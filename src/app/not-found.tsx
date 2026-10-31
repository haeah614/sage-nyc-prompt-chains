import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty-state">
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <p>This page is not part of the workspace.</p>
      <Link className="primary-link" href="/chains">
        Return to Prompt Chains
      </Link>
    </div>
  );
}
