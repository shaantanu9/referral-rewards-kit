-- rewards engine 0.2, migration 2 of 4: event logic for the options and new kinds (filters, distinct counts, daily
-- goal, weekly free freezes, quests, comebacks, friend streaks, recharge, windows, offers completed by an event).

create function rewards.member_tz(uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.timezone from rewards.members m where m.user_id = uid),
                  (select s.default_timezone from rewards.settings s where s.id))
$$;

-- Matching events of a program's event type on one local day (the daily goal and the history count these).
create function rewards.day_count(uid uuid, type text, w jsonb, day date, tz text) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from rewards.events e
   where e.user_id = uid and e.type = day_count.type and e.local_day = day and rewards.matches(w, e.props, e.occurred_at, tz)
$$;

-- Streaks (replaces 0.1): daily goal, free weekly freezes first, then earned ones; covered days remembered.
create or replace function rewards.on_streak(uid uuid, p rewards.programs, day date) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  st rewards.streaks;
  goal int := coalesce((p.config ->> 'daily_goal')::int, 1);
  weekly int := coalesce((p.config ->> 'weekly_free_freezes')::int, 0);
  auto boolean := coalesce((p.config ->> 'auto_freeze')::boolean, true);
  d date;
  wk text;
  weeks text[];
  frozen date[];
  earned int;
  covered boolean := true;
  r rewards.rules;
begin
  if goal > 1 and rewards.day_count(uid, p.config ->> 'event', p.config -> 'where', day, rewards.member_tz(uid)) <> goal then
    return false;  -- counts once, on the event that reaches the goal
  end if;
  insert into rewards.streaks (user_id, program_key) values (uid, p.key) on conflict do nothing;
  select * into st from rewards.streaks x where x.user_id = uid and x.program_key = p.key for update;
  if st.last_day is not null and day <= st.last_day then return false; end if;
  weeks := st.free_freeze_weeks;
  frozen := st.frozen_days;
  earned := st.freezes;
  if st.last_day is not null and day > st.last_day + 1 then
    for d in select generate_series(st.last_day + 1, day - 1, interval '1 day')::date loop
      wk := to_char(d, 'IYYY-"W"IW');
      if (select count(*) from unnest(weeks) x where x = wk) < weekly then
        weeks := weeks || wk;
      elsif auto and earned > 0 then
        earned := earned - 1;
      else
        covered := false;
        exit;
      end if;
      frozen := frozen || d;
    end loop;
  end if;
  if st.last_day is null or covered then
    st.current := st.current + 1;
  else
    weeks := st.free_freeze_weeks;
    frozen := st.frozen_days;
    earned := st.freezes;
    st.cycle := st.cycle + case when st.current > 0 then 1 else 0 end;
    st.current := 1;
  end if;
  update rewards.streaks x
     set current = st.current, longest = greatest(x.longest, st.current), last_day = day, cycle = st.cycle,
         freezes = earned, updated_at = now(),
         free_freeze_weeks = weeks[greatest(cardinality(weeks) - 15, 1):],
         frozen_days = frozen[greatest(cardinality(frozen) - 59, 1):]
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

create or replace function rewards.streak_json(uid uuid, p rewards.programs) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  st rewards.streaks;
  tz text := rewards.member_tz(uid);
  today date := (now() at time zone tz)::date;
  auto boolean := coalesce((p.config ->> 'auto_freeze')::boolean, true);
  weekly int := coalesce((p.config ->> 'weekly_free_freezes')::int, 0);
  free_left int := weekly;
  last_ok date;
  cur int := 0;
  cyc int := 1;
  nxt jsonb;
begin
  select * into st from rewards.streaks x where x.user_id = uid and x.program_key = p.key;
  if st.user_id is not null then
    cyc := st.cycle;
    free_left := greatest(weekly - (select count(*) from unnest(st.free_freeze_weeks) w
                                    where w = to_char(today, 'IYYY-"W"IW'))::int, 0);
    last_ok := st.last_day + 1 + case when auto then st.freezes else 0 end + free_left;
    if st.last_day is not null and today <= last_ok then cur := st.current; end if;
  end if;
  select rewards.spec(r, case when r.repeat = 'every' then (cur / r.threshold + 1) * r.threshold else r.threshold end)
    into nxt
    from rewards.rules r
   where r.program_key = p.key and r.active
     and (r.repeat = 'every' or (r.repeat = 'each_cycle' and r.threshold > cur)
          or (r.repeat = 'once' and r.threshold > cur and not exists (
                select 1 from rewards.grants g where g.grant_key = rewards.grant_key(p.key, r.threshold, r.kind, uid, null))))
   order by case when r.repeat = 'every' then (cur / r.threshold + 1) * r.threshold else r.threshold end, r.created_at
   limit 1;
  return jsonb_build_object(
    'program', p.key, 'current', cur, 'longest', coalesce(st.longest, 0),
    'today_done', coalesce(st.last_day = today, false), 'freezes', coalesce(st.freezes, 0),
    'daily_goal', coalesce((p.config ->> 'daily_goal')::int, 1),
    'today_count', rewards.day_count(uid, p.config ->> 'event', p.config -> 'where', today, tz),
    'weekly_free_freezes_left', free_left,
    'ends_today_at', ((today + 1)::timestamp at time zone tz),
    'breaks_at', case when cur > 0 then ((last_ok + 1)::timestamp at time zone tz) end,
    'cycle', cyc, 'next_reward', nxt);
end $$;

-- Milestones (replaces 0.1): `count: distinct:<prop>` counts a new value once.
create or replace function rewards.on_milestone(uid uuid, p rewards.programs, props jsonb default '{}') returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  n int;
  r rewards.rules;
  mode text := coalesce(p.config ->> 'count', 'events');
  v text;
begin
  if mode like 'distinct:%' then
    v := left(props ->> substr(mode, 10), 200);
    if v is null or v = '' then return; end if;
    insert into rewards.distinct_seen (user_id, program_key, value) values (uid, p.key, v) on conflict do nothing;
    if not found then return; end if;
  end if;
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

-- Quests (18.2) ------------------------------------------------------------------------------------------------------

create function rewards.quest_period(p rewards.programs, today date) returns text
language sql immutable set search_path = '' as $$
  select case coalesce(p.config ->> 'reset', 'daily') when 'daily' then today::text
              when 'weekly' then to_char(today, 'IYYY-"W"IW') else 'once' end
$$;

create function rewards.quest_period_end(p rewards.programs, today date, tz text) returns timestamptz
language sql immutable set search_path = '' as $$
  select case coalesce(p.config ->> 'reset', 'daily')
    when 'daily' then ((today + 1)::timestamp at time zone tz)
    when 'weekly' then ((today + (8 - extract(isodow from today)::int))::timestamp at time zone tz) end
$$;

create function rewards.on_quest(uid uuid, p rewards.programs, type text, props jsonb, tz text, today date) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  per text := rewards.quest_period(p, today);
  t jsonb;
  n int;
  r rewards.rules;
  newly boolean := false;
begin
  for t in select * from jsonb_array_elements(p.config -> 'tasks') x where x ->> 'event' = type loop
    if not rewards.matches(t -> 'where', props, now(), tz) then continue; end if;
    insert into rewards.quest_progress as q (user_id, program_key, period, task, progress)
    values (uid, p.key, per, t ->> 'key', 1)
    on conflict (user_id, program_key, period, task) do update set progress = q.progress + 1 where q.done_at is null
    returning q.progress into n;
    if n is not null and n >= coalesce((t ->> 'count')::int, 1) then
      update rewards.quest_progress q set done_at = now()
       where q.user_id = uid and q.program_key = p.key and q.period = per and q.task = t ->> 'key' and q.done_at is null;
      if found then
        newly := true;
        for r in select * from rewards.rules x where x.program_key = p.key and x.active and x.params ->> 'task' = t ->> 'key' loop
          perform rewards.queue(uid, r, per || ':' || (t ->> 'key'));
        end loop;
      end if;
    end if;
  end loop;
  if newly and (select count(*) from rewards.quest_progress q where q.user_id = uid and q.program_key = p.key
                  and q.period = per and q.done_at is not null) = jsonb_array_length(p.config -> 'tasks') then
    for r in select * from rewards.rules x where x.program_key = p.key and x.active and not x.params ? 'task' loop
      perform rewards.queue(uid, r, per);
    end loop;
  end if;
end $$;

create function rewards.quest_json(uid uuid, p rewards.programs) returns jsonb
language sql stable security definer set search_path = '' as $$
  with z as (select rewards.member_tz(uid) tz),
  d as (select (now() at time zone z.tz)::date today, z.tz from z),
  per as (select rewards.quest_period(p, d.today) period, rewards.quest_period_end(p, d.today, d.tz) ends_at from d),
  tasks as (
    select t ->> 'key' k, t ->> 'event' ev, coalesce((t ->> 'count')::int, 1) cnt, ord,
           coalesce(q.progress, 0) prog, q.done_at is not null done
      from jsonb_array_elements(p.config -> 'tasks') with ordinality a(t, ord)
      cross join per
      left join rewards.quest_progress q on q.user_id = uid and q.program_key = p.key and q.period = per.period and q.task = t ->> 'key')
  select jsonb_build_object('program', p.key, 'period', per.period, 'ends_at', per.ends_at,
    'done', (select bool_and(done) from tasks),
    'tasks', (select jsonb_agg(jsonb_build_object('key', k, 'event', ev, 'count', cnt, 'progress', least(prog, cnt), 'done', done,
                'rewards', coalesce((select jsonb_agg(rewards.spec(r, null)) from rewards.rules r
                                      where r.program_key = p.key and r.active and r.params ->> 'task' = k), '[]')) order by ord) from tasks),
    'bonus', coalesce((select jsonb_agg(rewards.spec(r, null)) from rewards.rules r
                        where r.program_key = p.key and r.active and not r.params ? 'task'), '[]'))
  from per
$$;

-- Comeback (18.2): the first matching event after >= after_days without one.
create function rewards.on_comeback(uid uuid, p rewards.programs, today date) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  last timestamptz;
  r rewards.rules;
begin
  select a.last_at into last from rewards.activity a where a.user_id = uid and a.program_key = p.key for update;
  if last is not null and now() - last >= make_interval(days => coalesce((p.config ->> 'after_days')::int, 7)) then
    for r in select * from rewards.rules x where x.program_key = p.key and x.active loop
      perform rewards.queue(uid, r, today::text);
    end loop;
  end if;
  insert into rewards.activity as a (user_id, program_key, last_at) values (uid, p.key, now())
  on conflict (user_id, program_key) do update set last_at = now();
end $$;

-- Friend streaks (18.2): a pair's day counts when both did the event on it (each on their own local day).
create function rewards.on_friend(uid uuid, p rewards.programs, day date) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  f rewards.friend_pairs;
  r rewards.rules;
  u uuid;
begin
  for f in select * from rewards.friend_pairs x where x.program_key = p.key and (x.user_a = uid or x.user_b = uid)
            order by x.id for update loop
    if f.user_a = uid then f.a_day := greatest(coalesce(f.a_day, day), day); else f.b_day := greatest(coalesce(f.b_day, day), day); end if;
    if f.a_day = day and f.b_day = day and (f.last_day is null or f.last_day < day) then
      if f.last_day = day - 1 then
        f.current := f.current + 1;
      else
        f.cycle := f.cycle + case when f.current > 0 then 1 else 0 end;
        f.current := 1;
      end if;
      f.last_day := day;
      f.longest := greatest(f.longest, f.current);
      foreach u in array array[f.user_a, f.user_b] loop
        for r in select * from rewards.rules x where x.program_key = p.key and x.active order by x.created_at loop
          if r.repeat = 'once' and f.current = r.threshold then
            perform rewards.queue(u, r, 'p' || f.id);
          elsif r.repeat = 'each_cycle' and f.current = r.threshold then
            perform rewards.queue(u, r, 'p' || f.id || ':c' || f.cycle);
          elsif r.repeat = 'every' and f.current % r.threshold = 0 then
            perform rewards.queue(u, r, 'p' || f.id || ':c' || f.cycle || ':d' || f.current);
          end if;
        end loop;
      end loop;
    end if;
    update rewards.friend_pairs x set a_day = f.a_day, b_day = f.b_day, current = f.current, longest = f.longest,
           last_day = f.last_day, cycle = f.cycle
     where x.id = f.id;
  end loop;
end $$;

create function rewards.friends_json(uid uuid, p rewards.programs) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := rewards.member_tz(uid);
  today date := (now() at time zone tz)::date;
  f rewards.friend_pairs;
  other uuid;
  name text;
  alive boolean;
  out jsonb := '[]';
begin
  for f in select * from rewards.friend_pairs x where x.program_key = p.key and (x.user_a = uid or x.user_b = uid)
            order by x.created_at loop
    other := case when f.user_a = uid then f.user_b else f.user_a end;
    begin
      name := rewards_app.app_display_name(other);
    exception when others then
      name := null;
    end;
    alive := f.last_day is not null and f.last_day >= today - 1;
    out := out || jsonb_build_array(jsonb_build_object('program', p.key, 'pair_id', f.id, 'friend_id', other,
      'friend_name', name, 'current', case when alive then f.current else 0 end, 'longest', f.longest,
      'today_me', case when f.user_a = uid then f.a_day else f.b_day end = today,
      'today_friend', coalesce(case when f.user_a = uid then f.b_day else f.a_day end >= today, false),
      'breaks_at', case when alive then ((f.last_day + 2)::timestamp at time zone tz) end,
      'next_reward', (select rewards.spec(r, case when r.repeat = 'every'
                                                  then ((case when alive then f.current else 0 end) / r.threshold + 1) * r.threshold
                                                  else r.threshold end)
                        from rewards.rules r where r.program_key = p.key and r.active
                         and (r.repeat = 'every' or r.threshold > case when alive then f.current else 0 end)
                       order by case when r.repeat = 'every'
                                     then ((case when alive then f.current else 0 end) / r.threshold + 1) * r.threshold
                                     else r.threshold end, r.created_at
                       limit 1)));
  end loop;
  return out;
end $$;

-- Recharge (18.2) ----------------------------------------------------------------------------------------------------

create function rewards.recharge_now(uid uuid, p rewards.programs) returns rewards.recharge
language plpgsql volatile security definer set search_path = '' as $$
declare
  mx int := coalesce((p.config ->> 'max')::int, 3);
  every interval := make_interval(mins => coalesce((p.config ->> 'every_minutes')::int, 240));
  r rewards.recharge;
  n int;
begin
  insert into rewards.recharge (user_id, program_key, units)
  values (uid, p.key, case when coalesce((p.config ->> 'start_full')::boolean, true) then mx else 0 end)
  on conflict do nothing;
  select * into r from rewards.recharge x where x.user_id = uid and x.program_key = p.key for update;
  if r.units < mx then
    n := floor(extract(epoch from now() - r.updated_at) / extract(epoch from every))::int;
    if n > 0 then
      r.units := least(mx, r.units + n);
      r.updated_at := case when r.units >= mx then now() else r.updated_at + every * n end;
      update rewards.recharge x set units = r.units, updated_at = r.updated_at where x.user_id = uid and x.program_key = p.key;
    end if;
  end if;
  return r;
end $$;

create function rewards.recharge_json(p rewards.programs, r rewards.recharge) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('program', p.key, 'units', r.units, 'max', coalesce((p.config ->> 'max')::int, 3),
    'every_minutes', coalesce((p.config ->> 'every_minutes')::int, 240),
    'next_at', case when r.units < coalesce((p.config ->> 'max')::int, 3)
                    then r.updated_at + make_interval(mins => coalesce((p.config ->> 'every_minutes')::int, 240)) end)
$$;

create function rewards.recharge_use(uid uuid, program text, units int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p rewards.programs;
  r rewards.recharge;
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  select * into p from rewards.programs x where x.key = program and x.kind = 'recharge';
  if p.key is null or not rewards.is_live(p) then raise exception 'rewards: unknown_program' using errcode = '22023'; end if;
  if coalesce(units, 0) < 1 then raise exception 'rewards: bad_units' using errcode = '22023'; end if;
  r := rewards.recharge_now(uid, p);
  if r.units < units then raise exception 'rewards: empty' using errcode = '22023'; end if;
  update rewards.recharge x
     set units = x.units - recharge_use.units,
         updated_at = case when x.units >= coalesce((p.config ->> 'max')::int, 3) then now() else x.updated_at end
   where x.user_id = uid and x.program_key = p.key returning * into r;
  return rewards.recharge_json(p, r);
end $$;

-- Windows (18.2): the current window, or the next one, in the member's local time.
create function rewards.window_json(uid uuid, p rewards.programs) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := rewards.member_tz(uid);
  today date := (now() at time zone tz)::date;
  d date;
  st timestamptz;
  en timestamptz;
  f time := (p.config ->> 'from')::time;
  t time := (p.config ->> 'to')::time;
begin
  for d in select generate_series(today - 1, today + 8, interval '1 day')::date loop
    if p.config ? 'days' and not (p.config -> 'days') @> to_jsonb(extract(isodow from d)::int) then continue; end if;
    st := (d + f) at time zone tz;
    en := (case when t > f then d else d + 1 end + t) at time zone tz;
    if now() < en then
      return jsonb_build_object('program', p.key, 'active', now() >= st, 'starts_at', st, 'ends_at', en);
    end if;
  end loop;
  return jsonb_build_object('program', p.key, 'active', false, 'starts_at', null, 'ends_at', null);
end $$;

-- For the app's own SQL: is this user inside the window right now?
create function rewards.in_window(uid uuid, program text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (rewards.window_json(uid, p) ->> 'active')::boolean and rewards.is_live(p)
                     from rewards.programs p where p.key = program and p.kind = 'window'), false)
$$;

-- Offers completed by an event (18.1): claims quietly inside an active window.
create function rewards.offer_complete(uid uuid, p rewards.programs) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  w rewards.offer_windows;
  r rewards.rules;
begin
  perform 1 from rewards.programs x where x.key = p.key for update;
  select * into w from rewards.offer_windows x where x.user_id = uid and x.program_key = p.key for update;
  if w.user_id is null or w.claimed_at is not null or w.ends_at <= now() or not p.enabled
     or rewards.stock_left(p) = 0 then
    return;
  end if;
  update rewards.offer_windows x set claimed_at = now() where x.user_id = uid and x.program_key = p.key;
  for r in select * from rewards.rules x where x.program_key = p.key and x.active order by x.created_at loop
    perform rewards.queue(uid, r, null);
  end loop;
end $$;

-- Tracking (replaces 0.1): where filters, every kind that listens, offers that start or complete on the event.
create or replace function rewards.track(uid uuid, type text, dedupe_key text, props jsonb, tz text, allow_server boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  s rewards.settings := rewards.settings();
  et rewards.event_types;
  zone text;
  day date;
  eid bigint;
  p rewards.programs;
  pr jsonb := coalesce(props, '{}');
  changed jsonb := '[]';
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  select * into et from rewards.event_types t where t.name = track.type;
  if et.name is null then raise exception 'rewards: unknown_event' using errcode = '22023'; end if;
  if et.source = 'server' and not allow_server then raise exception 'rewards: server_only_event' using errcode = '22023'; end if;
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
  values (uid, et.name, coalesce(nullif(btrim(track.dedupe_key), ''), 'day:' || day), day, pr)
  on conflict do nothing
  returning id into eid;
  if eid is null then
    return jsonb_build_object('enabled', true, 'duplicate', true, 'grants', '[]'::jsonb, 'streaks', '[]'::jsonb);
  end if;
  for p in select * from rewards.programs x
            where (x.kind in ('streak', 'milestone', 'comeback', 'friend_streak') and x.config ->> 'event' = et.name)
               or (x.kind = 'quest_set' and x.config -> 'tasks' @> jsonb_build_array(jsonb_build_object('event', et.name)))
            order by x.sort, x.key loop
    if not rewards.is_live(p) then continue; end if;
    if p.kind <> 'quest_set' and not rewards.matches(p.config -> 'where', pr, now(), zone) then continue; end if;
    if p.kind = 'streak' then
      if rewards.on_streak(uid, p, day) then changed := changed || jsonb_build_array(rewards.streak_json(uid, p)); end if;
    elsif p.kind = 'milestone' then perform rewards.on_milestone(uid, p, pr);
    elsif p.kind = 'quest_set' then perform rewards.on_quest(uid, p, et.name, pr, zone, day);
    elsif p.kind = 'comeback' then perform rewards.on_comeback(uid, p, day);
    elsif p.kind = 'friend_streak' then perform rewards.on_friend(uid, p, day);
    end if;
  end loop;
  for p in select * from rewards.programs x where x.kind = 'offer' and x.config ->> 'start_on' = et.name loop
    perform rewards.start_offer(uid, p);
  end loop;
  for p in select * from rewards.programs x where x.kind = 'offer' and x.config ->> 'complete_on' = et.name loop
    perform rewards.offer_complete(uid, p);
  end loop;
  return jsonb_build_object('enabled', true, 'duplicate', false, 'streaks', changed,
    'grants', rewards.grants_json(uid, (select array_agg(g.id) from rewards.grants g
                                        where g.user_id = uid and g.created_at = now())));
end $$;
