-- Rewards 0.2 engine options: where filters, distinct counts, daily goal, weekly free freezes, audience, mystery
-- rewards with shown odds, store offers, offers completed by an event, rc_currency for the worker (ADR 0002 18.1).
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u select 'u' || g, gen_random_uuid() from generate_series(1, 6) g;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
create table public.app_coins (grant_id uuid primary key, user_id uuid, kind text, amount numeric);
create table public.app_paid (user_id uuid primary key);
grant select, insert on public.app_coins, public.app_paid to postgres;
create or replace function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_coins values (grant_id, user_id, kind, amount) on conflict do nothing;
end $$;
create or replace function rewards_app.app_is_paid(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_paid p where p.user_id = app_is_paid.user_id) $$;
insert into public.app_paid values (pg_temp.uid('u2'));

-- the filter itself --------------------------------------------------------------------------------------------------
select tests.ok(rewards.matches('{"local_hour":{"in":[23,0,1,2,3]}}', '{}', '2026-11-14T18:00:00Z', 'Asia/Kolkata'),
                'Night owl: 23:30 in Kolkata matches');
select tests.ok(not rewards.matches('{"local_hour":{"in":[23,0,1,2,3]}}', '{}', '2026-11-14T10:00:00Z', 'Asia/Kolkata'),
                'Night owl: 15:30 in Kolkata does not');
select tests.ok(rewards.matches('{"prop:score":{"gte":9}}', '{"score":"9.5"}', now(), 'UTC'), 'numeric string prop >= 9');
select tests.ok(not rewards.matches('{"prop:score":{"gte":9}}', '{}', now(), 'UTC'), 'missing prop never matches gte');
select tests.ok(rewards.matches('{"local_weekday":{"in":[6,7]}}', '{}', '2026-11-14T12:00:00Z', 'UTC'), '2026-11-14 is a Saturday (weekend)');
select tests.ok(rewards.matches('{"prop:lang":{"ne":"en"},"prop:pages":{"gt":3,"lte":10}}', '{"lang":"hi","pages":5}', now(), 'UTC'),
                'several conditions all hold');
select tests.ok(rewards.matches(null, '{}', now(), 'UTC') and rewards.matches('{}', '{}', now(), 'UTC'), 'no filter always matches');
do $$ begin
  insert into rewards.event_types (name, source) values ('chapter_done', 'client');
  insert into rewards.programs (key, kind, config) values ('bad', 'streak', '{"event":"chapter_done","where":{"prop:x":{"like":"a"}}}');
  raise exception 'bad where accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'an unknown filter operator is refused');
end $$;

insert into rewards.event_types (name, source, daily_limit) values ('chapter_done', 'client', 100), ('purchase', 'server', 10);

-- distinct counts and a prop filter on a milestone --------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values
  ('series3', 'milestone', '{"event":"chapter_done","count":"distinct:series"}'),
  ('long_reads', 'milestone', '{"event":"chapter_done","where":{"prop:pages":{"gte":20}}}');
insert into rewards.rules (program_key, threshold, kind, amount, params) values
  ('series3', 3, 'badge', 1, '{"badge":"explorer"}'), ('long_reads', 2, 'coins', 5, '{}');
select rewards.track(pg_temp.uid('u1'), 'chapter_done', 'c' || g, jsonb_build_object('series', s, 'pages', pg), null, false)
  from (values (1, 'a', 10), (2, 'a', 25), (3, 'b', 30), (4, 'a', 5), (5, 'c', 8)) v(g, s, pg);
select tests.ok((select count from rewards.counters where program_key = 'series3') = 3, 'distinct: a, b, c counted once each');
select tests.ok(exists (select 1 from rewards.badges where badge = 'explorer'), 'distinct milestone pays at 3 series');
select tests.ok((select count from rewards.counters where program_key = 'long_reads') = 2, 'filter: only chapters of 20+ pages count');

-- daily goal and weekly free freezes --------------------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values
  ('daily3', 'streak', '{"event":"chapter_done","daily_goal":3,"weekly_free_freezes":1,"max_freezes":0}');
select rewards.track(pg_temp.uid('u3'), 'chapter_done', 'd1', '{}', null, false);
select rewards.track(pg_temp.uid('u3'), 'chapter_done', 'd2', '{}', null, false);
select tests.ok(not exists (select 1 from rewards.streaks where user_id = pg_temp.uid('u3') and program_key = 'daily3' and current > 0),
                'two of three: the day does not count yet');
create temp table sj as select rewards.streak_json(pg_temp.uid('u3'), p) j from rewards.programs p where p.key = 'daily3';
select tests.ok((select (j ->> 'daily_goal')::int = 3 and (j ->> 'today_count')::int = 2 and (j ->> 'weekly_free_freezes_left')::int = 1 from sj),
                'state shows goal 3, today 2, one free freeze');
select rewards.track(pg_temp.uid('u3'), 'chapter_done', 'd3', '{}', null, false);
select rewards.track(pg_temp.uid('u3'), 'chapter_done', 'd4', '{}', null, false);
select tests.ok((select current from rewards.streaks where user_id = pg_temp.uid('u3') and program_key = 'daily3') = 1,
                'the third event counts the day once; the fourth changes nothing');
-- one missed day: the free weekly freeze covers it (the gap's week must have none used)
update rewards.streaks set last_day = last_day - 2 where user_id = pg_temp.uid('u3') and program_key = 'daily3';
delete from rewards.events where user_id = pg_temp.uid('u3');
select rewards.track(pg_temp.uid('u3'), 'chapter_done', 'e' || g, '{}', null, false) from generate_series(1, 3) g;
select tests.ok((select current = 2 and cardinality(free_freeze_weeks) = 1 and cardinality(frozen_days) = 1
                 from rewards.streaks where user_id = pg_temp.uid('u3') and program_key = 'daily3'),
                'one missed day forgiven by the free weekly freeze, remembered as frozen');
-- the same week's second miss is not free (max_freezes 0): reset
update rewards.streaks set last_day = last_day - 2, free_freeze_weeks = array[to_char(current_date - 1, 'IYYY-"W"IW')]
 where user_id = pg_temp.uid('u3') and program_key = 'daily3';
delete from rewards.events where user_id = pg_temp.uid('u3');
select rewards.track(pg_temp.uid('u3'), 'chapter_done', 'f' || g, '{}', null, false) from generate_series(1, 3) g;
select tests.ok((select current = 1 and cycle = 2 from rewards.streaks where user_id = pg_temp.uid('u3') and program_key = 'daily3'),
                'the free freeze already used that week: the streak resets');

-- audience -----------------------------------------------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values ('buyer', 'milestone', '{"event":"purchase"}');
insert into rewards.rules (program_key, threshold, kind, amount, params) values
  ('buyer', 1, 'minutes', 30, '{"audience":"free"}'), ('buyer', 1, 'coins', 7, '{"audience":"paid"}');
select rewards.track(pg_temp.uid(n), 'purchase', 'p1', '{}', null, true) from unnest(array['u1', 'u2']) n;
select tests.ok((select string_agg(kind, ',') from rewards.grants where program_key = 'buyer' and user_id = pg_temp.uid('u1')) = 'minutes',
                'free user gets only the free reward');
select tests.ok((select string_agg(kind, ',') from rewards.grants where program_key = 'buyer' and user_id = pg_temp.uid('u2')) = 'coins',
                'paid user gets only the paid reward');
do $$ begin
  insert into rewards.rules (program_key, threshold, kind, amount, params) values ('buyer', 2, 'coins', 1, '{"audience":"vip"}');
  raise exception 'bad audience accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'audience must be all, free or paid');
end $$;

-- mystery with shown odds ------------------------------------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values ('box', 'milestone', '{"event":"chapter_done"}');
insert into rewards.rules (program_key, threshold, repeat, kind, amount, params) values
  ('box', 1, 'every', 'mystery', 1, '{"table":[{"kind":"coins","amount":5,"weight":3},{"kind":"coins","amount":50,"weight":1}]}');
create temp table mj as select rewards.milestone_json(pg_temp.uid('u4'), p) j from rewards.programs p where p.key = 'box';
select tests.ok((select j -> 'next_reward' -> 'odds' @> '[{"amount":5,"chance":75.0},{"amount":50,"chance":25.0}]' from mj),
                'odds shown before it is earned: 75 % / 25 %');
select rewards.track(pg_temp.uid('u4'), 'chapter_done', 'm' || g, '{}', null, false) from generate_series(1, 20) g;
select tests.ok((select count(*) = 20 and bool_and(kind = 'coins' and amount in (5, 50) and (params ->> 'mystery')::boolean)
                 from rewards.grants where program_key = 'box'), 'each draw pays one entry of the table');
select tests.ok((select count(distinct amount) from rewards.grants where program_key = 'box') >= 1, 'draws are recorded');
do $$ begin
  insert into rewards.rules (program_key, threshold, kind, amount, params) values ('box', 5, 'mystery', 1, '{"table":[{"kind":"entitlement_days","amount":1,"weight":1},{"kind":"coins","amount":1,"weight":1}]}');
  raise exception 'worker kind in a mystery accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'a mystery never contains worker kinds');
end $$;

-- store offer and rc_currency -------------------------------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values ('loyal', 'milestone', '{"event":"purchase"}');
insert into rewards.rules (program_key, threshold, kind, amount, params) values
  ('loyal', 1, 'store_offer', 1, '{"offer_code":"WINBACK30","platform":"ios"}'),
  ('loyal', 1, 'rc_currency', 100, '{"currency_code":"GEMS"}');
select rewards.track(pg_temp.uid('u5'), 'purchase', 'x1', '{}', null, true);
select tests.ok((select state from rewards.grants where kind = 'store_offer') = 'granted', 'store offer granted by the kit');
select tests.ok((select state from rewards.grants where kind = 'rc_currency') = 'queued', 'rc_currency waits for the worker');
select tests.ok(rewards.retry_local() = 0 and (select state from rewards.grants where kind = 'rc_currency') = 'queued',
                'retry_local never touches rc_currency');
create temp table cl as select rewards.claim_grants(10) j;
select tests.ok((select j @> '[{"kind":"rc_currency","currency_code":"GEMS","amount":100}]' from cl), 'claim returns rc_currency with its code');
do $$ begin
  insert into rewards.rules (program_key, threshold, kind, amount, params) values ('loyal', 2, 'rc_currency', 1.5, '{"currency_code":"GEMS"}');
  raise exception 'fractional currency accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'rc_currency amount must be whole');
end $$;

-- offer completed by an event ---------------------------------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values ('welcome_buy', 'offer', '{"window_minutes":1440,"complete_on":"purchase"}');
insert into rewards.rules (program_key, kind, amount) values ('welcome_buy', 'coins', 300);
select rewards.state(pg_temp.uid('u6'));
select rewards.track(pg_temp.uid('u6'), 'purchase', 'w1', '{}', null, true);
select tests.ok((select claimed_at is not null from rewards.offer_windows where user_id = pg_temp.uid('u6') and program_key = 'welcome_buy'),
                'a purchase inside the window claims the offer by itself');
select tests.ok(exists (select 1 from public.app_coins where user_id = pg_temp.uid('u6') and amount = 300), 'and pays it');
select rewards.track(pg_temp.uid('u1'), 'purchase', 'w2', '{}', null, true);
select tests.ok(not exists (select 1 from public.app_coins where user_id = pg_temp.uid('u1') and amount = 300),
                'no window started (never saw the offer): nothing paid');

rollback;
