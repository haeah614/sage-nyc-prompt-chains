import "server-only";
import { createClient } from "@supabase/supabase-js";
import { authConfig } from "./config";
import { AuthError } from "./errors";

// Private privileged client: only reads this flag for an already verified identity.
// Never export a general service-role client or accept an ID from request input.
export async function lookupSuperadmin(
  verifiedUserId: string,
): Promise<boolean> {
  try {
    const { url, serviceKey } = authConfig();
    const client = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            cache: "no-store",
            signal: AbortSignal.timeout(10000),
          }),
      },
    });
    const { data, error } = await client
      .from("profiles")
      .select("is_superadmin")
      .eq("id", verifiedUserId)
      .maybeSingle();
    if (error) throw error;
    return data?.is_superadmin === true;
  } catch {
    throw new AuthError(503, "Authorization is temporarily unavailable.");
  }
}
