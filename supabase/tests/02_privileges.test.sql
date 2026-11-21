-- Privileges (ADR 13). Every later migration's RPCs are checked here too, so this file grows with the kit.
-- Rules:
--   anon:          no USAGE on referral / referral_app, no EXECUTE on any kit function or hook, no table access.
--   authenticated: same, except EXECUTE on the public.referral_* user wrappers (none yet in migration 1).
--   service_role:  EXECUTE only on public.referral_svc_* (none yet), nothing in referral / referral_app directly.
\set ON_ERROR_STOP 1
begin;

select tests.ok(not has_schema_privilege(r, s, 'USAGE'), format('%s has no USAGE on %s', r, s))
from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['referral', 'referral_app']) s;

-- No API role may touch any referral table.
select tests.ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'referral' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  'no table grants in referral to API roles or PUBLIC');

-- No API role may execute a referral function.
create temp view kit_functions as
  select p.oid, n.nspname, p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('referral', 'referral_app')
     or (n.nspname = 'public' and p.proname like 'referral\_%');

select tests.ok(
  not exists (
    select 1 from kit_functions f, unnest(array['anon', 'authenticated', 'service_role']) r
    where f.nspname in ('referral', 'referral_app') and has_function_privilege(r, f.oid, 'EXECUTE')),
  'no API role can execute a referral or referral_app function');

select tests.ok(
  not exists (
    select 1 from kit_functions f
    where f.nspname = 'public' and f.proname like 'referral\_svc\_%'
      and (has_function_privilege('anon', f.oid, 'EXECUTE') or has_function_privilege('authenticated', f.oid, 'EXECUTE')
           or not has_function_privilege('service_role', f.oid, 'EXECUTE'))),
  'referral_svc_* wrappers: service_role only');

select tests.ok(
  not exists (
    select 1 from kit_functions f
    where f.nspname = 'public' and f.proname like 'referral\_%' and f.proname not like 'referral\_svc\_%'
      and ((has_function_privilege('anon', f.oid, 'EXECUTE') and f.proname <> 'referral_invite_preview')
           or not has_function_privilege('authenticated', f.oid, 'EXECUTE'))),
  'user wrappers: authenticated, never anon (except the invite preview, migration 23)');

select tests.ok(has_function_privilege('anon', 'public.referral_invite_preview(text)', 'EXECUTE'),
  'the invite page''s preview (migration 23) is callable by anon');

-- Every security definer function in the kit pins search_path.
select tests.ok(
  not exists (
    select 1 from kit_functions f join pg_proc p on p.oid = f.oid
    where p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'], false)),
  'every security definer kit function sets search_path = ''''');

select tests.ok(not exists (select 1 from referral.privacy_problems()), 'privacy_problems() is empty after migrations');

-- An app hook created after the migration WITHOUT a revoke (the forgetful case). Postgres gives PUBLIC EXECUTE on it
-- and per-schema defaults cannot stop that, so the protection that must hold is: no USAGE on the schema.
set local role postgres;
create function referral_app.app_hook_created_later(reward_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language sql security definer set search_path = '' as $$ select $$;
reset role;
select tests.ok(has_function_privilege('authenticated', 'referral_app.app_hook_created_later(uuid,uuid,text,numeric,jsonb)', 'EXECUTE'),
  'control: a hook created later carries PUBLIC EXECUTE (Postgres default)');
select tests.ok(not exists (select 1 from referral.privacy_problems() where problem = 'function reachable'),
  'the forgotten hook is still unreachable: no API role has USAGE on referral_app');
select tests.ok(exists (select 1 from referral.privacy_problems()
                        where problem = 'public execute' and object_name = 'referral_app.app_hook_created_later'),
  'but privacy_problems() reports its PUBLIC EXECUTE (migration 10), so the missing revoke is caught');

-- If someone later grants USAGE, the check reports it.
grant usage on schema referral_app to authenticated;
select tests.ok(exists (select 1 from referral.privacy_problems()
                        where problem = 'function reachable' and role_name = 'authenticated'
                          and object_name = 'referral_app.app_hook_created_later'),
  'privacy_problems() reports a reachable hook once USAGE is granted');
revoke usage on schema referral_app from authenticated;

-- A hook mistakenly created in public IS exposed by Supabase's defaults: this is why the guide forbids it.
set local role postgres;
create function public.app_referral_grant_misplaced() returns void language sql as $$ select $$;
reset role;
select tests.ok(has_function_privilege('authenticated', 'public.app_referral_grant_misplaced()', 'EXECUTE'),
  'control: a function in public is executable by authenticated (Supabase default), so hooks must not live there');

-- And an authenticated session really cannot call the hook.
do $$ begin
  perform tests.act_as('authenticated', gen_random_uuid());
  perform referral_app.app_referral_grant(gen_random_uuid(), gen_random_uuid(), 'minutes', 30, '{}');
  raise exception 'authenticated called the hook';
exception when insufficient_privilege then
  reset role;
  perform tests.ok(true, 'authenticated calling the hook is refused');
end $$;

-- Nor read a table.
do $$ begin
  perform tests.act_as('authenticated', gen_random_uuid());
  perform 1 from referral.rewards;
  raise exception 'authenticated read rewards';
exception when insufficient_privilege then
  reset role;
  perform tests.ok(true, 'authenticated reading referral.rewards is refused');
end $$;

rollback;
