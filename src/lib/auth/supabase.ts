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
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
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
