-- PROPOSAL ONLY / NOT APPLIED. Requires 001 + 002 + 003. Run once as postgres.
-- Destructive history operations are deliberately separate from execution setup.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.pct_delete_run(p_run_id uuid,p_run_revision integer)
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

CREATE OR REPLACE FUNCTION public.pct_clear_run_history(p_chain_id uuid DEFAULT NULL)
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
COMMIT;
