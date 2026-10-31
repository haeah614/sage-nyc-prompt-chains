import { NextResponse } from "next/server";
import { z } from "zod";
import { mutationApi } from "@/lib/auth/api";
import { errorResponse, AuthError } from "@/lib/auth/errors";
import { promptRpc } from "@/lib/database/rpc";
import { generateWithGemini } from "@/lib/gemini";

type Context = { params: Promise<{ id: string }> };
type Claimed = {
  run_revision: number;
  step: {
    id: string;
    revision: number;
    lease_token: string;
    step_snapshot: {
      model_key: string;
      instruction: string;
      input_source: string;
      generation_config: Record<string, unknown>;
    };
    input_text: string;
  };
};
type RpcTiming = { name: string; ms: number };

async function timedPromptRpc<T>(
  name: string,
  args: Record<string, unknown>,
  timings: RpcTiming[],
) {
  const started = performance.now();
  try {
    return await promptRpc<T>(name, args);
  } finally {
    timings.push({ name, ms: Math.round(performance.now() - started) });
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const executionStarted = performance.now();
    const authStarted = performance.now();
    await mutationApi(request);
    const authMs = Math.round(performance.now() - authStarted);
    const { id } = await params;
    const runId = z.uuid().parse(id);
    const parseStarted = performance.now();
    let runRevision = z
      .number()
      .int()
      .min(1)
      .parse((await request.json().catch(() => ({})))?.run_revision);
    const parseMs = Math.round(performance.now() - parseStarted);
    let completed = 0;
    const rpcTimings: RpcTiming[] = [];
    const timings: Array<{
      position: number;
      modelKey: string;
      claimMs: number;
      geminiMs: number;
      finishMs: number;
      totalMs: number;
    }> = [];
    while (completed < 100) {
      const stepStarted = performance.now();
      const claimStarted = performance.now();
      let claimed: Claimed;
      try {
        claimed = await timedPromptRpc<Claimed>(
          "pct_claim_step",
          {
            p_run_id: runId,
            p_run_revision: runRevision,
          },
          rpcTimings,
        );
      } catch (error) {
        // A terminal run is a successful end state for this orchestration route.
        if (error instanceof AuthError && error.status === 400) break;
        throw error;
      }
      const claimMs = Math.round(performance.now() - claimStarted);
      const step = claimed.step;
      try {
        const geminiStarted = performance.now();
        const result = await generateWithGemini({
          modelKey: step.step_snapshot.model_key,
          instruction: step.step_snapshot.instruction,
          input: step.input_text,
          generationConfig: step.step_snapshot.generation_config,
        });
        const geminiMs = Math.round(performance.now() - geminiStarted);
        const finishStarted = performance.now();
        const finished = await timedPromptRpc<{
          id: string;
          revision: number;
          status: string;
        }>(
          "pct_finish_step",
          {
            p_run_id: runId,
            p_step_id: step.id,
            p_step_revision: step.revision,
            p_lease_token: step.lease_token,
            p_status: "succeeded",
            p_output_text: result.text,
            p_error_code: null,
            p_error_message: null,
            p_usage: result.usage,
            p_media: [],
          },
          rpcTimings,
        );
        const finishMs = Math.round(performance.now() - finishStarted);
        const totalMs = Math.round(performance.now() - stepStarted);
        timings.push({
          position: completed + 1,
          modelKey: step.step_snapshot.model_key,
          claimMs,
          geminiMs,
          finishMs,
          totalMs,
        });
        console.info("[prompt-tool] step execution timing", {
          runId,
          position: completed + 1,
          modelKey: step.step_snapshot.model_key,
          claimMs,
          geminiMs,
          finishMs,
          totalMs,
        });
        runRevision = finished.revision;
        completed += 1;
        if (finished.status === "succeeded") break;
      } catch (error) {
        await timedPromptRpc(
          "pct_finish_step",
          {
            p_run_id: runId,
            p_step_id: step.id,
            p_step_revision: step.revision,
            p_lease_token: step.lease_token,
            p_status: "failed",
            p_output_text: null,
            p_error_code:
              error instanceof AuthError && error.status === 503
                ? "timeout"
                : "provider_error",
            p_error_message:
              error instanceof AuthError
                ? error.message
                : "Gemini execution failed.",
            p_usage: {},
            p_media: [],
          },
          rpcTimings,
        );
        throw error;
      }
    }
    const readStarted = performance.now();
    const run = await timedPromptRpc<Record<string, unknown>>(
      "pct_read_run",
      {
        p_run_id: runId,
      },
      rpcTimings,
    );
    const readMs = Math.round(performance.now() - readStarted);
    const totalMs = Math.round(performance.now() - executionStarted);
    console.info("[prompt-tool] chain execution timing", {
      runId,
      totalMs,
      authMs,
      parseMs,
      readMs,
      rpcTimings,
      steps: timings.length,
    });
    return NextResponse.json({
      ...run,
      timings: {
        totalMs,
        authMs,
        parseMs,
        readMs,
        rpc: rpcTimings,
        steps: timings,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
