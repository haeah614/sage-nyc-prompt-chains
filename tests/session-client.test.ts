import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), set: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.create }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: mocks.set }),
}));
import { sessionClient } from "@/lib/auth/supabase";
beforeEach(() => {
  mocks.create.mockReturnValue({});
});
it("uses only the public key and isolated session cookie", async () => {
  vi.stubEnv("NODE_ENV", "production");
  await sessionClient(true);
  expect(mocks.create).toHaveBeenCalledWith(
    "https://test.supabase.invalid",
    "synthetic-public-key",
    expect.objectContaining({
      cookieOptions: {
        name: "sage-prompt-chains-auth",
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: true,
      },
    }),
  );
});
it("persists cookie writes in handlers and leaves component refresh persistence to proxy", async () => {
  await sessionClient(true);
  const values = [
    {
      name: "sage-prompt-chains-auth.0",
      value: "session",
      options: { httpOnly: true },
    },
  ];
  mocks.create.mock.calls[0][2].cookies.setAll(values);
  expect(mocks.set).toHaveBeenCalledWith(
    values[0].name,
    values[0].value,
    values[0].options,
  );
  mocks.set.mockClear();
  await sessionClient();
  mocks.create.mock.calls[1][2].cookies.setAll(values);
  expect(mocks.set).not.toHaveBeenCalled();
});
it("does not swallow handler cookie write failures", async () => {
  mocks.set.mockImplementationOnce(() => {
    throw new Error("Cookie failure");
  });
  await sessionClient(true);
  expect(() =>
    mocks.create.mock.calls[0][2].cookies.setAll([
      { name: "session", value: "x", options: {} },
    ]),
  ).toThrow("Cookie failure");
});
it("does not construct a Supabase client with authentication disabled", async () => {
  vi.stubEnv("AUTH_ENABLED", "");
  await expect(sessionClient()).rejects.toMatchObject({ status: 503 });
  expect(mocks.create).not.toHaveBeenCalled();
});
