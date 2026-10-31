import { NextResponse } from "next/server";
import { mutationApi } from "@/lib/auth/api";
import { errorResponse } from "@/lib/auth/errors";
import { promptRpc } from "@/lib/database/rpc";
import { updateStepSchema, deleteStepSchema } from "@/lib/database/schemas";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    await mutationApi(request);
    const { id } = await params;
    const body = updateStepSchema.parse({ ...(await request.json()), id });
    const result = await promptRpc("pct_save_step", {
      p_chain_id: body.chain_id,
      p_chain_revision: body.chain_revision,
      p_id: body.id,
      p_step_revision: body.revision,
      p_name: body.name,
      p_instruction: body.instruction,
      p_model_id: body.model_id,
      p_input_source: body.input_source,
      p_generation_config: body.generation_config,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    await mutationApi(request);
    const { id } = await params;
    const body = deleteStepSchema.parse({ ...(await request.json()), id });
    await promptRpc("pct_delete_step", {
      p_chain_id: body.chain_id,
      p_chain_revision: body.chain_revision,
      p_step_id: body.id,
      p_step_revision: body.revision,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
