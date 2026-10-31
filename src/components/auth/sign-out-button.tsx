"use client";
import { useState } from "react";
export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function signOut() {
    setPending(true);
    setError(false);
    try {
      const response = await fetch("/auth/signout", { method: "POST" });
      if (
        !response.ok ||
        !response.redirected ||
        new URL(response.url).pathname !== "/login"
      )
        throw new Error();
      // Full navigation discards the client router's previously authorized content.
      window.location.replace("/login");
    } catch {
      setError(true);
      setPending(false);
    }
  }
  return (
    <div className="signout">
      <button
        type="button"
        className="secondary-button"
        disabled={pending}
        onClick={signOut}
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error && <p role="alert">Sign-out failed. Please retry.</p>}
    </div>
  );
}
