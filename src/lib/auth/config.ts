import "server-only";
import { AuthError } from "./errors";

export const SESSION_COOKIE = "sage-prompt-chains-auth";
export const NONCE_COOKIE = "sage-prompt-chains-login-nonce";
function deploymentOrigin(value: string | undefined) {
  if (!value) return [];
  const candidate = value.startsWith("http") ? value : `https://${value}`;
  return [candidate];
}
function configuredOrigins(origin: string) {
  return [
    origin,
    ...(process.env.APP_ALLOWED_ORIGINS ?? "").split(","),
    ...deploymentOrigin(process.env.VERCEL_URL),
    ...deploymentOrigin(process.env.VERCEL_BRANCH_URL),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
}
export function cookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
export function authConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const origin = process.env.APP_ORIGIN;
  if (
    process.env.AUTH_ENABLED !== "true" ||
    !url ||
    !key ||
    !serviceKey ||
    !googleClientId ||
    !origin
  ) {
    throw new AuthError(503, "Authentication is not configured.");
  }
  try {
    const origins = configuredOrigins(origin);
    if (new Set(origins).size !== origins.length || origins.length > 10)
      throw new Error();
    for (const candidate of origins) {
      const parsed = new URL(candidate);
      if (
        parsed.origin !== candidate ||
        parsed.username ||
        parsed.password ||
        (parsed.protocol !== "https:" &&
          !(
            process.env.NODE_ENV !== "production" &&
            parsed.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(parsed.hostname)
          ))
      )
        throw new Error();
    }
    const supabase = new URL(url);
    if (
      supabase.protocol !== "https:" ||
      supabase.username ||
      supabase.password
    )
      throw new Error();
  } catch {
    throw new AuthError(503, "Authentication configuration is invalid.");
  }
  return {
    url,
    key,
    serviceKey,
    googleClientId,
    origin,
    origins: configuredOrigins(origin),
  };
}
