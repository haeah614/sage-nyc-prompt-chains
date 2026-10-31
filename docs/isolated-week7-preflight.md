# Read-only preflight for `sage-nyc-admin-week7-test`

This procedure is intentionally separate from the migration files. It does not
create a transaction, change a grant, alter a policy, write a row, or contact
Storage. Run it only in the Supabase SQL Editor after confirming the editor's
project name and reference are `sage-nyc-admin-week7-test`. Never paste a URL,
key, token, or `.env` value into the query.

## Step 1: confirm the target

Run this small query first and stop if the result is not the isolated Week 7
test project or if the current role is not the reviewed database owner:

```sql
select current_database(), current_user, version();
```

Do not infer project identity from a copied connection string. Check the
Supabase dashboard project name/reference outside the query editor.

## Step 2: run the catalog-only proposal

Open and run [000_preflight.sql](../supabase/proposals/week8/000_preflight.sql)
as one read-only query. It reports object definitions, constraints, triggers,
function security/search paths, policies, grants, default privileges, aggregate
chain diagnostics, and the explicit `profiles.is_superadmin` privilege checks.

It must not be run with `BEGIN`, `COMMIT`, `GRANT`, `ALTER`, `CREATE`, `UPDATE`,
or a SQL editor option that wraps or retries it. If a relation is missing, the
final aggregate diagnostics can error after the catalog results; treat that as
a failed prerequisite and stop. Do not “fix” the project by running another
script.

## Step 3: record the required evidence

Save only the result metadata and booleans, not profile rows, prompts, tokens,
emails, or generated text. The following conditions are required before any
Week 8 proposal can be considered compatible:

- `public.profiles.is_superadmin` exists, is `boolean NOT NULL`, and profile
  RLS is enabled.
- `public.llm_providers`, `llm_models`, `prompt_chains`, `prompt_chain_steps`,
  `llm_responses`, `images`, and the Week 7 referenced `generations` table
  exist with the expected UUID keys and columns.
- `week7_stamp_row()`, `week7_lock_configuration()`,
  `week7_check_configuration()`, and
  `admin_update_prompt_chain_mix(uuid,jsonb)` exist with the expected owner,
  `SECURITY DEFINER`/search path, trigger definitions, and service-role-only
  mix RPC grant.
- Every Week 7 chain/model/provider table retains its immediate unique/FK
  constraints and the `(77007,1)` statement lock/check triggers.
- `protect_sage_superadmin_flag` is enabled on `public.profiles`, and its
  function body rejects flag changes unless `current_user` is the reviewed DBA
  role. The name alone is insufficient; review `pg_get_functiondef` output.
- `has_column_privilege('authenticated', 'public.profiles',
'is_superadmin', 'UPDATE')` and the corresponding INSERT check are false;
  anonymous privileges are also false. If a broad table grant is present, the
  trigger must still reject the write.
- `prompt_tool`, `pct_*`, and `pct_step_parent_revision` do not already exist.
- Existing chain count is at most 1,000, and there are no unexpected cascading
  FKs or delete triggers on the objects that the proposal will protect.

The current read-only repository evidence shows that the Admin test setup
_proposes_ the protection trigger and tests the self-promotion cases, but it
does not prove the current remote test project's installed state. The explicit
privilege/trigger checks above are mandatory.

## Step 4: assess reuse

Reuse the project only if every condition is satisfied and it contains no
important test data that cannot be discarded. If any condition is unknown,
missing, or different, create a fresh isolated Week 8 project instead of
adapting the proposals in place. In particular, do not apply `001_foundation.sql`
to a project without the verified flag-protection trigger or without the
reviewed Week 7 configuration triggers.

No later step is authorized by this document. Migration execution, synthetic
data provisioning, Auth tests, RLS tests, and concurrency tests require a
separate approval after the read-only results have been reviewed.
