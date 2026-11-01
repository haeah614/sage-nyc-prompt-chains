import { expect, it, vi } from "vitest";
import { authConfig, cookieOptions, SESSION_COOKIE } from "@/lib/auth/config";
import {
  assertJsonMutation,
  trustedOrigin,
  verifyGoogleCsrf,
  readGoogleForm,
} from "@/lib/auth/request-security";
const origin = "https://chains.example.test";
function request(
  headers: Record<string, string> = {},
  method = "POST",
  url = origin + "/api/future",
) {
  return new Request(url, {
    method,
    headers: {
      origin,
      "content-type": "application/json",
      "x-prompt-chains-csrf": "1",
      ...headers,
    },
  });
}
it("allows an exact-origin JSON mutation with the CSRF header", () =>
  expect(() => assertJsonMutation(request())).not.toThrow());
it.each([
  "",
  "null",
  "https://evil.test",
  "https://chains.example.test.evil.test",
  "https://chains.example.test:444",
])("rejects invalid origins: %s", (value) => {
  expect(() => assertJsonMutation(request({ origin: value }))).toThrow(
    "origin",
  );
});
it("rejects a missing Origin and forged host even with matching origin header", () => {
  const missing = request();
  missing.headers.delete("origin");
  expect(() => assertJsonMutation(missing)).toThrow("origin");
  expect(() =>
    assertJsonMutation(request({}, "POST", "https://evil.test/api/future")),
  ).toThrow("origin");
});
it("rejects simple forms, missing CSRF header, cross-site metadata, and safe HTTP methods", () => {
  expect(() =>
    assertJsonMutation(request({ "content-type": "text/plain" })),
  ).toThrow("application/json");
  expect(() =>
    assertJsonMutation(request({ "x-prompt-chains-csrf": "" })),
  ).toThrow("CSRF");
  expect(() =>
    assertJsonMutation(request({ "sec-fetch-site": "same-site" })),
  ).toThrow("Cross-site");
  expect(() => assertJsonMutation(request({}, "GET"))).toThrow("method");
});
it("allows Google's cross-site callback only at the configured destination", () => {
  expect(
    trustedOrigin(request({ origin: "https://accounts.google.com" }), false),
  ).toBe(origin);
  expect(() =>
    trustedOrigin(
      request({}, "POST", "https://evil.test/auth/callback"),
      false,
    ),
  ).toThrow();
});
it("allows only explicitly listed deployment origins", () => {
  const deployment = "https://sage-nyc-prompt-chains-commit.vercel.app";
  vi.stubEnv("APP_ALLOWED_ORIGINS", deployment);
  const allowed = request(
    { origin: deployment },
    "POST",
    deployment + "/api/future",
  );
  expect(() => assertJsonMutation(allowed)).not.toThrow();
  expect(trustedOrigin(allowed)).toBe(deployment);
  const rejected = request(
    { origin: "https://untrusted.vercel.app" },
    "POST",
    "https://untrusted.vercel.app/api/future",
  );
  expect(() => assertJsonMutation(rejected)).toThrow("origin");
});
it("allows the exact Vercel deployment and branch system origins", () => {
  const deployment = "sage-nyc-prompt-chains-commit.vercel.app";
  const branch = "sage-nyc-prompt-chains-git-main.vercel.app";
  vi.stubEnv("VERCEL_URL", deployment);
  vi.stubEnv("VERCEL_BRANCH_URL", branch);
  for (const host of [deployment, branch]) {
    const origin = `https://${host}`;
    const allowed = request({ origin }, "POST", `${origin}/api/future`);
    expect(() => assertJsonMutation(allowed)).not.toThrow();
  }
  const rejected = request(
    { origin: "https://other-project.vercel.app" },
    "POST",
    "https://other-project.vercel.app/api/future",
  );
  expect(() => assertJsonMutation(rejected)).toThrow("origin");
});
it("requires matching nonempty Google double-submit CSRF tokens", () => {
  expect(() => verifyGoogleCsrf("same", "same")).not.toThrow();
  for (const [body, cookie] of [
    [null, "x"],
    ["", ""],
    ["x", undefined],
    ["aa", "ab"],
    ["é", "a"],
  ]) {
    expect(() => verifyGoogleCsrf(body, cookie as string | undefined)).toThrow(
      "verification",
    );
  }
});
it("limits actual callback bytes even without Content-Length", async () => {
  const make = (body: string) =>
    new Request(origin, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  expect(
    (await readGoogleForm(make("credential=test&g_csrf_token=test"))).get(
      "credential",
    ),
  ).toBe("test");
  await expect(
    readGoogleForm(make("credential=" + "a".repeat(16001))),
  ).rejects.toMatchObject({ status: 413 });
  await expect(
    readGoogleForm(make("credential=a&credential=b&g_csrf_token=c")),
  ).rejects.toMatchObject({ status: 400 });
});
it("disables authentication by default and rejects malformed origins", () => {
  vi.stubEnv("AUTH_ENABLED", "");
  expect(() => authConfig()).toThrow("not configured");
  vi.stubEnv("AUTH_ENABLED", "true");
  vi.stubEnv("APP_ORIGIN", origin + "/path");
  expect(() => authConfig()).toThrow("invalid");
});
it("rejects malformed or duplicate allowlist entries", () => {
  vi.stubEnv("APP_ORIGIN", origin);
  vi.stubEnv("APP_ALLOWED_ORIGINS", "https://deploy.example/path");
  expect(() => authConfig()).toThrow("invalid");
  vi.stubEnv("APP_ALLOWED_ORIGINS", `${origin},${origin}`);
  expect(() => authConfig()).toThrow("invalid");
});
it("rejects malformed Vercel system origins", () => {
  vi.stubEnv("VERCEL_URL", "https://deployment.example/path");
  expect(() => authConfig()).toThrow("invalid");
});
it("uses an isolated, HttpOnly, host-only session cookie with production Secure", () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(SESSION_COOKIE).toBe("sage-prompt-chains-auth");
  expect(cookieOptions()).toEqual({
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
  });
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
  expect(() => authConfig()).toThrow("invalid");
});
