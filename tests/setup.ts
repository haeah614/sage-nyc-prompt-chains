import { beforeEach, vi } from "vitest";
beforeEach(() => {
  // Never contact Google, Supabase, or any external service in this test suite.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected network request in mocked test");
    }),
  );
  vi.stubEnv("AUTH_ENABLED", "true");
  vi.stubEnv("APP_ORIGIN", "https://chains.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-public-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-server-secret");
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "synthetic-google-id");
});
