import { NextResponse } from "next/server";
import { enqueueRunSchema, historySchema } from "@/lib/database/schemas";
import { authenticatedApi, mutationApi } from "@/lib/auth/api";
import { errorResponse } from "@/lib/auth/errors";
import { promptRpc } from "@/lib/database/rpc";

export async function POST(request: Request) {
  try {
    await mutationApi(request);
    const body = enqueueRunSchema.parse(await request.json());
    const result = await promptRpc("pct_enqueue_run", {
      p_chain_id: body.chain_id,
      p_chain_revision: body.chain_revision,
      p_input_text: body.input_text,
      p_idempotency_key: body.idempotency_key,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    await authenticatedApi();
    const url = new URL(request.url);
    const parsed = historySchema.parse({
      chain_id: url.searchParams.get("chain_id"),
      before_at: url.searchParams.get("before_at"),
      before_id: url.searchParams.get("before_id"),
      limit: Number(url.searchParams.get("limit") ?? 25),
    });
    const result = await promptRpc("pct_run_history", {
      p_chain_id: parsed.chain_id,
      p_before_at: parsed.before_at,
      p_before_id: parsed.before_id,
      p_limit: parsed.limit,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
