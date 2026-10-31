-- PROPOSAL ONLY / NOT APPLIED. Requires 001 + 002. No Gemini/network calls.
-- Runtime writes persist short transactions only; never hold a DB transaction
-- open across a model request. Signed user-session RPCs, not service-role writes.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

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
COMMIT;
