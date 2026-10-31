-- PROPOSAL ONLY / NOT APPLIED. Requires 001 + 002 + 003.
-- Superadmin-only chain deletion for isolated test/runtime use. It removes
-- private Week 8 history before shared Week 7 definitions, preserving catalog,
-- auth, profiles and all unrelated chains.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.pct_delete_chain_with_history(
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
COMMIT;
