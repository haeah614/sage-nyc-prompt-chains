import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { SignOutButton } from "@/components/auth/sign-out-button";
export const metadata = { title: "Authentication unavailable" };
export default function AuthUnavailable() {
  return (
    <AuthCard title="Unable to verify access">
      <p>
        Authentication may be unconfigured or temporarily unavailable. No
        workspace data has been loaded. Try again or contact the administrator.
      </p>
      <Link href="/login" className="primary-link">
        Return to sign-in
      </Link>
      <SignOutButton />
    </AuthCard>
  );
}
