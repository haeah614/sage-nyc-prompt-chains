import { requirePageSuperadmin } from "@/lib/auth/guards";
import { ThemePicker } from "@/components/theme/theme-picker";
import { PageHeading } from "@/components/ui/page-heading";
export const metadata = { title: "Settings" };
export default async function SettingsPage() {
  await requirePageSuperadmin();
  return (
    <>
      <PageHeading
        eyebrow="MAKE IT YOURS"
        title="Settings"
        description="A comfortable workspace starts with the details."
      />
      <section className="panel settings-panel">
        <h2>Appearance</h2>
        <p>
          Choose your preferred color theme. System follows your device’s
          appearance and updates automatically.
        </p>
        <ThemePicker />
        <p className="muted">
          Your preference is saved in this browser when local storage is
          available.
        </p>
      </section>
      <section className="panel settings-panel">
        <div className="section-heading">
          <h2>Connections & account</h2>
          <span className="pill subtle">SUPERADMIN ACCESS</span>
        </div>
        <p>
          Access requires a verified Google account and Superadmin approval.
          Chain storage is connected through guarded database RPCs. Gemini
          execution becomes available when the server-side API key is set.
        </p>
      </section>
    </>
  );
}
