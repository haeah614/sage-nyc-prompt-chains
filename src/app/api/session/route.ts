import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth/guards";
import { errorResponse } from "@/lib/auth/errors";
export async function GET() {
  try {
    const actor = await requireSuperadmin();
    return NextResponse.json(
      { user: { id: actor.id } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
