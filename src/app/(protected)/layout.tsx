import { AppShell } from "@/components/layout/app-shell";
import { requirePageSuperadmin } from "@/lib/auth/guards";
export const dynamic = "force-dynamic";
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePageSuperadmin();
  return <AppShell>{children}</AppShell>;
}
