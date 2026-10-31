import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), lookup: vi.fn() }));
vi.mock("@/lib/auth/supabase", () => ({
  sessionClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/lib/auth/superadmin", () => ({ lookupSuperadmin: mocks.lookup }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
import { GET } from "@/app/api/session/route";
import {
  requirePageSuperadmin,
  requireMutationSuperadmin,
} from "@/lib/auth/guards";
const user = {
  id: "verified-id",
  app_metadata: { provider: "google" },
  identities: [{ provider: "google" }],
};
beforeEach(() => {
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.lookup.mockResolvedValue(true);
});
it("protects the API without relying on the proxy", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  const response = await GET();
  expect(response.status).toBe(401);
  expect(mocks.lookup).not.toHaveBeenCalled();
  expect(await response.text()).not.toContain("verified-id");
});
it("returns 403 for ordinary users and no protected identity", async () => {
  mocks.lookup.mockResolvedValue(false);
  const response = await GET();
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain("verified-id");
});
it("returns only the verified ID for an approved Google identity", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ user: { id: "verified-id" } });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("rejects invalid sessions even when a user object accompanies an error", async () => {
  mocks.getUser.mockResolvedValue({ data: { user }, error: { status: 401 } });
  expect((await GET()).status).toBe(401);
  expect(mocks.lookup).not.toHaveBeenCalled();
});
it("sanitizes upstream errors and fails closed", async () => {
  mocks.lookup.mockRejectedValue(new Error("secret database details"));
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("secret");
});
it("treats Auth service outages as 503", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: null },
    error: { status: 500 },
  });
  expect((await GET()).status).toBe(503);
});
it("checks the database again on subsequent requests (role revocation)", async () => {
  expect((await GET()).status).toBe(200);
  mocks.lookup.mockResolvedValue(false);
  expect((await GET()).status).toBe(403);
});
it("redirects unauthenticated and forbidden pages to dedicated states", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(requirePageSuperadmin()).rejects.toThrow("REDIRECT:/login");
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.lookup.mockResolvedValue(false);
  await expect(requirePageSuperadmin()).rejects.toThrow("REDIRECT:/denied");
  mocks.lookup.mockRejectedValue(new Error());
  await expect(requirePageSuperadmin()).rejects.toThrow("REDIRECT:/auth-error");
});
it("future mutation guard checks CSRF before session or database access", async () => {
  await expect(
    requireMutationSuperadmin(
      new Request("https://chains.example.test/api/future", { method: "POST" }),
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(mocks.getUser).not.toHaveBeenCalled();
});
it("future mutation guard also rejects an authenticated non-Superadmin", async () => {
  mocks.lookup.mockResolvedValue(false);
  await expect(
    requireMutationSuperadmin(
      new Request("https://chains.example.test/api/future", {
        method: "POST",
        headers: {
          origin: "https://chains.example.test",
          "content-type": "application/json",
          "x-prompt-chains-csrf": "1",
        },
      }),
    ),
  ).rejects.toMatchObject({ status: 403 });
});
