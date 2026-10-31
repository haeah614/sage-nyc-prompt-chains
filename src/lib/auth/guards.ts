import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sessionClient } from "./supabase";
import { authorize } from "./policy";
import { lookupSuperadmin } from "./superadmin";
import { AuthError } from "./errors";
import { assertJsonMutation } from "./request-security";

export async function requireSuperadmin(client?: SupabaseClient) {
  const session = client ?? (await sessionClient());
  return authorize(async () => {
    const { data, error } = await session.auth.getUser();
    if (error && (error.status === undefined || error.status >= 500))
      throw new AuthError(503, "Authentication is temporarily unavailable.");
    return error ? null : data.user;
  }, lookupSuperadmin);
}
export async function requirePageSuperadmin() {
  try {
    return await requireSuperadmin();
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) redirect("/login");
    if (error instanceof AuthError && error.status === 403) redirect("/denied");
    redirect("/auth-error");
  }
}
// Future mutation handlers must call this before parsing input or accessing data.
export async function requireMutationSuperadmin(request: Request) {
  assertJsonMutation(request);
  return requireSuperadmin();
}
