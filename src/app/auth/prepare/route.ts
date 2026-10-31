import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertJsonMutation } from "@/lib/auth/request-security";
import { cookieOptions, NONCE_COOKIE } from "@/lib/auth/config";
import { errorResponse } from "@/lib/auth/errors";

export async function POST(request: Request) {
  try {
    assertJsonMutation(request);
    const nonce = randomBytes(32).toString("hex");
    (await cookies()).set(NONCE_COOKIE, nonce, {
      ...cookieOptions(),
      sameSite: "none",
      secure: true,
      maxAge: 600,
    });
    return NextResponse.json(
      { nonce: createHash("sha256").update(nonce).digest("hex") },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
