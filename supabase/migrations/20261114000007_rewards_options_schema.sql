-- rewards engine 0.2, migration 1 of 4: new program kinds and options in the schema, their checks, the event filter,
-- and grant-time options (audience, mystery, store offers) (ADR 0002 section 18).

alter table rewards.settings add column ads_enabled boolean not null default false,
  add column rc_allow_sandbox boolean not null default false;

-- Kinds the Edge Function worker grants through RevenueCat (never in the database transaction).
create function rewards.is_worker_kind(k text) returns boolean
language sql immutable set search_path = '' as $$ select k in ('entitlement_days', 'rc_currency') $$;

alter table rewards.programs drop constraint programs_kind_check;
alter table rewards.programs add constraint programs_kind_check
  check (kind in ('streak', 'milestone', 'social_tag', 'offer', 'quiz', 'quest_set', 'comeback', 'recharge', 'window',
                  'friend_streak'));

alter table rewards.streaks
  add column free_freeze_weeks text[] not null default '{}',
  add column frozen_days date[] not null default '{}';

alter table rewards.social_posts add column post_url text check (post_url is null or length(post_url) <= 300);

-- "Is this user a paying subscriber?" for rules with params.audience. Replace in the app's config.
create function rewards_app.app_is_paid(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select false $$;

-- Display name of a friend in a friend streak (null: the app shows its own). Replace in the app's config.
create function rewards_app.app_display_name(user_id uuid) returns text
language sql stable security definer set search_path = '' as $$ select null::text $$;

-- Event filter (18.1) -----------------------------------------------------------------------------------------------

create function rewards.to_num(j jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(j) = 'number' then (j #>> '{}')::numeric
              when jsonb_typeof(j) = 'string' and (j #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then (j #>> '{}')::numeric end
$$;

create function rewards.valid_where(w jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select w is null or jsonb_typeof(w) = 'null' or (jsonb_typeof(w) = 'object' and not exists (
    select 1 from jsonb_each(w) k
     where k.key !~ '^(local_hour|local_weekday|prop:[a-z_][a-z0-9_]{0,39})$'
        or jsonb_typeof(k.value) <> 'object'
        or exists (select 1 from jsonb_object_keys(k.value) op where op not in ('eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in'))
        or (k.value ? 'in' and jsonb_typeof(k.value -> 'in') <> 'array')))
$$;

-- True when the event (props, time, member timezone) passes every condition of `w` (null / {} = always).
create function rewards.matches(w jsonb, props jsonb, at timestamptz, tz text) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  k record;
  c record;
  v jsonb;
  ok boolean;
  local timestamp := at at time zone tz;
begin
  if w is null or jsonb_typeof(w) <> 'object' then return true; end if;
  for k in select * from jsonb_each(w) loop
    v := case k.key when 'local_hour' then to_jsonb(extract(hour from local)::int)
                    when 'local_weekday' then to_jsonb(extract(isodow from local)::int)
                    else coalesce(props, '{}') -> substr(k.key, 6) end;
    for c in select * from jsonb_each(k.value) loop
      ok := case c.key
        when 'eq' then v = c.value or (rewards.to_num(v) is not null and rewards.to_num(v) = rewards.to_num(c.value))
        when 'ne' then v is distinct from c.value
                       and (rewards.to_num(v) is null or rewards.to_num(v) is distinct from rewards.to_num(c.value))
        when 'gt' then coalesce(rewards.to_num(v) > rewards.to_num(c.value), false)
        when 'gte' then coalesce(rewards.to_num(v) >= rewards.to_num(c.value), false)
        when 'lt' then coalesce(rewards.to_num(v) < rewards.to_num(c.value), false)
        when 'lte' then coalesce(rewards.to_num(v) <= rewards.to_num(c.value), false)
        when 'in' then v is not null and exists (select 1 from jsonb_array_elements(c.value) e
                                                  where e = v or rewards.to_num(e) = rewards.to_num(v))
        else false end;
      if not coalesce(ok, false) then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end $$;

-- Config checks for every kind (replaces the 0.1 check) ----------------------------------------------------------------

create or replace function rewards.check_program() returns trigger
language plpgsql set search_path = '' as $$
declare
  c jsonb := new.config;
  t jsonb;
  ev constant text := 'rewards: program % needs config.event naming a registered event type';
begin
  if tg_op = 'UPDATE' and new.kind <> old.kind then
    raise exception 'rewards: a program''s kind cannot change (%)', new.key using errcode = '22023';
  end if;
  if not rewards.valid_where(c -> 'where') then
    raise exception 'rewards: program % has an invalid where', new.key using errcode = '22023';
  end if;
  if new.kind in ('streak', 'milestone', 'comeback', 'friend_streak') then
    if not exists (select 1 from rewards.event_types x where x.name = c ->> 'event') then
      raise exception using message = format(ev, new.key), errcode = '22023';
    end if;
  end if;
  if new.kind = 'streak' and (coalesce(c ->> 'max_freezes', '0') !~ '^[0-9]{1,2}$'
                              or coalesce(c ->> 'auto_freeze', 'true') not in ('true', 'false')
                              or coalesce(c ->> 'daily_goal', '1') !~ '^([1-9]|[1-9][0-9]|100)$'
                              or coalesce(c ->> 'weekly_free_freezes', '0') !~ '^[0-7]$') then
    raise exception 'rewards: streak % needs max_freezes 0-99, auto_freeze, daily_goal 1-100, weekly_free_freezes 0-7', new.key
      using errcode = '22023';
  elsif new.kind = 'milestone' and coalesce(c ->> 'count', 'events') !~ '^(events|distinct:[a-z_][a-z0-9_]{0,39})$' then
    raise exception 'rewards: milestone % count must be events or distinct:<prop>', new.key using errcode = '22023';
  elsif new.kind = 'offer' then
    if c ? 'window_minutes' and (c ->> 'window_minutes') !~ '^[1-9][0-9]{0,6}$' then
      raise exception 'rewards: offer % window_minutes must be a positive whole number', new.key using errcode = '22023';
    end if;
    if not c ? 'window_minutes' and new.ends_at is null then
      raise exception 'rewards: offer % needs window_minutes or an ends_at', new.key using errcode = '22023';
    end if;
    if coalesce(c ->> 'start_on', 'first_seen') <> 'first_seen'
       and not exists (select 1 from rewards.event_types x where x.name = c ->> 'start_on') then
      raise exception 'rewards: offer % start_on must be first_seen or a registered event type', new.key using errcode = '22023';
    end if;
    if c ? 'complete_on' and not exists (select 1 from rewards.event_types x where x.name = c ->> 'complete_on') then
      raise exception 'rewards: offer % complete_on must be a registered event type', new.key using errcode = '22023';
    end if;
    if c ? 'stock' and jsonb_typeof(c -> 'stock') <> 'null' and (c ->> 'stock') !~ '^[0-9]{1,9}$' then
      raise exception 'rewards: offer % stock must be null or a whole number', new.key using errcode = '22023';
    end if;
  elsif new.kind = 'social_tag' then
    if coalesce(c ->> 'platform', '') <> 'instagram' then
      raise exception 'rewards: social program % supports platform instagram only', new.key using errcode = '22023';
    end if;
    if coalesce(c ->> 'account', '') !~ '^[a-z0-9._]{1,30}$' then
      raise exception 'rewards: social program % needs config.account (lower case, no @)', new.key using errcode = '22023';
    end if;
    if coalesce(c ->> 'code_prefix', '') !~ '^[A-Z]{2,8}$' then
      raise exception 'rewards: social program % needs config.code_prefix of 2-8 capital letters', new.key using errcode = '22023';
    end if;
    if c ? 'repeat_days' and jsonb_typeof(c -> 'repeat_days') <> 'null' and (c ->> 'repeat_days') !~ '^[1-9][0-9]{0,3}$' then
      raise exception 'rewards: social program % repeat_days must be null or 1-9999', new.key using errcode = '22023';
    end if;
  elsif new.kind = 'quiz' then
    if coalesce(c ->> 'bank', 'default') !~ '^[a-z][a-z0-9_]{0,39}$'
       or coalesce(c ->> 'questions', '10') !~ '^([1-9]|[1-4][0-9]|50)$'
       or coalesce(c ->> 'avoid_days', '30') !~ '^[0-9]{1,3}$'
       or coalesce(c ->> 'grace_s', '2') !~ '^([0-9]|[12][0-9]|30)$'
       or coalesce(c ->> 'attempts_per_day', '1') !~ '^([1-9]|10)$'
       or (c ? 'mix' and jsonb_typeof(c -> 'mix') <> 'object') then
      raise exception 'rewards: quiz % config: bank, questions 1-50, avoid_days, grace_s 0-30, attempts_per_day 1-10, mix object', new.key
        using errcode = '22023';
    end if;
  elsif new.kind = 'quest_set' then
    if coalesce(c ->> 'reset', 'daily') not in ('daily', 'weekly', 'never')
       or jsonb_typeof(c -> 'tasks') <> 'array' or jsonb_array_length(c -> 'tasks') not between 1 and 20 then
      raise exception 'rewards: quest set % needs reset daily/weekly/never and 1-20 tasks', new.key using errcode = '22023';
    end if;
    for t in select * from jsonb_array_elements(c -> 'tasks') loop
      if coalesce(t ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,39}$'
         or not exists (select 1 from rewards.event_types x where x.name = t ->> 'event')
         or coalesce(t ->> 'count', '1') !~ '^[1-9][0-9]{0,4}$' or not rewards.valid_where(t -> 'where') then
        raise exception 'rewards: quest set % task needs key, a registered event, count >= 1, a valid where', new.key
          using errcode = '22023';
      end if;
    end loop;
    if (select count(distinct x ->> 'key') from jsonb_array_elements(c -> 'tasks') x) <> jsonb_array_length(c -> 'tasks') then
      raise exception 'rewards: quest set % task keys must be unique', new.key using errcode = '22023';
    end if;
  elsif new.kind = 'comeback' and coalesce(c ->> 'after_days', '7') !~ '^([1-9]|[1-9][0-9]|[1-3][0-9][0-9])$' then
    raise exception 'rewards: comeback % after_days must be 1-399', new.key using errcode = '22023';
  elsif new.kind = 'recharge' and (coalesce(c ->> 'max', '3') !~ '^([1-9]|[1-9][0-9]|100)$'
                                   or coalesce(c ->> 'every_minutes', '240') !~ '^[1-9][0-9]{0,5}$') then
    raise exception 'rewards: recharge % needs max 1-100 and every_minutes >= 1', new.key using errcode = '22023';
  elsif new.kind = 'window' then
    if coalesce(c ->> 'from', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(c ->> 'to', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or c ->> 'from' = c ->> 'to'
       or (c ? 'days' and (jsonb_typeof(c -> 'days') <> 'array' or exists (
             select 1 from jsonb_array_elements(c -> 'days') d where (d #>> '{}') !~ '^[1-7]$'))) then
      raise exception 'rewards: window % needs from and to as HH:MM (different) and days 1-7', new.key using errcode = '22023';
    end if;
  elsif new.kind = 'friend_streak' and coalesce(c ->> 'max_friends', '5') !~ '^([1-9]|1[0-9]|20)$' then
    raise exception 'rewards: friend streak % max_friends must be 1-20', new.key using errcode = '22023';
  end if;
  return new;
end $$;

create or replace function rewards.check_rule() returns trigger
language plpgsql set search_path = '' as $$
declare
  p rewards.programs;
  e jsonb;
begin
  if tg_op = 'DELETE' then
    raise exception 'rewards: rules are append-only; set active = false instead' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'active') <> (to_jsonb(old) - 'active') then
      raise exception 'rewards: rules are append-only; only active may change' using errcode = '22023';
    end if;
    return new;
  end if;
  select * into p from rewards.programs x where x.key = new.program_key;
  if p.kind in ('recharge', 'window') then
    raise exception 'rewards: % programs take no rules', p.kind using errcode = '22023';
  end if;
  if p.kind in ('streak', 'milestone', 'quiz', 'friend_streak') and new.threshold is null then
    raise exception 'rewards: % rules need a threshold', p.kind using errcode = '22023';
  end if;
  if p.kind in ('offer', 'social_tag', 'quest_set', 'comeback') and (new.threshold is not null or new.repeat <> 'once') then
    raise exception 'rewards: % rules take no threshold and repeat once', p.kind using errcode = '22023';
  end if;
  if p.kind = 'quiz' and new.repeat <> 'once' then
    raise exception 'rewards: quiz rules repeat once (each attempt pays its best tier)' using errcode = '22023';
  end if;
  if new.repeat = 'each_cycle' and p.kind not in ('streak', 'friend_streak') then
    raise exception 'rewards: repeat each_cycle is for streaks only' using errcode = '22023';
  end if;
  if new.repeat = 'every' and p.kind not in ('streak', 'milestone', 'friend_streak') then
    raise exception 'rewards: repeat every is for streaks and milestones' using errcode = '22023';
  end if;
  if p.kind = 'quest_set' and new.params ? 'task' and not exists (
       select 1 from jsonb_array_elements(p.config -> 'tasks') t where t ->> 'key' = new.params ->> 'task') then
    raise exception 'rewards: quest set % has no task %', p.key, new.params ->> 'task' using errcode = '22023';
  end if;
  if coalesce(new.params ->> 'audience', 'all') not in ('all', 'free', 'paid') then
    raise exception 'rewards: params.audience must be all, free or paid' using errcode = '22023';
  end if;
  if new.kind in ('entitlement_days', 'streak_freeze', 'rc_currency') and new.amount <> trunc(new.amount) then
    raise exception 'rewards: % amount must be a whole number', new.kind using errcode = '22023';
  end if;
  if new.kind = 'entitlement_days' and coalesce(new.params ->> 'entitlement_id', '') = '' then
    raise exception 'rewards: entitlement_days needs params.entitlement_id' using errcode = '22023';
  end if;
  if new.kind = 'badge' and coalesce(new.params ->> 'badge', '') !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'rewards: badge needs params.badge (lower case name)' using errcode = '22023';
  end if;
  if new.kind = 'rc_currency' and coalesce(new.params ->> 'currency_code', '') !~ '^[A-Za-z0-9_]{1,40}$' then
    raise exception 'rewards: rc_currency needs params.currency_code' using errcode = '22023';
  end if;
  if new.kind = 'store_offer' and coalesce(new.params ->> 'offer_code', new.params ->> 'promotional_offer_id', '') = '' then
    raise exception 'rewards: store_offer needs params.offer_code or params.promotional_offer_id' using errcode = '22023';
  end if;
  if new.kind = 'mystery' then
    if jsonb_typeof(new.params -> 'table') <> 'array' or jsonb_array_length(new.params -> 'table') not between 2 and 20 then
      raise exception 'rewards: mystery needs params.table with 2-20 entries' using errcode = '22023';
    end if;
    for e in select * from jsonb_array_elements(new.params -> 'table') loop
      if coalesce(e ->> 'kind', '') !~ '^[a-z][a-z0-9_]{1,39}$' or e ->> 'kind' in ('mystery', 'entitlement_days', 'rc_currency')
         or coalesce(rewards.to_num(e -> 'amount'), 0) <= 0 or coalesce(rewards.to_num(e -> 'weight'), 0) <= 0
         or (e ->> 'kind' = 'badge' and coalesce(e #>> '{params,badge}', '') = '') then
        raise exception 'rewards: each mystery entry needs a kind (not mystery, entitlement_days or rc_currency), amount > 0, weight > 0'
          using errcode = '22023';
      end if;
    end loop;
  end if;
  return new;
end $$;

-- Odds of a mystery rule as shown before it is earned (percent, 1 decimal).
create function rewards.odds(params jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  with t as (select e, rewards.to_num(e -> 'weight') w from jsonb_array_elements(params -> 'table') e),
  s as (select sum(w) total from t)
  select coalesce(jsonb_agg(jsonb_build_object('kind', t.e ->> 'kind', 'amount', rewards.to_num(t.e -> 'amount'),
                  'params', coalesce(t.e -> 'params', '{}'), 'chance', round(100 * t.w / s.total, 1))), '[]')
    from t, s
$$;

create or replace function rewards.spec(r rewards.rules, at_threshold int) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('threshold', at_threshold, 'kind', r.kind, 'amount', r.amount, 'params', r.params)
         || case when r.kind = 'mystery' then jsonb_build_object('odds', rewards.odds(r.params)) else '{}' end
$$;

-- The one insert path for grants (replaces 0.1): audience check, mystery pick, store offers granted by the kit.
create or replace function rewards.queue(uid uuid, r rewards.rules, suffix text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  s rewards.settings := rewards.settings();
  today_start timestamptz := ((now() at time zone 'UTC')::date)::timestamp at time zone 'UTC';
  st text := 'queued';
  gid uuid;
  aud text := coalesce(r.params ->> 'audience', 'all');
  paid boolean;
  k text := r.kind;
  amt numeric := r.amount;
  prm jsonb := r.params;
  e jsonb;
  total numeric;
  pick numeric;
begin
  if aud <> 'all' then
    begin
      paid := coalesce(rewards_app.app_is_paid(uid), false);
    exception when others then
      raise warning 'rewards: app_is_paid failed: %', sqlerrm;
      paid := false;
    end;
    if (aud = 'paid') <> paid then return null; end if;
  end if;
  if (select count(*) from rewards.grants g where g.created_at >= today_start) >= s.daily_grant_cap then
    st := 'skipped_cap';
  end if;
  if r.kind = 'mystery' then
    select sum(rewards.to_num(x -> 'weight')) into total from jsonb_array_elements(r.params -> 'table') x;
    pick := random() * total;
    for e in select * from jsonb_array_elements(r.params -> 'table') loop
      pick := pick - rewards.to_num(e -> 'weight');
      if pick <= 0 then exit; end if;
    end loop;
    k := e ->> 'kind';
    amt := rewards.to_num(e -> 'amount');
    prm := coalesce(e -> 'params', '{}') || jsonb_build_object('mystery', true);
  end if;
  insert into rewards.grants (user_id, program_key, rule_id, grant_key, kind, amount, params, state)
  values (uid, r.program_key, r.id, rewards.grant_key(r.program_key, r.threshold, r.kind, uid, suffix), k, amt, prm, st)
  on conflict (grant_key) do nothing
  returning id into gid;
  if gid is not null and st = 'queued' and not rewards.is_worker_kind(k) then
    perform rewards.grant_local(gid);
  end if;
  return gid;
end $$;

-- grant_local learns store_offer (kit-granted: the grant itself is the offer the app shows).
create or replace function rewards.grant_local(gid uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  g rewards.grants;
  s rewards.settings := rewards.settings();
  target text;
  maxf int;
begin
  select * into g from rewards.grants x where x.id = gid for update;
  if g.id is null or g.state not in ('queued', 'failed_retryable') or rewards.is_worker_kind(g.kind) or g.user_id is null then
    return g.state;
  end if;
  begin
    if g.kind = 'badge' then
      insert into rewards.badges (user_id, badge, program_key, grant_id)
      values (g.user_id, g.params ->> 'badge', g.program_key, g.id) on conflict do nothing;
    elsif g.kind = 'streak_freeze' then
      target := coalesce(g.params ->> 'program', g.program_key);
      select coalesce((p.config ->> 'max_freezes')::int, 2) into maxf
        from rewards.programs p where p.key = target and p.kind = 'streak';
      if maxf is null then
        raise exception 'rewards: streak_freeze needs a streak program, got %', target;
      end if;
      insert into rewards.streaks (user_id, program_key, freezes)
      values (g.user_id, target, least(g.amount::int, maxf))
      on conflict (user_id, program_key) do update set freezes = least(rewards.streaks.freezes + g.amount::int, maxf),
                                                       updated_at = now();
    elsif g.kind = 'store_offer' then
      null;
    else
      perform rewards_app.app_reward_grant(g.id, g.user_id, g.kind, g.amount, g.params);
    end if;
    update rewards.grants x set state = 'granted', granted_at = now(), updated_at = now(), last_error = null
     where x.id = gid;
    return 'granted';
  exception when others then
    update rewards.grants x
       set attempts = x.attempts + 1, last_error = left(sqlerrm, 500), updated_at = now(),
           state = case when x.attempts + 1 >= s.max_attempts then 'failed' else 'failed_retryable' end
     where x.id = gid;
    return (select x.state from rewards.grants x where x.id = gid);
  end;
end $$;

-- New tables -----------------------------------------------------------------------------------------------------------

create table rewards.distinct_seen (
  user_id uuid not null,
  program_key text not null references rewards.programs (key),
  value text not null check (length(value) <= 200),
  primary key (user_id, program_key, value)
);

create table rewards.quest_progress (
  user_id uuid not null,
  program_key text not null references rewards.programs (key),
  period text not null,
  task text not null,
  progress int not null default 0,
  done_at timestamptz,
  primary key (user_id, program_key, period, task)
);

create table rewards.activity (
  user_id uuid not null,
  program_key text not null references rewards.programs (key),
  last_at timestamptz not null,
  primary key (user_id, program_key)
);

create table rewards.recharge (
  user_id uuid not null,
  program_key text not null references rewards.programs (key),
  units int not null check (units >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, program_key)
);

create table rewards.friend_invites (
  code text primary key check (code ~ '^F[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{7}$'),
  program_key text not null references rewards.programs (key),
  user_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index friend_invites_user on rewards.friend_invites (user_id);

create table rewards.friend_pairs (
  id uuid primary key default gen_random_uuid(),
  program_key text not null references rewards.programs (key),
  user_a uuid not null,
  user_b uuid not null,
  created_at timestamptz not null default now(),
  current int not null default 0,
  longest int not null default 0,
  last_day date,
  cycle int not null default 1,
  a_day date,
  b_day date,
  check (user_a < user_b)
);
create unique index friend_pairs_unique on rewards.friend_pairs (program_key, user_a, user_b);
create index friend_pairs_b on rewards.friend_pairs (user_b);

revoke all on all tables in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards_app from public, anon, authenticated, service_role;
