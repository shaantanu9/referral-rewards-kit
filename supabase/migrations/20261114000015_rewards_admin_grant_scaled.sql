-- rewards engine 0.6 (ADR 0002 section 18.9): score-scaled rewards (params.amount_from / amount_max), a manual
-- compensation grant from the admin API (rewards_admin_grant), and rewards.privacy_problems() (rows, never notices).
-- Existing functions are patched from their deployed definitions (pg_get_functiondef + replace, checked), never retyped.

-- 1. Score-scaled rewards ------------------------------------------------------------------------------------------
--
-- A rule with params.amount_from = "<prop>" pays  min(floor(<prop of the triggering event>) * amount, amount_max).
-- `amount` is the multiplier (coins per point). `amount_max` is required: props of client events come from the phone.
-- A missing, non-numeric, zero or negative prop pays nothing (skipped, never clamped up to 1); the grant key is the
-- same as for any rule, so a replayed event still pays once. The triggering event's props reach rewards.queue through
-- the transaction-local setting rewards.event_props, set by rewards.track (and by quiz_answer for quiz tiers:
-- {"program","score","total"}), restored when track returns.

create function rewards.check_rule_scaled() returns trigger
language plpgsql set search_path = '' as $$
declare
  pk text;
  mx numeric;
begin
  if not (new.params ? 'amount_from' or new.params ? 'amount_max') then return new; end if;
  if jsonb_typeof(new.params -> 'amount_from') is distinct from 'string'
     or new.params ->> 'amount_from' !~ '^[A-Za-z_][A-Za-z0-9_]{0,39}$' then
    raise exception 'rewards: params.amount_from must name an event prop (letters, digits, _)' using errcode = '22023';
  end if;
  mx := rewards.to_num(new.params -> 'amount_max');
  if mx is null or mx <= 0 or mx <> trunc(mx) then
    raise exception 'rewards: params.amount_from needs params.amount_max (a whole number above 0)' using errcode = '22023';
  end if;
  if new.kind in ('mystery', 'badge', 'store_offer') or new.params ? 'amount_range' then
    raise exception 'rewards: params.amount_from is not for %, nor with amount_range',
      case when new.params ? 'amount_range' then 'a ranged rule' else new.kind end using errcode = '22023';
  end if;
  select p.kind into pk from rewards.programs p where p.key = new.program_key;
  if pk not in ('streak', 'milestone', 'quest_set', 'comeback', 'friend_streak', 'quiz') then
    raise exception 'rewards: params.amount_from needs a program paid by an event (not %)', pk using errcode = '22023';
  end if;
  return new;
end $$;
create trigger check_rule_scaled before insert on rewards.rules
  for each row execute function rewards.check_rule_scaled();

do $$
declare
  d text;
  n text;
begin
  -- queue: the scaled amount (before the surprise draw, so a skipped grant never uses up a surprise)
  d := pg_get_functiondef('rewards.queue(uuid,rewards.rules,text)'::regprocedure);
  n := replace(d, '  if r.params ? ''chance'' then',
    '  if r.params ? ''amount_from'' then
    declare
      ctx jsonb := nullif(current_setting(''rewards.event_props'', true), '''')::jsonb;
      v numeric;
    begin
      v := floor(rewards.to_num(ctx -> (r.params ->> ''amount_from'')));
      -- never trust the prop: missing, not a number, zero or negative pays nothing
      if v is null or v <= 0 then return null; end if;
      amt := least(v * r.amount, rewards.to_num(r.params -> ''amount_max''));
      prm := prm || jsonb_build_object(''scaled'', jsonb_build_object(''from'', r.params ->> ''amount_from'', ''value'', v));
    end;
  end if;
  if r.params ? ''chance'' then');
  if n = d then raise exception 'rewards: could not patch queue'; end if;
  execute n;

  -- track: the triggering event's props for queue, restored on return (an app hook may track a nested event)
  d := pg_get_functiondef('rewards.track(uuid,text,text,jsonb,text,boolean)'::regprocedure);
  n := replace(d, '  changed jsonb := ''[]'';
begin', '  changed jsonb := ''[]'';
  prev_props text := current_setting(''rewards.event_props'', true);
begin');
  if n = d then raise exception 'rewards: could not patch track (declare)'; end if;
  d := n;
  n := replace(d, '  for p in select * from rewards.programs x
            where (x.kind in', '  perform set_config(''rewards.event_props'', pr::text, true);
  for p in select * from rewards.programs x
            where (x.kind in');
  if n = d then raise exception 'rewards: could not patch track (set)'; end if;
  d := n;
  n := replace(d, '  return jsonb_build_object(''enabled'', true, ''duplicate'', false, ''streaks'', changed,',
    '  perform set_config(''rewards.event_props'', coalesce(prev_props, ''''), true);
  return jsonb_build_object(''enabled'', true, ''duplicate'', false, ''streaks'', changed,');
  if n = d then raise exception 'rewards: could not patch track (restore)'; end if;
  execute n;

  -- quiz_answer: a quiz tier's "event" is the finished attempt
  d := pg_get_functiondef('rewards.quiz_answer(uuid,text,integer,integer)'::regprocedure);
  n := replace(d, '    -- only the best tier reached pays',
    '    perform set_config(''rewards.event_props'',
      jsonb_build_object(''program'', p.key, ''score'', a.score, ''total'', total)::text, true);
    -- only the best tier reached pays');
  if n = d then raise exception 'rewards: could not patch quiz_answer (set)'; end if;
  d := n;
  n := replace(d, '    update rewards.quiz_attempts x set grant_ids = ids where x.id = a.id;',
    '    update rewards.quiz_attempts x set grant_ids = ids where x.id = a.id;
    perform set_config(''rewards.event_props'', '''', true);');
  if n = d then raise exception 'rewards: could not patch quiz_answer (clear)'; end if;
  execute n;
end $$;

-- 2. Manual compensation grant ---------------------------------------------------------------------------------------
--
-- A manual grant has no program rule: rule_id is null (and program_key too unless params.program names one), and its
-- key starts with "admin/", which no program grant key can (program keys are [a-z0-9_]; their keys are
-- "<program>:t…"). It is granted like any other: local kinds through rewards.grant_local (the app hook), worker kinds
-- (entitlement_days, rc_currency) by the Edge Function's /worker. Not counted against daily_grant_cap (an admin
-- decided). params.request_id (optional) makes a resend of the same form a no-op.

alter table rewards.grants alter column program_key drop not null, alter column rule_id drop not null;
alter table rewards.grants add constraint grants_rule_or_manual
  check ((rule_id is not null and program_key is not null) or grant_key like 'admin/%');

create function public.rewards_admin_grant(user_id uuid, kind text, amount int, params jsonb default '{}',
  note text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := rewards_admin_grant.user_id;
  k text := rewards_admin_grant.kind;
  amt int := rewards_admin_grant.amount;
  prm jsonb := coalesce(rewards_admin_grant.params, '{}');
  req text;
  prog text;
  gk text;
  gid uuid;
  dup boolean := false;
begin
  perform rewards.require_admin();
  if uid is null or not exists (select 1 from auth.users u where u.id = uid) then
    raise exception 'rewards: unknown_user' using errcode = '22023';
  end if;
  if coalesce(btrim(note), '') = '' or length(note) > 500 then
    raise exception 'rewards: note_required (why this reward, at most 500 characters)' using errcode = '22023';
  end if;
  if jsonb_typeof(prm) <> 'object' then raise exception 'rewards: bad_params' using errcode = '22023'; end if;
  if amt is null or amt < 1 or amt > 1000000 then
    raise exception 'rewards: bad_amount (a whole number from 1 to 1000000)' using errcode = '22023';
  end if;
  if k is null or k !~ '^[a-z][a-z0-9_]{1,39}$' or k = 'mystery' then
    raise exception 'rewards: bad_kind' using errcode = '22023';
  end if;
  req := prm ->> 'request_id';
  if req is not null and req !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'rewards: bad_params (request_id)' using errcode = '22023';
  end if;
  prm := prm - 'request_id';
  prog := prm ->> 'program';
  if prog is not null and not exists (select 1 from rewards.programs p where p.key = prog) then
    raise exception 'rewards: unknown_program' using errcode = '22023';
  end if;
  -- the same per-kind checks as a rule (rewards.check_rule)
  if k = 'entitlement_days' and coalesce(prm ->> 'entitlement_id', '') = '' then
    raise exception 'rewards: bad_params (entitlement_days needs params.entitlement_id)' using errcode = '22023';
  end if;
  if k = 'badge' and (coalesce(prm ->> 'badge', '') !~ '^[a-z][a-z0-9_]{1,39}$' or prog is null) then
    raise exception 'rewards: bad_params (badge needs params.badge and params.program)' using errcode = '22023';
  end if;
  if k = 'streak_freeze' and not exists (select 1 from rewards.programs p where p.key = prog and p.kind = 'streak') then
    raise exception 'rewards: bad_params (streak_freeze needs params.program, a streak)' using errcode = '22023';
  end if;
  if k = 'rc_currency' and coalesce(prm ->> 'currency_code', '') !~ '^[A-Za-z0-9_]{1,40}$' then
    raise exception 'rewards: bad_params (rc_currency needs params.currency_code)' using errcode = '22023';
  end if;
  if k = 'store_offer' and coalesce(prm ->> 'offer_code', prm ->> 'promotional_offer_id', '') = '' then
    raise exception 'rewards: bad_params (store_offer needs params.offer_code or params.promotional_offer_id)'
      using errcode = '22023';
  end if;
  prm := prm || jsonb_build_object('manual', true);
  gk := 'admin/' || uid::text || '/' || coalesce(req, gen_random_uuid()::text);
  insert into rewards.grants (user_id, program_key, rule_id, grant_key, kind, amount, params, state)
  values (uid, prog, null, gk, k, amt, prm, 'queued')
  on conflict (grant_key) do nothing
  returning id into gid;
  if gid is null then
    dup := true;
    select g.id into gid from rewards.grants g where g.grant_key = gk;
  else
    perform rewards.log('grant', jsonb_build_object('user_id', uid, 'grant_id', gid, 'kind', k, 'amount', amt,
                                                    'params', prm, 'note', btrim(note)));
    if not rewards.is_worker_kind(k) then perform rewards.grant_local(gid); end if;
  end if;
  return (select to_jsonb(g) - 'attempt_token' - 'user_id' from rewards.grants g where g.id = gid)
         || jsonb_build_object('duplicate', dup);
end $$;

-- 3. Privacy problems --------------------------------------------------------------------------------------------------
--
-- Rows (never notices); expected: none. Same idea as referral.privacy_problems(). The rules:
--   nothing in schemas rewards / rewards_app is executable by PUBLIC, anon or authenticated (even while the schema is
--   closed: one `grant usage` away), and neither schema gives them USAGE;
--   no table or view in rewards / rewards_app (or public.rewards_*) is readable or writable by anon or authenticated;
--   every public.rewards_* function is security definer with search_path = '';
--   public.rewards_svc_* only for service_role; no public.rewards_* for anon or PUBLIC; every public.rewards_admin_*
--   checks rewards.require_admin() itself.
create function rewards.privacy_problems() returns table (problem text, role_name text, object_name text)
language sql stable security definer set search_path = '' as $$
  with api(r) as (values ('anon'), ('authenticated')),
  fn as (
    select p.oid, n.nspname, p.proname, p.proacl, p.prosecdef, p.proconfig, p.prosrc,
           n.nspname || '.' || p.proname || '(' ||
             coalesce((select string_agg(pg_catalog.format_type(t, null), ',' order by i)
                       from unnest(p.proargtypes::oid[]) with ordinality as a(t, i)), '') || ')' as sig
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where (n.nspname in ('rewards', 'rewards_app') or (n.nspname = 'public' and p.proname like 'rewards\_%'))
      and p.prokind in ('f', 'p')
  ),
  pub_exec as (
    select f.* from fn f
    where f.proacl is null
       or exists (select 1 from pg_catalog.aclexplode(f.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  )
  select 'schema usage', api.r, s.nspname::text
  from api, pg_catalog.pg_namespace s
  where s.nspname in ('rewards', 'rewards_app') and pg_catalog.has_schema_privilege(api.r, s.oid, 'USAGE')
  union all
  select 'internal function executable', 'PUBLIC', f.sig from pub_exec f where f.nspname in ('rewards', 'rewards_app')
  union all
  select 'internal function executable', api.r, f.sig
  from api, fn f
  where f.nspname in ('rewards', 'rewards_app') and pg_catalog.has_function_privilege(api.r, f.oid, 'EXECUTE')
  union all
  select 'table access', api.r, c.oid::regclass::text
  from api, pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (n.nspname in ('rewards', 'rewards_app') or (n.nspname = 'public' and c.relname like 'rewards\_%'))
    and pg_catalog.has_table_privilege(api.r, c.oid, 'SELECT,INSERT,UPDATE,DELETE')
  union all
  select 'rpc not security definer', null, f.sig from fn f where f.nspname = 'public' and not f.prosecdef
  union all
  select 'rpc without search_path', null, f.sig
  from fn f where f.nspname = 'public' and not coalesce(f.proconfig @> array['search_path=""'], false)
  union all
  select 'rpc executable by PUBLIC', 'PUBLIC', f.sig from pub_exec f where f.nspname = 'public'
  union all
  select 'rpc executable by anon', 'anon', f.sig
  from fn f where f.nspname = 'public' and pg_catalog.has_function_privilege('anon', f.oid, 'EXECUTE')
  union all
  select 'service rpc executable by authenticated', 'authenticated', f.sig
  from fn f
  where f.nspname = 'public' and f.proname like 'rewards\_svc\_%'
    and pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
  union all
  select 'admin rpc without require_admin', null, f.sig
  from fn f
  where f.nspname = 'public' and f.proname like 'rewards\_admin\_%' and f.prosrc not like '%rewards.require_admin()%'
$$;

-- Grants: the same pattern as migration 14 (internal functions closed; admin RPCs for authenticated + service_role).
revoke all on all tables in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards_app from public, anon, authenticated, service_role;
do $$
declare
  f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'rewards\_admin\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
