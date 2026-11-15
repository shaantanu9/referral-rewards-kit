-- Rewards engine: tracking, streaks, milestones, grants exactly once, caps and retries (ADR 0002 6.1, 6.2, 7).
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u values ('a', gen_random_uuid()), ('b', gen_random_uuid()), ('c', gen_random_uuid());
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;

-- the app's ledger and grant hook (idempotent on grant_id), with a switch to make it fail
create table public.app_coins (grant_id uuid primary key, user_id uuid, kind text, amount numeric);
create table public.app_fail (on_ boolean);
insert into public.app_fail values (false);
grant select, insert on public.app_coins, public.app_fail to postgres;
create or replace function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select on_ from public.app_fail) then raise exception 'app ledger offline'; end if;
  if kind not in ('coins', 'minutes') then raise exception 'no kind %', kind; end if;
  insert into public.app_coins values (grant_id, user_id, kind, amount) on conflict do nothing;
end $$;

insert into rewards.event_types (name, source, daily_limit) values ('chapter_read', 'client', 50), ('quiz_done', 'client', 3),
  ('purchase_made', 'server', 50);
insert into rewards.programs (key, kind, config) values
  ('daily', 'streak', '{"event":"chapter_read","max_freezes":2}'),
  ('reader', 'milestone', '{"event":"chapter_read"}');
insert into rewards.rules (program_key, threshold, repeat, kind, amount, params) values
  ('daily', 2, 'once', 'coins', 20, '{}'),
  ('daily', 3, 'each_cycle', 'badge', 1, '{"badge":"three_day"}'),
  ('daily', 2, 'every', 'streak_freeze', 1, '{}'),
  ('reader', 3, 'once', 'minutes', 30, '{}'),
  ('reader', 2, 'every', 'coins', 5, '{}');

-- one simulated day passing for a user's streak
create function pg_temp.yesterday(n text) returns void language sql as $$
  update rewards.streaks set last_day = last_day - 1 where user_id = pg_temp.uid(n) and program_key = 'daily' $$;
create function pg_temp.read(n text, k text) returns jsonb language sql as $$
  select rewards.track(pg_temp.uid(n), 'chapter_read', k, '{}', 'Asia/Kolkata', false) $$;

-- first event
create temp table r1 as select pg_temp.read('a', 'ch1') j;
select tests.ok((select (j ->> 'duplicate')::boolean = false from r1), 'first event is new');
select tests.ok((select (j -> 'streaks' -> 0 ->> 'current')::int = 1 from r1), 'streak starts at 1');
select tests.ok((select timezone from rewards.members where user_id = pg_temp.uid('a')) = 'Asia/Kolkata', 'member timezone stored');
select tests.ok((select count from rewards.counters where user_id = pg_temp.uid('a') and program_key = 'reader') = 1,
                'milestone counter 1');

-- same dedupe key again: nothing changes
select tests.ok((pg_temp.read('a', 'ch1') ->> 'duplicate')::boolean, 'same dedupe key is a duplicate');
select tests.ok((select count from rewards.counters where user_id = pg_temp.uid('a')) = 1, 'duplicate does not count');

-- a second chapter the same day counts for the milestone, not the streak
create temp table r2 as select pg_temp.read('a', 'ch2') j;
select tests.ok((select jsonb_array_length(j -> 'streaks') = 0 from r2), 'same day does not move the streak');
select tests.ok((select count(*) = 1 from r2, jsonb_array_elements(j -> 'grants') g where g ->> 'kind' = 'coins'
                 and (g ->> 'amount')::numeric = 5), 'milestone every 2 grants 5 coins at count 2');

-- day 2: streak 2 → once coins 20 and every-2 freeze
select pg_temp.yesterday('a');
create temp table r3 as select pg_temp.read('a', 'ch3') j;
select tests.ok((select (j -> 'streaks' -> 0 ->> 'current')::int = 2 from r3), 'next day: streak 2');
select tests.ok((select count(*) = 1 from r3, jsonb_array_elements(j -> 'grants') g where g ->> 'kind' = 'coins'
                 and (g ->> 'amount')::numeric = 20), 'day 2 grants the once reward');
select tests.ok((select freezes from rewards.streaks where user_id = pg_temp.uid('a')) = 1, 'every-2 freeze granted (kit kind)');
select tests.ok((select count(*) from rewards.grants where user_id = pg_temp.uid('a') and state = 'granted') = 4,
                'all grants so far granted (milestone 5 coins, 30 min at count 3, 20 coins, freeze)');
select tests.ok((select count(*) from public.app_coins where user_id = pg_temp.uid('a')) = 3, 'app hook ran for app kinds only');

-- day 3: badge
select pg_temp.yesterday('a');
select pg_temp.read('a', 'ch4');
select tests.ok(exists (select 1 from rewards.badges where user_id = pg_temp.uid('a') and badge = 'three_day'), 'day 3 badge');

-- miss one day: the freeze covers it
update rewards.streaks set last_day = last_day - 2 where user_id = pg_temp.uid('a');
create temp table r5 as select pg_temp.read('a', 'ch5') j;
select tests.ok((select (j -> 'streaks' -> 0 ->> 'current')::int = 4 from r5), 'one missed day covered by a freeze');
select tests.ok((select freezes from rewards.streaks where user_id = pg_temp.uid('a')) = 1,
                'freeze spent, and day 4 (every 2) adds one back');

-- miss three days with one freeze: reset, new cycle
update rewards.streaks set last_day = last_day - 4 where user_id = pg_temp.uid('a');
create temp table r6 as select pg_temp.read('a', 'ch6') j;
select tests.ok((select (j -> 'streaks' -> 0 ->> 'current')::int = 1 and (j -> 'streaks' -> 0 ->> 'cycle')::int = 2 from r6),
                'gap larger than freezes: streak resets to 1 in cycle 2');
select tests.ok((select longest from rewards.streaks where user_id = pg_temp.uid('a')) = 4, 'longest kept');
-- the each_cycle badge can be earned again in cycle 2, the once coins cannot
select pg_temp.yesterday('a'); select pg_temp.read('a', 'ch7');
select pg_temp.yesterday('a'); select pg_temp.read('a', 'ch8');
select tests.ok((select count(*) from rewards.grants where user_id = pg_temp.uid('a') and kind = 'badge') = 2,
                'each_cycle badge granted again in the new cycle (one badge row: same name)');
select tests.ok((select count(*) from rewards.grants where user_id = pg_temp.uid('a') and kind = 'coins' and amount = 20) = 1,
                'once reward never granted twice');

-- the "fixed key" bug cannot happen: a second user earns the same reward
select pg_temp.read('b', 'x1'); select pg_temp.yesterday('b'); select pg_temp.read('b', 'x2');
select tests.ok((select count(*) from rewards.grants where kind = 'coins' and amount = 20) = 2,
                'two users both earn the day-2 reward (grant key holds the user id)');

-- a new rule version for the same reward never pays twice
update rewards.rules set active = false where program_key = 'daily' and threshold = 2 and repeat = 'once';
insert into rewards.rules (program_key, version, threshold, kind, amount) values ('daily', 2, 2, 'coins', 20);
update rewards.streaks set last_day = last_day - 5, current = 1 where user_id = pg_temp.uid('b');
select pg_temp.read('b', 'x3');
update rewards.streaks set last_day = last_day - 1 where user_id = pg_temp.uid('b');
select pg_temp.read('b', 'x4');
select tests.ok((select count(*) from rewards.grants where user_id = pg_temp.uid('b') and kind = 'coins' and amount = 20) = 1,
                'version 2 of the day-2 reward does not pay a user who got version 1');

-- streak state as the app shows it
create temp table sj as select rewards.streak_json(pg_temp.uid('a'), p) j from rewards.programs p where p.key = 'daily';
select tests.ok((select (j ->> 'today_done')::boolean from sj), 'today_done after an event today');
select tests.ok((select (j ->> 'breaks_at')::timestamptz > (j ->> 'ends_today_at')::timestamptz from sj),
                'breaks_at is after tonight when today is done');
select tests.ok((select j -> 'next_reward' is not null from sj), 'next reward shown');
-- a streak broken long ago shows 0
update rewards.streaks set last_day = last_day - 30 where user_id = pg_temp.uid('a');
select tests.ok((select (rewards.streak_json(pg_temp.uid('a'), p) ->> 'current')::int = 0 from rewards.programs p where p.key = 'daily'),
                'a broken streak shows current 0');

-- server-only events and limits
do $$ begin
  perform rewards.track(pg_temp.uid('a'), 'purchase_made', 'p1', '{}', null, false);
  raise exception 'client sent a server event';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: server_only_event', 'client cannot send a server event');
end $$;
select tests.ok((rewards.track(pg_temp.uid('a'), 'purchase_made', 'p1', '{}', null, true) ->> 'duplicate')::boolean = false,
                'service role can send a server event');
do $$ begin
  perform rewards.track(pg_temp.uid('a'), 'no_such', null, '{}', null, false);
  raise exception 'unknown event accepted';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: unknown_event', 'unknown event refused');
end $$;
do $$ begin
  for i in 1..10 loop perform rewards.track(pg_temp.uid('c'), 'quiz_done', 'lim' || i, '{}', null, false); end loop;
  raise exception 'daily limit not enforced';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: daily_limit', 'daily_limit per event type enforced');
end $$;
select tests.ok((rewards.track(pg_temp.uid('c'), 'chapter_read', 'tz1', '{}', 'Not/AZone', false) ->> 'duplicate') = 'false'
                and not exists (select 1 from rewards.members where user_id = pg_temp.uid('c') and timezone = 'Not/AZone'),
                'an invalid timezone never errors and is not stored');

-- timezone changes at most once per 24 h
select rewards.member_timezone(pg_temp.uid('a'), 'Europe/London');
select tests.ok((select timezone from rewards.members where user_id = pg_temp.uid('a')) = 'Asia/Kolkata',
                'timezone change within 24 h ignored');
update rewards.members set timezone_set_at = now() - interval '25 hours' where user_id = pg_temp.uid('a');
select rewards.member_timezone(pg_temp.uid('a'), 'Europe/London');
select tests.ok((select timezone from rewards.members where user_id = pg_temp.uid('a')) = 'Europe/London',
                'timezone change after 24 h stored');

-- failing hook: kept, retried, then granted exactly once
update public.app_fail set on_ = true;
insert into rewards.programs (key, kind, config) values ('buyer', 'milestone', '{"event":"purchase_made"}');
insert into rewards.rules (program_key, threshold, kind, amount) values ('buyer', 1, 'coins', 50);
select rewards.track(pg_temp.uid('b'), 'purchase_made', 'p9', '{}', null, true);
select tests.ok((select state = 'failed_retryable' and attempts = 1 and last_error like '%offline%'
                 from rewards.grants where program_key = 'buyer'), 'hook failure kept as failed_retryable');
update public.app_fail set on_ = false;
select tests.ok(rewards.retry_local() >= 1, 'retry_local grants it');
select tests.ok((select state = 'granted' from rewards.grants where program_key = 'buyer'), 'granted after retry');
select tests.ok((select count(*) from public.app_coins where grant_id = (select id from rewards.grants where program_key = 'buyer')) = 1,
                'app ledger has it once');
-- max attempts
update public.app_fail set on_ = true;
update rewards.settings set max_attempts = 2;
select rewards.track(pg_temp.uid('c'), 'purchase_made', 'p10', '{}', null, true);
select rewards.retry_local();
select tests.ok((select state from rewards.grants where program_key = 'buyer' and user_id = pg_temp.uid('c')) = 'failed',
                'failed after max_attempts');
update public.app_fail set on_ = false;

-- daily cap
update rewards.settings set daily_grant_cap = (select count(*) from rewards.grants);
insert into rewards.rules (program_key, threshold, repeat, kind, amount) values ('buyer', 1, 'every', 'minutes', 5);
select rewards.track(pg_temp.uid('c'), 'purchase_made', 'p11', '{}', null, true);
select tests.ok(exists (select 1 from rewards.grants where state = 'skipped_cap'), 'over the daily cap: skipped_cap');
update rewards.settings set daily_grant_cap = 1000;

-- disabled engine: tracking is a harmless no-op
update rewards.settings set enabled = false;
select tests.ok((pg_temp.read('c', 'off1') ->> 'enabled')::boolean = false, 'disabled engine: track returns enabled false');
select tests.ok(not exists (select 1 from rewards.events where dedupe_key = 'off1'), 'disabled engine stores nothing');
update rewards.settings set enabled = true;

-- through the public API as the user
select tests.act_as('authenticated', pg_temp.uid('c'));
select tests.ok((public.rewards_track('chapter_read', 'api1', '{}', 'UTC') ->> 'duplicate')::boolean = false,
                'rewards_track works for a signed-in user');
reset role;

rollback;
