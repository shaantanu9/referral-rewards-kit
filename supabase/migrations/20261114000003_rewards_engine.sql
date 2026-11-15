-- rewards engine migration 2: grants, streaks, milestones, offer windows and event tracking (ADR 0002 sections 6, 7).

create function rewards.settings() returns rewards.settings
language sql stable security definer set search_path = '' as $$ select * from rewards.settings s where s.id $$;

-- Live = switched on and inside its season window.
create function rewards.is_live(p rewards.programs) returns boolean
language sql stable set search_path = '' as $$
  select p.enabled and (p.starts_at is null or p.starts_at <= now()) and (p.ends_at is null or p.ends_at > now())
$$;

-- The member's timezone. A valid IANA name from the app is stored on first use and may change at most once per 24 h,
-- so switching timezones cannot add streak days. Anything invalid is ignored (never an error: tracking must not break).
create function rewards.member_timezone(uid uuid, tz text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  m rewards.members;
begin
  select * into m from rewards.members x where x.user_id = uid for update;
  if tz is not null and rewards.valid_timezone(tz) then
    if m.user_id is null then
      insert into rewards.members (user_id, timezone) values (uid, tz) on conflict (user_id) do nothing;
      return tz;
    elsif m.timezone <> tz and m.timezone_set_at <= now() - interval '24 hours' then
      update rewards.members x set timezone = tz, timezone_set_at = now() where x.user_id = uid;
      return tz;
    end if;
  end if;
  return coalesce(m.timezone, (select s.default_timezone from rewards.settings s where s.id));
end $$;

create function rewards.local_today(uid uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select m.timezone from rewards.members m where m.user_id = uid),
                                      (select s.default_timezone from rewards.settings s where s.id)))::date
$$;

-- One key per (program, threshold, kind, user, cycle): always holds the user id (the "fixed key" bug cannot happen),
-- never the rule id (a new rule version never pays twice).
create function rewards.grant_key(program text, threshold int, kind text, uid uuid, suffix text) returns text
language sql immutable set search_path = '' as $$
  select program || ':t' || coalesce(threshold::text, '-') || ':' || kind || ':' || uid::text || coalesce(':' || suffix, '')
$$;

-- Grant one local kind now. Kit kinds: badge, streak_freeze; everything else goes to the app hook. Any error is kept on
-- the row and retried by rewards.retry_local(). entitlement_days is left for the Edge Function.
create function rewards.grant_local(gid uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  g rewards.grants;
  s rewards.settings := rewards.settings();
  target text;
  maxf int;
begin
  select * into g from rewards.grants x where x.id = gid for update;
  if g.id is null or g.state not in ('queued', 'failed_retryable') or g.kind = 'entitlement_days' or g.user_id is null then
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

-- The one insert path for grants. Returns the new grant id, or null when that key was already granted.
create function rewards.queue(uid uuid, r rewards.rules, suffix text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  s rewards.settings := rewards.settings();
  today_start timestamptz := ((now() at time zone 'UTC')::date)::timestamp at time zone 'UTC';
  st text := 'queued';
  gid uuid;
begin
  if (select count(*) from rewards.grants g where g.created_at >= today_start) >= s.daily_grant_cap then
    st := 'skipped_cap';
  end if;
  insert into rewards.grants (user_id, program_key, rule_id, grant_key, kind, amount, params, state)
  values (uid, r.program_key, r.id, rewards.grant_key(r.program_key, r.threshold, r.kind, uid, suffix), r.kind,
          r.amount, r.params, st)
  on conflict (grant_key) do nothing
  returning id into gid;
  if gid is not null and st = 'queued' and r.kind <> 'entitlement_days' then
    perform rewards.grant_local(gid);
  end if;
  return gid;
end $$;

-- A rule spec as the app shows it.
create function rewards.spec(r rewards.rules, at_threshold int) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('threshold', at_threshold, 'kind', r.kind, 'amount', r.amount, 'params', r.params)
$$;

-- Streak as the app shows it (section 6.1). Times are real: ends_today_at is local midnight tonight, breaks_at is
-- when the streak really resets (counting freezes when auto_freeze is on). A streak already broken shows current 0.
create function rewards.streak_json(uid uuid, p rewards.programs) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st rewards.streaks;
  tz text := coalesce((select m.timezone from rewards.members m where m.user_id = uid),
                      (select s.default_timezone from rewards.settings s where s.id));
  today date := (now() at time zone tz)::date;
  auto boolean := coalesce((p.config ->> 'auto_freeze')::boolean, true);
  last_ok date;
  cur int := 0;
  cyc int := 1;
  nxt jsonb;
begin
  select * into st from rewards.streaks x where x.user_id = uid and x.program_key = p.key;
  if st.user_id is not null then
    cyc := st.cycle;
    last_ok := st.last_day + 1 + case when auto then st.freezes else 0 end;
    if st.last_day is not null and today <= last_ok then cur := st.current; end if;
  end if;
  select rewards.spec(r, case when r.repeat = 'every' then (cur / r.threshold + 1) * r.threshold else r.threshold end)
    into nxt
    from rewards.rules r
   where r.program_key = p.key and r.active
     and (r.repeat = 'every'
          or (r.repeat = 'each_cycle' and r.threshold > cur)
          or (r.repeat = 'once' and r.threshold > cur and not exists (
                select 1 from rewards.grants g where g.grant_key = rewards.grant_key(p.key, r.threshold, r.kind, uid, null))))
   order by case when r.repeat = 'every' then (cur / r.threshold + 1) * r.threshold else r.threshold end, r.created_at
   limit 1;
  return jsonb_build_object(
    'program', p.key, 'current', cur, 'longest', coalesce(st.longest, 0),
    'today_done', coalesce(st.last_day = today, false), 'freezes', coalesce(st.freezes, 0),
    'ends_today_at', ((today + 1)::timestamp at time zone tz),
    'breaks_at', case when cur > 0 then ((last_ok + 1)::timestamp at time zone tz) end,
    'cycle', cyc, 'next_reward', nxt);
end $$;

-- One counted day for a streak program. Returns true when the streak changed.
create function rewards.on_streak(uid uuid, p rewards.programs, day date) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  st rewards.streaks;
  gap int;
  r rewards.rules;
begin
  insert into rewards.streaks (user_id, program_key) values (uid, p.key) on conflict do nothing;
  select * into st from rewards.streaks x where x.user_id = uid and x.program_key = p.key for update;
  if st.last_day is not null and day <= st.last_day then
    return false;
  end if;
  if st.last_day is null or day = st.last_day + 1 then
    st.current := st.current + 1;
  else
    gap := day - st.last_day - 1;
    if coalesce((p.config ->> 'auto_freeze')::boolean, true) and st.freezes >= gap then
      st.freezes := st.freezes - gap;
      st.current := st.current + 1;
    else
      st.cycle := st.cycle + case when st.current > 0 then 1 else 0 end;
      st.current := 1;
    end if;
  end if;
  update rewards.streaks x
     set current = st.current, longest = greatest(x.longest, st.current), last_day = day, cycle = st.cycle,
         freezes = st.freezes, updated_at = now()
   where x.user_id = uid and x.program_key = p.key;
  for r in select * from rewards.rules x where x.program_key = p.key and x.active order by x.created_at loop
    if r.repeat = 'once' and st.current = r.threshold then
      perform rewards.queue(uid, r, null);
    elsif r.repeat = 'each_cycle' and st.current = r.threshold then
      perform rewards.queue(uid, r, 'c' || st.cycle);
    elsif r.repeat = 'every' and st.current % r.threshold = 0 then
      perform rewards.queue(uid, r, 'c' || st.cycle || ':d' || st.current);
    end if;
  end loop;
  return true;
end $$;

create function rewards.milestone_json(uid uuid, p rewards.programs) returns jsonb
language sql stable security definer set search_path = '' as $$
  with c as (select coalesce((select x.count from rewards.counters x where x.user_id = uid and x.program_key = p.key), 0) n)
  select jsonb_build_object('program', p.key, 'count', c.n, 'next_reward', (
    select rewards.spec(r, case when r.repeat = 'every' then (c.n / r.threshold + 1) * r.threshold else r.threshold end)
      from rewards.rules r
     where r.program_key = p.key and r.active and (r.repeat = 'every' or r.threshold > c.n)
     order by case when r.repeat = 'every' then (c.n / r.threshold + 1) * r.threshold else r.threshold end, r.created_at
     limit 1))
  from c
$$;

create function rewards.on_milestone(uid uuid, p rewards.programs) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  n int;
  r rewards.rules;
begin
  insert into rewards.counters as x (user_id, program_key, count) values (uid, p.key, 1)
  on conflict (user_id, program_key) do update set count = x.count + 1
  returning x.count into n;
  for r in select * from rewards.rules x where x.program_key = p.key and x.active order by x.created_at loop
    if r.repeat = 'once' and n = r.threshold then
      perform rewards.queue(uid, r, null);
    elsif r.repeat = 'every' and n % r.threshold = 0 then
      perform rewards.queue(uid, r, 'n' || n);
    end if;
  end loop;
end $$;

-- Start a user's offer window once (section 6.4). Only while the program is live; the deadline never moves after.
create function rewards.start_offer(uid uuid, p rewards.programs) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  ends timestamptz;
begin
  if not rewards.is_live(p) then return; end if;
  ends := least(case when p.config ? 'window_minutes'
                     then now() + make_interval(mins => (p.config ->> 'window_minutes')::int) end,
                p.ends_at);
  insert into rewards.offer_windows (user_id, program_key, ends_at) values (uid, p.key, ends)
  on conflict do nothing;
end $$;

-- Record one event and apply every live program listening to it. `allow_server`: true only for the service role and
-- triggers. The returned grants are the ones this transaction created for the user.
create function rewards.track(uid uuid, type text, dedupe_key text, props jsonb, tz text, allow_server boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  s rewards.settings := rewards.settings();
  et rewards.event_types;
  zone text;
  day date;
  eid bigint;
  p rewards.programs;
  changed jsonb := '[]';
begin
  if uid is null then
    raise exception 'rewards: not_signed_in' using errcode = '42501';
  end if;
  select * into et from rewards.event_types t where t.name = track.type;
  if et.name is null then
    raise exception 'rewards: unknown_event' using errcode = '22023';
  end if;
  if et.source = 'server' and not allow_server then
    raise exception 'rewards: server_only_event' using errcode = '22023';
  end if;
  if not s.enabled then
    return jsonb_build_object('enabled', false, 'duplicate', false, 'grants', '[]'::jsonb, 'streaks', '[]'::jsonb);
  end if;
  zone := rewards.member_timezone(uid, tz);
  day := (now() at time zone zone)::date;
  if (select count(*) from rewards.events e
       where e.user_id = uid and e.type = et.name and e.occurred_at > now() - interval '24 hours') >= et.daily_limit then
    raise exception 'rewards: daily_limit' using errcode = '22023';
  end if;
  insert into rewards.events (user_id, type, dedupe_key, local_day, props)
  values (uid, et.name, coalesce(nullif(btrim(track.dedupe_key), ''), 'day:' || day), day, coalesce(props, '{}'))
  on conflict do nothing
  returning id into eid;
  if eid is null then
    return jsonb_build_object('enabled', true, 'duplicate', true, 'grants', '[]'::jsonb, 'streaks', '[]'::jsonb);
  end if;
  for p in select * from rewards.programs x
            where x.kind in ('streak', 'milestone') and x.config ->> 'event' = et.name order by x.sort, x.key loop
    if rewards.is_live(p) then
      if p.kind = 'streak' then
        if rewards.on_streak(uid, p, day) then changed := changed || jsonb_build_array(rewards.streak_json(uid, p)); end if;
      else
        perform rewards.on_milestone(uid, p);
      end if;
    end if;
  end loop;
  for p in select * from rewards.programs x where x.kind = 'offer' and x.config ->> 'start_on' = et.name loop
    perform rewards.start_offer(uid, p);
  end loop;
  return jsonb_build_object('enabled', true, 'duplicate', false, 'streaks', changed,
    'grants', rewards.grants_json(uid, (select array_agg(g.id) from rewards.grants g
                                        where g.user_id = uid and g.created_at = now())));
end $$;
