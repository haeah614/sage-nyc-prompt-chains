import { expect, it, vi } from "vitest";
import { lookupSuperadmin } from "@/lib/auth/superadmin";
it("makes only a scoped read with the server key and no session cookies", async () => {
  const network = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ is_superadmin: true }), {
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", network);
  expect(await lookupSuperadmin("verified-user")).toBe(true);
  expect(network).toHaveBeenCalledOnce();
  const [url, init] = network.mock.calls[0];
  const query = new URL(url);
  expect(query.pathname).toBe("/rest/v1/profiles");
  expect([...query.searchParams]).toEqual([
    ["select", "is_superadmin"],
    ["id", "eq.verified-user"],
  ]);
  expect(new Headers(init.headers).get("authorization")).toBe(
    "Bearer synthetic-server-secret",
  );
  expect(new Headers(init.headers).has("cookie")).toBe(false);
  expect(init.cache).toBe("no-store");
  expect(init.method).toBe("GET");
});
it.each([
  null,
  { is_superadmin: false },
  { is_superadmin: null },
  { is_superadmin: "true" },
])("denies missing or non-true profile %s", async (data) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  expect(await lookupSuperadmin("verified-user")).toBe(false);
});
it("does not expose database failures", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "private database details" }), {
        status: 403,
      }),
    ),
  );
  await expect(lookupSuperadmin("verified-user")).rejects.toMatchObject({
    status: 503,
    message: "Authorization is temporarily unavailable.",
  });
});
