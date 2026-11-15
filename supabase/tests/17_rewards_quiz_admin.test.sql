-- Rewards engine: quiz results from the app's own table, and the admin API (setup, checks, analytics, audit).
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u values ('admin', gen_random_uuid()), ('kid', gen_random_uuid()), ('other', gen_random_uuid());
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to authenticated, service_role;
create table public.app_coins (grant_id uuid primary key, user_id uuid, amount numeric);
grant select, insert on public.app_coins to postgres;
create or replace function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_coins values (grant_id, user_id, amount) on conflict do nothing;
end $$;

-- the app's own quiz table, as it already exists in the app
create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  quiz_id text not null,
  score numeric,
  completed_at timestamptz
);
grant select, insert, update on public.quiz_attempts to authenticated;

-- setup through the admin API, as the service role (bootstrapping the first admin)
-- PostgREST sends the service role key's claims: {"role": "service_role"}
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select tests.ok(public.rewards_admin_set_admin(pg_temp.uid('admin'), true), 'service role adds the first admin');
reset role;

select tests.act_as('authenticated', pg_temp.uid('admin'));
select public.rewards_admin_save_event_type('quiz_completed', 'server', 100);
select public.rewards_admin_save_event_type('quiz_passed', 'server', 100);
select public.rewards_admin_save_event_type('quiz_first_pass', 'server', 100);
select public.rewards_admin_save_program('quiz_streak', 'streak', true, '{"event":"quiz_completed","max_freezes":1}', '{"title":"Daily quiz"}');
select public.rewards_admin_save_program('quiz_master', 'milestone', true, '{"event":"quiz_first_pass"}', '{"title":"Pass 3 different quizzes"}');
select public.rewards_admin_save_program('quiz_points', 'milestone', true, '{"event":"quiz_passed"}');
select public.rewards_admin_add_rule('quiz_streak', 'coins', 10, 2, 'every');
select public.rewards_admin_add_rule('quiz_master', 'badge', 1, 3, 'once', '{"badge":"quiz_master"}');
create temp table r1 as select public.rewards_admin_add_rule('quiz_points', 'coins', 5, 1, 'every') j;
select tests.ok((select (j ->> 'version')::int = 1 from r1), 'first rule of a program is version 1');
select tests.ok((public.rewards_admin_add_rule('quiz_points', 'coins', 6, 1, 'every') ->> 'version')::int = 2, 'next rule is version 2');
select public.rewards_admin_set_rule_active(((select j ->> 'id' from r1))::uuid, false);
create temp table cfg as select public.rewards_admin_config() j;
select tests.ok((select jsonb_array_length(j -> 'programs') = 3 and jsonb_array_length(j -> 'event_types') >= 3 from cfg),
                'config lists programs and event types');
select tests.ok((select jsonb_array_length(p -> 'rules') = 2 and (p ->> 'live')::boolean
                 from cfg, jsonb_array_elements(j -> 'programs') p where p ->> 'key' = 'quiz_points'), 'program carries its rules and live flag');
do $$ begin
  perform public.rewards_admin_save_settings('{"daily_grant_capp": 5}');
  raise exception 'typo accepted';
exception when sqlstate '22023' then perform tests.ok(sqlerrm like 'rewards: unknown_setting%', 'unknown setting key refused');
end $$;
select tests.ok((public.rewards_admin_save_settings('{"daily_grant_cap": 900}') ->> 'daily_grant_cap')::int = 900, 'settings saved');
reset role;

-- the app links its quiz table: completed (any score), passed (score >= 0.8), first pass of each quiz (dedupe quiz_id)
create trigger rewards_quiz_completed after insert or update of completed_at on public.quiz_attempts
  for each row when (new.completed_at is not null)
  execute function rewards.event_from_row('quiz_completed', 'user_id', 'id', 'quiz_id,score');
create trigger rewards_quiz_passed after insert or update of completed_at on public.quiz_attempts
  for each row when (new.completed_at is not null and new.score >= 0.8)
  execute function rewards.event_from_row('quiz_passed', 'user_id', 'id');
create trigger rewards_quiz_first_pass after insert or update of completed_at on public.quiz_attempts
  for each row when (new.completed_at is not null and new.score >= 0.8)
  execute function rewards.event_from_row('quiz_first_pass', 'user_id', 'quiz_id');

-- the kid takes quizzes as a signed-in user, through the app's normal insert
select tests.act_as('authenticated', pg_temp.uid('kid'));
insert into public.quiz_attempts (user_id, quiz_id, score, completed_at) values (pg_temp.uid('kid'), 'q1', 0.5, now());
insert into public.quiz_attempts (user_id, quiz_id, score) values (pg_temp.uid('kid'), 'q2', 0.9);
reset role;
select tests.ok((select count(*) from rewards.events where user_id = pg_temp.uid('kid') and type = 'quiz_completed') = 1,
                'a completed quiz becomes an event; an unfinished one does not');
select tests.ok((select props ->> 'quiz_id' = 'q1' and (props ->> 'score')::numeric = 0.5
                 from rewards.events where user_id = pg_temp.uid('kid') and type = 'quiz_completed'), 'props copied from the row');
select tests.ok(not exists (select 1 from rewards.events where user_id = pg_temp.uid('kid') and type = 'quiz_passed'),
                'a failed quiz is not a pass');
-- finishing q2 later (update) counts once
update public.quiz_attempts set completed_at = now() where quiz_id = 'q2';
update public.quiz_attempts set completed_at = now() where quiz_id = 'q2';
select tests.ok((select count(*) from rewards.events where user_id = pg_temp.uid('kid') and type = 'quiz_passed') = 1,
                'an update trigger counts the same attempt once');
-- pass q2 again and q3, q4: three different quizzes passed → badge; quiz_points every 1 → coins each pass
insert into public.quiz_attempts (user_id, quiz_id, score, completed_at) values
  (pg_temp.uid('kid'), 'q2', 1, now()), (pg_temp.uid('kid'), 'q3', 0.8, now()), (pg_temp.uid('kid'), 'q4', 0.95, now());
select tests.ok((select count from rewards.counters where user_id = pg_temp.uid('kid') and program_key = 'quiz_master') = 3,
                'first pass counted per quiz: q2 twice counts once');
select tests.ok(exists (select 1 from rewards.badges where user_id = pg_temp.uid('kid') and badge = 'quiz_master'), 'quiz master badge');
select tests.ok((select count(*) from rewards.grants where user_id = pg_temp.uid('kid') and program_key = 'quiz_points') = 4
                and (select bool_and(amount = 6) from rewards.grants where user_id = pg_temp.uid('kid') and program_key = 'quiz_points'),
                'every pass pays the active rule (version 2: 6 coins)');
-- quiz streak: day 2 pays 10 coins (every 2)
update rewards.streaks set last_day = last_day - 1 where user_id = pg_temp.uid('kid') and program_key = 'quiz_streak';
insert into public.quiz_attempts (user_id, quiz_id, score, completed_at) values (pg_temp.uid('kid'), 'q5', 0.1, now());
select tests.ok((select current from rewards.streaks where user_id = pg_temp.uid('kid') and program_key = 'quiz_streak') = 2
                and exists (select 1 from rewards.grants where user_id = pg_temp.uid('kid') and program_key = 'quiz_streak'),
                'quiz streak: completing a quiz on the next day pays the day-2 reward');

-- a broken rewards side never blocks the app's quiz insert
update rewards.event_types set daily_limit = 1 where name = 'quiz_completed';
insert into public.quiz_attempts (user_id, quiz_id, score, completed_at) values (pg_temp.uid('kid'), 'q6', 0.2, now());
select tests.ok(exists (select 1 from public.quiz_attempts where quiz_id = 'q6'), 'quiz insert succeeds even when tracking fails');
update rewards.event_types set daily_limit = 100 where name = 'quiz_completed';

-- the kid sees it in their own state
select tests.act_as('authenticated', pg_temp.uid('kid'));
create temp table ks as select public.rewards_state() j;
select tests.ok((select j -> 'milestones' @> '[{"program":"quiz_master","count":3}]' from ks), 'user state shows quiz progress');
reset role;

-- admin checks --------------------------------------------------------------------------------------------------------
select tests.act_as('authenticated', pg_temp.uid('admin'));
create temp table au as select public.rewards_admin_user(pg_temp.uid('kid')) j;
select tests.ok((select jsonb_array_length(j -> 'grants') >= 6 and j -> 'events' @> '[{"type":"quiz_passed","count":4}]' from au),
                'admin user view: grants and event counts');
select tests.ok((select not (j -> 'grants' -> 0 ? 'attempt_token') from au), 'admin user view never shows lease tokens');
select tests.ok((public.rewards_admin_track(pg_temp.uid('other'), 'quiz_passed') ->> 'duplicate') = 'false',
                'admin can fire a test event for a user, server types included');
select tests.ok(jsonb_array_length(public.rewards_admin_grants('granted', 'quiz_points', 10)) = 5, 'grant list filters by state and program');
reset role;

-- retry a failed grant
update rewards.grants set state = 'failed', attempts = 8, last_error = 'boom'
 where id = (select id from rewards.grants where user_id = pg_temp.uid('other') limit 1);
create temp table fg as select id from rewards.grants where state = 'failed' limit 1;
grant select on fg to authenticated;
select tests.act_as('authenticated', pg_temp.uid('admin'));
select tests.ok((select (public.rewards_admin_retry_grant(id) ->> 'state') = 'granted' from fg),
                'admin retry of a failed local grant grants it');
do $$ begin
  perform public.rewards_admin_retry_grant(gen_random_uuid());
  raise exception 'retry of unknown grant';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: not_retryable', 'retry refuses what is not failed');
end $$;

-- analytics
create temp table an as select public.rewards_admin_analytics(7) j;
select tests.ok((select j ?& array['daily', 'events_by_type', 'grants_by_program', 'streaks', 'milestones', 'offers', 'social', 'open_problems'] from an),
                'analytics has every section');
select tests.ok((select (d ->> 'active_users')::int = 2 from an, jsonb_array_elements(j -> 'daily') d limit 1), 'daily active users');
select tests.ok((select j -> 'events_by_type' @> '[{"type":"quiz_passed","events":5,"users":2}]' from an), 'events by type');
select tests.ok((select j -> 'streaks' @> '[{"program":"quiz_streak","bucket":"2-3","users":1}]' from an), 'streak buckets');
select tests.ok((select j::text !~ (select id::text from u where name = 'kid') from an), 'analytics never contains a user id');
select tests.ok(jsonb_array_length(public.rewards_admin_log(50)) >= 10, 'every admin change is in the audit log');
select tests.ok((select (l ->> 'actor')::uuid = pg_temp.uid('admin') from jsonb_array_elements(public.rewards_admin_log(50)) l
                 where l ->> 'action' = 'retry_grant'), 'audit log records who');
do $$ begin
  perform public.rewards_admin_set_admin(pg_temp.uid('admin'), false);
  raise exception 'removed self';
exception when sqlstate '22023' then perform tests.ok(true, 'an admin cannot remove themselves');
end $$;
reset role;

-- not an admin
do $$ begin
  perform tests.act_as('authenticated', pg_temp.uid('kid'));
  perform public.rewards_admin_analytics(7);
  raise exception 'non-admin read analytics';
exception when sqlstate '42501' then perform tests.ok(sqlerrm = 'rewards: not_admin', 'a normal user gets not_admin');
end $$;
reset role;
do $$ begin
  perform tests.act_as('authenticated', pg_temp.uid('kid'));
  perform public.rewards_admin_set_admin(pg_temp.uid('kid'), true);
  raise exception 'self-promotion';
exception when sqlstate '42501' then perform tests.ok(true, 'a normal user cannot make themselves admin');
end $$;
reset role;
select tests.ok(not has_function_privilege('anon', 'public.rewards_admin_analytics(integer)', 'EXECUTE'), 'anon cannot call admin functions');
select tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname = 'rewards' and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
                'still nothing in schema rewards is callable by authenticated');

-- the admin user view never starts an offer window
insert into rewards.programs (key, kind, config) values ('gift', 'offer', '{"window_minutes":60}');
select tests.act_as('authenticated', pg_temp.uid('admin'));
select public.rewards_admin_user(pg_temp.uid('other'));
reset role;
select tests.ok(not exists (select 1 from rewards.offer_windows where user_id = pg_temp.uid('other')), 'admin view does not start offers');

rollback;
