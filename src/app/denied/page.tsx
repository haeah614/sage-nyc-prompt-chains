import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { SignOutButton } from "@/components/auth/sign-out-button";
export const metadata = { title: "Access denied" };
export default function Denied() {
  return (
    <AuthCard title="Access denied">
      <p>
        This workspace requires an approved Google identity and Superadmin
        access. If sign-in expired, restart it; otherwise contact your
        administrator.
      </p>
      <SignOutButton />
      <Link href="/login" className="primary-link">
        Return to sign-in
      </Link>
    </AuthCard>
  );
}
