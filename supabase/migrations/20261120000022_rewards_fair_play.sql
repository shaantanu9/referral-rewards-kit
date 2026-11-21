-- rewards engine 0.7: fair play and progress. Reference: docs/rewards-api.md, "Fair play and progress".
--   1. Per-user choices (EU Digital Fairness Act proposal, 11 Nov 2026): streaks_off, surprises_off, timers_off.
--   2. Streak repair earned by effort, never bought (Silverman & Barasch 2023): config repair_days, repair_count.
--   3. Personal best per streak: best_day_count, record_today.
--   4. Milestones: head_start (endowed progress, Nunes & Drèze 2006), count sum:<prop>, levels (STEP UP points/levels).
-- Existing functions are patched from their deployed definitions (pg_get_functiondef + replace, checked), never retyped.

-- 1. Choices live next to the other per-user switches -----------------------------------------------------------------
alter table rewards.followup_prefs
  add column streaks_off boolean not null default false,
  add column surprises_off boolean not null default false,
  add column timers_off boolean not null default false;

create function rewards.choices(uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('streaks_off', coalesce(f.streaks_off, false),
                            'surprises_off', coalesce(f.surprises_off, false),
                            'timers_off', coalesce(f.timers_off, false))
    from (select 1) one left join rewards.followup_prefs f on f.user_id = uid
$$;

-- 2 + 3. Streak state for repair and personal bests ------------------------------------------------------------------
alter table rewards.streaks
  add column broken_current int not null default 0,   -- the streak lost at the last break (0: nothing to repair)
  add column broken_cycle int,                        -- its cycle, given back on repair so no reward pays twice
  add column broken_day date,                         -- the first missed day nothing covered
  add column broken_from date,                        -- the last day of the lost streak
  add column repaired_at timestamptz,
  add column best_day_count int not null default 0,   -- most matching events on one local day (from 0.7)
  add column best_day date,
  add column prior_best int not null default 0;       -- the best before best_day (a record needs to beat it)

-- Runs after on_streak for every matching event (also later ones the same day): personal best, then repair.
create function rewards.streak_after(uid uuid, p rewards.programs, day date, counted boolean) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  st rewards.streaks;
  n int := rewards.day_count(uid, p.config ->> 'event', p.config -> 'where', day, rewards.member_tz(uid));
  rdays int := (p.config ->> 'repair_days')::int;
  rcount int := coalesce((p.config ->> 'repair_count')::int, 2);
  restored int;
  missed date[];
  r rewards.rules;
  t int;
begin
  select * into st from rewards.streaks x where x.user_id = uid and x.program_key = p.key for update;
  if st.user_id is null then return counted; end if;
  if n > st.best_day_count then
    update rewards.streaks x
       set prior_best = case when x.best_day is distinct from day then x.best_day_count else x.prior_best end,
           best_day_count = n, best_day = day
     where x.user_id = uid and x.program_key = p.key;
  end if;
  if rdays is null or st.broken_current <= 0 or st.last_day is distinct from day
     or day > st.broken_day + rdays or n < rcount then
    return counted;
  end if;
  restored := st.broken_current + st.current;
  -- the gap shows as covered in the history (like frozen days)
  missed := array(select g::date from generate_series(st.broken_from + 1, day - st.current, interval '1 day') g);
  update rewards.streaks x
     set current = restored, longest = greatest(x.longest, restored), cycle = st.broken_cycle, broken_current = 0,
         repaired_at = now(), updated_at = now(),
         frozen_days = (x.frozen_days || missed)[greatest(cardinality(x.frozen_days || missed) - 59, 1):]
   where x.user_id = uid and x.program_key = p.key;
  -- thresholds the restored streak passes, in the old cycle (those below it were paid before the break)
  for r in select * from rewards.rules x where x.program_key = p.key and x.active order by x.created_at loop
    if r.repeat in ('once', 'each_cycle') and r.threshold > st.broken_current and r.threshold <= restored then
      perform rewards.queue(uid, r, case when r.repeat = 'each_cycle' then 'c' || st.broken_cycle end);
    elsif r.repeat = 'every' then
      for t in select g from generate_series((st.broken_current / r.threshold + 1) * r.threshold, restored, r.threshold) g loop
        perform rewards.queue(uid, r, 'c' || st.broken_cycle || ':d' || t);
      end loop;
    end if;
  end loop;
  return true;
end $$;

-- The streak fields 0.7 adds to streak_json: hidden, repair, repaired_at, best_day_count, record_today.
create function rewards.streak_extra_json(uid uuid, p rewards.programs, st rewards.streaks, today date, last_ok date,
                                          tz text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  rdays int := (p.config ->> 'repair_days')::int;
  need int := coalesce((p.config ->> 'repair_count')::int, 2);
  n int;
  lapse date;
  restores int;
begin
  if rdays is not null and st.user_id is not null then
    n := rewards.day_count(uid, p.config ->> 'event', p.config -> 'where', today, tz);
    if st.broken_current > 0 and today <= st.broken_day + rdays and st.last_day >= today - 1 then
      -- the break is known (the user came back): today's events, if they reach the count, bring it back
      lapse := st.broken_day;
      restores := st.broken_current + st.current + case when st.last_day = today then 0 else 1 end;
    elsif st.current > 0 and last_ok is not null and today > last_ok and today <= last_ok + rdays then
      -- lapsed, not yet seen by the engine (last_ok was the last day an event kept it, so it is the first missed
      -- day nothing covers): coming back today with the count keeps it going
      lapse := last_ok;
      restores := st.current + 1;
    end if;
  end if;
  return jsonb_build_object(
    'hidden', coalesce((select f.streaks_off from rewards.followup_prefs f where f.user_id = uid), false),
    'repair', case when lapse is not null then jsonb_build_object('restores_to', restores, 'needed', need,
                'done', n, 'until', ((lapse + rdays + 1)::timestamp at time zone tz)) end,
    'repaired_at', st.repaired_at,
    'best_day_count', coalesce(st.best_day_count, 0),
    'record_today', coalesce(st.best_day = today and st.best_day_count >= 2 and st.best_day_count > st.prior_best
                             and st.prior_best >= 1, false));
end $$;

-- 4. Milestone levels -------------------------------------------------------------------------------------------------
create function rewards.valid_levels(j jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select j is null or jsonb_typeof(j) = 'null' or (
    jsonb_typeof(j) = 'array' and jsonb_array_length(j) between 1 and 50
    and not exists (select 1 from jsonb_array_elements(j) x where jsonb_typeof(x) <> 'number' or (x #>> '{}') !~ '^[1-9][0-9]{0,8}$')
    and not exists (select 1 from jsonb_array_elements_text(j) with ordinality a(v, i)
                      join jsonb_array_elements_text(j) with ordinality b(v, i) on b.i = a.i + 1
                     where b.v::int <= a.v::int))
$$;

create function rewards.level_json(p rewards.programs, n int) returns jsonb
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p.config -> 'levels') = 'array' then (
    select jsonb_build_object('number', z.k,
             'name', case when z.k > 0 then p.public -> 'level_names' ->> (z.k - 1) end,
             'at', case when z.k > 0 then (p.config -> 'levels' ->> (z.k - 1))::int else 0 end,
             'next_at', (p.config -> 'levels' ->> z.k)::int)
      from (select count(*)::int k from jsonb_array_elements_text(p.config -> 'levels') t(v) where t.v::int <= n) z)
  end
$$;

-- Patches ---------------------------------------------------------------------------------------------------------------
create function pg_temp.patch(d text, old text, new text, what text) returns text
language plpgsql as $$
declare
  hits int := (length(d) - length(replace(d, old, ''))) / length(old);
begin
  if hits <> 1 then raise exception 'rewards 0.7: could not patch % (% matches)', what, hits; end if;
  return replace(d, old, new);
end $$;

do $$
declare
  d text;
begin
  -- check_program: repair options on streaks; head_start, sum:<prop>, sum_max, levels on milestones
  d := pg_get_functiondef('rewards.check_program()'::regprocedure);
  d := pg_temp.patch(d, $o$or coalesce(c ->> 'weekly_free_freezes', '0') !~ '^[0-7]$') then$o$,
    $n$or coalesce(c ->> 'weekly_free_freezes', '0') !~ '^[0-7]$'
                              or coalesce(c ->> 'repair_days', '1') !~ '^[1-7]$'
                              or coalesce(c ->> 'repair_count', '2') !~ '^([2-9]|10)$') then$n$, 'check_program (streak)');
  d := pg_temp.patch(d, $o$weekly_free_freezes 0-7', new.key$o$,
    $n$weekly_free_freezes 0-7, repair_days 1-7, repair_count 2-10', new.key$n$, 'check_program (streak message)');
  d := pg_temp.patch(d,
    $o$elsif new.kind = 'milestone' and coalesce(c ->> 'count', 'events') !~ '^(events|distinct:[a-z_][a-z0-9_]{0,39})$' then
    raise exception 'rewards: milestone % count must be events or distinct:<prop>', new.key using errcode = '22023';$o$,
    $n$elsif new.kind = 'milestone' and (coalesce(c ->> 'count', 'events') !~ '^(events|distinct:[a-z_][a-z0-9_]{0,39}|sum:[a-z_][a-z0-9_]{0,39})$'
                                   or coalesce(c ->> 'head_start', '1') !~ '^[1-9][0-9]{0,5}$'
                                   or coalesce(c ->> 'sum_max', '1') !~ '^[1-9][0-9]{0,6}$'
                                   or not rewards.valid_levels(c -> 'levels')) then
    raise exception 'rewards: milestone % count must be events, distinct:<prop> or sum:<prop>; head_start and sum_max whole numbers from 1; levels 1-50 rising whole numbers', new.key using errcode = '22023';$n$,
    'check_program (milestone)');
  execute d;

  -- on_streak: remember what a break loses (d is the first missed day nothing covered)
  d := pg_get_functiondef('rewards.on_streak(uuid,rewards.programs,date)'::regprocedure);
  d := pg_temp.patch(d, $o$    earned := st.freezes;
    st.cycle := st.cycle + case$o$, $n$    earned := st.freezes;
    if st.current > 0 then
      update rewards.streaks x set broken_current = st.current, broken_cycle = st.cycle, broken_day = d,
                                   broken_from = st.last_day
       where x.user_id = uid and x.program_key = p.key;
    end if;
    st.cycle := st.cycle + case$n$, 'on_streak');
  execute d;

  -- streak_json: the 0.7 fields
  d := pg_get_functiondef('rewards.streak_json(uuid,rewards.programs)'::regprocedure);
  d := pg_temp.patch(d, $o$'cycle', cyc, 'next_reward', nxt);$o$,
    $n$'cycle', cyc, 'next_reward', nxt) || rewards.streak_extra_json(uid, p, st, today, last_ok, tz);$n$, 'streak_json');
  execute d;

  -- track: personal best and repair after every streak event
  d := pg_get_functiondef('rewards.track(uuid,text,text,jsonb,text,boolean)'::regprocedure);
  d := pg_temp.patch(d, $o$if rewards.on_streak(uid, p, day) then$o$,
    $n$if rewards.streak_after(uid, p, day, rewards.on_streak(uid, p, day)) then$n$, 'track');
  execute d;

  -- on_milestone: sum:<prop>, head_start, thresholds crossed (not only hit)
  d := pg_get_functiondef('rewards.on_milestone(uuid,rewards.programs,jsonb)'::regprocedure);
  d := pg_temp.patch(d, $o$  v text;
begin$o$, $n$  v text;
  inc int := 1;
  m int;
begin$n$, 'on_milestone (declare)');
  d := pg_temp.patch(d, $o$  insert into rewards.counters as x (user_id, program_key, count) values (uid, p.key, 1)
  on conflict (user_id, program_key) do update set count = x.count + 1$o$, $n$  if mode like 'sum:%' then
    -- never trust the prop: missing, not a number or below 1 adds nothing; one event adds at most sum_max
    -- (least() skips nulls, so a missing prop is filtered out first)
    inc := (select least(round(z.x), coalesce((p.config ->> 'sum_max')::int, 1000))::int
              from (select rewards.to_num(props -> substr(mode, 5)) x) z where z.x is not null);
    if inc is null or inc < 1 then return; end if;
  end if;
  insert into rewards.counters as x (user_id, program_key, count)
  values (uid, p.key, inc + coalesce((p.config ->> 'head_start')::int, 0))
  on conflict (user_id, program_key) do update set count = x.count + inc$n$, 'on_milestone (count)');
  d := pg_temp.patch(d, $o$if r.repeat = 'once' and n = r.threshold then$o$,
    $n$if r.repeat = 'once' and n - inc < r.threshold and n >= r.threshold then$n$, 'on_milestone (once)');
  d := pg_temp.patch(d, $o$    elsif r.repeat = 'every' and n % r.threshold = 0 then
      perform rewards.queue(uid, r, 'n' || n);$o$, $n$    elsif r.repeat = 'every' and (n - inc) / r.threshold < n / r.threshold then
      for m in select g from generate_series(((n - inc) / r.threshold + 1) * r.threshold, n, r.threshold) g loop
        perform rewards.queue(uid, r, 'n' || m);
      end loop;$n$, 'on_milestone (every)');
  execute d;

  -- milestone_json: head start counted from the start, levels
  d := pg_get_functiondef('rewards.milestone_json(uuid,rewards.programs)'::regprocedure);
  d := pg_temp.patch(d, $o$), 0) n)$o$, $n$), coalesce((p.config ->> 'head_start')::int, 0)) n)$n$, 'milestone_json (count)');
  d := pg_temp.patch(d, $o$'count', c.n, 'next_reward', ($o$,
    $n$'count', c.n, 'head_start', coalesce((p.config ->> 'head_start')::int, 0), 'level', rewards.level_json(p, c.n),
    'next_reward', ($n$, 'milestone_json (fields)');
  execute d;

  -- queue: with surprises off, no chance bonus, a mystery's most likely entry, an amount range's midpoint
  d := pg_get_functiondef('rewards.queue(uuid,rewards.rules,text)'::regprocedure);
  d := pg_temp.patch(d, $o$  s rewards.settings := rewards.settings();$o$, $n$  s rewards.settings := rewards.settings();
  fixed boolean := coalesce((select f.surprises_off from rewards.followup_prefs f where f.user_id = uid), false);$n$,
    'queue (declare)');
  d := pg_temp.patch(d, $o$  if r.params ? 'chance' then$o$, $n$  if r.params ? 'chance' and fixed then return null; end if;
  if r.params ? 'chance' then$n$, 'queue (chance)');
  d := pg_temp.patch(d, $o$    pick := random() * total;
    for e in select * from jsonb_array_elements(r.params -> 'table') loop
      pick := pick - rewards.to_num(e -> 'weight');
      if pick <= 0 then exit; end if;
    end loop;$o$, $n$    if fixed then
      select t.x into e from jsonb_array_elements(r.params -> 'table') with ordinality t(x, i)
       order by rewards.to_num(t.x -> 'weight') desc, t.i limit 1;
    else
      pick := random() * total;
      for e in select * from jsonb_array_elements(r.params -> 'table') loop
        pick := pick - rewards.to_num(e -> 'weight');
        if pick <= 0 then exit; end if;
      end loop;
    end if;$n$, 'queue (mystery)');
  d := pg_temp.patch(d, $o$    amt := mn + floor(random() * (mx - mn + 1))::int;$o$,
    $n$    amt := case when fixed then floor((mn + mx) / 2.0)::int else mn + floor(random() * (mx - mn + 1))::int end;$n$,
    'queue (range)');
  d := pg_temp.patch(d, $o$  insert into rewards.grants (user_id, program_key, rule_id, grant_key, kind, amount, params, state)$o$,
    $n$  if fixed and (r.kind = 'mystery' or r.params ? 'amount_range') then prm := prm || '{"fixed": true}'; end if;
  insert into rewards.grants (user_id, program_key, rule_id, grant_key, kind, amount, params, state)$n$, 'queue (fixed)');
  execute d;

  -- followups_plan: no streak-at-risk reminder for a hidden streak
  d := pg_get_functiondef('rewards.followups_plan(uuid,integer)'::regprocedure);
  d := pg_temp.patch(d, $o$        streak := coalesce((sj ->> 'current')::int, 0);$o$, $n$        streak := coalesce((sj ->> 'current')::int, 0);
        if coalesce((sj ->> 'hidden')::boolean, false) then streak := 0; end if;$n$, 'followups_plan');
  execute d;

  -- followup_prefs_set: the three choices
  d := pg_get_functiondef('rewards.followup_prefs_set(uuid,jsonb)'::regprocedure);
  d := pg_temp.patch(d, $o$where k not in ('notifications_off', 'emails_off', 'reminder_time', 'muted_groups') limit 1;$o$,
    $n$where k not in ('notifications_off', 'emails_off', 'reminder_time', 'muted_groups', 'streaks_off', 'surprises_off',
                     'timers_off') limit 1;$n$, 'followup_prefs_set (keys)');
  d := pg_temp.patch(d, $o$    emails_off = coalesce((patch ->> 'emails_off')::boolean, x.emails_off),$o$,
    $n$    emails_off = coalesce((patch ->> 'emails_off')::boolean, x.emails_off),
    streaks_off = coalesce((patch ->> 'streaks_off')::boolean, x.streaks_off),
    surprises_off = coalesce((patch ->> 'surprises_off')::boolean, x.surprises_off),
    timers_off = coalesce((patch ->> 'timers_off')::boolean, x.timers_off),$n$, 'followup_prefs_set (update)');
  d := pg_temp.patch(d, $o$'muted_groups', to_jsonb(r.muted_groups),$o$,
    $n$'muted_groups', to_jsonb(r.muted_groups),
    'streaks_off', r.streaks_off, 'surprises_off', r.surprises_off, 'timers_off', r.timers_off,$n$,
    'followup_prefs_set (answer)');
  execute d;

  -- rewards_state: the choices, and no odds to show a user who turned surprises off
  d := pg_get_functiondef('public.rewards_state()'::regprocedure);
  d := pg_temp.patch(d, $o$jsonb_build_object('surprises', rewards.surprises_json())$o$,
    $n$jsonb_build_object('surprises', case when (rewards.choices(auth.uid()) ->> 'surprises_off')::boolean
                                          then '[]'::jsonb else rewards.surprises_json() end,
                         'choices', rewards.choices(auth.uid()))$n$, 'rewards_state');
  execute d;
end $$;

revoke execute on all functions in schema rewards from public, anon, authenticated, service_role;
