import { NextResponse } from "next/server";
import { z } from "zod";
import { mutationApi } from "@/lib/auth/api";
import { errorResponse } from "@/lib/auth/errors";
import { promptRpc } from "@/lib/database/rpc";
import { createStepSchema } from "@/lib/database/schemas";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    await mutationApi(request);
    const { id } = await params;
    const body = createStepSchema.parse({
      ...(await request.json()),
      chain_id: id,
    });
    const step = await promptRpc("pct_save_step", {
      p_chain_id: body.chain_id,
      p_chain_revision: body.chain_revision,
      p_id: null,
      p_step_revision: null,
      p_name: body.name,
      p_instruction: body.instruction,
      p_model_id: body.model_id,
      p_input_source: body.input_source,
      p_generation_config: body.generation_config,
    });
    return NextResponse.json(step, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

const reorderSchema = z.object({
  chain_revision: z.number().int().min(1),
  step_ids: z.array(z.uuid()).max(100),
});

export async function PUT(request: Request, { params }: Context) {
  try {
    await mutationApi(request);
    const { id } = await params;
    const body = reorderSchema.parse(await request.json());
    if (!z.uuid().safeParse(id).success)
      return NextResponse.json({ error: "Invalid chain id." }, { status: 400 });
    const result = await promptRpc("pct_reorder_steps", {
      p_chain_id: id,
      p_chain_revision: body.chain_revision,
      p_step_ids: body.step_ids,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
