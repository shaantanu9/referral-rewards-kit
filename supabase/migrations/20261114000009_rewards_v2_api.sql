-- rewards engine 0.2, migration 3 of 4: user RPCs for the new kinds, the state with every kind, RevenueCat events and
-- in-app currency grants through the worker (ADR 0002 sections 18.3, 18.5).

-- Worker support learns rc_currency (replaces 0.1) ---------------------------------------------------------------------

create or replace function rewards.retry_local(max_rows int default 200) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  gid uuid;
  n int := 0;
begin
  for gid in select g.id from rewards.grants g
              where g.state in ('queued', 'failed_retryable') and not rewards.is_worker_kind(g.kind) and g.user_id is not null
              order by g.created_at limit max_rows loop
    if rewards.grant_local(gid) = 'granted' then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Each claimed grant carries its kind: entitlement_days (entitlement_id, days) or rc_currency (currency_code, amount).
create or replace function rewards.claim_grants(batch int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s rewards.settings := rewards.settings();
  out jsonb;
begin
  update rewards.grants g set state = 'failed_retryable', attempt_token = null, granting_started_at = null,
         last_error = 'lease expired', updated_at = now()
   where g.state = 'granting' and g.granting_started_at < now() - make_interval(mins => s.lease_minutes);
  with c as (
    select g.id from rewards.grants g
     where rewards.is_worker_kind(g.kind) and g.state in ('queued', 'failed_retryable') and g.attempts < s.max_attempts
     order by g.created_at limit greatest(least(batch, 100), 1) for update skip locked),
  u as (
    update rewards.grants g set state = 'granting', attempt_token = gen_random_uuid(), granting_started_at = now(),
           attempts = g.attempts + 1, updated_at = now()
      from c where g.id = c.id
    returning g.*)
  select coalesce(jsonb_agg(jsonb_build_object('grant_id', u.id, 'attempt_token', u.attempt_token, 'user_id', u.user_id,
           'user_deleted', u.user_id is null, 'kind', u.kind, 'grant_key', u.grant_key,
           'entitlement_id', u.params ->> 'entitlement_id', 'days', u.amount::int,
           'currency_code', u.params ->> 'currency_code', 'amount', u.amount,
           'params', u.params, 'target_expires_at_ms', u.target_expires_at_ms, 'attempts', u.attempts)
           order by u.created_at), '[]')
    into out from u;
  return out;
end $$;

-- RevenueCat events (18.5) -----------------------------------------------------------------------------------------

create function rewards.rc_event(uid uuid, event_type text, event_id text, props jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t text := 'rc_' || lower(coalesce(event_type, ''));
  env text := upper(coalesce(props ->> 'environment', 'PRODUCTION'));
begin
  if uid is null or coalesce(event_id, '') = '' then return jsonb_build_object('tracked', false, 'reason', 'no_user'); end if;
  if env = 'SANDBOX' and not (rewards.settings()).rc_allow_sandbox then
    return jsonb_build_object('tracked', false, 'reason', 'sandbox');
  end if;
  if not exists (select 1 from rewards.event_types x where x.name = t) then
    return jsonb_build_object('tracked', false, 'reason', 'ignored_unregistered');
  end if;
  return jsonb_build_object('tracked', true,
    'result', rewards.track(uid, t, 'rc:' || event_id, coalesce(props, '{}'), null, true));
end $$;

create function rewards.ad_reward(uid uuid, ad_transaction_id text, currency text, amount numeric, event_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if uid is null or coalesce(ad_transaction_id, '') = '' then
    return jsonb_build_object('tracked', false, 'reason', 'no_user');
  end if;
  if not (rewards.settings()).ads_enabled then return jsonb_build_object('tracked', false, 'reason', 'ads_off'); end if;
  insert into rewards.event_types (name, source, daily_limit) values ('ad_watched', 'server', 50) on conflict do nothing;
  return jsonb_build_object('tracked', true, 'result',
    rewards.track(uid, 'ad_watched', 'ad:' || ad_transaction_id,
                  jsonb_build_object('currency', currency, 'amount', amount, 'event_id', event_id), null, true));
exception when sqlstate '22023' then
  -- daily_limit and friends: the ad was real, the engine just does not count more today
  return jsonb_build_object('tracked', false, 'reason', regexp_replace(sqlerrm, '^rewards: ', ''));
end $$;

-- History, recap (18.3) ----------------------------------------------------------------------------------------------

create function rewards.history(uid uuid, program text, weeks int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p rewards.programs;
  tz text := rewards.member_tz(uid);
  today date := (now() at time zone tz)::date;
  n int := least(greatest(coalesce(weeks, 15), 1), 53) * 7;
  st rewards.streaks;
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  select * into p from rewards.programs x
   where x.kind = 'streak' and (program is null or x.key = program) order by x.sort, x.key limit 1;
  if p.key is null then raise exception 'rewards: unknown_program' using errcode = '22023'; end if;
  select * into st from rewards.streaks x where x.user_id = uid and x.program_key = p.key;
  return jsonb_build_object('program', p.key, 'daily_goal', coalesce((p.config ->> 'daily_goal')::int, 1),
    'days', (select jsonb_agg(jsonb_build_object('day', d.dd, 'frozen', coalesce(d.dd = any(st.frozen_days), false),
               'count', coalesce(c.n, 0)) order by d.dd)
             from (select generate_series(today - (n - 1), today, interval '1 day')::date as dd) d
             left join (select e.local_day, count(*)::int n from rewards.events e
                         where e.user_id = uid and e.type = p.config ->> 'event' and e.local_day > today - n
                           and rewards.matches(p.config -> 'where', e.props, e.occurred_at, tz)
                         group by e.local_day) c on c.local_day = d.dd));
end $$;

create function rewards.recap(uid uuid, from_day date, to_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  if from_day is null or to_day is null or to_day < from_day or to_day - from_day > 366 then
    raise exception 'rewards: bad_range' using errcode = '22023';
  end if;
  return jsonb_build_object('from', from_day, 'to', to_day,
    'days_active', (select count(distinct e.local_day) from rewards.events e
                     where e.user_id = uid and e.local_day between from_day and to_day),
    'events', coalesce((select jsonb_agg(jsonb_build_object('type', t.type, 'count', t.n) order by t.n desc)
                          from (select e.type, count(*) n from rewards.events e
                                 where e.user_id = uid and e.local_day between from_day and to_day group by 1) t), '[]'),
    'grants', coalesce((select jsonb_agg(jsonb_build_object('kind', t.kind, 'amount', t.amount, 'count', t.n) order by t.kind)
                          from (select g.kind, sum(g.amount) amount, count(*) n from rewards.grants g
                                 where g.user_id = uid and g.state = 'granted'
                                   and (g.created_at at time zone rewards.member_tz(uid))::date between from_day and to_day
                                 group by 1) t), '[]'),
    'best_streak', coalesce((select max(x.longest) from rewards.streaks x where x.user_id = uid), 0),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('badge', b.badge, 'granted_at', b.granted_at) order by b.granted_at)
                          from rewards.badges b where b.user_id = uid
                           and (b.granted_at at time zone rewards.member_tz(uid))::date between from_day and to_day), '[]'));
end $$;

-- Friends (18.3) -----------------------------------------------------------------------------------------------------

create function rewards.friend_invite(uid uuid, program text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p rewards.programs;
  inv rewards.friend_invites;
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea;
  c text;
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  select * into p from rewards.programs x where x.key = program and x.kind = 'friend_streak';
  if p.key is null or not rewards.is_live(p) then raise exception 'rewards: unknown_program' using errcode = '22023'; end if;
  select * into inv from rewards.friend_invites i
   where i.user_id = uid and i.program_key = p.key and i.used_at is null and i.expires_at > now() + interval '1 day'
   order by i.created_at desc limit 1;
  if inv.code is null then
    for attempt in 1..8 loop
      b := extensions.gen_random_bytes(7);
      c := 'F';
      for i in 0..6 loop c := c || substr(alphabet, (get_byte(b, i) % 31) + 1, 1); end loop;
      exit when not exists (select 1 from rewards.friend_invites i where i.code = c);
    end loop;
    insert into rewards.friend_invites (code, program_key, user_id, expires_at)
    values (c, p.key, uid, now() + interval '7 days') returning * into inv;
  end if;
  return jsonb_build_object('code', inv.code, 'expires_at', inv.expires_at);
end $$;

create function rewards.friend_accept(uid uuid, code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  inv rewards.friend_invites;
  p rewards.programs;
  mx int;
  pid uuid;
  c text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  select * into inv from rewards.friend_invites i where i.code = c for update;
  if inv.code is null or inv.used_at is not null or inv.expires_at <= now() then
    raise exception 'rewards: bad_code' using errcode = '22023';
  end if;
  if inv.user_id = uid then raise exception 'rewards: own_code' using errcode = '22023'; end if;
  select * into p from rewards.programs x where x.key = inv.program_key;
  mx := coalesce((p.config ->> 'max_friends')::int, 5);
  if exists (select 1 from rewards.friend_pairs f where f.program_key = p.key
               and f.user_a = least(uid, inv.user_id) and f.user_b = greatest(uid, inv.user_id)) then
    raise exception 'rewards: already_friends' using errcode = '22023';
  end if;
  if (select count(*) from rewards.friend_pairs f where f.program_key = p.key and uid in (f.user_a, f.user_b)) >= mx
     or (select count(*) from rewards.friend_pairs f where f.program_key = p.key and inv.user_id in (f.user_a, f.user_b)) >= mx then
    raise exception 'rewards: too_many_friends' using errcode = '22023';
  end if;
  insert into rewards.friend_pairs (program_key, user_a, user_b)
  values (p.key, least(uid, inv.user_id), greatest(uid, inv.user_id)) returning id into pid;
  update rewards.friend_invites i set used_at = now() where i.code = c;
  return jsonb_build_object('pair_id', pid, 'program', p.key);
end $$;

-- Social link submission (18.3): the post link goes on the pending post for review.
create function rewards.social_submit_link(uid uuid, program text, url text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  m text[];
  p rewards.programs;
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  select * into p from rewards.programs x where x.key = program and x.kind = 'social_tag';
  if p.key is null then raise exception 'rewards: unknown_program' using errcode = '22023'; end if;
  m := regexp_match(btrim(coalesce(url, '')), '^https?://(?:www\.)?instagram\.com/(p|reel|reels|tv)/([A-Za-z0-9_-]{5,40})/?(?:\?.*)?$');
  if m is null then raise exception 'rewards: bad_link' using errcode = '22023'; end if;
  update rewards.social_posts s set post_url = 'https://www.instagram.com/' || replace(m[1], 'reels', 'reel') || '/' || m[2] || '/'
   where s.id = (select x.id from rewards.social_posts x where x.user_id = uid and x.program_key = p.key and x.state = 'pending'
                   and x.created_at > now() - make_interval(days => (rewards.settings()).social_window_days)
                 order by x.cycle desc limit 1);
  if not found then raise exception 'rewards: no_pending_post' using errcode = '22023'; end if;
  return rewards.social_json(uid, p);
end $$;

-- The state with every kind (replaces 0.1; quiz_json comes in the next migration) -------------------------------------
create or replace function rewards.state(uid uuid, start_offers boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s rewards.settings := rewards.settings();
  p rewards.programs;
  o jsonb;
  progs jsonb := '[]'; streaks jsonb := '[]'; milestones jsonb := '[]'; offers jsonb := '[]'; social jsonb := '[]';
  quests jsonb := '[]'; recharges jsonb := '[]'; windows jsonb := '[]'; friends jsonb := '[]'; quizzes jsonb := '[]';
  info jsonb;
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  if not s.enabled then
    return jsonb_build_object('enabled', false, 'server_time', now(), 'programs', '[]'::jsonb, 'streaks', '[]'::jsonb,
      'milestones', '[]'::jsonb, 'offers', '[]'::jsonb, 'social', '[]'::jsonb, 'quests', '[]'::jsonb,
      'recharges', '[]'::jsonb, 'windows', '[]'::jsonb, 'friends', '[]'::jsonb, 'quizzes', '[]'::jsonb,
      'inbox', '[]'::jsonb, 'badges', '[]'::jsonb);
  end if;
  for p in select * from rewards.programs x order by x.sort, x.key loop
    info := jsonb_build_object('key', p.key, 'kind', p.kind, 'starts_at', p.starts_at, 'ends_at', p.ends_at, 'public', p.public);
    if p.kind = 'offer' then
      if start_offers and coalesce(p.config ->> 'start_on', 'first_seen') = 'first_seen' then
        perform rewards.start_offer(uid, p);
      end if;
      o := rewards.offer_json(uid, p);
      if o ->> 'state' <> 'not_started' or rewards.is_live(p) then
        offers := offers || jsonb_build_array(o);
        progs := progs || jsonb_build_array(info);
      end if;
      continue;
    end if;
    if not rewards.is_live(p) then continue; end if;
    progs := progs || jsonb_build_array(info);
    case p.kind
      when 'streak' then streaks := streaks || jsonb_build_array(rewards.streak_json(uid, p));
      when 'milestone' then milestones := milestones || jsonb_build_array(rewards.milestone_json(uid, p));
      when 'social_tag' then social := social || jsonb_build_array(rewards.social_json(uid, p));
      when 'quest_set' then quests := quests || jsonb_build_array(rewards.quest_json(uid, p));
      when 'recharge' then recharges := recharges || jsonb_build_array(rewards.recharge_json(p, rewards.recharge_now(uid, p)));
      when 'window' then windows := windows || jsonb_build_array(rewards.window_json(uid, p));
      when 'friend_streak' then friends := friends || rewards.friends_json(uid, p);
      when 'quiz' then quizzes := quizzes || jsonb_build_array(rewards.quiz_json(uid, p));
      else null;
    end case;
  end loop;
  return jsonb_build_object('enabled', true, 'server_time', now(), 'programs', progs, 'streaks', streaks,
    'milestones', milestones, 'offers', offers, 'social', social, 'quests', quests, 'recharges', recharges,
    'windows', windows, 'friends', friends, 'quizzes', quizzes,
    'inbox', rewards.grants_json(uid, array(
      select g.id from rewards.grants g
       where g.user_id = uid and g.seen_at is null and g.state in ('granted', 'queued', 'granting', 'failed_retryable')
       order by g.created_at desc limit 50)),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('badge', b.badge, 'program', b.program_key,
                                                             'granted_at', b.granted_at) order by b.granted_at)
                          from rewards.badges b where b.user_id = uid), '[]'));
end $$;

-- social_json shows the submitted link (replaces 0.1's: same shape plus post_url).
create or replace function rewards.social_json(uid uuid, p rewards.programs) returns jsonb
language sql stable security definer set search_path = '' as $$
  with last as (select * from rewards.social_posts x where x.user_id = uid and x.program_key = p.key
                 order by x.cycle desc limit 1),
  win as (select s.social_window_days w from rewards.settings s where s.id),
  rep as (select case when jsonb_typeof(p.config -> 'repeat_days') = 'number' then (p.config ->> 'repeat_days')::int end d),
  st as (select case
      when not exists (select 1 from last) then 'none'
      when (select state from last) = 'verified' and (select d from rep) is null then 'verified'
      when (select state from last) = 'verified'
           and (select decided_at from last) + make_interval(days => (select d from rep)) > now() then 'cooldown'
      when (select state from last) = 'verified' then 'none'
      when (select state from last) = 'pending'
           and (select created_at from last) + make_interval(days => (select w from win)) <= now() then 'expired'
      else (select state from last) end v)
  select jsonb_build_object('program', p.key, 'platform', p.config ->> 'platform', 'account', p.config ->> 'account',
    'state', st.v,
    'code', case when st.v <> 'none' then (select code from last) end,
    'post_url', case when st.v <> 'none' then (select post_url from last) end,
    'expires_at', case
      when st.v = 'pending' then (select created_at from last) + make_interval(days => (select w from win))
      when st.v = 'cooldown' then (select decided_at from last) + make_interval(days => (select d from rep)) end,
    'rewards', rewards.rule_specs(p.key))
  from st
$$;

-- Public wrappers ------------------------------------------------------------------------------------------------------
create function public.rewards_history(program text default null, weeks int default 15) returns jsonb
language sql stable security definer set search_path = '' as $$ select rewards.history(auth.uid(), program, weeks) $$;
create function public.rewards_recap(from_day date, to_day date) returns jsonb
language sql stable security definer set search_path = '' as $$ select rewards.recap(auth.uid(), from_day, to_day) $$;
create function public.rewards_recharge_use(program text, units int default 1) returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.recharge_use(auth.uid(), program, units) $$;
create function public.rewards_friend_invite(program text) returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.friend_invite(auth.uid(), program) $$;
create function public.rewards_friend_accept(code text) returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.friend_accept(auth.uid(), code) $$;
create function public.rewards_friend_remove(pair_id uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  delete from rewards.friend_pairs f where f.id = pair_id and auth.uid() in (f.user_a, f.user_b);
  return found;
end $$;
create function public.rewards_social_submit_link(program text, url text) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select rewards.social_submit_link(auth.uid(), program, url)
$$;
create function public.rewards_svc_rc_event(user_id uuid, event_type text, event_id text, props jsonb default '{}') returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.rc_event(user_id, event_type, event_id, props) $$;
create function public.rewards_svc_ad_reward(user_id uuid, ad_transaction_id text, currency text, amount numeric,
                                             event_id text default null) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select rewards.ad_reward(user_id, ad_transaction_id, currency, amount, event_id)
$$;

revoke all on all tables in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards_app from public, anon, authenticated, service_role;
revoke all on function public.rewards_history(text, int), public.rewards_recap(date, date),
  public.rewards_recharge_use(text, int), public.rewards_friend_invite(text), public.rewards_friend_accept(text),
  public.rewards_friend_remove(uuid), public.rewards_social_submit_link(text, text),
  public.rewards_svc_rc_event(uuid, text, text, jsonb), public.rewards_svc_ad_reward(uuid, text, text, numeric, text)
  from public, anon, authenticated, service_role;
grant execute on function public.rewards_history(text, int), public.rewards_recap(date, date),
  public.rewards_recharge_use(text, int), public.rewards_friend_invite(text), public.rewards_friend_accept(text),
  public.rewards_friend_remove(uuid), public.rewards_social_submit_link(text, text) to authenticated;
grant execute on function public.rewards_svc_rc_event(uuid, text, text, jsonb),
  public.rewards_svc_ad_reward(uuid, text, text, numeric, text) to service_role;
