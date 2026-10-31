import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticatedApi, mutationApi } from "@/lib/auth/api";
import { errorResponse } from "@/lib/auth/errors";
import { promptRpc } from "@/lib/database/rpc";
import { updateChainSchema, deleteChainSchema } from "@/lib/database/schemas";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    await authenticatedApi();
    const { id } = await params;
    if (!z.uuid().safeParse(id).success)
      return NextResponse.json({ error: "Invalid chain id." }, { status: 400 });
    const chain = await promptRpc("pct_read_chain", { p_chain_id: id });
    return NextResponse.json(chain, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    await mutationApi(request);
    const { id } = await params;
    const body = updateChainSchema.parse({ ...(await request.json()), id });
    const chain = await promptRpc("pct_save_chain", {
      p_id: body.id,
      p_expected_revision: body.revision,
      p_name: body.name,
      p_slug: body.slug,
      p_version: body.version,
      p_description: body.description,
    });
    return NextResponse.json(chain);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    await mutationApi(request);
    const { id } = await params;
    const body = deleteChainSchema.parse({ ...(await request.json()), id });
    await promptRpc("pct_delete_chain_with_history", {
      p_chain_id: body.id,
      p_chain_revision: body.revision,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
