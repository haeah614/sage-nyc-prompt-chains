import { redirect } from "next/navigation";
import { requirePageSuperadmin } from "@/lib/auth/guards";
export const dynamic = "force-dynamic";
export default async function Home() {
  await requirePageSuperadmin();
  redirect("/chains");
}
