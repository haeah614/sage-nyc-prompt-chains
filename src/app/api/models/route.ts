import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticatedApi } from "@/lib/auth/api";
import { errorResponse } from "@/lib/auth/errors";
import { promptRpc } from "@/lib/database/rpc";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await authenticatedApi();
    const url = new URL(request.url);
    const after = url.searchParams.get("after");
    const limit = Number(url.searchParams.get("limit") ?? 100);
    if (after && !z.uuid().safeParse(after).success)
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    const models = await promptRpc("pct_model_catalog", {
      p_after_id: after,
      p_limit: limit,
    });
    return NextResponse.json(models, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
