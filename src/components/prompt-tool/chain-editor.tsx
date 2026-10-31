"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clipboard, LoaderCircle, Play } from "lucide-react";
import type { ChainRow, RunDetail, StepRow } from "@/lib/database/types";

type Model = {
  id: string;
  model_key: string;
  display_name: string;
  enabled: boolean;
  provider_name: string;
  gemini_approved: boolean;
};
type ChainDetail = {
  chain: ChainRow;
  steps: (StepRow & {
    input_source: string;
    generation_config: Record<string, unknown>;
  })[];
};
const PREFERRED_GEMINI_MODEL = "gemini-3.5-flash-lite";
type ExecutionTiming = {
  totalMs: number;
  authMs: number;
  parseMs: number;
  readMs: number;
  rpc: Array<{ name: string; ms: number }>;
  steps: Array<{ position: number; geminiMs: number; totalMs: number }>;
};
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

export function ChainEditor({ initialChainId }: { initialChainId?: string }) {
  const router = useRouter();
  const [chains, setChains] = useState<ChainRow[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [detail, setDetail] = useState<ChainDetail | null>(null);
  const [selected, setSelected] = useState(initialChainId ?? "");
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunDetail | null>(null);
  const [progress, setProgress] = useState("Ready to run");
  const [copied, setCopied] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [executionTiming, setExecutionTiming] =
    useState<ExecutionTiming | null>(null);
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [chainForm, setChainForm] = useState({
    name: "",
    slug: "",
    version: 1,
    description: "",
  });
  const [step, setStep] = useState({
    name: "",
    instruction: "",
    model_id: "",
    input_source: "previous_output",
  });
  useEffect(() => {
    void Promise.all([api("/api/chains"), api("/api/models")])
      .then(([c, m]) => {
        setChains(c);
        setModels(m);
        const first = initialChainId ?? c[0]?.id;
        if (first) setSelected(first);
      })
      .catch((e) => setError(e.message));
  }, [initialChainId]);
  useEffect(() => {
    if (!selected) return;
    void api(`/api/chains/${selected}`)
      .then((value: ChainDetail) => {
        setDetail(value);
        setChainForm({
          name: value.chain.name,
          slug: value.chain.slug,
          version: value.chain.version,
          description: value.chain.description,
        });
      })
      .catch((e) => setError(e.message));
  }, [selected]);
  const modelOptions = useMemo(
    () =>
      models.filter(
        (model) =>
          model.enabled &&
          model.gemini_approved &&
          model.model_key === PREFERRED_GEMINI_MODEL,
      ),
    [models],
  );
  useEffect(() => {
    if (!running) return;
    const started = performance.now();
    const timer = window.setInterval(
      () => setElapsedMs(Math.round(performance.now() - started)),
      250,
    );
    return () => window.clearInterval(timer);
  }, [running]);
  async function saveStep(event: React.FormEvent) {
    event.preventDefault();
    if (!detail) return;
    try {
      await api(
        editingStep
          ? `/api/steps/${editingStep}`
          : `/api/chains/${detail.chain.id}/steps`,
        {
          method: editingStep ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...step,
            chain_id: detail.chain.id,
            chain_revision: detail.chain.revision,
            ...(editingStep
              ? {
                  id: editingStep,
                  revision: detail.steps.find((item) => item.id === editingStep)
                    ?.revision,
                }
              : {}),
            model_id: step.model_id,
            generation_config: {},
          }),
        },
      );
      setStep({
        name: "",
        instruction: "",
        model_id: "",
        input_source: "previous_output",
      });
      setEditingStep(null);
      setDetail(await api(`/api/chains/${detail.chain.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save step.");
    }
  }
  async function saveChain(event: React.FormEvent) {
    event.preventDefault();
    if (!detail) return;
    try {
      await api(`/api/chains/${detail.chain.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...chainForm, revision: detail.chain.revision }),
      });
      setDetail(await api(`/api/chains/${detail.chain.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update chain.");
    }
  }
  async function removeStep(item: ChainDetail["steps"][number]) {
    if (!detail || !window.confirm(`Delete step “${item.name}”?`)) return;
    if (
      typeof item.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        item.id,
      )
    ) {
      setError(
        "This step cannot be deleted because its identifier is invalid.",
      );
      return;
    }
    try {
      await api(`/api/steps/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain_id: detail.chain.id,
          chain_revision: detail.chain.revision,
          revision: item.revision,
          confirmation: "DELETE",
        }),
      });
      setDetail(await api(`/api/chains/${detail.chain.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete step.");
    }
  }
  function editStep(item: ChainDetail["steps"][number]) {
    setEditingStep(item.id);
    setStep({
      name: item.name,
      instruction: item.instruction,
      model_id: item.model_id,
      input_source: item.input_source,
    });
  }
  async function moveStep(index: number, direction: -1 | 1) {
    if (!detail) return;
    const next = [...detail.steps];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await api(`/api/chains/${detail.chain.id}/steps`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain_revision: detail.chain.revision,
          step_ids: next.map((item) => item.id),
        }),
      });
      setDetail(await api(`/api/chains/${detail.chain.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to reorder steps.");
    }
  }
  async function removeChain() {
    if (
      !detail ||
      !window.confirm(
        `Delete “${detail.chain.name}”? Empty chains only can be deleted.`,
      )
    )
      return;
    try {
      await api(`/api/chains/${detail.chain.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: detail.chain.revision,
          confirmation: "DELETE",
        }),
      });
      router.push("/chains");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete chain.");
    }
  }
  async function run() {
    if (!detail || !input.trim()) return;
    setRunning(true);
    setElapsedMs(0);
    setExecutionTiming(null);
    setRunResult(null);
    setProgress("Preparing a snapshot of your chain…");
    try {
      const queued = await api("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain_id: detail.chain.id,
          chain_revision: detail.chain.revision,
          input_text: input,
          idempotency_key: crypto.randomUUID(),
        }),
      });
      setProgress("Gemini is working through each step…");
      const result = await api(`/api/runs/${queued.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_revision: queued.revision }),
      });
      setRunResult(result);
      setExecutionTiming(result.timings ?? null);
      setProgress(
        result.run.status === "succeeded"
          ? "Chain complete"
          : "Chain finished with an error",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to execute chain.");
    } finally {
      setRunning(false);
    }
  }
  async function copyResult() {
    const output =
      runResult?.steps
        .map((item) => item.output_text)
        .filter(Boolean)
        .join("\n\n") ?? "";
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div className="workspace-stack">
      {error && (
        <p className="auth-notice" role="alert">
          {error}
        </p>
      )}
      <div className="toolbar editor-toolbar">
        <label>
          Chain
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select a chain</option>
            {chains.map((chain) => (
              <option value={chain.id} key={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>
        </label>
        {detail && (
          <span className="muted">Revision {detail.chain.revision}</span>
        )}
      </div>
      {detail ? (
        <>
          <section className="panel editor-section chain-settings">
            <div className="editor-section-header">
              <div>
                <span className="eyebrow">CHAIN SETTINGS</span>
                <h2>{detail.chain.name}</h2>
                <p>Define the identity and description for this workflow.</p>
              </div>
              <span className="pill subtle">{detail.steps.length} steps</span>
            </div>
            <form className="form-grid chain-form" onSubmit={saveChain}>
              <label>
                Name
                <input
                  required
                  value={chainForm.name}
                  onChange={(e) =>
                    setChainForm({ ...chainForm, name: e.target.value })
                  }
                />
              </label>
              <label>
                Slug
                <input
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  value={chainForm.slug}
                  onChange={(e) =>
                    setChainForm({ ...chainForm, slug: e.target.value })
                  }
                />
              </label>
              <label>
                Version
                <input
                  required
                  type="number"
                  min="1"
                  value={chainForm.version}
                  onChange={(e) =>
                    setChainForm({
                      ...chainForm,
                      version: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="full">
                Description
                <textarea
                  required
                  value={chainForm.description}
                  onChange={(e) =>
                    setChainForm({ ...chainForm, description: e.target.value })
                  }
                />
              </label>
              <button className="primary-button" type="submit">
                Save chain
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void removeChain()}
              >
                Delete empty chain
              </button>
            </form>
          </section>
          <section className="panel editor-section workflow-section">
            <div className="editor-section-header">
              <div>
                <span className="eyebrow">WORKFLOW</span>
                <h2>Build the sequence</h2>
                <p>
                  Each step receives the selected input and passes its output
                  forward.
                </p>
              </div>
              <span className="pill subtle">
                {detail.steps.length} connected
              </span>
            </div>
            <div className="step-list pipeline">
              {detail.steps.map((item, index) => (
                <article className="step-card" key={item.id}>
                  <span
                    className="step-number"
                    aria-label={`Step ${item.position}`}
                  >
                    {String(item.position).padStart(2, "0")}
                  </span>
                  <div className="step-content">
                    <div className="step-card-heading">
                      <strong>{item.name}</strong>
                      <span className="step-model">
                        {models.find((model) => model.id === item.model_id)
                          ?.display_name ?? "Model unavailable"}
                      </span>
                    </div>
                    <p>{item.instruction}</p>
                    <span className="step-linkage">
                      <span>
                        {item.input_source === "chain_input"
                          ? "Original input"
                          : index === 0
                            ? "Chain input"
                            : `Step ${item.position - 1} output`}
                      </span>
                      <span className="step-dot" /> Gemini text generation
                    </span>
                  </div>
                  <div className="step-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => editStep(item)}
                    >
                      Edit
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void moveStep(index, -1)}
                      disabled={index === 0}
                    >
                      ↑
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void moveStep(index, 1)}
                      disabled={index === detail.steps.length - 1}
                    >
                      ↓
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void removeStep(item)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <section className="panel editor-section step-composer">
            <div className="editor-section-header">
              <div>
                <span className="eyebrow">STEP CONFIGURATION</span>
                <h2>{editingStep ? "Edit step" : "Add a step"}</h2>
                <p>
                  Choose a model, write an instruction, and define its input.
                </p>
              </div>
            </div>
            <form className="form-grid step-form" onSubmit={saveStep}>
              <label>
                Name
                <input
                  required
                  value={step.name}
                  onChange={(e) => setStep({ ...step, name: e.target.value })}
                />
              </label>
              <label>
                Gemini model
                <select
                  required
                  value={step.model_id}
                  onChange={(e) =>
                    setStep({ ...step, model_id: e.target.value })
                  }
                >
                  <option value="">Choose approved model</option>
                  {step.model_id &&
                    !modelOptions.some(
                      (model) => model.id === step.model_id,
                    ) && (
                      <option value={step.model_id} disabled>
                        Current model unavailable — choose Gemini 3.5 Flash Lite
                      </option>
                    )}
                  {modelOptions.length === 0 && !step.model_id && (
                    <option value="" disabled>
                      Gemini 3.5 Flash Lite is not approved yet
                    </option>
                  )}
                  {modelOptions.map((model) => (
                    <option value={model.id} key={model.id}>
                      {model.display_name} · {model.provider_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="full">
                Instruction
                <textarea
                  required
                  value={step.instruction}
                  onChange={(e) =>
                    setStep({ ...step, instruction: e.target.value })
                  }
                />
              </label>
              <label>
                Input source
                <select
                  value={step.input_source}
                  onChange={(e) =>
                    setStep({ ...step, input_source: e.target.value })
                  }
                >
                  <option value="previous_output">Previous output</option>
                  <option value="chain_input">Original chain input</option>
                </select>
              </label>
              <button className="primary-button" type="submit">
                {editingStep ? "Update step" : "Save step"}
              </button>
              {editingStep && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setEditingStep(null);
                    setStep({
                      name: "",
                      instruction: "",
                      model_id: "",
                      input_source: "previous_output",
                    });
                  }}
                >
                  Cancel edit
                </button>
              )}
            </form>
          </section>
          <section className="panel">
            <div className="run-header">
              <div>
                <span className="eyebrow">LIVE EXECUTION</span>
                <h2>Run this chain</h2>
                <p className="description">
                  Gemini will process each step in order and save a complete run
                  record.
                </p>
              </div>
              <span className={`run-state ${running ? "active" : ""}`}>
                <span />
                {running
                  ? `${progress} · ${Math.floor(elapsedMs / 1000)}s`
                  : progress}
              </span>
            </div>
            <textarea
              className="run-input"
              aria-label="Chain input"
              placeholder="What would you like this workflow to work on?"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={running}
            />
            <button
              className="primary-button run-button"
              disabled={running || !input.trim() || detail.steps.length === 0}
              onClick={() => void run()}
            >
              {running ? (
                <>
                  <LoaderCircle className="spin" size={17} /> Running your
                  chain… {Math.floor(elapsedMs / 1000)}s
                </>
              ) : (
                <>
                  <Play size={17} /> Run with Gemini
                </>
              )}
            </button>
            {runResult && (
              <div className={`output-card ${runResult.run.status}`}>
                <div className="output-card-header">
                  <div>
                    <span className="eyebrow">LATEST OUTPUT</span>
                    <h3>
                      {runResult.run.status === "succeeded"
                        ? "Your chain is complete"
                        : "The chain needs attention"}
                    </h3>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => void copyResult()}
                    disabled={!runResult.steps.some((item) => item.output_text)}
                  >
                    <Clipboard size={15} /> {copied ? "Copied" : "Copy output"}
                  </button>
                </div>
                {runResult.steps.map((item) => (
                  <div className="output-step" key={item.id}>
                    <div>
                      <span className="output-step-number">
                        {item.position}
                      </span>
                      <strong>{item.step_snapshot.name}</strong>
                    </div>
                    <p>
                      {item.output_text ??
                        item.error_message ??
                        "No output recorded."}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {executionTiming && (
              <p className="run-timing success">
                <CheckCircle2 size={16} aria-hidden="true" /> Completed in{" "}
                {(executionTiming.totalMs / 1000).toFixed(1)}s
              </p>
            )}
          </section>
        </>
      ) : (
        <div className="empty-state">
          <h3>Select a chain to edit</h3>
          <p>Choose a saved chain or create one from Prompt Chains.</p>
        </div>
      )}
    </div>
  );
}
