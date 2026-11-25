import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionClient } from "@/lib/auth/supabase";
import { requireSuperadmin } from "@/lib/auth/guards";
import { AuthError, errorResponse } from "@/lib/auth/errors";
import {
  trustedOrigin,
  readGoogleForm,
  verifyGoogleCsrf,
} from "@/lib/auth/request-security";
import { cookieOptions, NONCE_COOKIE } from "@/lib/auth/config";

export async function POST(request: Request) {
  let origin: string | undefined;
  try {
    // Google submits cross-site: exact destination + its double-submit CSRF check
    // replace the same-origin requirement used by ordinary mutation endpoints.
    origin = trustedOrigin(request, false);
    const form = await readGoogleForm(request);
    const jar = await cookies();
    verifyGoogleCsrf(form.get("g_csrf_token"), jar.get("g_csrf_token")?.value);
    const nonce = jar.get(NONCE_COOKIE)?.value;
    jar.set(NONCE_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
    if (!nonce || !/^[a-f0-9]{64}$/.test(nonce))
      throw new AuthError(403, "Sign-in expired. Restart sign-in.");
    const credential = form.get("credential");
    if (!credential || credential.length > 12000)
      throw new AuthError(400, "Invalid Google credential.");
    const client = await sessionClient(true);
    const { error } = await client.auth.signInWithIdToken({
      provider: "google",
      token: credential,
      nonce,
    });
    if (error) {
      const unavailable =
        error.status === 0 ||
        error.status === undefined ||
        error.status === 429 ||
        error.status >= 500;
      // Never log the credential, nonce, session, or raw provider message.
      console.error("[auth] Google ID-token exchange failed", {
        status: error.status,
        unavailable,
      });
      throw new AuthError(
        unavailable ? 503 : 401,
        unavailable
          ? "Authentication is temporarily unavailable."
          : "Google sign-in failed.",
      );
    }
    await requireSuperadmin(client);
    return NextResponse.redirect(new URL("/chains", origin), {
      status: 303,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    // Fixed destinations only; never consume a caller-supplied return URL.
    if (!origin) return errorResponse(error);
    const destination =
      error instanceof AuthError && error.status === 403
        ? "/denied"
        : error instanceof AuthError && error.status < 500
          ? "/login?error=signin"
          : "/auth-error";
    return NextResponse.redirect(new URL(destination, origin), {
      status: 303,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
