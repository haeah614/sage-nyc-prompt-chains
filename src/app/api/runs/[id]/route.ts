import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticatedApi } from "@/lib/auth/api";
import { errorResponse } from "@/lib/auth/errors";
import { promptRpc } from "@/lib/database/rpc";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Context) {
  try {
    await authenticatedApi();
    const { id } = await params;
    if (!z.uuid().safeParse(id).success)
      return NextResponse.json({ error: "Invalid run id." }, { status: 400 });
    return NextResponse.json(
      await promptRpc("pct_read_run", { p_run_id: id }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
