import { requirePageSuperadmin } from "@/lib/auth/guards";
import { PageHeading } from "@/components/ui/page-heading";
import { RunHistory } from "@/components/prompt-tool/run-history";
export const metadata = { title: "Run History" };
export default async function HistoryPage({
  searchParams,
}: { searchParams?: Promise<{ run?: string }> } = {}) {
  await requirePageSuperadmin();
  const { run } = (await searchParams) ?? {};
  return (
    <>
      <PageHeading
        eyebrow="REFLECT AND REFINE"
        title="Run History"
        description="Review every chain execution, its step outputs, and any errors."
      />
      <RunHistory selectedRun={run} />
    </>
  );
}
