import { requirePageSuperadmin } from "@/lib/auth/guards";
import { PageHeading } from "@/components/ui/page-heading";
import { ChainEditor } from "@/components/prompt-tool/chain-editor";
export const metadata = { title: "Chain Editor" };
export default async function EditorPage({
  searchParams,
}: { searchParams?: Promise<{ chain?: string }> } = {}) {
  await requirePageSuperadmin();
  const { chain } = (await searchParams) ?? {};
  return (
    <>
      <PageHeading
        eyebrow="MAKE SPACE FOR YOUR PROCESS"
        title="Chain Editor"
        description="Compose steps, configure approved Gemini models, and run a workflow."
      />
      <ChainEditor initialChainId={chain} />
    </>
  );
}
