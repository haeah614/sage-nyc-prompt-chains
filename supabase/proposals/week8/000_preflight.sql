-- READ-ONLY REVIEW SCRIPT. Prepared only; not executed by tests or application.
-- Run against an approved isolated clone before considering 001–003.
select version(), current_database(), current_user;
select table_schema,table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns
where (table_schema='public' and table_name in (
  'profiles','prompt_chains','prompt_chain_steps','llm_models','llm_providers',
  'generations','llm_responses','images')) or table_schema='prompt_tool'
order by table_schema,table_name,ordinal_position;
select c.conrelid::regclass as source,c.confrelid::regclass as target,
  c.conname,c.contype,c.confdeltype,pg_get_constraintdef(c.oid) as definition
from pg_catalog.pg_constraint c
where c.conrelid in (to_regclass('public.prompt_chains'),to_regclass('public.prompt_chain_steps'),
 to_regclass('public.llm_models'),to_regclass('public.llm_providers'))
 or c.confrelid in (to_regclass('public.prompt_chains'),to_regclass('public.prompt_chain_steps'));
select t.tgrelid::regclass,t.tgname,pg_get_triggerdef(t.oid)
from pg_catalog.pg_trigger t where not t.tgisinternal and t.tgrelid in (
 to_regclass('public.profiles'),to_regclass('public.prompt_chains'),to_regclass('public.prompt_chain_steps'),
 to_regclass('public.llm_models'),to_regclass('public.llm_providers'));
select p.oid::regprocedure,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) as owner,
 p.proacl,pg_get_functiondef(p.oid)
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and (p.proname in ('week7_stamp_row','week7_lock_configuration',
 'week7_check_configuration','admin_update_prompt_chain_mix','protect_sage_superadmin_flag')
 or p.proname like 'pct_%');
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname in ('public','prompt_tool');
select grantee,table_schema,table_name,privilege_type from information_schema.table_privileges
where table_schema='prompt_tool' or (table_schema='public' and table_name in (
 'profiles','prompt_chains','prompt_chain_steps','llm_models','llm_providers'));
select grantee,table_name,column_name,privilege_type from information_schema.column_privileges
where table_schema='public' and table_name='profiles';
-- Required authorization evidence: this does not mutate anything. A false value
-- or an unexpected broad grant means ordinary users may be able to self-promote.
select
  has_table_privilege('authenticated','public.profiles','INSERT') as authenticated_can_insert_profile,
  has_table_privilege('authenticated','public.profiles','UPDATE') as authenticated_can_update_profile,
  has_column_privilege('authenticated','public.profiles','is_superadmin','INSERT') as authenticated_can_insert_flag,
  has_column_privilege('authenticated','public.profiles','is_superadmin','UPDATE') as authenticated_can_update_flag,
  has_table_privilege('anon','public.profiles','INSERT') as anon_can_insert_profile,
  has_table_privilege('anon','public.profiles','UPDATE') as anon_can_update_profile;
select policyname,roles,cmd,qual,with_check
from pg_policies
where schemaname='public' and tablename='profiles'
order by policyname;
-- A protected trigger must be enabled and its body must reject flag changes for
-- non-DBA roles. Review pg_get_functiondef output above; catalog existence alone
-- does not establish behavior.
select defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl from pg_default_acl;
-- Aggregate diagnostics only: no prompts, profile records, credentials or outputs.
select count(*) as total_chains from public.prompt_chains;
select max(position) as largest_position, max(revision) as largest_step_revision from public.prompt_chain_steps;
select count(*) as invalid_active_chains from public.prompt_chains c where c.mix_weight>0 and (
 not exists(select 1 from public.prompt_chain_steps s where s.chain_id=c.id)
 or exists(select 1 from public.prompt_chain_steps s join public.llm_models m on m.id=s.model_id
 join public.llm_providers p on p.id=m.provider_id where s.chain_id=c.id and (not m.enabled or not p.enabled)));
-- Review role memberships/custom privileged functions separately. Metadata comparison
-- is mandatory: object existence alone does not establish that definitions match.
