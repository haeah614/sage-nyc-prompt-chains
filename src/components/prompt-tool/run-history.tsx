"use client";

import Link from "next/link";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  LoaderCircle,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RunDetail, RunHistoryItem } from "@/lib/database/types";

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

function StatusIcon({ status }: { status: string }) {
  if (status === "succeeded")
    return (
      <CheckCircle2
        className="status-icon success"
        size={22}
        aria-hidden="true"
      />
    );
  if (status === "failed" || status === "cancelled")
    return (
      <XCircle className="status-icon danger" size={22} aria-hidden="true" />
    );
  if (status === "running")
    return (
      <LoaderCircle
        className="status-icon running spin"
        size={22}
        aria-hidden="true"
      />
    );
  return (
    <Clock3 className="status-icon pending" size={18} aria-hidden="true" />
  );
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function RunHistory({ selectedRun }: { selectedRun?: string }) {
  const [runs, setRuns] = useState<RunHistoryItem[]>([]);
  const [chainNames, setChainNames] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [expanded, setExpanded] = useState<string | null>(selectedRun ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const succeededRuns = useMemo(
    () => runs.filter((run) => run.status === "succeeded").length,
    [runs],
  );
  async function load() {
    const chains = (await api("/api/chains")) as {
      id: string;
      name: string;
    }[];
    setChainNames(
      Object.fromEntries(chains.map((chain) => [chain.id, chain.name])),
    );
    const all = await Promise.all(
      chains.map((chain) => api(`/api/runs?chain_id=${chain.id}`)),
    );
    setRuns(
      all
        .flat()
        .sort((a: RunHistoryItem, b: RunHistoryItem) =>
          b.created_at.localeCompare(a.created_at),
        ),
    );
  }
  useEffect(() => {
    void api("/api/chains")
      .then(async (chains: { id: string; name: string }[]) => {
        setChainNames(
          Object.fromEntries(chains.map((chain) => [chain.id, chain.name])),
        );
        const all = await Promise.all(
          chains.map((chain) => api(`/api/runs?chain_id=${chain.id}`)),
        );
        setRuns(
          all
            .flat()
            .sort((a: RunHistoryItem, b: RunHistoryItem) =>
              b.created_at.localeCompare(a.created_at),
            ),
        );
      })
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Unable to load run history.",
        ),
      );
  }, []);
  useEffect(() => {
    if (!selectedRun) return;
    void api(`/api/runs/${selectedRun}`)
      .then((value) => {
        setExpanded(selectedRun);
        setDetail(value);
      })
      .catch((e) => setError(e.message));
  }, [selectedRun]);
  async function toggle(run: RunHistoryItem) {
    if (expanded === run.id) {
      setExpanded(null);
      return;
    }
    setExpanded(run.id);
    try {
      setDetail(await api(`/api/runs/${run.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load run.");
    }
  }
  async function deleteRun(run: RunHistoryItem) {
    if (
      !window.confirm(
        "Delete this run and all of its step results? This cannot be undone.",
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/api/runs/${run.id}/delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: run.revision,
          confirmation: "DELETE",
        }),
      });
      setRuns((current) => current.filter((item) => item.id !== run.id));
      if (expanded === run.id) {
        setExpanded(null);
        setDetail(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete run.");
    } finally {
      setBusy(false);
    }
  }
  async function clearHistory() {
    if (
      !window.confirm(
        "Clear every run and step result from this workspace? This cannot be undone.",
      )
    )
      return;
    setBusy(true);
    try {
      await api("/api/runs/clear", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "CLEAR", chain_id: null }),
      });
      setRuns([]);
      setExpanded(null);
      setDetail(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to clear history.");
    } finally {
      setBusy(false);
    }
  }
  function savedOutput(step: RunDetail["steps"][number]) {
    if (step.output_text) return step.output_text;
    return (
      detail?.artifacts.find(
        (artifact) =>
          artifact.run_step_id === step.id && artifact.kind === "text",
      )?.text_content ?? null
    );
  }
  async function copyOutput() {
    const output =
      detail?.steps
        .map((step) => savedOutput(step))
        .filter(Boolean)
        .join("\n\n") ?? "";
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div className="history-layout">
      {error && (
        <p className="auth-notice" role="alert">
          {error}
        </p>
      )}
      <div className="history-summary">
        <div>
          <span className="eyebrow">WORKSPACE MEMORY</span>
          <h2>{runs.length} runs recorded</h2>
          <p>
            {succeededRuns} successful · {runs.length - succeededRuns} needing
            attention
          </p>
        </div>
        <button
          className="danger-button"
          disabled={busy || runs.length === 0}
          onClick={() => void clearHistory()}
        >
          <Trash2 size={16} /> Clear run history
        </button>
      </div>
      <section className="panel history-panel">
        <div className="section-heading">
          <div>
            <h2>Recent executions</h2>
            <p className="panel-subtitle">
              Select a run to inspect each prompt, output, and error.
            </p>
          </div>
          <button
            className="secondary-button"
            onClick={() => void load()}
            disabled={busy}
          >
            <RotateCcw size={15} /> Refresh
          </button>
        </div>
        {runs.length === 0 ? (
          <div className="empty-state">
            <h3>No runs yet</h3>
            <p>
              Execute a chain from the editor to build a useful record of your
              work.
            </p>
            <Link className="primary-link" href="/editor">
              Open chain editor
            </Link>
          </div>
        ) : (
          <div className="run-list">
            {runs.map((run) => (
              <div
                className={`run-item ${expanded === run.id ? "is-open" : ""}`}
                key={run.id}
              >
                <div className="run-row">
                  <div className="history-run-status">
                    <StatusIcon status={run.status} />
                    <span className={`status-label ${run.status}`}>
                      {statusLabel(run.status)}
                    </span>
                  </div>
                  <div className="history-run-copy">
                    <strong>
                      {chainNames[run.chain_id] ?? "Prompt chain"}
                    </strong>
                    <span>{new Date(run.created_at).toLocaleString()}</span>
                  </div>
                  <span className="history-run-revision">
                    Revision {run.revision}
                  </span>
                  <button
                    className="history-run-view"
                    onClick={() => void toggle(run)}
                    aria-expanded={expanded === run.id}
                  >
                    {expanded === run.id ? "Hide details" : "View details"}
                    <ChevronDown size={16} className="run-chevron" />
                  </button>
                  <button
                    className="icon-button"
                    title="Delete run"
                    aria-label="Delete run"
                    disabled={busy}
                    onClick={() => void deleteRun(run)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                {expanded === run.id && detail?.run.id === run.id && (
                  <div className="run-detail">
                    <div className="detail-toolbar">
                      <span className={`status-label ${detail.run.status}`}>
                        {statusLabel(detail.run.status)}
                      </span>
                      <button
                        className="secondary-button"
                        disabled={
                          !detail.steps.some((step) => savedOutput(step))
                        }
                        onClick={() => void copyOutput()}
                      >
                        <Copy size={15} /> {copied ? "Copied" : "Copy output"}
                      </button>
                    </div>
                    {detail.steps.map((step) => (
                      <details
                        className="result-step"
                        key={step.id}
                        open={step.status === "failed"}
                      >
                        <summary>
                          <span className="step-number">{step.position}</span>
                          <span className="result-step-meta">
                            <strong>{step.step_snapshot.name}</strong>
                            <small>
                              {statusLabel(step.status)} ·{" "}
                              {step.step_snapshot.model_key}
                            </small>
                          </span>
                          <ChevronRight
                            className="result-step-chevron"
                            size={16}
                            aria-hidden="true"
                          />
                        </summary>
                        <div className="result-body">
                          <span className="result-label">Input</span>
                          <p>{step.input_text ?? "Not started"}</p>
                          <span className="result-label">Output</span>
                          <p>
                            {savedOutput(step) ??
                              step.error_message ??
                              "No output recorded."}
                          </p>
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
