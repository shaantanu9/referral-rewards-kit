-- Migration 10 and supabase/probes/function_grants.sql: every helper is revoked from PUBLIC / anon / authenticated,
-- and the only functions an API role can call are the eight client RPCs (authenticated) and referral_svc_*
-- (service_role). Each case below breaks one rule and checks it is reported.
\set ON_ERROR_STOP 1
begin;

select tests.ok(not exists (select 1 from referral.privacy_problems()), 'privacy_problems() is empty after all migrations');

-- No kit function keeps the default PUBLIC EXECUTE (a null ACL is that default).
select tests.ok(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname in ('referral', 'referral_app') or (n.nspname = 'public' and p.proname like 'referral\_%'))
      and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))),
  'no kit function grants anything to PUBLIC');

select tests.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname like 'referral\_%' and p.proname not like 'referral\_svc\_%'
                   and p.proname not like 'referral\_admin\_%'
                   and has_function_privilege('authenticated', p.oid, 'EXECUTE')) = 8,
  'exactly eight client RPCs are callable by authenticated (admin functions aside, migration 21)');

-- The probe file, as an owner would run it on a live project.
\ir ../probes/function_grants.sql
select tests.ok((select count(*) from referral_function_grants where verdict = 'expected') = 8,
  'probe: the eight client RPCs are the only expected rows');
select tests.ok((select count(*) from referral_function_grants where verdict = 'expected_admin') = 7,
  'probe: the seven admin RPCs (migration 21) are expected, each checking the admin');
select tests.ok(not exists (select 1 from referral_function_grants where verdict = 'kit_exposed'),
  'probe: no kit function is exposed after the migrations');
select tests.ok(not exists (select 1 from referral_function_grants where role_name = 'anon'),
  'probe: anon can call nothing');

-- 1. A helper in public created without a revoke (Supabase's defaults grant it to anon and authenticated).
set local role postgres;
create function public.referral_helper_oops() returns int language sql security definer set search_path = '' as $$ select 1 $$;
reset role;
select tests.ok(exists (select 1 from referral.privacy_problems() where problem = 'anon execute' and object_name = 'public.referral_helper_oops'),
  'a public helper callable by anon is reported');
select tests.ok(exists (select 1 from referral.privacy_problems() where problem = 'unexpected client function'
                          and object_name = 'public.referral_helper_oops()'),
  'a public helper callable by authenticated that is not a client RPC is reported');
select tests.ok(exists (select 1 from referral.privacy_problems() where problem = 'public execute' and object_name = 'public.referral_helper_oops'),
  'its PUBLIC EXECUTE is reported');
select tests.ok(exists (select 1 from referral_function_grants where function_signature = 'public.referral_helper_oops()' and verdict = 'kit_exposed'),
  'probe: the helper shows as kit_exposed');
revoke execute on function public.referral_helper_oops() from public, anon, authenticated, service_role;
select tests.ok(not exists (select 1 from referral.privacy_problems()), 'after the revoke nothing is reported');

-- 2. A client RPC that lost its grant.
revoke execute on function public.referral_terms(text) from authenticated;
select tests.ok(exists (select 1 from referral.privacy_problems() where problem = 'client function not granted'
                          and object_name = 'public.referral_terms(text)'),
  'a client RPC authenticated cannot call is reported');
grant execute on function public.referral_terms(text) to authenticated;

-- 3. A service function granted to signed-in users.
grant execute on function public.referral_svc_sweep() to authenticated;
select tests.ok(exists (select 1 from referral.privacy_problems() where problem = 'service function exposed'
                          and object_name = 'public.referral_svc_sweep'),
  'a referral_svc_* function callable by authenticated is reported');
revoke execute on function public.referral_svc_sweep() from authenticated;

-- 4. An app function (not the kit's) in public: the probe lists it for review, privacy_problems() leaves it alone.
set local role postgres;
create function public.app_add_credits(n int) returns void language sql security definer set search_path = '' as $$ select $$;
create function public.app_public_list() returns int language sql stable as $$ select 1 $$;
reset role;
select tests.ok(exists (select 1 from referral_function_grants where function_signature = 'public.app_add_credits(integer)'
                          and verdict = 'app_definer_exposed' and role_name = 'anon'),
  'probe: an app security definer function callable by anon is flagged for review');
select tests.ok(exists (select 1 from referral_function_grants where function_signature = 'public.app_public_list()'
                          and verdict = 'app_callable'),
  'probe: an app invoker function shows as app_callable');
select tests.ok(not exists (select 1 from referral.privacy_problems()), 'privacy_problems() covers only kit functions');

rollback;
