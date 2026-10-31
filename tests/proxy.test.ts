import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { CookieOptions } from "@supabase/ssr";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  lookup: vi.fn(),
  refresh: false,
}));
vi.mock("@/lib/auth/superadmin", () => ({ lookupSuperadmin: mocks.lookup }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (
          values: { name: string; value: string; options: CookieOptions }[],
        ) => void;
      };
    },
  ) => ({
    auth: {
      getUser: async () => {
        if (mocks.refresh)
          options.cookies.setAll([
            {
              name: "sage-prompt-chains-auth.0",
              value: "refreshed-token",
              options: {
                httpOnly: true,
                secure: true,
                path: "/",
                sameSite: "lax",
              },
            },
          ]);
        return mocks.getUser();
      },
    },
  }),
}));
import { proxy } from "@/proxy";
import { AuthError } from "@/lib/auth/errors";
const origin = "https://chains.example.test";
const user = {
  id: "verified-user",
  app_metadata: { provider: "google" },
  identities: [{ provider: "google" }],
};
beforeEach(() => {
  mocks.refresh = false;
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.lookup.mockResolvedValue(true);
});
it.each([
  "/",
  "/chains",
  "/editor",
  "/history",
  "/settings",
  "/unknown",
  "/login/extra",
])("blocks unauthenticated page %s", async (path) => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  const response = await proxy(new NextRequest(origin + path));
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(origin + "/login");
});
it("returns 401 for unauthenticated API requests rather than HTML redirects", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await proxy(new NextRequest(origin + "/api/session"))).status).toBe(
    401,
  );
});
it("denies non-Superadmins on both pages and APIs", async () => {
  mocks.lookup.mockResolvedValue(false);
  expect((await proxy(new NextRequest(origin + "/api/future"))).status).toBe(
    403,
  );
  expect(
    (await proxy(new NextRequest(origin + "/chains"))).headers.get("location"),
  ).toBe(origin + "/denied");
});
it("preserves refreshed cookies on authorization redirects", async () => {
  mocks.refresh = true;
  mocks.lookup.mockResolvedValue(false);
  const request = new NextRequest(origin + "/chains");
  const response = await proxy(request);
  expect(response.cookies.get("sage-prompt-chains-auth.0")?.value).toBe(
    "refreshed-token",
  );
  expect(request.cookies.get("sage-prompt-chains-auth.0")?.value).toBe(
    "refreshed-token",
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("preserves refreshed cookies on successful requests and API denials", async () => {
  mocks.refresh = true;
  const response = await proxy(new NextRequest(origin + "/chains"));
  expect(response.status).toBe(200);
  expect(response.cookies.get("sage-prompt-chains-auth.0")?.httpOnly).toBe(
    true,
  );
  mocks.lookup.mockResolvedValue(false);
  const denied = await proxy(new NextRequest(origin + "/api/session"));
  expect(denied.status).toBe(403);
  expect(denied.cookies.get("sage-prompt-chains-auth.0")?.value).toBe(
    "refreshed-token",
  );
});
it("fails closed on missing configuration and database outages", async () => {
  mocks.lookup.mockRejectedValue(
    new AuthError(503, "Authorization unavailable"),
  );
  expect((await proxy(new NextRequest(origin + "/api/session"))).status).toBe(
    503,
  );
  vi.stubEnv("AUTH_ENABLED", "");
  const response = await proxy(new NextRequest(origin + "/chains"));
  expect(response.headers.get("location")).toBe(origin + "/auth-error");
});
it.each([
  "/login",
  "/denied",
  "/auth-error",
  "/auth/prepare",
  "/auth/callback",
  "/auth/signout",
])("keeps only explicit auth entry point %s public", async (path) => {
  expect((await proxy(new NextRequest(origin + path))).status).toBe(200);
  expect(mocks.getUser).not.toHaveBeenCalled();
});
