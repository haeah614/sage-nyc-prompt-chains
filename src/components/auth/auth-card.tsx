import { GitBranch } from "lucide-react";
import { ThemePicker } from "@/components/theme/theme-picker";
export function AuthCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <span className="brand-mark">
          <GitBranch size={26} aria-hidden="true" />
        </span>
        <p className="eyebrow">PROMPT STUDIO · WEEK 8</p>
        <h1>{title}</h1>
        {children}
        <div className="auth-theme">
          <ThemePicker />
        </div>
      </section>
      <p className="muted">A private workspace for thoughtful workflows.</p>
    </main>
  );
}
