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
