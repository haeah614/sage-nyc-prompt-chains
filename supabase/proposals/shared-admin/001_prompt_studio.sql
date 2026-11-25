-- PREPARED ONLY. USER APPROVAL REQUIRED. NO EXECUTION OR CUTOVER AUTHORIZED.
-- Target only: sage-nyc-admin / maqhbfhrzluqznzrpisb / us-west-2.
-- The execution operator MUST verify that project reference outside SQL.
-- Phase A: additive schema only. No source-data import, seeds, auth or env changes.
-- Based on live read-only inspection 2026-11-25 and Week 8 proposals.
-- Single transaction: failures, including the final capacity check, roll back all DDL.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Reviewed migration owner required'; END IF;
  IF pg_catalog.pg_database_size(pg_catalog.current_database()) >= 50000000
    THEN RAISE EXCEPTION 'Phase A exceeds reviewed 50 MB database budget; remeasure and review'; END IF;
  IF pg_catalog.to_regnamespace('prompt_tool') IS NOT NULL OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'pct\_%' ESCAPE '\')
    THEN RAISE EXCEPTION 'Prompt Studio objects already exist; do not overwrite'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='create_profile_for_new_user' AND pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))='06f828c5349cc9b9b884124d89dbec2d' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres') THEN RAISE EXCEPTION 'Reviewed function drift: create_profile_for_new_user'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_plan_vote_counts' AND pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))='10f8ee86a644ef42db7ba1041e42aeed' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres') THEN RAISE EXCEPTION 'Reviewed function drift: get_plan_vote_counts'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_plan_vote_totals' AND pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))='296281c42393f83d23c987cba13892af' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres') THEN RAISE EXCEPTION 'Reviewed function drift: get_plan_vote_totals'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_delete_unreferenced_plan' AND pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))='83057df90c64b013d06b1f649c97753b' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres') THEN RAISE EXCEPTION 'Reviewed function drift: admin_delete_unreferenced_plan'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='week7_stamp_row' AND pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))='6c8f7f2883cb97676bb3826be0c87dd8' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres') THEN RAISE EXCEPTION 'Reviewed function drift: week7_stamp_row'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='week7_lock_configuration' AND pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))='acce27e43fcf63dcb0674a0185913c80' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres') THEN RAISE EXCEPTION 'Reviewed function drift: week7_lock_configuration'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='week7_check_configuration' AND pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))='6d49ffc89669fd7da9ea4cba7d6a5060' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres') THEN RAISE EXCEPTION 'Reviewed function drift: week7_check_configuration'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_update_prompt_chain_mix' AND pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))='cefbbc91f6ffc64a24a9cc071d458798' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres') THEN RAISE EXCEPTION 'Reviewed function drift: admin_update_prompt_chain_mix'; END IF;
END $$;
-- Source: week8/001_foundation.sql
-- PROPOSAL ONLY / NOT APPLIED. Requires reviewed Week 7 01 + 02 and protected profiles flag.
-- Run once as postgres, separately, after 000 metadata comparison. No seed rows.

DO $$
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Apply as reviewed migration owner postgres'; END IF;
  IF to_regprocedure('public.week7_stamp_row()') IS NULL
    OR to_regprocedure('public.week7_lock_configuration()') IS NULL
    OR to_regprocedure('public.week7_check_configuration()') IS NULL
    OR to_regprocedure('public.admin_update_prompt_chain_mix(uuid,jsonb)') IS NULL
    OR to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('auth.jwt()') IS NULL
    THEN RAISE EXCEPTION 'Missing reviewed Week 7 / Supabase prerequisites'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='profiles' AND column_name='is_superadmin' AND data_type='boolean' AND is_nullable='NO')
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.profiles'::regclass)
    THEN RAISE EXCEPTION 'Review profiles authorization and RLS'; END IF;
  -- This target protects the flag through grants; do not replace its policies,
  -- auth provisioning function, or service-role administrative behavior.
  IF EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated')) roles(name)
    WHERE pg_catalog.has_column_privilege(name,'public.profiles','is_superadmin','INSERT')
       OR pg_catalog.has_column_privilege(name,'public.profiles','is_superadmin','UPDATE'))
    THEN RAISE EXCEPTION 'Profile flag privileges changed; stop for security review'; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid IN ('public.prompt_chains'::regclass,
     'public.prompt_chain_steps'::regclass,'public.llm_models'::regclass,'public.llm_providers'::regclass)
     AND tgname IN ('week7_stamp','week7_configuration_lock','week7_configuration_check') AND tgenabled='O') <> 12
    THEN RAISE EXCEPTION 'Reviewed Week 7 triggers are required'; END IF;
  IF (SELECT count(*) FROM public.prompt_chains)>1000 THEN RAISE EXCEPTION 'Week 7 mix supports at most 1000 chains'; END IF;
END $$;

CREATE SCHEMA prompt_tool AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA prompt_tool FROM PUBLIC,anon,authenticated,service_role;

-- No caller-supplied actor UUID. A signed user JWT supplies auth.uid(); both the
-- Google identity and current DB flag are rechecked. Never grant to service_role.
CREATE FUNCTION prompt_tool.require_superadmin() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid := auth.uid();
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='25000'; END IF;
  IF actor IS NULL OR (auth.jwt()->>'role') IS DISTINCT FROM 'authenticated'
     OR (auth.jwt()->'app_metadata'->>'provider') IS DISTINCT FROM 'google'
     OR NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id=actor AND i.provider='google')
    THEN RAISE EXCEPTION 'Verified Google identity required' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.profiles p WHERE p.id=actor AND p.is_superadmin IS TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Superadmin authorization required' USING ERRCODE='42501'; END IF;
  RETURN actor;
END $$;
REVOKE ALL ON FUNCTION prompt_tool.require_superadmin() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION prompt_tool.lock_configuration() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- Call after require_superadmin, before acquiring any chain/step/model row locks.
  PERFORM pg_catalog.pg_advisory_xact_lock(77007,1);
END $$;
REVOKE ALL ON FUNCTION prompt_tool.lock_configuration() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION prompt_tool.valid_generation_config(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF value IS NULL OR jsonb_typeof(value)<>'object' OR octet_length(value::text)>4096 THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(value) k WHERE k NOT IN ('temperature','top_p','max_output_tokens')) THEN RETURN false; END IF;
  IF value ? 'temperature' AND (jsonb_typeof(value->'temperature')<>'number'
    OR NOT ((value->>'temperature')::numeric BETWEEN 0 AND 2)) THEN RETURN false; END IF;
  IF value ? 'top_p' AND (jsonb_typeof(value->'top_p')<>'number'
    OR NOT ((value->>'top_p')::numeric BETWEEN 0 AND 1)) THEN RETURN false; END IF;
  IF value ? 'max_output_tokens' AND (jsonb_typeof(value->'max_output_tokens')<>'number'
    OR (value->>'max_output_tokens') !~ '^[1-9][0-9]{0,5}$'
    OR (value->>'max_output_tokens')::numeric>65536) THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION prompt_tool.valid_generation_config(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE prompt_tool.step_options (
  step_id uuid PRIMARY KEY REFERENCES public.prompt_chain_steps(id) ON DELETE CASCADE,
  input_source text NOT NULL DEFAULT 'previous_output' CHECK(input_source IN ('chain_input','previous_output')),
  generation_config jsonb NOT NULL DEFAULT '{}' CHECK(prompt_tool.valid_generation_config(generation_config))
);
-- Explicit operator-reviewed provider mapping; no assumptions about catalog slugs.
-- Only the migration owner may provision this allowlist after review. No seeds.
CREATE TABLE prompt_tool.gemini_providers (
  provider_id uuid PRIMARY KEY REFERENCES public.llm_providers(id) ON DELETE RESTRICT
);

-- Child edits must invalidate a chain-wide optimistic revision, including Week 7
-- mix forms. Keep week7_stamp intact; revision changes need not be exactly +1.
CREATE FUNCTION prompt_tool.bump_parent_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target uuid;
BEGIN
  IF TG_OP='UPDATE' AND NEW.chain_id IS DISTINCT FROM OLD.chain_id THEN
    RAISE EXCEPTION 'A step cannot move between chains' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN target:=OLD.chain_id; ELSE target:=NEW.chain_id; END IF;
  UPDATE public.prompt_chains SET updated_at=clock_timestamp() WHERE id=target;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION prompt_tool.bump_parent_revision() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER pct_step_parent_revision AFTER INSERT OR UPDATE OR DELETE ON public.prompt_chain_steps
  FOR EACH ROW EXECUTE FUNCTION prompt_tool.bump_parent_revision();

CREATE TABLE prompt_tool.chain_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL REFERENCES public.prompt_chains(id) ON DELETE RESTRICT,
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  idempotency_key uuid NOT NULL,
  chain_revision integer NOT NULL CHECK(chain_revision>0),
  chain_snapshot jsonb NOT NULL CHECK(jsonb_typeof(chain_snapshot)='object'),
  input_text text NOT NULL CHECK(length(btrim(input_text)) BETWEEN 1 AND 20000),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text CHECK(error_code IN ('provider_error','timeout','invalid_output','cancelled','lease_expired')),
  error_message text CHECK(octet_length(error_message)<=2000),
  UNIQUE(requested_by,idempotency_key),
  UNIQUE(id,chain_id),
  CHECK((status IN ('queued','running')) = (finished_at IS NULL)),
  CHECK(status<>'queued' OR started_at IS NULL),
  CHECK(status NOT IN ('running','succeeded') OR started_at IS NOT NULL),
  CHECK((status IN ('failed','cancelled')) = (error_code IS NOT NULL)),
  CHECK(error_code IS NOT NULL OR error_message IS NULL)
);
CREATE INDEX pct_runs_chain_history ON prompt_tool.chain_runs(chain_id,created_at DESC,id DESC);
CREATE INDEX pct_runs_requester ON prompt_tool.chain_runs(requested_by);

CREATE TABLE prompt_tool.run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  chain_id uuid NOT NULL,
  -- Historical identifier, deliberately not a live FK: removing a step must not
  -- erase or mutate snapshots. Only enqueue RPC copies it from the actual step.
  source_step_id uuid NOT NULL,
  position integer NOT NULL CHECK(position BETWEEN 1 AND 100),
  step_snapshot jsonb NOT NULL CHECK(jsonb_typeof(step_snapshot)='object'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','skipped','cancelled')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  input_text text CHECK(octet_length(input_text)<=262144),
  output_text text CHECK(octet_length(output_text)<=262144),
  error_code text CHECK(error_code IN ('provider_error','timeout','invalid_output','cancelled','lease_expired')),
  error_message text CHECK(octet_length(error_message)<=2000),
  executed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  lease_token uuid,
  lease_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  usage jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(usage)='object' AND octet_length(usage::text)<=4096),
  FOREIGN KEY(run_id,chain_id) REFERENCES prompt_tool.chain_runs(id,chain_id) ON DELETE RESTRICT,
  UNIQUE(run_id,position), UNIQUE(run_id,source_step_id), UNIQUE(id,run_id,chain_id),
  CHECK((status='running') = (lease_token IS NOT NULL)),
  CHECK((status='running') = (lease_expires_at IS NOT NULL)),
  CHECK((status IN ('pending','running')) = (finished_at IS NULL)),
  CHECK(status<>'pending' OR started_at IS NULL),
  CHECK(status NOT IN ('running','succeeded','failed') OR started_at IS NOT NULL),
  CHECK((status IN ('failed','cancelled')) = (error_code IS NOT NULL)),
  CHECK(error_code IS NOT NULL OR error_message IS NULL)
);
CREATE INDEX pct_run_steps_executor ON prompt_tool.run_steps(executed_by);
CREATE INDEX pct_run_steps_chain ON prompt_tool.run_steps(chain_id);
CREATE INDEX pct_running_step_expiry ON prompt_tool.run_steps(lease_expires_at) WHERE status='running';

CREATE TABLE prompt_tool.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL,
  run_id uuid NOT NULL,
  run_step_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('text','image','audio','video')),
  text_content text CHECK(octet_length(text_content)<=262144),
  bucket_id text,
  object_path text,
  mime_type text,
  byte_size bigint CHECK(byte_size BETWEEN 1 AND 52428800),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  -- Optional provenance links preserve Week 7 records and their deletion behavior.
  generation_id uuid REFERENCES public.generations(id) ON DELETE SET NULL,
  response_id uuid REFERENCES public.llm_responses(id) ON DELETE SET NULL,
  image_id uuid REFERENCES public.images(id) ON DELETE SET NULL,
  FOREIGN KEY(run_step_id,run_id,chain_id) REFERENCES prompt_tool.run_steps(id,run_id,chain_id) ON DELETE RESTRICT,
  CHECK((kind='text' AND text_content IS NOT NULL AND length(btrim(text_content))>0
     AND bucket_id IS NULL AND object_path IS NULL AND mime_type IS NULL AND byte_size IS NULL)
    OR (kind<>'text' AND text_content IS NULL AND bucket_id IS NOT NULL AND bucket_id='prompt-chain-artifacts'
     AND object_path IS NOT NULL AND object_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$'
     AND split_part(object_path,'/',1)=run_id::text
     AND mime_type IS NOT NULL AND mime_type ~ '^(image|audio|video)/[a-zA-Z0-9.+-]+$'
     AND split_part(mime_type,'/',1)=kind AND byte_size IS NOT NULL)),
  UNIQUE(bucket_id,object_path)
);
CREATE TRIGGER pct_artifact_stamp BEFORE INSERT OR UPDATE ON prompt_tool.artifacts
  FOR EACH ROW EXECUTE FUNCTION public.week7_stamp_row();
CREATE INDEX pct_artifacts_chain ON prompt_tool.artifacts(chain_id,created_at DESC,id DESC);
CREATE INDEX pct_artifacts_step ON prompt_tool.artifacts(run_step_id,run_id,chain_id);
CREATE INDEX pct_artifacts_generation ON prompt_tool.artifacts(generation_id) WHERE generation_id IS NOT NULL;
CREATE INDEX pct_artifacts_response ON prompt_tool.artifacts(response_id) WHERE response_id IS NOT NULL;
CREATE INDEX pct_artifacts_image ON prompt_tool.artifacts(image_id) WHERE image_id IS NOT NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['step_options','gemini_providers','chain_runs','run_steps','artifacts'] LOOP
    EXECUTE format('ALTER TABLE prompt_tool.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE prompt_tool.%I FROM PUBLIC,anon,authenticated,service_role',t);
  END LOOP;
END $$;
-- No browser policies or direct runtime table grants. Access only via guarded RPCs.
-- Existing Week 7 tables, policies, grants, stamp/mix functions and constraints survive.

-- Source: week8/002_chain_rpcs.sql
-- PROPOSAL ONLY / NOT APPLIED. Requires 001. Run once as postgres.

-- Internal helpers are not executable by any runtime role.
CREATE FUNCTION prompt_tool.checked_chain(p_id uuid,p_revision integer,p_edit boolean DEFAULT true)
RETURNS public.prompt_chains LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.prompt_chains;
BEGIN
  SELECT * INTO c FROM public.prompt_chains WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR p_revision IS NULL OR p_revision<1 OR p_revision>=2147483447 OR c.revision<>p_revision THEN
    RAISE EXCEPTION 'Chain changed or removed; reload' USING ERRCODE='40001'; END IF;
  IF p_edit AND c.mix_weight<>0 THEN RAISE EXCEPTION 'Deactivate chain in the Week 7 mix before editing' USING ERRCODE='23514'; END IF;
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION prompt_tool.checked_chain(uuid,integer,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pct_save_chain(p_id uuid,p_expected_revision integer,p_name text,p_slug text,p_version integer,p_description text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.prompt_chains;
BEGIN
  PERFORM prompt_tool.require_superadmin();
  PERFORM prompt_tool.lock_configuration();
  IF p_id IS NULL THEN
    IF p_expected_revision IS NOT NULL THEN RAISE EXCEPTION 'New chains have no expected revision' USING ERRCODE='22023'; END IF;
    IF (SELECT count(*) FROM public.prompt_chains)>=1000 THEN RAISE EXCEPTION 'Week 7 mix chain limit reached' USING ERRCODE='23514'; END IF;
    INSERT INTO public.prompt_chains(name,slug,version,description,mix_weight)
      VALUES(p_name,p_slug,p_version,p_description,0) RETURNING * INTO c;
  ELSE
    c:=prompt_tool.checked_chain(p_id,p_expected_revision);
    UPDATE public.prompt_chains SET name=p_name,slug=p_slug,version=p_version,description=p_description
      WHERE id=p_id RETURNING * INTO c;
  END IF;
  RETURN to_jsonb(c);
END $$;
REVOKE ALL ON FUNCTION public.pct_save_chain(uuid,integer,text,text,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_save_chain(uuid,integer,text,text,integer,text) TO authenticated;

CREATE FUNCTION public.pct_save_step(p_chain_id uuid,p_chain_revision integer,p_id uuid,p_step_revision integer,
  p_name text,p_instruction text,p_model_id uuid,p_input_source text,p_generation_config jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.prompt_chain_steps; next_position bigint; c public.prompt_chains;
BEGIN
  PERFORM prompt_tool.require_superadmin();
  PERFORM prompt_tool.lock_configuration();
  c:=prompt_tool.checked_chain(p_chain_id,p_chain_revision);
  IF p_id IS NULL THEN
    IF p_step_revision IS NOT NULL THEN RAISE EXCEPTION 'New steps have no expected revision' USING ERRCODE='22023'; END IF;
    IF (SELECT count(*) FROM public.prompt_chain_steps WHERE chain_id=p_chain_id)>=100 THEN
      RAISE EXCEPTION 'At most 100 steps per chain' USING ERRCODE='23514'; END IF;
    SELECT coalesce(max(position)::bigint,0)+1 INTO next_position FROM public.prompt_chain_steps WHERE chain_id=p_chain_id;
    IF next_position>2147483547 THEN RAISE EXCEPTION 'Reorder existing steps before appending' USING ERRCODE='22023'; END IF;
    INSERT INTO public.prompt_chain_steps(chain_id,position,name,instruction,model_id)
      VALUES(p_chain_id,next_position::integer,p_name,p_instruction,p_model_id) RETURNING * INTO s;
  ELSE
    SELECT * INTO s FROM public.prompt_chain_steps WHERE id=p_id AND chain_id=p_chain_id FOR UPDATE;
    IF NOT FOUND OR p_step_revision IS NULL OR p_step_revision<1 OR p_step_revision>=2147483646 OR s.revision<>p_step_revision THEN
      RAISE EXCEPTION 'Step changed or removed; reload' USING ERRCODE='40001'; END IF;
    UPDATE public.prompt_chain_steps SET name=p_name,instruction=p_instruction,model_id=p_model_id WHERE id=p_id RETURNING * INTO s;
  END IF;
  INSERT INTO prompt_tool.step_options(step_id,input_source,generation_config) VALUES(s.id,p_input_source,p_generation_config)
    ON CONFLICT(step_id) DO UPDATE SET input_source=excluded.input_source,generation_config=excluded.generation_config;
  -- Parent revision already bumped by the step row write (including options-only edits).
  SELECT * INTO c FROM public.prompt_chains WHERE id=p_chain_id;
  RETURN jsonb_build_object('step',to_jsonb(s),'chain_revision',c.revision);
END $$;
REVOKE ALL ON FUNCTION public.pct_save_step(uuid,integer,uuid,integer,text,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_save_step(uuid,integer,uuid,integer,text,text,uuid,text,jsonb) TO authenticated;

CREATE FUNCTION public.pct_reorder_steps(p_chain_id uuid,p_chain_revision integer,p_step_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.prompt_chains; n integer; highest bigint;
BEGIN
  PERFORM prompt_tool.require_superadmin();
  PERFORM prompt_tool.lock_configuration();
  c:=prompt_tool.checked_chain(p_chain_id,p_chain_revision);
  SELECT count(*),coalesce(max(position),0) INTO n,highest FROM public.prompt_chain_steps WHERE chain_id=p_chain_id;
  IF p_step_ids IS NULL OR coalesce(array_ndims(p_step_ids),1)<>1 OR cardinality(p_step_ids)<>n OR n>100
    OR EXISTS(SELECT 1 FROM unnest(p_step_ids) v WHERE v IS NULL)
    OR (SELECT count(DISTINCT v) FROM unnest(p_step_ids) v)<>n
    OR EXISTS(SELECT 1 FROM unnest(p_step_ids) v WHERE NOT EXISTS(
      SELECT 1 FROM public.prompt_chain_steps s WHERE s.id=v AND s.chain_id=p_chain_id)) THEN
    RAISE EXCEPTION 'Provide every step ID exactly once' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM unnest(p_step_ids) WITH ORDINALITY AS x(id,ord)
    JOIN public.prompt_chain_steps s ON s.id=x.id WHERE s.position<>x.ord) THEN
    RETURN jsonb_build_object('chain_revision',c.revision,'step_ids',to_jsonb(p_step_ids)); END IF;
  IF highest+n>2147483647 OR EXISTS(SELECT 1 FROM public.prompt_chain_steps WHERE chain_id=p_chain_id AND revision>=2147483646) THEN
    RAISE EXCEPTION 'Position or revision headroom exhausted' USING ERRCODE='22023'; END IF;
  -- Existing immediate UNIQUE(chain_id,position) remains unchanged. Phase one
  -- moves to a disjoint positive band; phase two writes contiguous 1..N.
  UPDATE public.prompt_chain_steps s SET position=(highest+x.ord)::integer
    FROM unnest(p_step_ids) WITH ORDINALITY AS x(id,ord) WHERE s.id=x.id AND s.chain_id=p_chain_id;
  UPDATE public.prompt_chain_steps s SET position=x.ord::integer
    FROM unnest(p_step_ids) WITH ORDINALITY AS x(id,ord) WHERE s.id=x.id AND s.chain_id=p_chain_id;
  SELECT * INTO c FROM public.prompt_chains WHERE id=p_chain_id;
  RETURN jsonb_build_object('chain_revision',c.revision,'step_ids',to_jsonb(p_step_ids));
END $$;
REVOKE ALL ON FUNCTION public.pct_reorder_steps(uuid,integer,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_reorder_steps(uuid,integer,uuid[]) TO authenticated;

CREATE FUNCTION prompt_tool.assert_safe_delete(p_table regclass) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- Unknown FK actions must not silently cascade through a future schema change.
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid=p_table
    AND NOT (p_table='public.prompt_chain_steps'::regclass AND conrelid='prompt_tool.step_options'::regclass)
    AND confdeltype NOT IN ('a','r')) THEN
    RAISE EXCEPTION 'Unreviewed cascading deletion dependency' USING ERRCODE='23503'; END IF;
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=p_table AND NOT tgisinternal AND (tgtype & 8)=8
    AND tgname NOT IN ('week7_configuration_lock','week7_configuration_check','pct_step_parent_revision')) THEN
    RAISE EXCEPTION 'Unreviewed delete trigger' USING ERRCODE='23503'; END IF;
END $$;
REVOKE ALL ON FUNCTION prompt_tool.assert_safe_delete(regclass) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pct_delete_step(p_chain_id uuid,p_chain_revision integer,p_step_id uuid,p_step_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.prompt_chain_steps; c public.prompt_chains;
BEGIN
  PERFORM prompt_tool.require_superadmin();
  PERFORM prompt_tool.lock_configuration();
  c:=prompt_tool.checked_chain(p_chain_id,p_chain_revision);
  SELECT * INTO s FROM public.prompt_chain_steps WHERE id=p_step_id AND chain_id=p_chain_id FOR UPDATE;
  IF NOT FOUND OR p_step_revision IS NULL OR s.revision<>p_step_revision THEN
    RAISE EXCEPTION 'Step changed or removed; reload' USING ERRCODE='40001'; END IF;
  PERFORM prompt_tool.assert_safe_delete('public.prompt_chain_steps'::regclass);
  DELETE FROM public.prompt_chain_steps WHERE id=p_step_id;
  -- Gaps are allowed by Week 7. Execution snapshots normalize order without
  -- modifying definitions; explicit reorder compacts positions when desired.
  SELECT * INTO c FROM public.prompt_chains WHERE id=p_chain_id;
  RETURN jsonb_build_object('deleted',true,'chain_revision',c.revision);
END $$;
REVOKE ALL ON FUNCTION public.pct_delete_step(uuid,integer,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_delete_step(uuid,integer,uuid,integer) TO authenticated;

CREATE FUNCTION public.pct_delete_chain(p_chain_id uuid,p_chain_revision integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM prompt_tool.require_superadmin();
  PERFORM prompt_tool.lock_configuration();
  PERFORM prompt_tool.checked_chain(p_chain_id,p_chain_revision);
  PERFORM prompt_tool.assert_safe_delete('public.prompt_chains'::regclass);
  IF EXISTS(SELECT 1 FROM public.prompt_chain_steps WHERE chain_id=p_chain_id)
    OR EXISTS(SELECT 1 FROM prompt_tool.chain_runs WHERE chain_id=p_chain_id) THEN
    RAISE EXCEPTION 'Chain has steps or execution history; deletion is blocked' USING ERRCODE='23503'; END IF;
  DELETE FROM public.prompt_chains WHERE id=p_chain_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.pct_delete_chain(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_delete_chain(uuid,integer) TO authenticated;

-- Shared Week 7 tables keep browser SELECT denied; scoped reads also use RPCs.
CREATE FUNCTION public.pct_read_chain(p_chain_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM prompt_tool.require_superadmin();
  PERFORM prompt_tool.lock_configuration();
  SELECT jsonb_build_object('chain',to_jsonb(c),'steps',coalesce((
    SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('input_source',coalesce(o.input_source,'previous_output'),
      'generation_config',coalesce(o.generation_config,'{}'::jsonb)) ORDER BY s.position)
    FROM public.prompt_chain_steps s LEFT JOIN prompt_tool.step_options o ON o.step_id=s.id WHERE s.chain_id=c.id),'[]'::jsonb))
    INTO result FROM public.prompt_chains c WHERE c.id=p_chain_id;
  IF result IS NULL THEN RAISE EXCEPTION 'Chain not found' USING ERRCODE='P0002'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.pct_read_chain(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_read_chain(uuid) TO authenticated;

CREATE FUNCTION public.pct_list_chains(p_after_id uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM prompt_tool.require_superadmin();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid limit' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) INTO result
    FROM (SELECT * FROM public.prompt_chains WHERE p_after_id IS NULL OR id>p_after_id ORDER BY id LIMIT p_limit) c;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.pct_list_chains(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_list_chains(uuid,integer) TO authenticated;
CREATE FUNCTION public.pct_model_catalog(p_after_id uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM prompt_tool.require_superadmin();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid limit' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) INTO result FROM (
    SELECT m.id,m.revision,m.model_key,m.display_name,m.enabled,m.provider_id,
      p.name AS provider_name,p.slug AS provider_key,p.enabled AS provider_enabled,
      (g.provider_id IS NOT NULL) AS gemini_approved
    FROM public.llm_models m JOIN public.llm_providers p ON p.id=m.provider_id
    LEFT JOIN prompt_tool.gemini_providers g ON g.provider_id=p.id
    WHERE p_after_id IS NULL OR m.id>p_after_id ORDER BY m.id LIMIT p_limit) x;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.pct_model_catalog(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_model_catalog(uuid,integer) TO authenticated;

-- Source: week8/003_execution_rpcs.sql
-- PROPOSAL ONLY / NOT APPLIED. Requires 001 + 002. No Gemini/network calls.
-- Runtime writes persist short transactions only; never hold a DB transaction
-- open across a model request. Signed user-session RPCs, not service-role writes.

CREATE FUNCTION public.pct_enqueue_run(p_chain_id uuid,p_chain_revision integer,p_input_text text,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; c public.prompt_chains; r prompt_tool.chain_runs; n integer;
BEGIN
  actor:=prompt_tool.require_superadmin();
  PERFORM prompt_tool.lock_configuration();
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Idempotency key required' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM prompt_tool.chain_runs WHERE requested_by=actor AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF r.chain_id IS DISTINCT FROM p_chain_id OR r.chain_revision IS DISTINCT FROM p_chain_revision OR r.input_text IS DISTINCT FROM p_input_text THEN
      RAISE EXCEPTION 'Idempotency key reused for a different request' USING ERRCODE='40001'; END IF;
    RETURN jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status,'reused',true);
  END IF;
  c:=prompt_tool.checked_chain(p_chain_id,p_chain_revision,false);
  SELECT count(*) INTO n FROM public.prompt_chain_steps WHERE chain_id=p_chain_id;
  IF n NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Execution requires 1 to 100 steps' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public.prompt_chain_steps s JOIN public.llm_models m ON m.id=s.model_id
    JOIN public.llm_providers p ON p.id=m.provider_id LEFT JOIN prompt_tool.gemini_providers g ON g.provider_id=p.id
    WHERE s.chain_id=p_chain_id AND (NOT m.enabled OR NOT p.enabled OR g.provider_id IS NULL)) THEN
    RAISE EXCEPTION 'Execution requires enabled models on approved Gemini providers' USING ERRCODE='23514'; END IF;
  INSERT INTO prompt_tool.chain_runs(chain_id,requested_by,idempotency_key,chain_revision,chain_snapshot,input_text)
    VALUES(c.id,actor,p_idempotency_key,c.revision,to_jsonb(c),p_input_text) RETURNING * INTO r;
  INSERT INTO prompt_tool.run_steps(run_id,chain_id,source_step_id,position,step_snapshot)
    SELECT r.id,c.id,s.id,row_number() OVER(ORDER BY s.position)::integer,
      to_jsonb(s)||jsonb_build_object('input_source',coalesce(o.input_source,'previous_output'),
      'generation_config',coalesce(o.generation_config,'{}'::jsonb),
      'model_key',m.model_key,'model_revision',m.revision,'provider_id',p.id,'provider_key',p.slug,'provider_revision',p.revision)
    FROM public.prompt_chain_steps s JOIN public.llm_models m ON m.id=s.model_id
    JOIN public.llm_providers p ON p.id=m.provider_id LEFT JOIN prompt_tool.step_options o ON o.step_id=s.id
    WHERE s.chain_id=c.id;
  RETURN jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status,'reused',false);
END $$;
REVOKE ALL ON FUNCTION public.pct_enqueue_run(uuid,integer,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_enqueue_run(uuid,integer,text,uuid) TO authenticated;

CREATE FUNCTION public.pct_claim_step(p_run_id uuid,p_run_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; r prompt_tool.chain_runs; s prompt_tool.run_steps; resolved_input text;
BEGIN
  actor:=prompt_tool.require_superadmin();
  PERFORM prompt_tool.lock_configuration();
  SELECT * INTO r FROM prompt_tool.chain_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR p_run_revision IS NULL OR r.revision<>p_run_revision THEN
    RAISE EXCEPTION 'Run changed or removed; reload' USING ERRCODE='40001'; END IF;
  IF r.status NOT IN ('queued','running') OR EXISTS(SELECT 1 FROM prompt_tool.run_steps WHERE run_id=r.id AND status='running') THEN
    RAISE EXCEPTION 'Run is terminal or already has an in-flight step' USING ERRCODE='40001'; END IF;
  SELECT * INTO s FROM prompt_tool.run_steps WHERE run_id=r.id AND status='pending' ORDER BY position LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM prompt_tool.run_steps WHERE run_id=r.id AND position<s.position AND status<>'succeeded') THEN
    RAISE EXCEPTION 'Previous steps must succeed first' USING ERRCODE='23514'; END IF;
  -- Enabled flags are a live kill switch; model and provider identifiers remain
  -- snapshots. Deleted models/providers cannot be used for a new external call.
  IF NOT EXISTS(SELECT 1 FROM public.llm_models m JOIN public.llm_providers p ON p.id=m.provider_id
    JOIN prompt_tool.gemini_providers g ON g.provider_id=p.id
    WHERE m.id=(s.step_snapshot->>'model_id')::uuid AND p.id=(s.step_snapshot->>'provider_id')::uuid AND m.enabled AND p.enabled) THEN
    RAISE EXCEPTION 'Model/provider is no longer executable' USING ERRCODE='23514'; END IF;
  IF s.position=1 OR s.step_snapshot->>'input_source'='chain_input' THEN resolved_input:=r.input_text;
  ELSE SELECT output_text INTO resolved_input FROM prompt_tool.run_steps WHERE run_id=r.id AND position=s.position-1; END IF;
  IF resolved_input IS NULL OR length(btrim(resolved_input))=0 THEN
    RAISE EXCEPTION 'Previous step has no usable text input' USING ERRCODE='23514'; END IF;
  UPDATE prompt_tool.run_steps SET status='running',revision=revision+1,input_text=resolved_input,
    executed_by=actor,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '5 minutes',started_at=clock_timestamp()
    WHERE id=s.id RETURNING * INTO s;
  UPDATE prompt_tool.chain_runs SET status='running',revision=revision+1,started_at=coalesce(started_at,clock_timestamp())
    WHERE id=r.id RETURNING * INTO r;
  RETURN jsonb_build_object('run_revision',r.revision,'step',to_jsonb(s));
END $$;
REVOKE ALL ON FUNCTION public.pct_claim_step(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_claim_step(uuid,integer) TO authenticated;

CREATE FUNCTION public.pct_finish_step(p_run_id uuid,p_step_id uuid,p_step_revision integer,p_lease_token uuid,
  p_status text,p_output_text text,p_error_code text,p_error_message text,p_usage jsonb,p_media jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; r prompt_tool.chain_runs; s prompt_tool.run_steps; item jsonb; usage_item record;
BEGIN
  actor:=prompt_tool.require_superadmin();
  SELECT * INTO r FROM prompt_tool.chain_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR r.status<>'running' THEN RAISE EXCEPTION 'Run is not running' USING ERRCODE='40001'; END IF;
  SELECT * INTO s FROM prompt_tool.run_steps WHERE id=p_step_id AND run_id=r.id FOR UPDATE;
  IF NOT FOUND OR s.status<>'running' OR s.revision IS DISTINCT FROM p_step_revision
    OR p_lease_token IS NULL OR s.lease_token<>p_lease_token OR s.executed_by IS DISTINCT FROM actor
    OR s.lease_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Stale, expired or foreign step lease' USING ERRCODE='40001'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('succeeded','failed') OR p_usage IS NULL OR jsonb_typeof(p_usage)<>'object'
    OR octet_length(p_usage::text)>4096 OR p_media IS NULL OR jsonb_typeof(p_media)<>'array' THEN
    RAISE EXCEPTION 'Invalid completion envelope' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_media)>16 OR octet_length(p_media::text)>16384 THEN
    RAISE EXCEPTION 'Too many media references' USING ERRCODE='22023'; END IF;
  FOR usage_item IN SELECT key,value FROM jsonb_each(p_usage) LOOP
    IF usage_item.key NOT IN ('input_tokens','output_tokens','total_tokens') OR jsonb_typeof(usage_item.value)<>'number'
      OR usage_item.value::text !~ '^(0|[1-9][0-9]{0,9})$' OR usage_item.value::text::numeric>2147483647 THEN
      RAISE EXCEPTION 'Invalid usage metadata' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF p_status='succeeded' THEN
    IF p_error_code IS NOT NULL OR p_error_message IS NOT NULL OR (coalesce(length(btrim(p_output_text)),0)=0 AND jsonb_array_length(p_media)=0) THEN
      RAISE EXCEPTION 'Successful steps require output and no error' USING ERRCODE='22023'; END IF;
    IF coalesce(length(btrim(p_output_text)),0)=0 AND EXISTS(SELECT 1 FROM prompt_tool.run_steps
      WHERE run_id=r.id AND position=s.position+1 AND step_snapshot->>'input_source'='previous_output') THEN
      RAISE EXCEPTION 'Next step requires text; record invalid_output failure instead' USING ERRCODE='23514'; END IF;
  ELSE
    IF p_error_code IS NULL OR p_error_code NOT IN ('provider_error','timeout','invalid_output')
      OR p_output_text IS NOT NULL OR jsonb_array_length(p_media)<>0 THEN
      RAISE EXCEPTION 'Failed steps require an error and no output' USING ERRCODE='22023'; END IF;
  END IF;
  UPDATE prompt_tool.run_steps SET status=p_status,revision=revision+1,output_text=p_output_text,error_code=p_error_code,
    error_message=p_error_message,usage=p_usage,lease_token=NULL,lease_expires_at=NULL,finished_at=clock_timestamp()
    WHERE id=s.id;
  IF p_status='succeeded' THEN
    IF coalesce(length(btrim(p_output_text)),0)>0 THEN
      INSERT INTO prompt_tool.artifacts(chain_id,run_id,run_step_id,kind,text_content) VALUES(r.chain_id,r.id,s.id,'text',p_output_text); END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_media) LOOP
      IF jsonb_typeof(item)<>'object' OR NOT (item ?& ARRAY['kind','bucket_id','object_path','mime_type','byte_size'])
        OR (SELECT count(*) FROM jsonb_object_keys(item))<>5 OR jsonb_typeof(item->'kind')<>'string'
        OR jsonb_typeof(item->'bucket_id')<>'string' OR jsonb_typeof(item->'object_path')<>'string'
        OR jsonb_typeof(item->'mime_type')<>'string' OR jsonb_typeof(item->'byte_size')<>'number'
        OR (item->>'byte_size') !~ '^[1-9][0-9]{0,7}$' OR item->>'kind' NOT IN ('image','audio','video') THEN
        RAISE EXCEPTION 'Invalid media reference' USING ERRCODE='22023'; END IF;
      INSERT INTO prompt_tool.artifacts(chain_id,run_id,run_step_id,kind,bucket_id,object_path,mime_type,byte_size)
        VALUES(r.chain_id,r.id,s.id,item->>'kind',item->>'bucket_id',item->>'object_path',item->>'mime_type',(item->>'byte_size')::bigint);
    END LOOP;
  ELSE
    UPDATE prompt_tool.run_steps SET status='skipped',revision=revision+1,finished_at=clock_timestamp() WHERE run_id=r.id AND status='pending';
  END IF;
  IF p_status='failed' THEN
    UPDATE prompt_tool.chain_runs SET status='failed',revision=revision+1,error_code=p_error_code,error_message=p_error_message,finished_at=clock_timestamp() WHERE id=r.id;
  ELSIF NOT EXISTS(SELECT 1 FROM prompt_tool.run_steps WHERE run_id=r.id AND status<>'succeeded') THEN
    UPDATE prompt_tool.chain_runs SET status='succeeded',revision=revision+1,finished_at=clock_timestamp() WHERE id=r.id;
  ELSE UPDATE prompt_tool.chain_runs SET revision=revision+1 WHERE id=r.id;
  END IF;
  SELECT * INTO r FROM prompt_tool.chain_runs WHERE id=r.id;
  RETURN jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status);
END $$;
REVOKE ALL ON FUNCTION public.pct_finish_step(uuid,uuid,integer,uuid,text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_finish_step(uuid,uuid,integer,uuid,text,text,text,text,jsonb,jsonb) TO authenticated;

CREATE FUNCTION public.pct_stop_run(p_run_id uuid,p_run_revision integer,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r prompt_tool.chain_runs; final_status text;
BEGIN
  PERFORM prompt_tool.require_superadmin();
  SELECT * INTO r FROM prompt_tool.chain_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR r.revision IS DISTINCT FROM p_run_revision OR r.status NOT IN ('queued','running') THEN
    RAISE EXCEPTION 'Run changed or already terminal' USING ERRCODE='40001'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('cancelled','lease_expired') THEN RAISE EXCEPTION 'Invalid stop reason' USING ERRCODE='22023'; END IF;
  IF p_reason='lease_expired' AND NOT EXISTS(SELECT 1 FROM prompt_tool.run_steps WHERE run_id=r.id AND status='running' AND lease_expires_at<=clock_timestamp()) THEN
    RAISE EXCEPTION 'No expired in-flight step' USING ERRCODE='40001'; END IF;
  final_status:=CASE WHEN p_reason='cancelled' THEN 'cancelled' ELSE 'failed' END;
  UPDATE prompt_tool.run_steps SET status=final_status,revision=revision+1,error_code=p_reason,
    lease_token=NULL,lease_expires_at=NULL,finished_at=clock_timestamp() WHERE run_id=r.id AND status='running';
  UPDATE prompt_tool.run_steps SET status=CASE WHEN p_reason='cancelled' THEN 'cancelled' ELSE 'skipped' END,
    revision=revision+1,error_code=CASE WHEN p_reason='cancelled' THEN 'cancelled' ELSE NULL END,
    finished_at=clock_timestamp() WHERE run_id=r.id AND status='pending';
  UPDATE prompt_tool.chain_runs SET status=final_status,revision=revision+1,error_code=p_reason,finished_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
  RETURN jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status);
END $$;
REVOKE ALL ON FUNCTION public.pct_stop_run(uuid,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_stop_run(uuid,integer,text) TO authenticated;

CREATE FUNCTION public.pct_run_history(p_chain_id uuid,p_before_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM prompt_tool.require_superadmin();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_before_at IS NULL)<>(p_before_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid history cursor' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC,r.id DESC),'[]'::jsonb) INTO result FROM (
    SELECT id,chain_id,requested_by,chain_revision,status,revision,created_at,started_at,finished_at,error_code
    FROM prompt_tool.chain_runs WHERE chain_id=p_chain_id
      AND (p_before_at IS NULL OR (created_at,id)<(p_before_at,p_before_id))
    ORDER BY created_at DESC,id DESC LIMIT p_limit) r;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.pct_run_history(uuid,timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_run_history(uuid,timestamptz,uuid,integer) TO authenticated;

CREATE FUNCTION public.pct_read_run(p_run_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM prompt_tool.require_superadmin();
  -- One SQL snapshot. Lease tokens are returned only to the successful claimant.
  SELECT jsonb_build_object('run',to_jsonb(r),'steps',coalesce((
    SELECT jsonb_agg(to_jsonb(s)-'lease_token' ORDER BY s.position) FROM prompt_tool.run_steps s WHERE s.run_id=r.id),'[]'::jsonb),
    'artifacts',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at,a.id) FROM prompt_tool.artifacts a WHERE a.run_id=r.id),'[]'::jsonb))
    INTO result FROM prompt_tool.chain_runs r WHERE r.id=p_run_id;
  IF result IS NULL THEN RAISE EXCEPTION 'Run not found' USING ERRCODE='P0002'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.pct_read_run(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_read_run(uuid) TO authenticated;

CREATE FUNCTION public.pct_link_artifact(p_artifact_id uuid,p_revision integer,p_generation_id uuid,p_response_id uuid,p_image_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a prompt_tool.artifacts;
BEGIN
  PERFORM prompt_tool.require_superadmin();
  SELECT * INTO a FROM prompt_tool.artifacts WHERE id=p_artifact_id FOR UPDATE;
  IF NOT FOUND OR a.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Artifact changed; reload' USING ERRCODE='40001'; END IF;
  IF p_image_id IS NOT NULL AND a.kind<>'image' THEN RAISE EXCEPTION 'Image link requires image artifact' USING ERRCODE='23514'; END IF;
  IF p_response_id IS NOT NULL AND a.kind<>'text' THEN RAISE EXCEPTION 'Response link requires text artifact' USING ERRCODE='23514'; END IF;
  IF p_response_id IS NOT NULL AND p_generation_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.llm_responses WHERE id=p_response_id AND generation_id=p_generation_id) THEN
    RAISE EXCEPTION 'Response belongs to a different generation' USING ERRCODE='23514'; END IF;
  -- Links mean reviewed provenance, not verified equality of content. No source
  -- records or storage bytes are mutated; FK validation rejects missing targets.
  UPDATE prompt_tool.artifacts SET generation_id=p_generation_id,response_id=p_response_id,image_id=p_image_id
    WHERE id=a.id RETURNING * INTO a;
  RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION public.pct_link_artifact(uuid,integer,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_link_artifact(uuid,integer,uuid,uuid,uuid) TO authenticated;

-- Source: week8/004_history_delete.sql
-- PROPOSAL ONLY / NOT APPLIED. Requires 001 + 002 + 003. Run once as postgres.
-- Destructive history operations are deliberately separate from execution setup.

CREATE FUNCTION public.pct_delete_run(p_run_id uuid,p_run_revision integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r prompt_tool.chain_runs;
BEGIN
  PERFORM prompt_tool.require_superadmin();
  SELECT * INTO r FROM prompt_tool.chain_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR p_run_revision IS NULL OR r.revision IS DISTINCT FROM p_run_revision THEN
    RAISE EXCEPTION 'Run changed or removed; reload' USING ERRCODE='40001';
  END IF;
  DELETE FROM prompt_tool.artifacts WHERE run_id=r.id;
  DELETE FROM prompt_tool.run_steps WHERE run_id=r.id;
  DELETE FROM prompt_tool.chain_runs WHERE id=r.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.pct_delete_run(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_delete_run(uuid,integer) TO authenticated;

CREATE FUNCTION public.pct_clear_run_history(p_chain_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE deleted_count integer;
BEGIN
  PERFORM prompt_tool.require_superadmin();
  DELETE FROM prompt_tool.artifacts a
  WHERE p_chain_id IS NULL OR a.chain_id=p_chain_id;
  DELETE FROM prompt_tool.run_steps s
  WHERE p_chain_id IS NULL OR s.chain_id=p_chain_id;
  DELETE FROM prompt_tool.chain_runs r
  WHERE p_chain_id IS NULL OR r.chain_id=p_chain_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END $$;
REVOKE ALL ON FUNCTION public.pct_clear_run_history(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_clear_run_history(uuid) TO authenticated;

-- Source: week8/005_chain_delete_with_history.sql
-- PROPOSAL ONLY / NOT APPLIED. Requires 001 + 002 + 003.
-- Superadmin-only chain deletion for isolated test/runtime use. It removes
-- private Week 8 history before shared Week 7 definitions, preserving catalog,
-- auth, profiles and all unrelated chains.

CREATE FUNCTION public.pct_delete_chain_with_history(
  p_chain_id uuid,
  p_chain_revision integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM prompt_tool.require_superadmin();
  PERFORM prompt_tool.lock_configuration();
  PERFORM prompt_tool.checked_chain(p_chain_id,p_chain_revision);
  PERFORM prompt_tool.assert_safe_delete('public.prompt_chains'::regclass);

  -- Respect the dependency order: artifacts -> run steps -> runs -> steps -> chain.
  DELETE FROM prompt_tool.artifacts WHERE chain_id=p_chain_id;
  DELETE FROM prompt_tool.run_steps WHERE chain_id=p_chain_id;
  DELETE FROM prompt_tool.chain_runs WHERE chain_id=p_chain_id;
  DELETE FROM public.prompt_chain_steps WHERE chain_id=p_chain_id;
  DELETE FROM public.prompt_chains WHERE id=p_chain_id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.pct_delete_chain_with_history(uuid,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pct_delete_chain_with_history(uuid,integer)
  TO authenticated;

DO $$ BEGIN
  IF pg_catalog.pg_database_size(pg_catalog.current_database()) >= 50000000
    THEN RAISE EXCEPTION 'Post-install database exceeds reviewed 50 MB budget'; END IF;
END $$;
COMMIT;
