import { requirePageSuperadmin } from "@/lib/auth/guards";
import { PageHeading } from "@/components/ui/page-heading";
import { ChainLibrary } from "@/components/prompt-tool/chain-library";
export const metadata = { title: "Prompt Chains" };

export default async function ChainsPage() {
  await requirePageSuperadmin();
  return (
    <>
      <PageHeading
        eyebrow="YOUR IDEAS, CONNECTED"
        title="Prompt Chains"
        description="Create and maintain repeatable workflows made from connected prompts."
      />
      <ChainLibrary />
    </>
  );
}
