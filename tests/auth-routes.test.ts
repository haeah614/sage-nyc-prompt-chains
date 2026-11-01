import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  set: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  getUser: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      mocks.jar.has(name) ? { name, value: mocks.jar.get(name) } : undefined,
    getAll: () => [...mocks.jar].map(([name, value]) => ({ name, value })),
    set: mocks.set,
  }),
}));
vi.mock("@/lib/auth/supabase", () => ({
  sessionClient: async () => ({
    auth: {
      signInWithIdToken: mocks.signIn,
      signOut: mocks.signOut,
      getUser: mocks.getUser,
    },
  }),
}));
vi.mock("@/lib/auth/superadmin", () => ({ lookupSuperadmin: mocks.lookup }));
import { POST as prepare } from "@/app/auth/prepare/route";
import { POST as callback } from "@/app/auth/callback/route";
import { POST as signout } from "@/app/auth/signout/route";
import { NONCE_COOKIE, SESSION_COOKIE } from "@/lib/auth/config";
const origin = "https://chains.example.test";
const nonce = "a".repeat(64);
function callbackRequest(
  body = "credential=synthetic-token&g_csrf_token=csrf",
  url = origin + "/auth/callback",
) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}
beforeEach(() => {
  mocks.jar.clear();
  mocks.jar.set("g_csrf_token", "csrf");
  mocks.jar.set(NONCE_COOKIE, nonce);
  mocks.set.mockImplementation((name: string, value: string) => {
    mocks.jar.set(name, value);
  });
  mocks.signIn.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        id: "verified-user",
        app_metadata: { provider: "google" },
        identities: [{ provider: "google" }],
      },
    },
    error: null,
  });
  mocks.lookup.mockResolvedValue(true);
});
it("prepares a random HttpOnly nonce, exposing only its hash to Google", async () => {
  const response = await prepare(
    new Request(origin + "/auth/prepare", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-prompt-chains-csrf": "1",
      },
    }),
  );
  expect(response.status).toBe(200);
  const raw = mocks.jar.get(NONCE_COOKIE)!;
  expect(raw).toMatch(/^[a-f0-9]{64}$/);
  expect(await response.json()).toEqual({
    nonce: createHash("sha256").update(raw).digest("hex"),
  });
  expect(mocks.set).toHaveBeenCalledWith(
    NONCE_COOKIE,
    raw,
    expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 600,
    }),
  );
});
it("rejects cross-origin nonce preparation", async () => {
  expect(
    (
      await prepare(
        new Request(origin + "/auth/prepare", {
          method: "POST",
          headers: { origin: "https://evil.test" },
        }),
      )
    ).status,
  ).toBe(403);
  expect(mocks.set).not.toHaveBeenCalled();
});
it("exchanges the Google token with the raw nonce then authorizes its verified identity", async () => {
  const response = await callback(callbackRequest());
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(origin + "/chains");
  expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith({
    provider: "google",
    token: "synthetic-token",
    nonce,
  });
  expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith("verified-user");
  expect(mocks.jar.get(NONCE_COOKIE)).toBe("");
});
it("accepts a Google callback on an explicitly allowed deployment origin", async () => {
  const deployment = "https://sage-nyc-prompt-chains-commit.vercel.app";
  vi.stubEnv("APP_ALLOWED_ORIGINS", deployment);
  const response = await callback(
    callbackRequest(
      "credential=synthetic-token&g_csrf_token=csrf",
      deployment + "/auth/callback",
    ),
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(deployment + "/chains");
});
it("never exchanges tokens with a missing/mismatched CSRF token", async () => {
  await callback(
    callbackRequest("credential=synthetic-token&g_csrf_token=wrong"),
  );
  expect(mocks.signIn).not.toHaveBeenCalled();
  expect(mocks.lookup).not.toHaveBeenCalled();
});
it("rejects expired or missing login nonces and does not replay a consumed nonce", async () => {
  mocks.jar.delete(NONCE_COOKIE);
  await callback(callbackRequest());
  expect(mocks.signIn).not.toHaveBeenCalled();
  mocks.jar.set(NONCE_COOKIE, nonce);
  await callback(callbackRequest());
  await callback(callbackRequest());
  expect(mocks.signIn).toHaveBeenCalledOnce();
});
it("denies non-Superadmins after valid Google sign-in", async () => {
  mocks.lookup.mockResolvedValue(false);
  const response = await callback(callbackRequest());
  expect(response.headers.get("location")).toBe(origin + "/denied");
});
it("rejects provider exchange errors before reading profiles", async () => {
  mocks.signIn.mockResolvedValue({
    error: { message: "sensitive provider error" },
  });
  const response = await callback(callbackRequest());
  expect(response.headers.get("location")).toBe(origin + "/login?error=signin");
  expect(mocks.lookup).not.toHaveBeenCalled();
});
it("rejects untrusted callback destinations and ignores supplied return paths", async () => {
  expect(
    (
      await callback(
        callbackRequest(undefined, "https://evil.test/auth/callback"),
      )
    ).status,
  ).toBe(403);
  expect(mocks.signIn).not.toHaveBeenCalled();
  const response = await callback(
    callbackRequest(
      undefined,
      origin + "/auth/callback?next=https://evil.test",
    ),
  );
  expect(response.headers.get("location")).toBe(origin + "/chains");
});
it("rejects oversized callback bodies before token exchange", async () => {
  await callback(
    callbackRequest("credential=" + "x".repeat(17000) + "&g_csrf_token=csrf"),
  );
  expect(mocks.signIn).not.toHaveBeenCalled();
});
it("signs out only the local session and clears only this app's cookies", async () => {
  mocks.jar.set(SESSION_COOKIE + ".0", "session");
  mocks.jar.set("sage-admin-auth.0", "other-session");
  const response = await signout(
    new Request(origin + "/auth/signout", {
      method: "POST",
      headers: { origin },
    }),
  );
  expect(response.status).toBe(303);
  expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  expect(mocks.jar.get(SESSION_COOKIE + ".0")).toBe("");
  expect(mocks.jar.get("sage-admin-auth.0")).toBe("other-session");
});
it.each([undefined, "https://evil.test", "null"])(
  "rejects sign-out without exact same-origin: %s",
  async (value) => {
    const response = await signout(
      new Request(origin + "/auth/signout", {
        method: "POST",
        headers: value ? { origin: value } : {},
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.signOut).not.toHaveBeenCalled();
  },
);
it("reports sign-out failures without claiming the session was revoked", async () => {
  mocks.signOut.mockResolvedValue({ error: new Error("secret details") });
  const response = await signout(
    new Request(origin + "/auth/signout", {
      method: "POST",
      headers: { origin },
    }),
  );
  expect(response.status).toBe(503);
  expect(mocks.set).not.toHaveBeenCalled();
  expect(await response.text()).not.toContain("secret");
});
