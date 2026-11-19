-- Probe: which functions can the API roles call? Run it on a project before and after applying the kit, and after
-- every migration of the app's own (Supabase SQL editor or psql). Read-only: it creates only a TEMPORARY view, which
-- disappears when the session ends, and changes nothing else.
--
-- Postgres grants EXECUTE on every new function to PUBLIC, and Supabase grants new functions in `public` to anon,
-- authenticated and service_role. So every helper an app or the kit creates is callable through PostgREST
-- (`POST /rest/v1/rpc/<name>`) until someone revokes it. Expected result:
--   verdict = 'expected'            the eight referral client RPCs, for authenticated only
--   verdict = 'expected_admin'      a referral admin RPC (public.referral_admin_*) for authenticated: security definer
--                                   with search_path = '' whose body calls referral.require_admin()
--   verdict = 'expected_rewards'    a rewards RPC (public.rewards_*, not rewards_svc_*) for authenticated: security
--                                   definer with search_path = '' (each checks auth.uid() / rewards.require_admin())
--   verdict = 'kit_exposed'         a referral-kit or rewards function an API role can call that it must not: FIX NOW
--                                   (revoke execute on function <sig> from public, anon, authenticated;)
--   verdict = 'app_definer_exposed' an app function that runs as its owner (security definer) and anon or
--                                   authenticated can call: check it checks auth.uid() itself, or revoke it
--   verdict = 'app_callable'        an app function anon or authenticated can call (security invoker: runs with the
--                                   caller's rights and RLS); fine when the app calls it, otherwise revoke it
-- The list shows every row except the expected ones; `select * from referral_function_grants` shows them all.
-- The rewards engine has its own check with the same rules and more: `select * from rewards.privacy_problems();`
-- (expected: no rows).

create or replace temp view referral_function_grants as
with api(role_name) as (values ('anon'), ('authenticated')),
client_rpcs(sig) as (values
  ('public.referral_my_code(text)'), ('public.referral_rotate_code(text)'), ('public.referral_claim(text,text)'),
  ('public.referral_terms(text)'), ('public.referral_check_activation(text)'), ('public.referral_stats(text)'),
  ('public.referral_pending(text)'), ('public.referral_ack(uuid[],text)')),
fn as (
  select p.oid, n.oid as nsoid, n.nspname, p.proname, p.prosecdef, p.proacl,
         n.nspname || '.' || p.proname || '(' ||
           coalesce((select string_agg(pg_catalog.format_type(t, null), ',' order by i)
                     from unnest(p.proargtypes::oid[]) with ordinality as a(t, i)), '') || ')' as sig,
         (n.nspname in ('referral', 'referral_app', 'rewards', 'rewards_app')
          or (n.nspname = 'public' and (p.proname like 'referral\_%' or p.proname like 'rewards\_%'))) as kit,
         p.proconfig, p.prosrc
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'referral', 'referral_app', 'rewards', 'rewards_app')
    and p.prokind in ('f', 'p')
    -- functions that belong to an extension (pgcrypto, pg_net, …) are the extension's business
    and not exists (select 1 from pg_catalog.pg_depend d
                    where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
),
callable as (
  select f.*, api.role_name
  from fn f, api
  where pg_catalog.has_schema_privilege(api.role_name, f.nsoid, 'USAGE')
    and pg_catalog.has_function_privilege(api.role_name, f.oid, 'EXECUTE')
  union all
  -- PUBLIC execute on a kit function is a problem even where the schema is closed today (one grant away).
  select f.*, 'PUBLIC'
  from fn f
  where f.kit and (f.proacl is null
     or exists (select 1 from pg_catalog.aclexplode(f.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
)
select c.sig as function_signature,
       c.role_name,
       c.prosecdef as security_definer,
       case
         when c.kit and c.role_name = 'authenticated' and c.sig in (select sig from client_rpcs) then 'expected'
         when c.kit and c.role_name = 'authenticated' and c.nspname = 'public' and c.proname like 'referral\_admin\_%'
              and c.prosecdef and coalesce(c.proconfig @> array['search_path=""'], false)
              and position('referral.require_admin()' in c.prosrc) > 0 then 'expected_admin'
         when c.kit and c.role_name = 'authenticated' and c.nspname = 'public' and c.proname like 'rewards\_%'
              and c.proname not like 'rewards\_svc\_%' and c.prosecdef
              and coalesce(c.proconfig @> array['search_path=""'], false) then 'expected_rewards'
         when c.kit then 'kit_exposed'
         when c.prosecdef then 'app_definer_exposed'
         else 'app_callable'
       end as verdict
from callable c;

select * from referral_function_grants
where verdict not in ('expected', 'expected_admin', 'expected_rewards')
order by case verdict when 'kit_exposed' then 0 when 'app_definer_exposed' then 1 else 2 end, function_signature, role_name;
