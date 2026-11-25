import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse, parsePlPgSQL } from "libpg-query";

const sql = readFileSync(
  "supabase/proposals/shared-admin/001_prompt_studio.sql",
  "utf8",
);
it("parses the atomic shared migration without top-level data mutations", async () => {
  const parsed = await parse(sql);
  await expect(parsePlPgSQL(sql)).resolves.toBeDefined();
  for (const { stmt } of parsed.stmts ?? []) {
    for (const forbidden of [
      "InsertStmt",
      "UpdateStmt",
      "DeleteStmt",
      "DropStmt",
      "TruncateStmt",
    ])
      expect(stmt).not.toHaveProperty(forbidden);
  }
  expect(sql.match(/^BEGIN ISOLATION LEVEL READ COMMITTED;/gm)).toHaveLength(1);
  expect(sql.match(/^COMMIT;/gm)).toHaveLength(1);
});
it("preserves shared security and refuses drift, collisions and capacity overruns", () => {
  expect(sql).not.toMatch(/CREATE OR REPLACE|ALTER TABLE public\./i);
  expect(sql).not.toMatch(
    /(?:GRANT|REVOKE)[^;]*ON (?:TABLE )?public\.profiles/i,
  );
  expect(sql).toContain(
    "has_column_privilege(name,'public.profiles','is_superadmin','INSERT')",
  );
  expect(sql).toContain(
    "has_column_privilege(name,'public.profiles','is_superadmin','UPDATE')",
  );
  expect(sql.match(/Reviewed function drift:/g)).toHaveLength(8);
  expect(
    sql.match(
      /pg_database_size\(pg_catalog.current_database\(\)\) >= 50000000/g,
    ),
  ).toHaveLength(2);
  expect(sql).toContain(
    "Prompt Studio objects already exist; do not overwrite",
  );
  const bodies = [
    ...sql.matchAll(
      /CREATE FUNCTION public\.(pct_\w+)\([^]*?AS \$\$([^]*?)\$\$;/g,
    ),
  ];
  expect(bodies).toHaveLength(18);
  for (const [, , body] of bodies)
    expect(body).toMatch(
      /BEGIN\s+(?:PERFORM|actor:=)\s*prompt_tool\.require_superadmin\(\);/,
    );
});
