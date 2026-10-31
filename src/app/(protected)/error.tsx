"use client";
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <section className="panel">
      <h1>Unable to load the workspace</h1>
      <p>
        Please try again. If the problem continues, contact the administrator.
      </p>
      <button className="primary-link" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
