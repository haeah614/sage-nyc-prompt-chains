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

## Shared `sage-nyc-admin` migration review — 2026-11-25

**Prepared, not applied. User approval is required before any shared-database
change.** The user's current request authorizes inspection and preparation for
this shared target, superseding the earlier isolated-project-only scope above.
It does not authorize applying the proposal yet.

Target: `maqhbfhrzluqznzrpisb` (`sage-nyc-admin`, `us-west-2`).
Source: `iakvzlgxtucbcrgieacj` (`sage-nyc-admin-week7-test`, paused).
`funnystudy-iteration-3` is excluded from every operation. No plan upgrade,
project pause, source deletion, credential rotation, or Auth configuration change
is part of this proposal.

### Read-only findings

- Target is `ACTIVE_HEALTHY`; `pg_database_size(current_database())` returned
  **13,003,923 bytes** (13.004 decimal MB / 12.401 MiB).
- Against the documented Free allowance of 500 MB, a conservative decimal
  500,000,000-byte calculation leaves **486,996,077 bytes** (~487 MB), 97.4%.
  This is a point-in-time database measurement, including indexes and catalogs;
  it is not an egress or Storage-object usage measurement. Other apps share it.
- All required public Week 7 tables exist. The four configuration tables have
  their 12 enabled stamp/lock/check triggers. Existing routines are owned by
  `postgres`. The chain/model/provider tables are currently empty.
- `prompt_tool` and public `pct_*` RPCs are absent. There are two existing
  Superadmin profiles; no names, user tokens, or flags were exported or changed.
- The target lacks `protect_sage_superadmin_flag`, but effective INSERT/UPDATE
  privileges on that column are false for ordinary authenticated users; anon
  also lacks table UPDATE. The profile table is RLS-enabled and only postgres
  and service_role have table grants. Existing auth provisioning inserts names
  and leaves the Superadmin flag at its false default. The inspected public
  SECURITY DEFINER routines do not expose flag updates.
- Google is enabled and nonce validation enabled. The shared project's Google
  client ID differs from Prompt Studio's local Google client ID. Target Auth
  settings must remain unchanged; Prompt Studio must use an already accepted
  shared client, with its own origins registered in that Google Web client.
- Source project DNS is unavailable while paused. Its Management API backup
  listing returned zero backups and empty physical-backup metadata. This is
  **not evidence that its data is empty or lost**. Source row counts, catalog,
  prompt definitions, and run history cannot yet be verified or imported.

References: [Free database allowance](https://supabase.com/docs/guides/platform/billing-on-supabase),
[database versus disk usage](https://supabase.com/docs/guides/platform/database-size).

### Approval scope A: additive schema installation only

Review `supabase/proposals/shared-admin/001_prompt_studio.sql` (standalone,
transactional, not wired into any automatic migration runner). It assembles the
existing Week 8 foundation and all 18 application RPCs, including the existing
explicitly confirmed history/chain-delete capabilities. Installing those RPCs
executes no deletions.

Changes are limited to:

1. Create private `prompt_tool` schema, five empty tables, indexes and helpers.
2. Create 18 guarded public RPCs with EXECUTE only for `authenticated`; every RPC
   checks signed Google identity and the existing true Superadmin flag. Private
   tables remain RLS-enabled without browser grants or policies.
3. Add `pct_step_parent_revision` to the existing step table. Future step edits
   invalidate parent revisions, so an already-open Admin mix form may require a
   reload. The trigger does not alter mix weights or existing chain records at
   installation time.

The target-specific prerequisite checks existing flag privileges instead of
requiring an absent trigger. It does not add a profile trigger, grant access,
change a policy, alter Auth provisioning, or change an existing role flag.
Hashes of the eight inspected public function definitions guard against drift.
Object collisions abort rather than overwrite. Recheck table/column/constraint,
ACL, trigger and role-membership drift immediately before executing.

The proposal uses one READ COMMITTED transaction, a five-second lock timeout,
and a 30-second statement timeout. Initial and final checks abort at **50 MB
for the entire database**, intentionally far below the 500 MB Free allowance.
This bounds the approved empty-schema installation. No import or model seeds
are included. SQL identity cannot safely infer a hosted project reference:
the operator must verify the exact target through the Management API before
submitting anything.

Before application, take a recoverable target backup using an approved secure
local destination and verify restoreability. Do not commit database data,
credentials, or tokens. The old runbook remains relevant for locking,
concurrency, and negative authorization tests.

### Source preservation and cutover gates — not yet ready for approval

Do not present an empty target as a completed migration. Obtain a downloadable
backup/export of the paused source through its dashboard or Supabase support,
without pausing either active project or upgrading. If it is unavailable,
retain the source unchanged and stop before cutover; no data-loss waiver is
implied by schema approval.

After a source export is available:

1. Restore it into an isolated **local** PostgreSQL environment. Inspect actual
   schema, data sizes/counts, dependencies and source-only schema changes; the
   repository proposals are not proof of the source's live schema.
2. Prepare a separate reviewed data-only import for providers, models, chains,
   steps, `step_options`, provider allowlist, runs, run steps and artifacts.
   Preserve UUIDs, snapshots, revisions, timestamps and output text. Detect
   collisions and stop; do not use blanket ON CONFLICT overwrites.
3. Map actor references using verified identities, never blindly copy Auth UUIDs
   across projects. Do not import auth.users, identities, sessions, passwords,
   profiles or role flags into the shared project. Missing mappings and optional
   provenance links require explicit review; do not silently discard attribution
   or set links to NULL. Check any source Storage objects separately.
4. Existing stamp and parent-revision triggers would rewrite imported metadata.
   Design and rehearse an import-specific preservation procedure locally before
   requesting import approval. Never disable shared triggers opportunistically
   or replay a whole source database dump into the target.
5. Measure restored source relation/index sizes and the rehearsed target delta.
   Require target + import + indexes + conservative overhead to stay below
   **50 MB** for this initial migration; revise the estimate and request renewed
   review if not. Recheck live target size immediately before and after import.
6. Review the complete import SQL and row-count/content-checksum reconciliation
   before requesting separate approval. Preserve the source until reconciliation
   and the user's acceptance are complete.
7. Only then update **Prompt Studio's** Vercel Supabase URL/public key/server key
   to the target project's matching values, and Google client ID to the shared
   provider's existing client. Retain Gemini credentials and exact origin/CSRF
   controls. Never change the Consumer or Admin deployments or environment files.
8. Register Prompt Studio's stable origin and `/auth/callback` in that Google
   client's authorized JavaScript origins and redirect URIs, preserving all
   existing entries. Register a new commit URL too if it will be used for login.
   Supabase Site URL/redirect allowlists are not the redirect path for this app's
   GIS `signInWithIdToken` flow and need no speculative changes.
9. Deploy Prompt Studio, verify approved Superadmin access and ordinary-user
   denial, create/configure a chain, execute real Gemini steps, verify outputs
   and persistent history, then smoke-test the existing Consumer/Admin flows.
   Record a video only after all checks pass.

No paid plan is needed for the measured empty-schema installation. Future
unbounded run history can still fill any finite quota: one step can retain its
input plus output plus a duplicate output artifact (up to roughly 0.75 MiB,
plus snapshots/indexes); 100 large steps can exceed 75 MiB per run. Measure total
DB and `prompt_tool` relation sizes before/after walkthrough runs. Review at
350 MB and suspend new Prompt Studio runs operationally at 400 MB, leaving
headroom for the other apps; this is an operational threshold, not an installed
hard quota. Never auto-purge history to meet the limit. Any retention or runtime
admission-control change needs a separate review. The Free plan must stay Free.

### Verification and rollback status

Prepared SQL is grammar-checked with PostgreSQL and PL/pgSQL parsers and tested
for no top-level data writes, no replacement of existing public functions,
profile-grant checks, scoped RPC guards, and capacity gates. This is **not** a
live migration rehearsal. Local Docker was unavailable during preparation.

If installation fails, its transaction rolls back. After installation, prefer
forward repair and leave data intact; do not drop the schema after it has data.
Before any cutover, the existing app remains on its original backend. After
cutover, reverting environment variables alone does not merge new records back
into the paused source; freeze writes and reconcile before any rollback.
