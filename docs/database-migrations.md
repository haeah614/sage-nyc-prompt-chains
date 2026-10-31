# Week 8 migration runbook — not executed

Only preparation and offline parsing/tests are authorized in this step. Do not run these files now. No build, test, app startup or npm script applies SQL. There is deliberately no automatic migration or destructive down command.

## Preconditions for an isolated test installation

1. Obtain separate approval and choose a disposable, isolated Supabase project matching the intended PostgreSQL version (Week 7's draft uses PostgreSQL 17+ features). Confirm its identity without displaying credentials. Do not use production, a shared project, or a production data export.
2. Provision a **reviewed synthetic baseline**, not a blind replay of historical scripts: `auth.users`, `auth.identities`, trusted `auth.uid()`/`auth.jwt()`, roles `anon`/`authenticated`/`service_role`, `profiles` and its RLS/protected non-null boolean Superadmin flag, and existing `generations` shape.
3. Install or verify the reviewed Week 7 `01-domain-tables.sql` then `02-prompt-chain-mix.sql` equivalents in that test project. All referenced tables must exist, including `llm_responses` and `images`. Preserve the existing stamp/configuration triggers, immediate step uniqueness, FK actions and full-set mix RPC. Do not run the Admin repository's scripts against an already installed schema or change those source files.
4. Verify the actual `protect_sage_superadmin_flag` trigger (or review and adapt this proposal to a proven equivalent) prevents promotion via broad table grants, profile inserts/updates and privileged routines. The source repository says live installation is unverified. Week 8's prerequisite deliberately stops if the expected enabled trigger is missing. Do not bootstrap users or grant flags as part of these migrations.
5. Review function/table ownership, RLS, role memberships, custom roles, default privileges, all referencing FKs and trigger bodies. Owner must be trusted `postgres`; no untrusted role may replace helper functions, create objects in privileged schemas, set authenticated gateway claims, or bypass the profile boundary. The limited automated preconditions are not a complete schema-drift audit.
6. Confirm `prompt_tool`, `pct_*` names and `pct_step_parent_revision` are unused; existing conflicts intentionally abort. Confirm shared chain count ≤1,000, model/provider relationships, position/revision headroom, and no unsupported unreviewed custom triggers or cascading dependencies. Agree on short locks/timeouts and a maintenance window for the shared-table trigger DDL.
7. Approve the decisions below and prepare synthetic Google Superadmin, ordinary Google, and non-Google test identities through normal test Auth. Never copy real tokens or secrets into tests or SQL.

## Exact order after approval

Run as `postgres` in **separate** dedicated sessions/queries, not inside an outer transaction. Stop on the first error.

| Order | File                                              | Effect                                                                                                                                                                            |
| ----- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | `supabase/proposals/week8/000_preflight.sql`      | SELECT-only catalog/aggregate review; compare results to the baseline above. This is not an applied migration.                                                                    |
| 1     | `supabase/proposals/week8/001_foundation.sql`     | Checks prerequisites; creates private schema, five tables, helpers, indexes, RLS/revokes; adds the shared step→chain revision trigger. No seed data.                              |
| 2     | `supabase/proposals/week8/002_chain_rpcs.sql`     | Adds eight guarded definition/read RPCs and private helpers; grants only scoped EXECUTE to authenticated sessions. No table-write grants.                                         |
| 3     | `supabase/proposals/week8/003_execution_rpcs.sql` | Adds seven guarded execution/history/provenance RPCs. No network calls, jobs or runner.                                                                                           |
| 4     | `supabase/proposals/week8/004_history_delete.sql` | Adds separately reviewed, Superadmin-only individual and clear-history RPCs. It deletes only private run artifacts/steps/runs and is not required for chain execution.            |
| 5     | Separate reviewed test provisioning               | Configure the Gemini provider-ID allowlist and synthetic chain/model/step records. Test existing mix behavior before enabling any application write handler.                      |
| 6     | Separate future Storage setup, if needed          | Provision/verify the private artifact bucket and upload/reconciliation policy. Do not run the Admin image bucket SQL as provisioning. Text-only persistence tests need no bucket. |

Each numbered migration has its own explicit READ COMMITTED transaction, 5-second lock timeout and 30-second statement timeout. A failure rolls back that file; earlier committed files remain installed. If a SQL client leaves a failed transaction open, roll it back before further review. Do not retry blindly. Collision errors and schema mismatches require investigation, not `IF NOT EXISTS` patches or a forced drop.

The current parser is an offline PostgreSQL grammar parser, not proof of compatibility with the chosen server's catalog/version. PostgREST schema-cache visibility and function resolution must be verified after an approved installation. No application feature should be enabled between migrations 1 and 3.

## Decisions required before installation

- **Shared schema baseline:** Is Week 7 installed exactly as reviewed? Is Superadmin promotion protection proven? Approve any adaptation required by a different live trigger name/body.
- **Runtime authorization:** Approve user-session RPCs for Week 8 while Week 7 retains its existing service-role mix RPC. A future unattended worker needs a separate reviewed identity/delegation design; this proposal does not add service-role execution grants.
- **Editing policy:** Approve deactivating a chain before definition edits, up to 100 steps, the existing 1,000-chain mix limit, and strict expected revisions. Do not silently hide chains from the old mix.
- **Deletion/retention:** Approve the separately reviewed 004 history purge RPCs. They require explicit UI confirmation, delete artifacts before run steps before runs, and do not delete chains, steps, profiles or Week 7 records. Do not apply 004 until retention behavior has been reviewed.
- **Execution policy:** Approve linear text input chaining, five-minute nonrenewable leases, no automatic retries, model/provider allowlist, model-specific capabilities, budgets and cancellation limitations. Decide if business `version` should become immutable before first test; current proposal allows edits while inactive and snapshots past values.
- **Media policy:** Approve the separate private bucket, supported actual MIME types, 50 MiB/16-object metadata ceilings and orphan-reconciliation design before media tests. Metadata support is not functioning media generation.

## Rollback and recovery

Prefer forward repair with handlers disabled once records exist. Keep schema and data backups appropriate to the isolated project and record which files committed. The application must remain compatible with the baseline during a rollback.

- Before any runtime use: an approved operator can revoke the new public `pct_*` EXECUTE grants first, then remove 003 RPCs, then 002 RPCs/helpers. Remove the `pct_step_parent_revision` trigger on the shared step table before removing its helper/schema. Only after confirming the new tables are empty and dependencies are known may the 001 objects be removed in dependency order (artifacts → run_steps → chain_runs; step_options and gemini_providers; private helpers/schema). Do not use `DROP ... CASCADE` as a shortcut. No executable down script is supplied.
- After use: removing tables would destroy execution evidence, text/media references and provenance. Export/review retained records under an approved policy; preserve private objects or plan deletion separately. Disabling endpoints and leaving the additive tables in place is safer than dropping them.
- Never drop or replace Week 7 tables, uniqueness constraints, stamp/configuration triggers, the mix function, profiles policies or prior grants during rollback. The only new shared-table trigger is `pct_step_parent_revision`.
- Step/parent revisions already incremented must **not** be decremented. Old clients should reload. Step reorder results are ordinary valid positive positions and need no destructive reversal.
- Do not roll back a database result by repeating a Gemini request. External provider billing/work and Storage uploads are outside SQL transaction atomicity. Investigate leases, committed run state and orphaned objects separately.
- On a failed reorder/update RPC, PostgreSQL should roll back both intermediate positions and all revision increments. That guarantee must be verified in the isolated concurrency tests before enabling edits.

See [architecture](database-architecture.md) and the [deferred database verification matrix](database-verification.md).
