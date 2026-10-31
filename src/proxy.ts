import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig, cookieOptions, SESSION_COOKIE } from "@/lib/auth/config";
import { requireSuperadmin } from "@/lib/auth/guards";
import { AuthError, errorResponse } from "@/lib/auth/errors";

const publicPaths = new Set([
  "/login",
  "/denied",
  "/auth-error",
  "/auth/prepare",
  "/auth/callback",
  "/auth/signout",
]);
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  if (publicPaths.has(request.nextUrl.pathname)) return response;
  function carryCookies(target: NextResponse) {
    response.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
    target.headers.set("Cache-Control", "private, no-store");
    return target;
  }
  try {
    const { url, key } = authConfig();
    const client = createServerClient(url, key, {
      cookieOptions: { ...cookieOptions(), name: SESSION_COOKIE },
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          const previous = response.cookies.getAll();
          response = NextResponse.next({ request });
          previous.forEach((cookie) => response.cookies.set(cookie));
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });
    await requireSuperadmin(client);
    return carryCookies(response);
  } catch (error) {
    if (
      request.nextUrl.pathname === "/api" ||
      request.nextUrl.pathname.startsWith("/api/")
    )
      return carryCookies(errorResponse(error));
    const destination =
      error instanceof AuthError && error.status === 401
        ? "/login"
        : error instanceof AuthError && error.status === 403
          ? "/denied"
          : "/auth-error";
    return carryCookies(
      NextResponse.redirect(new URL(destination, request.url)),
    );
  }
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
