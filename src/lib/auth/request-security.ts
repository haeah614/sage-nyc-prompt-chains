import "server-only";
import { timingSafeEqual } from "node:crypto";
import { authConfig } from "./config";
import { AuthError } from "./errors";

export function trustedOrigin(request: Request, requireSameOrigin = true) {
  const { origin } = authConfig();
  if (
    new URL(request.url).origin !== origin ||
    (requireSameOrigin && request.headers.get("origin") !== origin)
  ) {
    throw new AuthError(403, "Request origin is not allowed.");
  }
  if (requireSameOrigin) {
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin")
      throw new AuthError(403, "Cross-site requests are not allowed.");
  }
  return origin;
}
export function assertJsonMutation(request: Request) {
  trustedOrigin(request);
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method))
    throw new AuthError(405, "Mutation method required.");
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new AuthError(415, "Use application/json.");
  // A custom header plus exact Origin checking prevents cross-origin form submissions.
  // Do not enable cross-origin CORS for these endpoints.
  if (request.headers.get("x-prompt-chains-csrf") !== "1")
    throw new AuthError(403, "CSRF verification failed.");
}
export function verifyGoogleCsrf(posted: unknown, cookie: string | undefined) {
  if (
    typeof posted !== "string" ||
    !posted ||
    !cookie ||
    posted.length > 512 ||
    Buffer.byteLength(posted) !== Buffer.byteLength(cookie) ||
    !timingSafeEqual(Buffer.from(posted), Buffer.from(cookie))
  ) {
    throw new AuthError(
      403,
      "Google sign-in verification failed. Restart sign-in.",
    );
  }
}
export async function readGoogleForm(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/x-www-form-urlencoded"
  )
    throw new AuthError(415, "Invalid sign-in submission.");
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError(400, "Missing sign-in submission.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16000) {
        await reader.cancel();
        throw new AuthError(413, "Request too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  if (
    form.getAll("credential").length !== 1 ||
    form.getAll("g_csrf_token").length !== 1
  )
    throw new AuthError(400, "Invalid sign-in submission.");
  return form;
}
