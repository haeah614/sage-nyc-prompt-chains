import { describe, it, expect, vi } from "vitest";
import { authorize } from "@/lib/auth/policy";
const google = {
  id: "verified-user",
  app_metadata: { provider: "google" },
  identities: [{ provider: "google" }],
};
describe("deny-by-default authorization", () => {
  it("returns 401 without reading profiles for an anonymous caller", async () => {
    const lookup = vi.fn();
    await expect(authorize(async () => null, lookup)).rejects.toMatchObject({
      status: 401,
    });
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each([false, null, undefined, "true", 1])(
    "requires a literal true flag, rejects %s",
    async (value) => {
      await expect(
        authorize(
          async () => google,
          async () => value as boolean,
        ),
      ).rejects.toMatchObject({ status: 403 });
    },
  );
  it("only passes the authenticated user's ID to the flag lookup", async () => {
    const lookup = vi.fn(async () => true);
    expect(
      await authorize(
        async () => ({
          ...google,
          user_metadata: { is_superadmin: true, id: "attacker" },
        }),
        lookup,
      ),
    ).toEqual({ id: "verified-user" });
    expect(lookup).toHaveBeenCalledExactlyOnceWith("verified-user");
  });
  it.each([
    { ...google, app_metadata: { provider: "email" } },
    { ...google, identities: [] },
    { ...google, identities: undefined },
  ])("rejects a non-Google or metadata-only identity", async (user) => {
    const lookup = vi.fn(async () => true);
    await expect(authorize(async () => user, lookup)).rejects.toMatchObject({
      status: 403,
    });
    expect(lookup).not.toHaveBeenCalled();
  });
  it("does not trust user metadata for the role", async () => {
    await expect(
      authorize(
        async () => ({ ...google, user_metadata: { is_superadmin: true } }),
        async () => false,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("fails closed when the profile store fails", async () => {
    await expect(
      authorize(
        async () => google,
        async () => {
          throw new Error("offline");
        },
      ),
    ).rejects.toThrow("offline");
  });
});
