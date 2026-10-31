import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sessionClient } from "@/lib/auth/supabase";
import { trustedOrigin } from "@/lib/auth/request-security";
import { AuthError, errorResponse } from "@/lib/auth/errors";
import { cookieOptions, NONCE_COOKIE, SESSION_COOKIE } from "@/lib/auth/config";

export async function POST(request: Request) {
  try {
    const origin = trustedOrigin(request);
    const client = await sessionClient(true);
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw new AuthError(503, "Sign-out failed. Please retry.");
    const jar = await cookies();
    for (const { name } of jar.getAll()) {
      if (
        name === NONCE_COOKIE ||
        name === SESSION_COOKIE ||
        name.startsWith(`${SESSION_COOKIE}.`) ||
        name.startsWith(`${SESSION_COOKIE}-`)
      ) {
        jar.set(name, "", { ...cookieOptions(), maxAge: 0 });
      }
    }
    return NextResponse.redirect(new URL("/login", origin), {
      status: 303,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
