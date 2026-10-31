import { AuthError } from "./errors";
export type VerifiedIdentity = {
  id: string;
  app_metadata: { provider?: string };
  identities?: { provider: string }[];
};

// Identity must come from Supabase getUser(), never a request body or getSession().
export async function authorize(
  getIdentity: () => Promise<VerifiedIdentity | null>,
  getFlag: (id: string) => Promise<boolean>,
) {
  const user = await getIdentity();
  if (!user) throw new AuthError(401, "Sign in with Google to continue.");
  if (
    user.app_metadata.provider !== "google" ||
    !user.identities?.some((identity) => identity.provider === "google")
  ) {
    throw new AuthError(403, "A Google identity is required.");
  }
  if ((await getFlag(user.id)) !== true)
    throw new AuthError(403, "Superadmin access is required.");
  return { id: user.id };
}
