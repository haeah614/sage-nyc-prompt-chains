import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const source = readFileSync(
  resolve("src/components/prompt-tool/run-history.tsx"),
  "utf8",
);
const styles = readFileSync(resolve("src/app/globals.css"), "utf8");
const editorSource = readFileSync(
  resolve("src/components/prompt-tool/chain-editor.tsx"),
  "utf8",
);

it("keeps the run row metadata and actions in the rendered history structure", () => {
  expect(source).toContain('className="history-run-status"');
  expect(source).toContain('className="history-run-copy"');
  expect(source).toContain('className="history-run-revision"');
  expect(source).toContain('className="history-run-view"');
  expect(source).toContain('aria-label="Delete run"');
  expect(source).toContain("View details");
  expect(source).toContain("new Date(run.created_at).toLocaleString()");
});

it("gives the history row a visible responsive grid instead of hiding its metadata", () => {
  expect(styles).toContain(".run-row {");
  expect(styles).toContain("display: grid;");
  expect(styles).toContain(".history-run-status {");
  expect(styles).toContain("display: inline-flex;");
  expect(styles).toContain(".history-run-view {");
  expect(styles).not.toContain(".history-run-status {\n  display: none;");
  expect(styles).not.toContain(".history-run-view {\n  display: none;");
});

it("renders persisted text artifacts when a run step output is absent", () => {
  expect(source).toContain("function savedOutput");
  expect(source).toContain("artifact.run_step_id === step.id");
  expect(source).toContain('artifact.kind === "text"');
  expect(source).toContain("savedOutput(step)");
});

it("shows a disclosure chevron on each expandable step result", () => {
  expect(source).toContain('className="result-step-chevron"');
  expect(source).toContain("<ChevronRight");
  expect(styles).toContain(".result-step[open] .result-step-chevron");
});

it("handles an empty successful 204 response after step deletion", () => {
  expect(editorSource).toContain(
    "return response.status === 204 ? null : response.json();",
  );
});
