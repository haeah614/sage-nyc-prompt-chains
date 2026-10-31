"use client";
import Script from "next/script";
import { useRef, useState } from "react";
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            ux_mode: string;
            login_uri: string;
            nonce: string;
            auto_select: boolean;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: Record<string, string>,
          ) => void;
        };
      };
    };
  }
}
export function GoogleLogin({
  clientId,
  origin,
}: {
  clientId: string;
  origin: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const initializing = useRef(false);
  const [status, setStatus] = useState("Loading secure Google sign-in…");
  async function initialize() {
    if (initializing.current) return;
    initializing.current = true;
    try {
      if (
        window.location.origin !== origin ||
        !window.google ||
        !container.current
      )
        throw new Error();
      const response = await fetch("/auth/prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Prompt-Chains-CSRF": "1",
        },
        body: "{}",
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const { nonce } = await response.json();
      window.google.accounts.id.initialize({
        client_id: clientId,
        ux_mode: "redirect",
        login_uri: `${origin}/auth/callback`,
        nonce,
        auto_select: false,
      });
      container.current.replaceChildren();
      window.google.accounts.id.renderButton(container.current, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
      });
      setStatus("");
    } catch {
      setStatus(
        "Google sign-in is unavailable. Reload to try again, or contact the administrator.",
      );
    } finally {
      initializing.current = false;
    }
  }
  return (
    <div className="google-login">
      <Script
        src="https://accounts.google.com/gsi/client"
        onReady={() => {
          void initialize();
        }}
        onError={() =>
          setStatus(
            "Unable to load Google sign-in. Check your connection and reload.",
          )
        }
      />
      <div ref={container} />
      {status && <p role="status">{status}</p>}
    </div>
  );
}
