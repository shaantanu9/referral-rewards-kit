-- Rewards 0.7 (docs/rewards-api.md, "Fair play and progress"): per-user choices, streak repair, personal best, milestone
-- head start, sum counting, levels. Times are UTC (the default timezone); past days are set on the streak rows.
\set ON_ERROR_STOP 1
begin;
select setseed(0.07);

create temp table u (name text primary key, id uuid not null);
insert into u select n, gen_random_uuid() from unnest(array['a','b','c','d','e','f','g']) n;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to public;
create table public.app_coins (grant_id uuid primary key, user_id uuid, amount numeric);
grant select, insert on public.app_coins to postgres;
create or replace function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_coins values (grant_id, user_id, amount) on conflict do nothing;
end $$;
insert into rewards.event_types (name, source, daily_limit) values ('lesson', 'client', 100), ('read', 'client', 100);
create function pg_temp.ev(n text, type text, k text, props jsonb default '{}') returns jsonb language sql as $$
  select rewards.track(pg_temp.uid(n), type, k, props, null, false) $$;
create function pg_temp.streak(n text) returns jsonb language sql as $$
  select rewards.streak_json(pg_temp.uid(n), p) from rewards.programs p where p.key = 'daily' $$;
create function pg_temp.ms(n text, k text) returns jsonb language sql as $$
  select rewards.milestone_json(pg_temp.uid(n), p) from rewards.programs p where p.key = k $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'UTC')::date $$;

-- config checks ---------------------------------------------------------------------------------------------------------
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad1', 'streak', '{"event":"lesson","repair_days":9}');
  raise exception 'repair_days 9 accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'repair_days is 1-7');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad2', 'streak', '{"event":"lesson","repair_days":1,"repair_count":1}');
  raise exception 'repair_count 1 accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'repair_count is 2-10');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad3', 'milestone', '{"event":"read","levels":[10,5]}');
  raise exception 'falling levels accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'levels must rise');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad4', 'milestone', '{"event":"read","head_start":0}');
  raise exception 'head_start 0 accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'head_start from 1');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad5', 'milestone', '{"event":"read","count":"sum:Bad-Prop"}');
  raise exception 'bad sum prop accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'sum:<prop> needs a plain prop name');
end $$;

insert into rewards.programs (key, kind, config, public) values
  ('daily', 'streak', '{"event":"lesson","repair_days":2,"repair_count":2,"auto_freeze":false}', '{"title":"Daily"}'),
  ('reads', 'milestone', '{"event":"read","head_start":2}', '{"head_start_label":"A head start from us"}'),
  ('xp', 'milestone', '{"event":"lesson","count":"sum:xp","sum_max":50,"levels":[20,60,120]}',
   '{"level_names":["Starter","Explorer","Expert"]}'),
  ('box', 'milestone', '{"event":"read","count":"distinct:series"}', '{}');
insert into rewards.rules (program_key, threshold, repeat, kind, amount, params) values
  ('daily', 21, 'once', 'badge', 1, '{"badge":"three_weeks"}'),
  ('daily', 10, 'each_cycle', 'coins', 10, '{}'),
  ('reads', 2, 'once', 'coins', 1, '{}'),
  ('reads', 3, 'once', 'coins', 3, '{}'),
  ('xp', 50, 'every', 'coins', 7, '{}'),
  ('box', 1, 'every', 'mystery', 1, '{"table":[{"kind":"coins","amount":5,"weight":3},{"kind":"coins","amount":50,"weight":1}]}');

-- 1. choices ------------------------------------------------------------------------------------------------------------
select tests.ok(rewards.choices(pg_temp.uid('a')) = '{"streaks_off":false,"surprises_off":false,"timers_off":false}',
                'choices default to all on');
select tests.ok((select (j ->> 'streaks_off')::boolean and (j ->> 'timers_off')::boolean and not (j ->> 'surprises_off')::boolean
                   from (select rewards.followup_prefs_set(pg_temp.uid('a'), '{"streaks_off":true,"timers_off":true}') j) x),
                'the prefs setter takes and returns the choices');
select tests.ok(rewards.followup_prefs_set(pg_temp.uid('a'), '{}') ->> 'streaks_off' = 'true', 'choices are kept');
do $$ begin
  perform rewards.followup_prefs_set(pg_temp.uid('a'), '{"calm":true}');
  raise exception 'unknown key accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'unknown choice refused');
end $$;
select tests.act_as('authenticated', pg_temp.uid('a'));
select tests.ok((public.rewards_state() -> 'choices' ->> 'timers_off')::boolean, 'rewards_state returns the choices');
reset role;

-- streaks_off: still counted, hidden, no streak-at-risk reminder planned
insert into rewards.programs (key, kind, config) values
  ('n_risk', 'followup', '{"channel":"notification","trigger":{"type":"streak_at_risk","program":"daily","hours_before":4},"priority":50,"title":"App","body":"Day {{streak}} ends tonight.","payload":"/home"}');
select pg_temp.ev('a', 'lesson', 'a1');
select pg_temp.ev('b', 'lesson', 'b1');
select tests.ok((pg_temp.streak('a') ->> 'current')::int = 1 and (pg_temp.streak('a') ->> 'hidden')::boolean,
                'a hidden streak keeps counting and says hidden');
select tests.ok(not (pg_temp.streak('b') ->> 'hidden')::boolean, 'others are not hidden');
select tests.ok(not exists (select 1 from jsonb_array_elements(rewards.followups_plan(pg_temp.uid('a'), 3) -> 'plan') x
                             where x ->> 'program' = 'n_risk')
                and exists (select 1 from jsonb_array_elements(rewards.followups_plan(pg_temp.uid('b'), 3) -> 'plan') x
                             where x ->> 'program' = 'n_risk'),
                'no streak-at-risk reminder for a hidden streak; still planned for others');
delete from rewards.programs where key = 'n_risk';

-- surprises_off: mystery gives its most likely entry, marked fixed; odds hidden
select rewards.followup_prefs_set(pg_temp.uid('c'), '{"surprises_off":true}');
select pg_temp.ev('c', 'read', 'c' || g, jsonb_build_object('series', 's' || g)) from generate_series(1, 12) g;
select tests.ok((select count(*) = 12 and bool_and(amount = 5 and (params ->> 'fixed')::boolean) from rewards.grants
                  where user_id = pg_temp.uid('c') and program_key = 'box'), 'mystery with surprises off: always the most likely entry, fixed');
select pg_temp.ev('d', 'read', 'd' || g, jsonb_build_object('series', 's' || g)) from generate_series(1, 30) g;
select tests.ok((select count(distinct amount) = 2 and bool_and(params ->> 'fixed' is null) from rewards.grants
                  where user_id = pg_temp.uid('d') and program_key = 'box'), 'with surprises on, the draw still varies');
insert into rewards.programs (key, kind, config) values ('lucky', 'milestone', '{"event":"read"}');
insert into rewards.rules (program_key, threshold, repeat, kind, amount, params) values
  ('lucky', 1, 'every', 'coins', 1, '{"chance":1}'),
  ('lucky', 1, 'every', 'coins', 21, '{"amount_range":[10,21]}');
select pg_temp.ev('c', 'read', 'c-lucky', '{"series":"s1"}');
select tests.ok((select count(*) = 1 and bool_and(amount = 15 and (params ->> 'fixed')::boolean) from rewards.grants
                  where user_id = pg_temp.uid('c') and program_key = 'lucky'),
                'surprises off: no chance bonus; an amount range gives its midpoint');
select tests.act_as('authenticated', pg_temp.uid('c'));
select tests.ok(jsonb_array_length(public.rewards_state() -> 'surprises') = 0, 'no odds shown with surprises off');
reset role;
select tests.act_as('authenticated', pg_temp.uid('d'));
select tests.ok(jsonb_array_length(public.rewards_state() -> 'surprises') = 1, 'odds still shown to others');
reset role;
update rewards.rules set active = false where program_key = 'lucky';

-- 2. streak repair ------------------------------------------------------------------------------------------------------
-- e had 20 days ending 3 days ago (missed the last two): the engine has not seen the break yet
insert into rewards.streaks (user_id, program_key, current, longest, last_day, cycle)
values (pg_temp.uid('e'), 'daily', 20, 20, pg_temp.today() - 2, 1);
select tests.ok((pg_temp.streak('e') -> 'repair' ->> 'restores_to')::int = 21
                and (pg_temp.streak('e') -> 'repair' ->> 'needed')::int = 2,
                'a lapse the engine has not seen yet offers repair (restores 21 with 2 today)');
update rewards.streaks set last_day = pg_temp.today() - 4 where user_id = pg_temp.uid('e');
select tests.ok(pg_temp.streak('e') -> 'repair' = 'null'::jsonb, 'no repair once repair_days have passed');
update rewards.streaks set last_day = pg_temp.today() - 2 where user_id = pg_temp.uid('e');

select pg_temp.ev('e', 'lesson', 'e1');
select tests.ok((select current = 1 and broken_current = 20 and broken_day = pg_temp.today() - 1 and broken_cycle = 1
                   from rewards.streaks where user_id = pg_temp.uid('e')), 'the break is recorded with what it lost');
select tests.ok((pg_temp.streak('e') -> 'repair' ->> 'restores_to')::int = 21 and (pg_temp.streak('e') -> 'repair' ->> 'done')::int = 1,
                'after the first event: 1 of 2 done, restores 21');
select tests.ok((select count(*) from rewards.grants where user_id = pg_temp.uid('e')) = 0, 'nothing granted yet');
select tests.ok(jsonb_array_length(pg_temp.ev('e', 'lesson', 'e2') -> 'streaks') = 1, 'the repairing event reports the streak');
select tests.ok((select current = 21 and longest = 21 and cycle = 1 and broken_current = 0 and repaired_at is not null
                        and (pg_temp.today() - 1) = any(frozen_days)
                   from rewards.streaks where user_id = pg_temp.uid('e')), 'repaired: 21 days, the old cycle, the gap covered');
select tests.ok((select count(*) = 1 from rewards.grants where user_id = pg_temp.uid('e') and params ->> 'badge' = 'three_weeks'),
                'the 21-day reward the repair reaches is paid');
select tests.ok((select count(*) = 0 from rewards.grants where user_id = pg_temp.uid('e') and kind = 'coins'),
                'the 10-day reward of the old cycle is not paid twice');
select tests.ok(pg_temp.streak('e') -> 'repair' = 'null'::jsonb and (pg_temp.streak('e') ->> 'current')::int = 21,
                'no repair offered after repairing');
select pg_temp.ev('e', 'lesson', 'e3');
select tests.ok((select current = 21 from rewards.streaks where user_id = pg_temp.uid('e')), 'a third event changes nothing');

-- f: repair_count not reached the day of return, and the window closes
insert into rewards.streaks (user_id, program_key, current, longest, last_day, cycle)
values (pg_temp.uid('f'), 'daily', 9, 9, pg_temp.today() - 5, 2);
select pg_temp.ev('f', 'lesson', 'f1');
select tests.ok((select current = 1 and broken_current = 9 from rewards.streaks where user_id = pg_temp.uid('f'))
                and pg_temp.streak('f') -> 'repair' = 'null'::jsonb, 'a break older than repair_days cannot be repaired');
select pg_temp.ev('f', 'lesson', 'f2');
select tests.ok((select current = 1 from rewards.streaks where user_id = pg_temp.uid('f')), 'and two events do not repair it');

-- 3. personal best ------------------------------------------------------------------------------------------------------
update rewards.streaks set best_day_count = 1, best_day = pg_temp.today() - 1, prior_best = 0 where user_id = pg_temp.uid('b');
select tests.ok(not (pg_temp.streak('b') ->> 'record_today')::boolean, 'one event: no record');
select pg_temp.ev('b', 'lesson', 'b2');
select tests.ok((pg_temp.streak('b') ->> 'record_today')::boolean and (pg_temp.streak('b') ->> 'best_day_count')::int = 2,
                'two events beat the best of one: a record today');
select pg_temp.ev('g', 'lesson', 'g' || n) from generate_series(1, 3) n;
select tests.ok(not (pg_temp.streak('g') ->> 'record_today')::boolean and (pg_temp.streak('g') ->> 'best_day_count')::int = 3,
                'the first day ever is not called a record');

-- 4. head start, sum counting, levels -----------------------------------------------------------------------------------
select tests.ok((pg_temp.ms('a', 'reads') ->> 'count')::int = 2 and (pg_temp.ms('a', 'reads') ->> 'head_start')::int = 2,
                'a head start shows before the first event');
select pg_temp.ev('a', 'read', 'ar1', '{"series":"x"}');
select tests.ok((pg_temp.ms('a', 'reads') ->> 'count')::int = 3, 'the first event counts on top of the head start');
select tests.ok((select array_agg(amount order by amount) = array[3::numeric] from rewards.grants
                  where user_id = pg_temp.uid('a') and program_key = 'reads'),
                'a threshold inside the head start never pays; the next one does');

select pg_temp.ev('b', 'lesson', 'bx1', '{"xp":15}');
select tests.ok((pg_temp.ms('b', 'xp') -> 'level') = '{"number":0,"name":null,"at":0,"next_at":20}', 'level 0 before the first');
select pg_temp.ev('b', 'lesson', 'bx2', '{"xp":"30"}');
select tests.ok((pg_temp.ms('b', 'xp') ->> 'count')::int = 45
                and (pg_temp.ms('b', 'xp') -> 'level') = '{"number":1,"name":"Starter","at":20,"next_at":60}',
                'sums add (numbers and number strings); level 1 Starter');
select pg_temp.ev('b', 'lesson', 'bx3', '{"xp":9999}');
select tests.ok((pg_temp.ms('b', 'xp') ->> 'count')::int = 95, 'one event adds at most sum_max');
select tests.ok((select count(*) = 1 from rewards.grants where user_id = pg_temp.uid('b') and program_key = 'xp'),
                'crossing 50 pays the every-50 rule once');
select pg_temp.ev('b', 'lesson', 'bx4', '{"xp":-5}');
select pg_temp.ev('b', 'lesson', 'bx5', '{"xp":"lots"}');
select pg_temp.ev('b', 'lesson', 'bx6', '{}');
select tests.ok((pg_temp.ms('b', 'xp') ->> 'count')::int = 95, 'negative, non-number and missing props add nothing');
select pg_temp.ev('b', 'lesson', 'bx7', '{"xp":50}');
select pg_temp.ev('b', 'lesson', 'bx8', '{"xp":50}');
select tests.ok((pg_temp.ms('b', 'xp') -> 'level') = '{"number":3,"name":"Expert","at":120,"next_at":null}'
                and (select count(*) = 3 from rewards.grants where user_id = pg_temp.uid('b') and program_key = 'xp'),
                'top level has no next; 100 and 150 each paid once');

-- events-mode milestones without the new options behave as before
select tests.ok((pg_temp.ms('d', 'box') ->> 'count')::int = 30 and pg_temp.ms('d', 'box') -> 'level' = 'null'::jsonb
                and (pg_temp.ms('d', 'box') ->> 'head_start')::int = 0, 'plain milestones unchanged');

rollback;
