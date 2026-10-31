import { expect, it, vi } from "vitest";
const guard = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error("ACCESS_BLOCKED");
  }),
);
vi.mock("@/lib/auth/guards", () => ({ requirePageSuperadmin: guard }));
import Chains from "@/app/(protected)/chains/page";
import Editor from "@/app/(protected)/editor/page";
import History from "@/app/(protected)/history/page";
import Settings from "@/app/(protected)/settings/page";
import Layout from "@/app/(protected)/layout";
import Home from "@/app/page";
it.each([Chains, Editor, History, Settings, Home])(
  "checks authorization before rendering %s even without proxy/layout",
  async (Page) => {
    await expect(Page()).rejects.toThrow("ACCESS_BLOCKED");
    expect(guard).toHaveBeenCalledOnce();
  },
);
it("checks authorization before rendering the navigation shell", async () => {
  await expect(Layout({ children: "private" })).rejects.toThrow(
    "ACCESS_BLOCKED",
  );
});
