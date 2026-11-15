-- referral-kit migration 10: privacy_problems() also reports EXECUTE left to PUBLIC, and any public.referral_*
-- function an API role can call that it should not (ADR 13; lesson from the first app, 2026-11-13).
--
-- Why: Postgres grants EXECUTE on every new function to PUBLIC, and Supabase adds anon / authenticated / service_role
-- for functions in `public`. A helper created by `create function` without a revoke is therefore callable by every
-- role that can reach its schema. The kit's schemas give no API role USAGE, so the old check found nothing while a
-- forgotten hook still carried PUBLIC EXECUTE: one later `grant usage` away from exposed. Now it is reported.
--
-- The only functions an API role may call:
--   authenticated: the eight client RPCs below (what the Flutter package calls), never anon;
--   service_role:  public.referral_svc_* (the Edge Function), never anon or authenticated.
-- Everything else in `referral`, `referral_app` and `public.referral_*` must have EXECUTE revoked from PUBLIC.
--
-- Same signature as before (create or replace), so referral.sweep() and the worker's alert keep working.

create or replace function referral.privacy_problems() returns table (problem text, role_name text, object_name text)
language sql stable security definer set search_path = '' as $$
  with api(r) as (values ('anon'), ('authenticated'), ('service_role')),
  client_rpcs(sig) as (values
    ('public.referral_my_code(text)'), ('public.referral_rotate_code(text)'), ('public.referral_claim(text,text)'),
    ('public.referral_terms(text)'), ('public.referral_check_activation(text)'), ('public.referral_stats(text)'),
    ('public.referral_pending(text)'), ('public.referral_ack(uuid[],text)')),
  kit_fn as (
    select p.oid, n.oid as nsoid, n.nspname, p.proname, p.proacl,
           n.nspname || '.' || p.proname as name,
           n.nspname || '.' || p.proname || '(' ||
             coalesce((select string_agg(pg_catalog.format_type(t, null), ',' order by i)
                       from unnest(p.proargtypes::oid[]) with ordinality as a(t, i)), '') || ')' as sig
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('referral', 'referral_app') or (n.nspname = 'public' and p.proname like 'referral\_%')
  )
  select 'schema usage', api.r, s.nspname::text
  from api, pg_catalog.pg_namespace s
  where s.nspname in ('referral', 'referral_app') and pg_catalog.has_schema_privilege(api.r, s.oid, 'USAGE')
  union all
  select 'table access', api.r, t.schemaname || '.' || t.tablename
  from api, pg_catalog.pg_tables t
  where t.schemaname = 'referral'
    and pg_catalog.has_table_privilege(api.r, (t.schemaname || '.' || t.tablename)::regclass,
                                       'SELECT,INSERT,UPDATE,DELETE')
  union all
  select 'function reachable', api.r, f.name
  from api, kit_fn f
  where f.nspname in ('referral', 'referral_app')
    and pg_catalog.has_schema_privilege(api.r, f.nsoid, 'USAGE')
    and pg_catalog.has_function_privilege(api.r, f.oid, 'EXECUTE')
  union all
  -- A null ACL means the default: EXECUTE for PUBLIC.
  select 'public execute', 'PUBLIC', f.name
  from kit_fn f
  where f.proacl is null
     or exists (select 1 from pg_catalog.aclexplode(f.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  union all
  select 'anon execute', 'anon', f.name
  from kit_fn f
  where f.nspname = 'public' and pg_catalog.has_function_privilege('anon', f.oid, 'EXECUTE')
  union all
  select 'unexpected client function', 'authenticated', f.sig
  from kit_fn f
  where f.nspname = 'public' and f.proname not like 'referral\_svc\_%'
    and f.sig not in (select sig from client_rpcs)
    and pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
  union all
  select 'client function not granted', 'authenticated', c.sig
  from client_rpcs c join kit_fn f on f.sig = c.sig
  where not pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
  union all
  select 'service function exposed', 'authenticated', f.name
  from kit_fn f
  where f.nspname = 'public' and f.proname like 'referral\_svc\_%'
    and pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
  union all
  select 'definer without search_path', null, f.name
  from kit_fn f join pg_catalog.pg_proc p on p.oid = f.oid
  where p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'], false)
$$;

revoke execute on function referral.privacy_problems() from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral_app from public, anon, authenticated, service_role;
