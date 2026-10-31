import { NextResponse } from "next/server";
import { z } from "zod";
import { mutationApi } from "@/lib/auth/api";
import { errorResponse } from "@/lib/auth/errors";
import { promptRpc } from "@/lib/database/rpc";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({
  revision: z.number().int().min(1),
  confirmation: z.literal("DELETE"),
});

export async function DELETE(request: Request, { params }: Context) {
  try {
    await mutationApi(request);
    const { id } = await params;
    const body = schema.parse(await request.json());
    await promptRpc("pct_delete_run", {
      p_run_id: z.uuid().parse(id),
      p_run_revision: body.revision,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
