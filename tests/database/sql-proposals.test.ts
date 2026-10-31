import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { parse, parsePlPgSQL } from "libpg-query";

// PARSING ONLY. No PostgreSQL engine/client, migrations runner, environment files,
// database connection or SQL execution is used by these tests.
const directory = resolve("supabase/proposals/week8");
const names = [
  "000_preflight.sql",
  "001_foundation.sql",
  "002_chain_rpcs.sql",
  "003_execution_rpcs.sql",
  "004_history_delete.sql",
  "005_chain_delete_with_history.sql",
];
const sql = names.map((name) => readFileSync(resolve(directory, name), "utf8"));
const migrations = sql.slice(1).join("\n");
it.each(names.map((name, index) => ({ name, index })))(
  "parses PostgreSQL and PL/pgSQL grammar: $name",
  async ({ index }) => {
    const statements = (await parse(sql[index]!)).stmts ?? [];
    expect(statements.length).toBeGreaterThan(0);
    await expect(parsePlPgSQL(sql[index]!)).resolves.toBeDefined();
  },
);
it("preflight is SELECT-only and does not export private content", async () => {
  const result = await parse(sql[0]!);
  const statements = result.stmts ?? [];
  expect(
    statements.every((statement) => {
      const node = statement.stmt;
      return Boolean(node && "SelectStmt" in node);
    }),
  ).toBe(true);
  expect(sql[0]).not.toMatch(/select\s+\*\s+from\s+(auth\.|public\.profiles)/i);
});
it("migration top levels contain no seeds, destructive drops or ordinary row writes", async () => {
  for (const migration of sql.slice(1)) {
    const result = await parse(migration);
    for (const { stmt } of result.stmts ?? []) {
      for (const forbidden of [
        "DropStmt",
        "TruncateStmt",
        "InsertStmt",
        "UpdateStmt",
        "DeleteStmt",
      ])
        expect(stmt).not.toHaveProperty(forbidden);
    }
    expect(migration).toMatch(/BEGIN ISOLATION LEVEL READ COMMITTED;/);
    expect(migration.trim()).toMatch(/COMMIT;$/);
  }
});
it("does not replace Week 7 routines, constraints, columns, grants or tables", () => {
  expect(sql.slice(1, 4).join("\n")).not.toMatch(/CREATE\s+OR\s+REPLACE/i);
  expect(migrations).not.toMatch(/ALTER\s+TABLE\s+public\./i);
  expect(migrations).not.toMatch(
    /(?:GRANT|REVOKE)[^;]*ON\s+(?:TABLE\s+)?public\.(prompt_chains|prompt_chain_steps|llm_models|llm_providers)/i,
  );
  expect(migrations).not.toMatch(
    /CREATE\s+FUNCTION\s+public\.admin_update_prompt_chain_mix/i,
  );
});
it("history deletion proposal is rerunnable and scoped to private run data", () => {
  expect(sql[4]).toMatch(/CREATE OR REPLACE FUNCTION public\.pct_delete_run/);
  expect(sql[4]).toMatch(
    /CREATE OR REPLACE FUNCTION public\.pct_clear_run_history/,
  );
  expect(sql[4]).not.toMatch(
    /public\.(prompt_chains|prompt_chain_steps|profiles|llm_models|llm_providers)/,
  );
});
it("chain deletion proposal is Superadmin-only and follows dependency order", () => {
  const proposal = sql[5]!;
  expect(proposal).toMatch(
    /CREATE OR REPLACE FUNCTION public\.pct_delete_chain_with_history/,
  );
  expect(proposal).toMatch(
    /artifacts[\s\S]*run_steps[\s\S]*chain_runs[\s\S]*prompt_chain_steps[\s\S]*prompt_chains/,
  );
  expect(proposal).toMatch(/prompt_tool\.require_superadmin\(\)/);
  expect(proposal).toMatch(
    /GRANT EXECUTE ON FUNCTION public\.pct_delete_chain_with_history/,
  );
});
it("every public RPC has an empty search_path, auth-first body and explicit narrow EXECUTE grant", () => {
  const functions = [
    ...migrations.matchAll(
      /CREATE (?:OR REPLACE )?FUNCTION public\.(pct_\w+)\(([^]*?)\)\s+RETURNS[^]*?AS \$\$([^]*?)\$\$;/g,
    ),
  ];
  expect(functions.length).toBe(18);
  for (const [declaration, name, args, body] of functions) {
    expect(declaration).toMatch(/SECURITY DEFINER SET search_path=''/);
    expect(body).toMatch(
      /BEGIN\s+(?:PERFORM|actor:=)\s*prompt_tool\.require_superadmin\(\);/,
    );
    expect(args).not.toMatch(/p_actor|p_user|p_is_superadmin/);
    expect(migrations).toMatch(
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\([^;]+FROM PUBLIC,anon,authenticated,service_role;`,
      ),
    );
    expect(migrations).toMatch(
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]+TO authenticated;`,
      ),
    );
  }
});
it("private data and helpers have no runtime grants, and profile promotion is a prerequisite", () => {
  expect(migrations).not.toMatch(
    /^GRANT[^;]*TO\s+(?:PUBLIC|anon|service_role)/im,
  );
  expect(migrations).not.toMatch(
    /^GRANT[^;]*ON\s+(?:TABLE\s+)?prompt_tool\./im,
  );
  expect(sql[1]).toContain("ENABLE ROW LEVEL SECURITY");
  expect(sql[1]).toContain(
    "REVOKE ALL ON TABLE prompt_tool.%I FROM PUBLIC,anon,authenticated,service_role",
  );
  expect(sql[1]).toContain("tgname='protect_sage_superadmin_flag'");
  expect(sql[1]).toContain("actor uuid := auth.uid()");
  expect(sql[1]).toContain("FROM auth.identities");
  expect(sql[1]).toContain("p.is_superadmin IS TRUE FOR SHARE");
});
it("definition mutations acquire the Week 7 lock before chain/step row locks", () => {
  expect(sql[1]).toContain("pg_advisory_xact_lock(77007,1)");
  for (const name of [
    "save_chain",
    "save_step",
    "reorder_steps",
    "delete_step",
    "delete_chain",
  ]) {
    const body = sql[2]
      .split(`CREATE FUNCTION public.pct_${name}(`)[1]
      .split("$$;")[0];
    expect(body.indexOf("prompt_tool.require_superadmin()")).toBeLessThan(
      body.indexOf("prompt_tool.lock_configuration()"),
    );
    expect(body.indexOf("prompt_tool.lock_configuration()")).toBeLessThan(
      body.indexOf("prompt_tool.checked_chain("),
    );
  }
});
it("reorder validates exact membership and stages above all old positive positions without weakening uniqueness", () => {
  expect(sql[2]).toContain("cardinality(p_step_ids)<>n");
  expect(sql[2]).toContain("count(DISTINCT v)");
  expect(sql[2]).toContain("s.id=v AND s.chain_id=p_chain_id");
  expect(sql[2]).toContain("highest+n>2147483647");
  expect(sql[2]).toContain("position=(highest+x.ord)::integer");
  expect(sql[2]).toContain("position=x.ord::integer");
  expect(sql[2]).not.toMatch(
    /DROP\s+CONSTRAINT|DISABLE\s+TRIGGER|position\s*=\s*-/i,
  );
  expect(sql[1]).toContain(
    "pct_step_parent_revision AFTER INSERT OR UPDATE OR DELETE",
  );
});
it("history survives step deletion; chain deletion cannot cascade through runs", () => {
  expect(sql[1]).toContain(
    "chain_id uuid NOT NULL REFERENCES public.prompt_chains(id) ON DELETE RESTRICT",
  );
  expect(sql[1]).toMatch(/source_step_id uuid NOT NULL,/);
  expect(sql[1]).not.toMatch(/source_step_id[^,]*REFERENCES/);
  expect(sql[2]).toContain(
    "Chain has steps or execution history; deletion is blocked",
  );
  expect(sql[2]).toContain("Unreviewed cascading deletion dependency");
  expect(sql[1]).toContain("FOREIGN KEY(run_step_id,run_id,chain_id)");
  const deleteStep = sql[2]
    .split("CREATE FUNCTION public.pct_delete_step(")[1]
    .split("$$;")[0];
  expect(deleteStep).toContain(
    "DELETE FROM public.prompt_chain_steps WHERE id=p_step_id;",
  );
});
it("run creation has idempotency, immutable snapshots, provider checks and ordered step capture", () => {
  expect(sql[1]).toContain("UNIQUE(requested_by,idempotency_key)");
  expect(sql[3]).toContain("Idempotency key reused for a different request");
  expect(sql[3]).toContain("to_jsonb(c),p_input_text");
  expect(sql[3]).toContain("row_number() OVER(ORDER BY s.position)");
  expect(sql[3]).toContain("g.provider_id IS NULL");
  expect(sql[3]).not.toMatch(
    /UPDATE[^;]*SET\s+(chain_snapshot|step_snapshot)/i,
  );
});
it("execution fences stale/foreign leases and has no automatic retry of model requests", () => {
  for (const fragment of [
    "s.revision IS DISTINCT FROM p_step_revision",
    "s.lease_token<>p_lease_token",
    "s.executed_by IS DISTINCT FROM actor",
    "s.lease_expires_at<=clock_timestamp()",
    "interval '5 minutes'",
    "Previous steps must succeed first",
    "No expired in-flight step",
    "status='skipped'",
    "to_jsonb(s)-'lease_token'",
  ])
    expect(sql[3]).toContain(fragment);
  expect(sql[3]).not.toMatch(/http_post|net\.http|pg_net|CREATE\s+EXTENSION/i);
});
it("media metadata excludes signed URLs and credentials; optional legacy links do not cascade", () => {
  expect(sql[1]).toContain(
    "bucket_id IS NOT NULL AND bucket_id='prompt-chain-artifacts'",
  );
  expect(sql[1]).toContain("split_part(object_path,'/',1)=run_id::text");
  for (const table of ["generations", "llm_responses", "images"])
    expect(sql[1]).toContain(
      `REFERENCES public.${table}(id) ON DELETE SET NULL`,
    );
  expect(sql[1]).not.toMatch(
    /CREATE\s+TABLE[^;]*(api_key|signed_url|access_token)/i,
  );
});
