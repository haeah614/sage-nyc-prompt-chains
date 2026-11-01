import { AuthCard } from "@/components/auth/auth-card";
import { GoogleLogin } from "@/components/auth/google-login";
import { authConfig } from "@/lib/auth/config";
export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  let config: ReturnType<typeof authConfig> | undefined;
  try {
    config = authConfig();
  } catch {
    /* Show configuration state without contacting Supabase. */
  }
  const { error } = await searchParams;
  return (
    <AuthCard title="Welcome to Prompt Studio">
      <p>Sign in with your approved Google account to enter the workspace.</p>
      <span className="pill subtle">SUPERADMIN ACCESS ONLY</span>
      {error && (
        <p className="auth-notice" role="alert">
          Sign-in could not be completed. Please try again.
        </p>
      )}
      {config ? (
        <GoogleLogin
          clientId={config.googleClientId}
          origins={config.origins}
        />
      ) : (
        <p className="auth-notice" role="status">
          Authentication is not configured. An administrator must enable the
          reviewed Google and Supabase setup before sign-in is available.
        </p>
      )}
      <p className="muted">
        Signing in does not grant access automatically. Your account must have
        Superadmin approval.
      </p>
    </AuthCard>
  );
}
