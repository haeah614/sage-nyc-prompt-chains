import { NextResponse } from "next/server";
import { z } from "zod";
import { mutationApi } from "@/lib/auth/api";
import { errorResponse } from "@/lib/auth/errors";
import { promptRpc } from "@/lib/database/rpc";

const schema = z.object({
  confirmation: z.literal("CLEAR"),
  chain_id: z.uuid().nullable().optional(),
});

export async function DELETE(request: Request) {
  try {
    await mutationApi(request);
    const body = schema.parse(await request.json());
    const deleted = await promptRpc<number>("pct_clear_run_history", {
      p_chain_id: body.chain_id ?? null,
    });
    return NextResponse.json({ deleted });
  } catch (error) {
    return errorResponse(error);
  }
}
