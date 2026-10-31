# Database verification scope

## Checks run without SQL execution

`npm test` includes the existing mocked authentication tests plus:

- PostgreSQL SQL and PL/pgSQL **parsing** of all four proposal files using local WebAssembly parser code. No PostgreSQL server/engine, query execution, migration runner, connection string or schema installation is used.
- Static proposal checks: SELECT-only preflight; transactional migration envelopes; no top-level row writes, destructive drops or Week 7 replacements; guarded RPCs, actor derivation, explicit grants, lock/revision/order rules, snapshot/lease handling and retention-oriented FKs.
- Executable TypeScript validation checks: strict definition fields, revision/confirmation requirements, no role/actor/mix injection, bounded generation settings, idempotency inputs, status/result consistency, UTF-8 sizes, private same-run media references and history cursors.
- Pure reorder-plan checks: exact membership, duplicates, foreign IDs, gaps, no-op, integer overflow, revision headroom, and immediate-uniqueness safety after each simulated row update for 1–100 reversed step sets.

Static checks and a TypeScript model are **not execution tests of SQL**. Parsing cannot validate relation/column resolution, permissions, trigger side effects, constraints against data, locks, PostgREST behavior, Auth JWT behavior or concurrency. The parser version can differ from the target PostgreSQL version. No PGlite or other in-memory migration execution is performed because this step expressly prohibits executing migrations.

## Required isolated database tests — deferred, not run

Use a separately approved synthetic baseline and the migration order in the runbook. Test fixtures must never include production rows or copied credentials. Keep API/network testing confined to that isolated project.

| Area                  | Required test and expected result                                                                                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration application | Apply 001→002→003 once; assert all objects, owners, RLS and grants. Missing baseline/flag protection or name collisions abort rather than partially adapting schema.                                                                                                              |
| Auth matrix           | With real signed test JWTs: anonymous denied, ordinary Google denied, flagged non-Google denied, approved Google Superadmin allowed. Revoke flag and ensure the next operation fails. No caller actor argument exists.                                                            |
| Direct table access   | PUBLIC/anon/authenticated/service_role cannot access private tables or helpers; service_role cannot execute new RPCs. Existing Week 7 service-role reads/mix continue to work. Review inherited/custom grants too.                                                                |
| Promotion attempts    | Existing profile APIs and direct authenticated requests cannot set `is_superadmin`, including inserts, broad-grant scenarios and any installed definer functions.                                                                                                                 |
| CRUD conflicts        | Create at zero weight; successful expected-revision edits; stale chain/step token fails; cross-chain step ID fails; options-only update bumps parent; active-chain edits fail.                                                                                                    |
| Week 7 mix regression | Open a complete mix snapshot; add/delete a chain or edit a step; old snapshot must conflict. Reloaded full-set save succeeds. Positive chains still require steps and enabled catalog entries. All-zero mix still works.                                                          |
| Reorder               | Reverse [A,B,C] with immediate uniqueness enabled; final positions 1..3. Missing/duplicate/foreign IDs and overflow fail. Force a failure during phase two using a disposable test-only trigger, then confirm original positions and revisions persist. Remove test-only trigger. |
| Snapshot integrity    | Enqueue, then edit/delete live steps and rename catalog metadata; stored snapshots and captured input remain unchanged. Deleted/disabled catalog entries block new claims, while prior results stay readable.                                                                     |
| Idempotency           | Same actor/key/payload returns the same run with no new steps. Changed payload conflicts. Concurrent same-key enqueue produces one run. Different actor with same key is independent.                                                                                             |
| Sequential execution  | Claim first step only, validate resolved input/instruction/model snapshot. Reject claim while another step is running; finish then claim next; allow explicit chain-input reset.                                                                                                  |
| Lease fencing         | Wrong actor, stale revision/token, expiry and post-cancel completions fail. Expire only an actually expired in-flight lease. No automatic provider call replay is triggered.                                                                                                      |
| Status/atomicity      | Finish success atomically inserts valid artifacts; invalid media metadata rolls back step/run updates and artifacts together. Failure skips later steps; cancellation closes pending/running steps; terminal rows cannot be reopened.                                             |
| Media consistency     | Cross-run/cross-chain links, wrong bucket/path/MIME, NULL media fields, oversize content and duplicate object paths fail. Real file validation and private Storage access are separate tests.                                                                                     |
| Optional provenance   | Missing legacy rows fail; incompatible image/response artifact kinds fail; inconsistent response/generation pair fails. Deleting a legacy source nulls links and preserves artifact content.                                                                                      |
| Safe deletion         | Inactive unused empty chain deletes; steps/history/unknown cascades block unsafe deletion. A live step can be deleted while snapshots survive. Account removal clears attribution but retains run/artifact content.                                                               |
| History               | Chain-scoped ordering and tied timestamps paginate without skipped/duplicated rows on a stable dataset; unauthorized readers see nothing; read-run excludes lease tokens.                                                                                                         |
| Recovery              | Simulate losing the completion response and read the run before retrying persistence. Simulate successful upload + rejected completion; verify future orphan reconciliation without deleting referenced objects.                                                                  |

### Multi-session tests (real PostgreSQL, not a single-session model)

Use two independent transactions/API clients and bounded timeouts:

1. Reorder versus step edit/delete: one commits, the stale chain revision rejects the other; no duplicate positions or partial changes.
2. Step/chain changes versus Week 7 full-set mix save: shared `(77007,1)` lock serializes changes; full-set/revision conflict is detected after waiting.
3. Provider/model disable versus enqueue/claim: snapshot and live enabled checks behave consistently with the shared configuration lock; no new claim proceeds on disabled configuration after its commit.
4. Duplicate enqueue and duplicate claim: one run per idempotency key and only one in-flight lease.
5. Completion versus cancellation/expiry: run-row serialization chooses one accepted outcome; the loser receives a conflict with no orphan DB artifacts.
6. Superadmin revocation versus mutation: profile row lock prevents a role change midway through an already authorized transaction; subsequent requests deny access. Bound all transactions so revocation is not delayed by a provider call.
7. Chain deletion versus enqueue and FK reference insertion: no accepted history is cascaded or orphaned.
8. Optional source deletion versus artifact linking: nullable FKs preserve historical content and revisions remain usable.

Any deadlock, lock timeout or serialization error must be surfaced as a bounded conflict/reload response. Do not automatically rerun an external provider call. Review query plans for history and identifier lookups only after realistic synthetic data exists.
