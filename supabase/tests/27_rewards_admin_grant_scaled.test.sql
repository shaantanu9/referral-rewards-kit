-- Rewards 0.6 (ADR 0002 18.9): score-scaled rewards (amount_from / amount_max), the manual compensation grant
-- (rewards_admin_grant) and rewards.privacy_problems() with the function grants probe.
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u select n, gen_random_uuid() from unnest(array['a', 'b', 'q', 'adm', 'kid']) n;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to authenticated, service_role, anon;
insert into auth.users (id, email) select id, name || '@example.test' from u;
insert into rewards.admins (user_id) values (pg_temp.uid('adm'));
create table public.app_coins (grant_id uuid primary key, user_id uuid, kind text, amount numeric);
grant select, insert on public.app_coins to postgres;
create or replace function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_coins values (grant_id, user_id, kind, amount) on conflict do nothing;
end $$;
revoke execute on function rewards_app.app_reward_grant(uuid, uuid, text, numeric, jsonb) from public, anon, authenticated, service_role;
insert into rewards.event_types (name, source, daily_limit) values ('lesson_done', 'client', 1000);
insert into rewards.programs (key, kind, config) values
  ('scored', 'milestone', '{"event":"lesson_done"}'),
  ('welcome', 'offer', '{"window_minutes":60}'),
  ('daily', 'streak', '{"event":"lesson_done"}');

-- 1. scaled rule checks ---------------------------------------------------------------------------------------------
create function pg_temp.refused(prog text, kind text, amount numeric, params jsonb, thr int default 1) returns boolean
language plpgsql as $$
begin
  insert into rewards.rules (program_key, threshold, repeat, kind, amount, params)
  values (prog, thr, case when thr is null then 'once' else 'every' end, kind, amount, params);
  return false;
exception when sqlstate '22023' then return true;
end $$;
select tests.ok(pg_temp.refused('scored', 'coins', 2, '{"amount_from":"correct"}'), 'amount_from needs amount_max');
select tests.ok(pg_temp.refused('scored', 'coins', 2, '{"amount_max":30}'), 'amount_max alone is refused');
select tests.ok(pg_temp.refused('scored', 'coins', 2, '{"amount_from":"bad name","amount_max":30}'), 'a prop name is letters, digits, _');
select tests.ok(pg_temp.refused('scored', 'coins', 2, '{"amount_from":7,"amount_max":30}'), 'amount_from is a string');
select tests.ok(pg_temp.refused('scored', 'coins', 2, '{"amount_from":"correct","amount_max":2.5}'), 'amount_max is whole');
select tests.ok(pg_temp.refused('scored', 'badge', 1, '{"amount_from":"correct","amount_max":3,"badge":"x_y"}'), 'not on a badge');
select tests.ok(pg_temp.refused('scored', 'coins', 30, '{"amount_from":"correct","amount_max":30,"amount_range":[1,30]}'),
                'not with amount_range');
select tests.ok(pg_temp.refused('welcome', 'coins', 2, '{"amount_from":"correct","amount_max":30}', null),
                'not on a program without a triggering event (offer)');

-- 2. scaled grants: amount = floor(prop) * amount, capped; never a bad prop ----------------------------------------
insert into rewards.rules (program_key, threshold, repeat, kind, amount, params)
values ('scored', 1, 'every', 'coins', 2, '{"amount_from":"correct","amount_max":30}');
-- every grant of one transaction has the same created_at: find the n-th milestone grant by its key
create function pg_temp.nth(n text, k int) returns rewards.grants language sql as $$
  select * from rewards.grants g where g.grant_key = rewards.grant_key('scored', 1, 'coins', pg_temp.uid(n), 'n' || k) $$;
create function pg_temp.grants_of(n text) returns int language sql as $$
  select count(*)::int from rewards.grants g where g.user_id = pg_temp.uid(n) $$;

select rewards.track(pg_temp.uid('a'), 'lesson_done', 'l1', '{"correct":7}', null, false);
select tests.ok((pg_temp.nth('a', 1)).amount = 14 and (pg_temp.nth('a', 1)).state = 'granted',
                '7 correct x 2 = 14 coins, granted through the hook');
select tests.ok((pg_temp.nth('a', 1)).params -> 'scaled' = '{"from":"correct","value":7}', 'the grant says what it was scaled by');
select tests.ok((select amount from public.app_coins where grant_id = (pg_temp.nth('a', 1)).id) = 14, 'the hook got 14');
select tests.ok((select count(*) from rewards.grants g where g.user_id = pg_temp.uid('a') and g.grant_key = 'scored:t1:coins:' || pg_temp.uid('a') || ':n1') = 1,
                'the grant key is the usual one (program, threshold, kind, user, count)');
select tests.ok(coalesce(current_setting('rewards.event_props', true), '') = '', 'track leaves no event props behind');
select rewards.track(pg_temp.uid('a'), 'lesson_done', 'l1', '{"correct":99}', null, false);
select tests.ok(pg_temp.grants_of('a') = 1, 'a replayed event pays nothing more');
select rewards.track(pg_temp.uid('a'), 'lesson_done', 'l2', '{"correct":100}', null, false);
select tests.ok((pg_temp.nth('a', 2)).amount = 30, 'capped at amount_max');
select rewards.track(pg_temp.uid('a'), 'lesson_done', 'l3', '{"correct":4.9}', null, false);
select tests.ok((pg_temp.nth('a', 3)).amount = 8, 'a fraction is rounded down (4.9 -> 4 x 2)');
select rewards.track(pg_temp.uid('a'), 'lesson_done', 'l4', '{"correct":"5"}', null, false);
select tests.ok((pg_temp.nth('a', 4)).amount = 10, 'a numeric string counts');
select rewards.track(pg_temp.uid('a'), 'lesson_done', 'l5', '{"correct":-3}', null, false);
select rewards.track(pg_temp.uid('a'), 'lesson_done', 'l6', '{"correct":"lots"}', null, false);
select rewards.track(pg_temp.uid('a'), 'lesson_done', 'l7', '{}', null, false);
select rewards.track(pg_temp.uid('a'), 'lesson_done', 'l8', '{"correct":0}', null, false);
select rewards.track(pg_temp.uid('a'), 'lesson_done', 'l9', '{"correct":0.5}', null, false);
select tests.ok(pg_temp.grants_of('a') = 4, 'negative, non-numeric, missing, zero and below one pay nothing');
select tests.ok((select c.count from rewards.counters c where c.user_id = pg_temp.uid('a') and c.program_key = 'scored') = 9,
                'the milestone still counts every event');
select tests.ok((select string_agg(g.grant_key, ',') from rewards.grants g where g.user_id = pg_temp.uid('a') and g.grant_key like '%:n5') is null,
                'a skipped grant leaves no row');

-- a nested event (an app hook that tracks) does not wipe the outer event's props
insert into rewards.event_types (name, source, daily_limit) values ('coins_got', 'server', 1000);
create or replace function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_coins values (grant_id, user_id, kind, amount) on conflict do nothing;
  perform rewards.track(user_id, 'coins_got', grant_id::text, '{}', null, true);
end $$;
insert into rewards.rules (program_key, threshold, repeat, kind, amount, params)
values ('daily', 1, 'every', 'coins', 1, '{"amount_from":"correct","amount_max":50}');
select rewards.track(pg_temp.uid('b'), 'lesson_done', 'n1', '{"correct":6}', null, false);
select tests.ok((select string_agg(g.program_key || '=' || g.amount, ',' order by g.program_key) from rewards.grants g
                  where g.user_id = pg_temp.uid('b')) = 'daily=6,scored=12',
                'both programs read the same event after a nested track in the hook');

-- quiz tiers scale with the score
insert into rewards.quiz_questions (bank, kind, prompt, choices, answer, time_limit_s)
select 'scaled', 'true_false', 'True ' || g, '["True","False"]', 0, 30 from generate_series(1, 3) g;
insert into rewards.programs (key, kind, config) values ('qz', 'quiz', '{"bank":"scaled","questions":3}');
insert into rewards.rules (program_key, threshold, kind, amount, params)
values ('qz', 1, 'coins', 5, '{"amount_from":"score","amount_max":100}');
select rewards.quiz_start(pg_temp.uid('q'), 'qz');
select rewards.quiz_question(pg_temp.uid('q'), 'qz');
select rewards.quiz_answer(pg_temp.uid('q'), 'qz', 0, 0);
select rewards.quiz_question(pg_temp.uid('q'), 'qz');
select rewards.quiz_answer(pg_temp.uid('q'), 'qz', 1, 1);
select rewards.quiz_question(pg_temp.uid('q'), 'qz');
select tests.ok(((rewards.quiz_answer(pg_temp.uid('q'), 'qz', 2, 0)) -> 'grants' -> 0 ->> 'amount')::numeric = 10,
                'a quiz tier with amount_from score: 2 right x 5 = 10');
select tests.ok(coalesce(current_setting('rewards.event_props', true), '') = '', 'quiz_answer leaves no event props behind');

-- 3. manual compensation grant -------------------------------------------------------------------------------------
create or replace function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_coins values (grant_id, user_id, kind, amount) on conflict do nothing;
end $$;

select tests.act_as('anon');
do $$ begin
  perform public.rewards_admin_grant(gen_random_uuid(), 'coins', 5, '{}', 'x');
  raise exception 'anon granted';
exception when insufficient_privilege then perform tests.ok(true, 'anon cannot call rewards_admin_grant');
end $$;
reset role;
select tests.act_as('authenticated', pg_temp.uid('a'));
do $$ begin
  perform public.rewards_admin_grant(pg_temp.uid('a'), 'coins', 500, '{}', 'self service');
  raise exception 'non-admin granted';
exception when insufficient_privilege then perform tests.ok(sqlerrm = 'rewards: not_admin', 'a non-admin is refused');
end $$;
reset role;

select tests.act_as('authenticated', pg_temp.uid('adm'));
create temp table mg as select public.rewards_admin_grant(pg_temp.uid('kid'), 'coins', 25,
  '{"request_id":"req-0001-aaaa"}', 'Compensation for the outage on 12 Nov') j;
grant select on mg to postgres;
select tests.ok((select j ->> 'state' = 'granted' and (j ->> 'amount')::numeric = 25 and j ->> 'rule_id' is null
                        and j ->> 'program_key' is null and j ->> 'grant_key' like 'admin/%' and (j -> 'params' ->> 'manual')::boolean
                        and not (j -> 'params' ? 'request_id') and not (j ->> 'duplicate')::boolean from mg),
                'coins granted at once: no rule, admin/ key, marked manual');
select tests.ok((select j ->> 'grant_key' from mg) = 'admin/' || pg_temp.uid('kid') || '/req-0001-aaaa', 'the key carries the request id');
select tests.ok((public.rewards_admin_grant(pg_temp.uid('kid'), 'coins', 25, '{"request_id":"req-0001-aaaa"}', 'again')
                 ->> 'duplicate')::boolean, 'the same request id is a duplicate');
create temp table ent as select public.rewards_admin_grant(pg_temp.uid('kid'), 'entitlement_days', 3,
  '{"entitlement_id":"premium"}', 'Missed trial days') j;
grant select on ent to postgres;
select tests.ok((select j ->> 'state' from ent) = 'queued', 'entitlement_days waits for the worker');
select public.rewards_admin_grant(pg_temp.uid('kid'), 'badge', 1, '{"badge":"founder","program":"scored"}', 'Early supporter');
select public.rewards_admin_grant(pg_temp.uid('kid'), 'streak_freeze', 1, '{"program":"daily"}', 'App crashed');

create function pg_temp.grant_refused(k text, amt int, prm jsonb, note text, who uuid default null) returns text
language plpgsql as $$
begin
  perform public.rewards_admin_grant(coalesce(who, pg_temp.uid('kid')), k, amt, prm, note);
  return 'accepted';
exception when sqlstate '22023' then return split_part(split_part(sqlerrm, 'rewards: ', 2), ' ', 1);
end $$;
select tests.ok(pg_temp.grant_refused('coins', 5, '{}', '  ') = 'note_required', 'a note is required');
select tests.ok(pg_temp.grant_refused('coins', 0, '{}', 'n') = 'bad_amount', 'amount at least 1');
select tests.ok(pg_temp.grant_refused('coins', 2000000, '{}', 'n') = 'bad_amount', 'amount at most 1000000');
select tests.ok(pg_temp.grant_refused('mystery', 1, '{}', 'n') = 'bad_kind', 'no mystery by hand');
select tests.ok(pg_temp.grant_refused('Coins!', 1, '{}', 'n') = 'bad_kind', 'kind is a lower-case name');
select tests.ok(pg_temp.grant_refused('entitlement_days', 1, '{}', 'n') = 'bad_params', 'entitlement_days needs entitlement_id');
select tests.ok(pg_temp.grant_refused('badge', 1, '{"badge":"x_y"}', 'n') = 'bad_params', 'a badge needs a program');
select tests.ok(pg_temp.grant_refused('streak_freeze', 1, '{"program":"scored"}', 'n') = 'bad_params', 'a freeze needs a streak');
select tests.ok(pg_temp.grant_refused('coins', 1, '{"program":"nope"}', 'n') = 'unknown_program', 'an unknown program is refused');
select tests.ok(pg_temp.grant_refused('coins', 1, '{"request_id":"x"}', 'n') = 'bad_params', 'a request id is 8-64 safe characters');
select tests.ok(pg_temp.grant_refused('coins', 1, '{}', 'n', gen_random_uuid()) = 'unknown_user', 'an unknown user is refused');
reset role;

select tests.ok((select count(*) from public.app_coins c where c.user_id = pg_temp.uid('kid') and c.kind = 'coins') = 1,
                'the app hook paid the coins once');
select tests.ok(exists (select 1 from rewards.badges b where b.user_id = pg_temp.uid('kid') and b.badge = 'founder' and b.program_key = 'scored'),
                'a manual badge lands in badges');
select tests.ok((select s.freezes from rewards.streaks s where s.user_id = pg_temp.uid('kid') and s.program_key = 'daily') = 1,
                'a manual streak freeze lands on the streak');
select tests.ok((select count(*) from rewards.admin_log l where l.action = 'grant' and l.actor = pg_temp.uid('adm')) = 4
                and exists (select 1 from rewards.admin_log l where l.action = 'grant'
                              and l.detail ->> 'note' = 'Compensation for the outage on 12 Nov' and (l.detail ->> 'amount')::int = 25),
                'every new manual grant is in the audit log with its note (a duplicate is not)');
select tests.ok(exists (select 1 from jsonb_array_elements(rewards.claim_grants(10)) c
                         where c ->> 'grant_id' = (select j ->> 'id' from ent) and (c ->> 'days')::int = 3
                           and c ->> 'entitlement_id' = 'premium'),
                'the worker claims the manual entitlement_days like any other');
select tests.ok(exists (select 1 from jsonb_array_elements(rewards.state(pg_temp.uid('kid'), false) -> 'inbox') i
                         where i ->> 'id' = (select j ->> 'id' from mg)),
                'the user sees the manual grant in the inbox');
do $$ begin
  insert into rewards.grants (user_id, grant_key, kind, amount) values (gen_random_uuid(), 'scored:t1:coins:x', 'coins', 1);
  raise exception 'rule-less program-style grant accepted';
exception when check_violation then perform tests.ok(true, 'a grant without a rule must have an admin/ key');
end $$;
select tests.ok(not exists (select 1 from rewards.grants g where g.rule_id is not null and g.grant_key like 'admin/%'),
                'no program grant key starts with admin/');

-- 4. privacy problems and the probe --------------------------------------------------------------------------------
select tests.ok(not exists (select 1 from rewards.privacy_problems()), 'privacy_problems() is empty after all migrations');
select tests.ok(not has_function_privilege('authenticated', 'rewards.privacy_problems()', 'EXECUTE')
                and not has_function_privilege('service_role', 'rewards.privacy_problems()', 'EXECUTE'),
                'privacy_problems() itself is closed');
\ir ../probes/function_grants.sql
select tests.ok(not exists (select 1 from referral_function_grants where verdict = 'kit_exposed'), 'probe: no rewards function exposed');
select tests.ok(exists (select 1 from referral_function_grants where verdict = 'expected_rewards'
                         and function_signature = 'public.rewards_admin_grant(uuid,text,integer,jsonb,text)'),
                'probe: the new admin RPC is an expected rewards RPC');

create function pg_temp.has_problem(p text, obj text) returns boolean language sql as $$
  select exists (select 1 from rewards.privacy_problems() x where x.problem = p and x.object_name = obj) $$;

grant execute on function rewards.grant_local(uuid) to authenticated;
select tests.ok(pg_temp.has_problem('internal function executable', 'rewards.grant_local(uuid)'),
                'an internal function executable by authenticated is reported');
revoke execute on function rewards.grant_local(uuid) from authenticated;
grant execute on function rewards_app.app_is_paid(uuid) to public;
select tests.ok(exists (select 1 from rewards.privacy_problems() x where x.problem = 'internal function executable'
                          and x.role_name = 'PUBLIC' and x.object_name = 'rewards_app.app_is_paid(uuid)'),
                'a hook left executable by PUBLIC is reported');
revoke execute on function rewards_app.app_is_paid(uuid) from public;
grant usage on schema rewards to anon;
select tests.ok(pg_temp.has_problem('schema usage', 'rewards'), 'USAGE on schema rewards for anon is reported');
revoke usage on schema rewards from anon;
grant select on rewards.grants to authenticated;
select tests.ok(exists (select 1 from rewards.privacy_problems() x where x.problem = 'table access'
                          and x.role_name = 'authenticated' and x.object_name = 'rewards.grants'),
                'a rewards table readable by authenticated is reported');
revoke select on rewards.grants from authenticated;
grant execute on function public.rewards_svc_retry_local() to authenticated;
select tests.ok(pg_temp.has_problem('service rpc executable by authenticated', 'public.rewards_svc_retry_local()'),
                'a service RPC callable by authenticated is reported');
select tests.ok(exists (select 1 from referral_function_grants where function_signature = 'public.rewards_svc_retry_local()'
                          and verdict = 'kit_exposed'), 'probe: the service RPC shows as kit_exposed');
revoke execute on function public.rewards_svc_retry_local() from authenticated;
grant execute on function public.rewards_admin_grant(uuid, text, integer, jsonb, text) to anon;
select tests.ok(pg_temp.has_problem('rpc executable by anon', 'public.rewards_admin_grant(uuid,text,integer,jsonb,text)'),
                'an admin RPC callable by anon is reported');
revoke execute on function public.rewards_admin_grant(uuid, text, integer, jsonb, text) from anon;
set local role postgres;
create function public.rewards_helper_oops() returns int language sql as $$ select 1 $$;
create function public.rewards_admin_oops() returns int language sql security definer set search_path = '' as $$ select 1 $$;
reset role;
select tests.ok(pg_temp.has_problem('rpc not security definer', 'public.rewards_helper_oops()')
                and pg_temp.has_problem('rpc without search_path', 'public.rewards_helper_oops()')
                and pg_temp.has_problem('rpc executable by PUBLIC', 'public.rewards_helper_oops()')
                and pg_temp.has_problem('rpc executable by anon', 'public.rewards_helper_oops()'),
                'a public.rewards_* helper made without the pattern is reported four ways');
select tests.ok(pg_temp.has_problem('admin rpc without require_admin', 'public.rewards_admin_oops()'),
                'an admin RPC that does not check require_admin is reported');
drop function public.rewards_helper_oops();
drop function public.rewards_admin_oops();
select tests.ok(not exists (select 1 from rewards.privacy_problems()), 'after the fixes nothing is reported');

rollback;
