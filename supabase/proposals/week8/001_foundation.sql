-- PROPOSAL ONLY / NOT APPLIED. Requires reviewed Week 7 01 + 02 and protected profiles flag.
-- Run once as postgres, separately, after 000 metadata comparison. No seed rows.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

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
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.profiles'::regclass
    AND tgname='protect_sage_superadmin_flag' AND tgenabled='O')
    THEN RAISE EXCEPTION 'Reviewed profile promotion protection is required'; END IF;
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
COMMIT;
