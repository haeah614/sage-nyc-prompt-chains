import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticatedApi, mutationApi } from "@/lib/auth/api";
import { errorResponse } from "@/lib/auth/errors";
import { promptRpc } from "@/lib/database/rpc";
import { chainDefinitionSchema } from "@/lib/database/schemas";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await authenticatedApi();
    const url = new URL(request.url);
    const after = url.searchParams.get("after");
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (after && !z.uuid().safeParse(after).success)
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      return NextResponse.json({ error: "Invalid limit." }, { status: 400 });
    const chains = await promptRpc("pct_list_chains", {
      p_after_id: after,
      p_limit: limit,
    });
    return NextResponse.json(chains, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await mutationApi(request);
    const body = chainDefinitionSchema.parse(await request.json());
    const chain = await promptRpc("pct_save_chain", {
      p_id: null,
      p_expected_revision: null,
      p_name: body.name,
      p_slug: body.slug,
      p_version: body.version,
      p_description: body.description,
    });
    return NextResponse.json(chain, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
