import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const source = readFileSync(
  resolve("src/components/prompt-tool/chain-library.tsx"),
  "utf8",
);

it("requires explicit confirmation before deleting the selected chain", () => {
  expect(source).toContain("window.confirm");
  expect(source).toContain("will also be deleted");
  expect(source).toContain('confirmation: "DELETE"');
  expect(source).toContain('method: "DELETE"');
});

it("removes only the confirmed chain after a successful delete", () => {
  expect(source).toContain(
    "setChains((current) => current.filter((item) => item.id !== chain.id))",
  );
  expect(source).toContain("setNotice(`“${chain.name}” was deleted.`)");
  expect(source).toContain("setError(e instanceof Error ? e.message");
  expect(source).toContain("aria-label={`Delete ${chain.name}`}");
});
