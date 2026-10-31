import { NextResponse } from "next/server";
import { stopRunSchema } from "@/lib/database/schemas";
import { mutationApi } from "@/lib/auth/api";
import { errorResponse } from "@/lib/auth/errors";
import { promptRpc } from "@/lib/database/rpc";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  try {
    await mutationApi(request);
    const { id } = await params;
    const body = stopRunSchema.parse({ ...(await request.json()), run_id: id });
    return NextResponse.json(
      await promptRpc("pct_stop_run", {
        p_run_id: body.run_id,
        p_run_revision: body.run_revision,
        p_reason: body.reason,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
