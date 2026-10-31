-- PROPOSAL ONLY / NOT APPLIED. Requires 001. Run once as postgres.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

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
COMMIT;
