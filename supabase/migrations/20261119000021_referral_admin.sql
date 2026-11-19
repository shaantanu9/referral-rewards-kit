-- referral-kit migration 21: admin read and support functions for the admin page's Referrals section.
--
-- Who is an admin: `referral_app.app_referral_is_admin(user_id)`. The default reads `rewards.admins` when the rewards
-- kit is installed (the same list the admin page already uses) and says no otherwise; an app without the rewards kit
-- replaces the hook. The service role is always allowed (SQL editor, scripts). Every public.referral_admin_* function
-- calls referral.require_admin() first; privacy_problems() reports one that does not.
--
-- What an admin sees: every referral with both people (id and email from auth.users), its state and dates, every
-- reward with its state, attempts and last error, a user's codes, invites and stats, totals, a daily chart, the top
-- sharers and the worker's state. Admin actions (retry a reward, re-check activation) are written to
-- referral.admin_log.

-- Hook: is this user an admin? ---------------------------------------------------------------------------------------
create function referral_app.app_referral_is_admin(user_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  yes boolean;
begin
  if to_regclass('rewards.admins') is null then
    return false;
  end if;
  execute 'select exists (select 1 from rewards.admins a where a.user_id = $1)' into yes using user_id;
  return coalesce(yes, false);
end $$;

create function referral.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return null; end if;
  if auth.uid() is null or not referral_app.app_referral_is_admin(auth.uid()) then
    raise exception 'referral: not_admin' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create table referral.admin_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  admin_id uuid,
  action text not null,
  details jsonb not null default '{}'
);

create function referral.admin_log_add(action text, details jsonb) returns void
language sql volatile security definer set search_path = '' as $$
  insert into referral.admin_log (admin_id, action, details) values (auth.uid(), action, coalesce(details, '{}'))
$$;

-- Row builders -------------------------------------------------------------------------------------------------------
create function referral.admin_person(uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when uid is null then null else jsonb_build_object(
    'id', uid,
    'email', (select u.email from auth.users u where u.id = uid),
    'deleted', exists (select 1 from referral.members m where m.user_id = uid and m.deleted_at is not null))
  end
$$;

create function referral.admin_reward_row(w referral.rewards) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', w.id, 'referral_id', w.referral_id, 'user', referral.admin_person(w.user_id),
    'who', w.who, 'event', w.event, 'kind', w.kind, 'amount', w.amount, 'params', w.params, 'state', w.state,
    'attempts', w.attempts, 'last_error', w.last_error, 'available_at', w.available_at, 'created_at', w.created_at,
    'updated_at', w.updated_at)
$$;

create function referral.admin_referral_row(r referral.referrals) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'code', r.code, 'state', r.state, 'rule_set_version', r.rule_set_version,
    'claimed_at', r.claimed_at, 'joined_at', r.joined_at, 'paid_at', r.paid_at,
    'activate_by', case when r.state = 'claimed'
                        then r.claimed_at + make_interval(days => (select s.activate_window_days from referral.settings s where s.id)) end,
    'cancel_cause', r.paid_cancel_cause, 'friend_deleted_at', r.friend_deleted_at,
    'sharer', referral.admin_person(r.sharer_id), 'friend', referral.admin_person(r.friend_id),
    'rewards', coalesce((select jsonb_agg(referral.admin_reward_row(w) order by w.created_at)
                         from referral.rewards w where w.referral_id = r.id), '[]'))
$$;

-- Overview -----------------------------------------------------------------------------------------------------------
create function public.referral_admin_overview(days int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d int := least(greatest(coalesce(days, 30), 1), 365);
  since timestamptz := date_trunc('day', now()) - make_interval(days => least(greatest(coalesce(days, 30), 1), 365) - 1);
begin
  perform referral.require_admin();
  return jsonb_build_object(
    'days', d,
    'settings', (select to_jsonb(s) - 'id' - 'pepper_version' - 'pepper_versions_active' from referral.settings s where s.id),
    'rule_set', referral.current_rule_set(),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'version', r.version, 'event', r.event,
                         'who', r.who, 'kind', r.kind, 'amount', r.amount, 'params', r.params, 'active', r.active)
                         order by r.version desc, r.event, r.who)
                       from referral.rules r), '[]'),
    'referrals_by_state', coalesce((select jsonb_object_agg(x.state, x.n)
                                    from (select r.state, count(*) n from referral.referrals r group by r.state) x), '{}'),
    'rewards_by_state', coalesce((select jsonb_object_agg(x.state, x.n)
                                  from (select w.state, count(*) n from referral.rewards w group by w.state) x), '{}'),
    'totals', jsonb_build_object(
      'codes', (select count(*) from referral.codes c where c.disabled_at is null),
      'sharers', (select count(distinct r.sharer_id) from referral.referrals r),
      'referrals', (select count(*) from referral.referrals),
      'claimed_in_window', (select count(*) from referral.referrals r where r.claimed_at >= since),
      'joined_in_window', (select count(*) from referral.referrals r where r.joined_at >= since),
      'paid_in_window', (select count(*) from referral.referrals r where r.paid_at >= since),
      'problem_rewards', (select count(*) from referral.rewards w where w.state in ('failed', 'failed_retryable')),
      'in_review', (select count(*) from referral.members m where m.review_since is not null and m.deleted_at is null)),
    'daily', (select jsonb_agg(jsonb_build_object('day', g.day::date,
                'claimed', (select count(*) from referral.referrals r
                             where r.claimed_at >= g.day and r.claimed_at < g.day + interval '1 day'),
                'joined', (select count(*) from referral.referrals r
                            where r.joined_at >= g.day and r.joined_at < g.day + interval '1 day')) order by g.day)
              from generate_series(since, date_trunc('day', now()), interval '1 day') as g(day)),
    'top_sharers', coalesce((select jsonb_agg(t order by t.total desc, t.joined desc) from (
        select referral.admin_person(r.sharer_id) as sharer,
               (select c.code from referral.codes c where c.user_id = r.sharer_id and c.disabled_at is null) as code,
               count(*) as total,
               count(*) filter (where r.state = 'claimed') as waiting,
               count(*) filter (where r.joined_at is not null) as joined,
               count(*) filter (where r.paid_at is not null) as paid
          from referral.referrals r where r.sharer_id is not null
         group by r.sharer_id order by count(*) desc, count(*) filter (where r.joined_at is not null) desc limit 10) t), '[]'),
    'worker', jsonb_build_object(
      'last_banked_check_at', (select w.last_banked_check_at from referral.worker_state w where w.id),
      'events_by_state', coalesce((select jsonb_object_agg(x.state, x.n)
                                   from (select e.state, count(*) n from referral.events e group by e.state) x), '{}')),
    'privacy_problems', (select count(*) from referral.privacy_problems()));
end $$;

-- Referral list, newest first, with both people and their rewards. Next page: pass the returned `next_before` and
-- `next_before_id` (the last row's claimed_at and id, so rows with the same time are not skipped).
create function public.referral_admin_referrals(state text default null, search text default null,
  max_rows int default 100, before timestamptz default null, before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  q text := nullif(btrim(coalesce(search, '')), '');
  n int := least(greatest(coalesce(max_rows, 100), 1), 500);
  rows jsonb;
begin
  perform referral.require_admin();
  select coalesce(jsonb_agg(referral.admin_referral_row(r) order by r.claimed_at desc, r.id desc), '[]') into rows
  from (
    select r.* from referral.referrals r
     where (referral_admin_referrals.state is null or r.state = referral_admin_referrals.state)
       and (before is null or (r.claimed_at, r.id) < (before, coalesce(before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
       and (q is null
            or r.code = upper(replace(q, '-', ''))
            or exists (select 1 from auth.users u where u.id in (r.sharer_id, r.friend_id) and u.email ilike '%' || q || '%')
            or r.sharer_id::text = q or r.friend_id::text = q)
     order by r.claimed_at desc, r.id desc limit n) r;
  return jsonb_build_object('rows', rows,
    'next_before', case when jsonb_array_length(rows) = n then rows -> (n - 1) ->> 'claimed_at' end,
    'next_before_id', case when jsonb_array_length(rows) = n then rows -> (n - 1) ->> 'id' end);
end $$;

-- One user: by id, email or invite code.
create function public.referral_admin_user(query text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  q text := btrim(coalesce(query, ''));
  uid uuid;
begin
  perform referral.require_admin();
  if q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    uid := q::uuid;
  elsif position('@' in q) > 0 then
    select u.id into uid from auth.users u where lower(u.email) = lower(q) limit 1;
  else
    select c.user_id into uid from referral.codes c where c.code = referral.normalise_code(q)
     order by c.disabled_at nulls first limit 1;
  end if;
  if uid is null then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'user', referral.admin_person(uid) || jsonb_build_object(
      'created_at', (select u.created_at from auth.users u where u.id = uid),
      'verified_at', referral.verified_since(uid),
      'eligible_from', (select m.eligible_from from referral.members m where m.user_id = uid),
      'review_since', (select m.review_since from referral.members m where m.user_id = uid),
      'installs', (select count(*) from referral.installs i where i.user_id = uid)),
    'codes', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'created_at', c.created_at,
                         'disabled_at', c.disabled_at) order by c.created_at desc)
                       from referral.codes c where c.user_id = uid), '[]'),
    'invited', coalesce((select jsonb_agg(referral.admin_referral_row(r) order by r.claimed_at desc)
                         from referral.referrals r where r.sharer_id = uid), '[]'),
    'invited_by', (select referral.admin_referral_row(r) from referral.referrals r where r.friend_id = uid),
    'rewards', coalesce((select jsonb_agg(referral.admin_reward_row(w) order by w.created_at desc)
                         from referral.rewards w where w.user_id = uid), '[]'),
    'abuse_marks', coalesce((select jsonb_agg(jsonb_build_object('cause', a.cause, 'points', a.points,
                               'created_at', a.created_at) order by a.created_at desc)
                             from referral.abuse_marks a where a.user_id = uid), '[]'),
    'stats', referral.stats(uid));
end $$;

-- Rewards that need a look: failed, retrying, or due for over an hour and still not granted.
create function public.referral_admin_rewards(state text default null, max_rows int default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform referral.require_admin();
  return coalesce((select jsonb_agg(referral.admin_reward_row(w) || jsonb_build_object('code', r.code)
                                    order by w.updated_at desc)
    from (select * from referral.rewards x
           where case when referral_admin_rewards.state is not null then x.state = referral_admin_rewards.state
                      else x.state in ('failed', 'failed_retryable')
                        or (x.state in ('queued', 'granting') and x.available_at < now() - interval '1 hour') end
           order by x.updated_at desc limit least(greatest(coalesce(max_rows, 100), 1), 500)) w
    join referral.referrals r on r.id = w.referral_id), '[]');
end $$;

-- Retry a failed reward now. App kinds are granted at once through the app hook; entitlement_days go to the worker.
create function public.referral_admin_retry_reward(reward_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  w referral.rewards;
  result text;
begin
  perform referral.require_admin();
  select * into w from referral.rewards x where x.id = reward_id for update;
  if w.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if w.state not in ('failed', 'failed_retryable') then
    return jsonb_build_object('ok', false, 'reason', 'not_failed', 'state', w.state);
  end if;
  update referral.rewards set state = 'queued', attempts = 0, available_at = now(), updated_at = now()
   where id = w.id;
  perform referral.admin_log_add('retry_reward', jsonb_build_object('reward_id', w.id, 'was', w.state,
                                                                    'last_error', w.last_error));
  if w.kind <> 'entitlement_days' then
    result := referral.grant_local(w.id);
  else
    result := 'queued_for_worker';
  end if;
  return jsonb_build_object('ok', true, 'result', result,
    'reward', (select referral.admin_reward_row(x) from referral.rewards x where x.id = w.id));
end $$;

-- Ask the app's activation hook again for one friend (e.g. after fixing the hook).
create function public.referral_admin_check_activation(friend_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  st text;
begin
  perform referral.require_admin();
  st := referral.check_activation(friend_id);
  perform referral.admin_log_add('check_activation', jsonb_build_object('friend_id', friend_id, 'state', st));
  return jsonb_build_object('state', st);
end $$;

create function public.referral_admin_log(max_rows int default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform referral.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'admin', referral.admin_person(l.admin_id),
                     'action', l.action, 'details', l.details) order by l.id desc)
                   from (select * from referral.admin_log order by id desc
                          limit least(greatest(coalesce(max_rows, 100), 1), 500)) l), '[]');
end $$;

-- Grants: admin functions to signed-in users (each checks the admin itself) and the service role; never anon.
revoke all on function public.referral_admin_overview(int), public.referral_admin_referrals(text, text, int, timestamptz, uuid),
  public.referral_admin_user(text), public.referral_admin_rewards(text, int), public.referral_admin_retry_reward(uuid),
  public.referral_admin_check_activation(uuid), public.referral_admin_log(int) from public, anon;
grant execute on function public.referral_admin_overview(int), public.referral_admin_referrals(text, text, int, timestamptz, uuid),
  public.referral_admin_user(text), public.referral_admin_rewards(text, int), public.referral_admin_retry_reward(uuid),
  public.referral_admin_check_activation(uuid), public.referral_admin_log(int) to authenticated, service_role;

-- privacy_problems(): admin functions are expected client functions, but only when they check the admin. Same body as
-- migration 10 with that one exception and one new problem.
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
  where f.nspname = 'public' and f.proname not like 'referral\_svc\_%' and f.proname not like 'referral\_admin\_%'
    and f.sig not in (select sig from client_rpcs)
    and pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
  union all
  select 'admin function without check', 'authenticated', f.name
  from kit_fn f join pg_catalog.pg_proc p on p.oid = f.oid
  where f.nspname = 'public' and f.proname like 'referral\_admin\_%'
    and pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
    and position('referral.require_admin()' in p.prosrc) = 0
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

revoke all on table referral.admin_log from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral_app from public, anon, authenticated, service_role;
