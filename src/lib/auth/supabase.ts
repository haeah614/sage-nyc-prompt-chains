import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authConfig, cookieOptions, SESSION_COOKIE } from "./config";

export async function sessionClient(writable = false) {
  const { url, key } = authConfig();
  const jar = await cookies();
  return createServerClient(url, key, {
    cookieOptions: { ...cookieOptions(), name: SESSION_COOKIE },
    global: {
      fetch: async (input, init) => {
        try {
          return await fetch(input, { ...init, cache: "no-store" });
        } catch (error) {
          const cause = error instanceof Error ? error.cause : undefined;
          const code =
            cause && typeof cause === "object" && "code" in cause
              ? cause.code
              : undefined;
          console.error("[auth] Supabase connection failed", {
            host: new URL(url).hostname,
            code:
              typeof code === "string" &&
              [
                "ENOTFOUND",
                "EAI_AGAIN",
                "ECONNREFUSED",
                "ETIMEDOUT",
                "ECONNRESET",
              ].includes(code)
                ? code
                : "network_error",
          });
          throw error;
        }
      },
    },
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        if (writable)
          values.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
        // Server components cannot set cookies. The proxy persists refreshes.
      },
    },
  });
}
