import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthError } from "@/lib/auth/errors";
import { sessionClient } from "@/lib/auth/supabase";

/**
 * All Prompt Tool database access goes through the reviewed RPC surface. The
 * RPCs perform the authoritative Superadmin check inside Postgres; this helper
 * only normalizes errors and never accepts a caller-supplied actor id.
 */
export async function promptRpc<T>(
  name: string,
  args: Record<string, unknown> = {},
  client?: SupabaseClient,
): Promise<T> {
  const db = client ?? (await sessionClient());
  const { data, error } = await db.rpc(name, args);
  if (error) {
    const status =
      error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400;
    throw new AuthError(
      status,
      status === 403 ? "Superadmin authorization required." : error.message,
    );
  }
  return data as T;
}
