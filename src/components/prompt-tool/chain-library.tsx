"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChainRow } from "@/lib/database/types";

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: { ...(init?.headers ?? {}), "X-Prompt-Chains-CSRF": "1" },
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => null))?.error ?? "Request failed.",
    );
  return response.status === 204 ? null : response.json();
}

export function ChainLibrary() {
  const [chains, setChains] = useState<ChainRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  async function load() {
    setLoading(true);
    try {
      setChains(await api("/api/chains"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load chains.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void api("/api/chains")
      .then(setChains)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Unable to load chains."),
      )
      .finally(() => setLoading(false));
  }, []);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api("/api/chains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, version: 1, description }),
      });
      setName("");
      setSlug("");
      setDescription("");
      setFormOpen(false);
      setNotice("Chain created successfully.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create chain.");
    }
  }
  async function deleteChain(chain: ChainRow) {
    if (
      !window.confirm(
        `Delete “${chain.name}” permanently? Its steps, execution history, and artifacts will also be deleted.`,
      )
    )
      return;
    setDeleting(chain.id);
    setError("");
    setNotice("");
    try {
      await api(`/api/chains/${chain.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: chain.id,
          revision: chain.revision,
          confirmation: "DELETE",
        }),
      });
      setChains((current) => current.filter((item) => item.id !== chain.id));
      setNotice(`“${chain.name}” was deleted.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete chain.");
    } finally {
      setDeleting(null);
    }
  }
  return (
    <div className="workspace-stack">
      <div className="toolbar">
        <div>
          <span className="muted">
            {loading
              ? "Loading…"
              : `${chains.length} saved chain${chains.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <button
          className="primary-button"
          onClick={() => setFormOpen((value) => !value)}
        >
          {formOpen ? "Close" : "New chain"}
        </button>
      </div>
      {error && (
        <p className="auth-notice" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-notice" role="status">
          {notice}
        </p>
      )}
      {formOpen && (
        <form className="form-grid panel" onSubmit={create}>
          <label>
            Name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Slug
            <input
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </label>
          <label className="full">
            Description
            <textarea
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <button className="primary-button" type="submit">
            Create chain
          </button>
        </form>
      )}
      {!loading && chains.length === 0 ? (
        <div className="empty-state">
          <h3>No chains yet</h3>
          <p>Create your first workflow to start connecting prompts.</p>
        </div>
      ) : (
        <div className="chain-list">
          {chains.map((chain) => (
            <div className="chain-row" key={chain.id}>
              <Link
                className="chain-row-link"
                href={`/editor?chain=${chain.id}`}
              >
                <div>
                  <strong>{chain.name}</strong>
                  <span>
                    {chain.slug} · v{chain.version}
                  </span>
                </div>
                <span className="muted">Revision {chain.revision} →</span>
              </Link>
              <button
                className="icon-button chain-delete-button"
                type="button"
                title={`Delete ${chain.name}`}
                aria-label={`Delete ${chain.name}`}
                disabled={deleting !== null}
                onClick={() => void deleteChain(chain)}
              >
                <Trash2 size={17} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
