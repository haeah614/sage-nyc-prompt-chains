"use client";
import { SignOutButton } from "@/components/auth/sign-out-button";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  GitBranch,
  History,
  Layers3,
  Settings2,
  Workflow,
} from "lucide-react";
import { navigation } from "@/config/navigation";
import { ThemePicker } from "@/components/theme/theme-picker";

const icons = {
  chains: Layers3,
  editor: Workflow,
  history: History,
  settings: Settings2,
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const current = navigation.find(({ href }) => pathname === href);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link href="/chains" className="brand">
          <span className="brand-mark">
            <GitBranch size={23} />
          </span>
          <span>
            Prompt Studio<small>CHAIN YOUR THINKING</small>
          </span>
        </Link>
        <div className="workspace">
          <span className="workspace-avatar">AI</span>
          <span>
            My Workspace<small>AI Workflow Studio</small>
          </span>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {navigation.map(({ href, label, icon }) => {
            const Icon = icons[icon];
            return (
              <Link
                key={href}
                href={href}
                aria-current={pathname === href ? "page" : undefined}
              >
                <Icon size={19} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <span className="editorial-kicker">PROMPT STUDIO</span>
          <p className="editorial-tagline">Think. Connect. Create.</p>
          <ThemePicker />
          <SignOutButton />
          <p className="local-note">
            Local workspace <ArrowUpRight size={13} />
          </p>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <span>
            Workspace <span className="breadcrumb">/</span>{" "}
            <strong>{current?.label ?? "Prompt Studio"}</strong>
          </span>
          <span className="status-badge">
            <span />
            Development workspace
          </span>
        </header>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <footer>
          Prompt Studio <span>Week 8 · Build thoughtful workflows</span>
        </footer>
      </div>
    </div>
  );
}
