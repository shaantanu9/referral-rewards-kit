-- Rewards 0.2 kinds: quests, comeback, recharge, windows, friend streaks; history, recap, social link (ADR 0002 18.2-18.3).
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u select 'u' || g, gen_random_uuid() from generate_series(1, 8) g;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to authenticated;
create table public.app_coins (grant_id uuid primary key, user_id uuid, amount numeric);
grant select, insert on public.app_coins to postgres;
create or replace function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_coins values (grant_id, user_id, amount) on conflict do nothing;
end $$;
insert into rewards.event_types (name, source, daily_limit) values ('lesson', 'client', 100), ('share', 'client', 100),
  ('practice', 'client', 100);

-- quests --------------------------------------------------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values ('daily_q', 'quest_set',
  '{"reset":"daily","tasks":[{"key":"two_lessons","event":"lesson","count":2},{"key":"share_once","event":"share","count":1}]}');
insert into rewards.rules (program_key, kind, amount, params) values
  ('daily_q', 'coins', 10, '{"task":"two_lessons"}'), ('daily_q', 'coins', 5, '{"task":"share_once"}'), ('daily_q', 'coins', 25, '{}');
do $$ begin
  insert into rewards.rules (program_key, kind, amount, params) values ('daily_q', 'coins', 1, '{"task":"nope"}');
  raise exception 'unknown task accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'a rule for an unknown task is refused');
end $$;
select rewards.track(pg_temp.uid('u1'), 'lesson', 'l1', '{}', null, false);
create temp table q1 as select rewards.quest_json(pg_temp.uid('u1'), p) j from rewards.programs p where p.key = 'daily_q';
select tests.ok((select j -> 'tasks' -> 0 @> '{"key":"two_lessons","progress":1,"count":2,"done":false}' and not (j ->> 'done')::boolean from q1),
                'quest progress 1 of 2');
select rewards.track(pg_temp.uid('u1'), 'lesson', 'l2', '{}', null, false);
select rewards.track(pg_temp.uid('u1'), 'lesson', 'l3', '{}', null, false);
select tests.ok((select sum(amount) from public.app_coins where user_id = pg_temp.uid('u1')) = 10, 'task reward once, extra events do nothing');
select rewards.track(pg_temp.uid('u1'), 'share', 's1', '{}', null, false);
select tests.ok((select sum(amount) from public.app_coins where user_id = pg_temp.uid('u1')) = 40, 'second task + the all-done bonus');
select tests.ok((select (rewards.quest_json(pg_temp.uid('u1'), p) ->> 'done')::boolean from rewards.programs p where p.key = 'daily_q'),
                'quest set done today');
-- tomorrow is a new period: progress starts again and pays again
update rewards.quest_progress set period = (current_date - 1)::text where user_id = pg_temp.uid('u1');
update rewards.grants set grant_key = replace(grant_key, ':' || current_date::text, ':' || (current_date - 1)::text)
 where program_key = 'daily_q';
select rewards.track(pg_temp.uid('u1'), 'share', 's2', '{}', null, false);
select tests.ok((select sum(amount) from public.app_coins where user_id = pg_temp.uid('u1')) = 45, 'a new day pays the task again');

-- comeback ------------------------------------------------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values ('welcome_back', 'comeback', '{"event":"practice","after_days":7}');
insert into rewards.rules (program_key, kind, amount) values ('welcome_back', 'coins', 50);
select rewards.track(pg_temp.uid('u2'), 'practice', 'a', '{}', null, false);
select tests.ok(not exists (select 1 from public.app_coins where user_id = pg_temp.uid('u2')), 'the very first event is not a comeback');
update rewards.activity set last_at = now() - interval '3 days' where user_id = pg_temp.uid('u2');
select rewards.track(pg_temp.uid('u2'), 'practice', 'b', '{}', null, false);
select tests.ok(not exists (select 1 from public.app_coins where user_id = pg_temp.uid('u2')), 'three days away is not enough');
update rewards.activity set last_at = now() - interval '8 days' where user_id = pg_temp.uid('u2');
select rewards.track(pg_temp.uid('u2'), 'practice', 'c', '{}', null, false);
select rewards.track(pg_temp.uid('u2'), 'practice', 'd', '{}', null, false);
select tests.ok((select sum(amount) from public.app_coins where user_id = pg_temp.uid('u2')) = 50, 'back after 8 days: paid once');

-- recharge ------------------------------------------------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values ('hearts', 'recharge', '{"max":3,"every_minutes":60}');
do $$ begin
  insert into rewards.rules (program_key, kind, amount) values ('hearts', 'coins', 1);
  raise exception 'rule on recharge accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'recharge programs take no rules');
end $$;
select tests.ok((rewards.recharge_use(pg_temp.uid('u3'), 'hearts', 1) ->> 'units')::int = 2, 'starts full, one used');
select rewards.recharge_use(pg_temp.uid('u3'), 'hearts', 2);
do $$ begin
  perform rewards.recharge_use(pg_temp.uid('u3'), 'hearts', 1);
  raise exception 'used an empty recharge';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: empty', 'empty: refused');
end $$;
update rewards.recharge set updated_at = now() - interval '125 minutes' where user_id = pg_temp.uid('u3');
create temp table rc as select rewards.recharge_json(p, rewards.recharge_now(pg_temp.uid('u3'), p)) j from rewards.programs p where p.key = 'hearts';
select tests.ok((select (j ->> 'units')::int = 2 and (j ->> 'next_at')::timestamptz > now() + interval '50 minutes'
                 and (j ->> 'next_at')::timestamptz < now() + interval '56 minutes' from rc),
                'two refilled after 125 min; the next one keeps its 5 min of progress');
update rewards.recharge set updated_at = now() - interval '10 hours' where user_id = pg_temp.uid('u3');
select tests.ok((select (rewards.recharge_now(pg_temp.uid('u3'), p)).units = 3 from rewards.programs p where p.key = 'hearts'),
                'full after 10 hours, never above max');

-- windows -------------------------------------------------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values
  ('happy_now', 'window', jsonb_build_object('from', to_char(now() at time zone 'UTC' - interval '1 hour', 'HH24:MI'),
                                             'to', to_char(now() at time zone 'UTC' + interval '1 hour', 'HH24:MI'))),
  ('happy_later', 'window', jsonb_build_object('from', to_char(now() at time zone 'UTC' + interval '2 hours', 'HH24:MI'),
                                               'to', to_char(now() at time zone 'UTC' + interval '3 hours', 'HH24:MI')));
select tests.ok(rewards.in_window(pg_temp.uid('u4'), 'happy_now'), 'inside the window now');
select tests.ok(not rewards.in_window(pg_temp.uid('u4'), 'happy_later'), 'a later window is not active');
create temp table wj as select rewards.window_json(pg_temp.uid('u4'), p) j from rewards.programs p where p.key = 'happy_later';
select tests.ok((select (j ->> 'starts_at')::timestamptz between now() + interval '1 hour 58 minutes' and now() + interval '2 hours 1 minute' from wj),
                'the next window''s real start time');
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad_w', 'window', '{"from":"25:00","to":"26:00"}');
  raise exception 'bad window accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'window times must be HH:MM');
end $$;

-- friend streaks ------------------------------------------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values ('buddies', 'friend_streak', '{"event":"lesson","max_friends":2}');
insert into rewards.rules (program_key, threshold, kind, amount) values ('buddies', 2, 'coins', 15);
create temp table inv as select rewards.friend_invite(pg_temp.uid('u5'), 'buddies') j;
select tests.ok((select j ->> 'code' ~ '^F[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{7}$' from inv), 'invite code F + 7');
select tests.ok((rewards.friend_invite(pg_temp.uid('u5'), 'buddies') ->> 'code') = (select j ->> 'code' from inv), 'an open invite is reused');
do $$ begin
  perform rewards.friend_accept(pg_temp.uid('u5'), (select j ->> 'code' from inv));
  raise exception 'own code accepted';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: own_code', 'own code refused');
end $$;
select tests.ok((rewards.friend_accept(pg_temp.uid('u6'), lower(' ' || (select j ->> 'code' from inv))) ->> 'pair_id') is not null,
                'friend accepts (case and spaces forgiven)');
do $$ begin
  perform rewards.friend_accept(pg_temp.uid('u7'), (select j ->> 'code' from inv));
  raise exception 'used code accepted';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: bad_code', 'an invite is single use');
end $$;
select rewards.track(pg_temp.uid('u5'), 'lesson', 'f1', '{}', null, false);
select tests.ok((select current from rewards.friend_pairs) = 0, 'one friend alone does not count the day');
select rewards.track(pg_temp.uid('u6'), 'lesson', 'f1', '{}', null, false);
select tests.ok((select current from rewards.friend_pairs) = 1, 'both did it today: pair streak 1');
update rewards.friend_pairs set last_day = last_day - 1, a_day = a_day - 1, b_day = b_day - 1;
select rewards.track(pg_temp.uid('u5'), 'lesson', 'f2', '{}', null, false);
select rewards.track(pg_temp.uid('u6'), 'lesson', 'f2', '{}', null, false);
select tests.ok((select current from rewards.friend_pairs) = 2, 'next day together: 2');
select tests.ok((select count(*) from public.app_coins where amount = 15) = 2, 'both friends paid at 2');
create temp table fj as select rewards.friends_json(pg_temp.uid('u5'), p) j from rewards.programs p where p.key = 'buddies';
select tests.ok((select j -> 0 ->> 'friend_id' = pg_temp.uid('u6')::text and (j -> 0 ->> 'today_me')::boolean
                 and (j -> 0 ->> 'today_friend')::boolean and (j -> 0 ->> 'current')::int = 2 from fj), 'friend list shows both done');
-- the cap
select rewards.friend_accept(pg_temp.uid('u7'), rewards.friend_invite(pg_temp.uid('u5'), 'buddies') ->> 'code');
do $$ begin
  perform rewards.friend_accept(pg_temp.uid('u8'), rewards.friend_invite(pg_temp.uid('u5'), 'buddies') ->> 'code');
  raise exception 'over the cap';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: too_many_friends', 'max_friends enforced');
end $$;
grant select on fj to authenticated;
select tests.act_as('authenticated', pg_temp.uid('u5'));
select tests.ok(public.rewards_friend_remove((select (j -> 0 ->> 'pair_id')::uuid from fj)), 'a friend can be removed');
reset role;

-- history and recap ---------------------------------------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values ('lessons_daily', 'streak', '{"event":"lesson","daily_goal":2}');
create temp table h as select rewards.history(pg_temp.uid('u1'), 'lessons_daily', 2) j;
select tests.ok((select jsonb_array_length(j -> 'days') = 14 and (j ->> 'daily_goal')::int = 2 from h), 'two weeks of days with the goal');
select tests.ok((select (j -> 'days' -> 13 ->> 'count')::int = 3 and j -> 'days' -> 13 ->> 'day' = current_date::text from h),
                'today counts its 3 lessons');
create temp table rp as select rewards.recap(pg_temp.uid('u1'), current_date - 7, current_date) j;
select tests.ok((select (j ->> 'days_active')::int = 1 and j -> 'events' @> '[{"type":"lesson","count":3}]'
                 and j -> 'grants' @> '[{"kind":"coins","count":4}]' from rp), 'recap counts days, events and grants');
do $$ begin
  perform rewards.recap(pg_temp.uid('u1'), current_date, current_date - 1);
  raise exception 'bad range accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'recap refuses a reversed range');
end $$;

-- social link -----------------------------------------------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values ('ig', 'social_tag', '{"platform":"instagram","account":"myapp","code_prefix":"AB"}');
do $$ begin
  perform rewards.social_submit_link(pg_temp.uid('u1'), 'ig', 'https://www.instagram.com/p/AbCdE123/');
  raise exception 'link without a post accepted';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: no_pending_post', 'a link needs a started task');
end $$;
select rewards.social_start(pg_temp.uid('u1'), 'ig', 'one');
do $$ begin
  perform rewards.social_submit_link(pg_temp.uid('u1'), 'ig', 'https://evil.example/p/AbCdE123/');
  raise exception 'bad link accepted';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: bad_link', 'only Instagram post links');
end $$;
select tests.ok((rewards.social_submit_link(pg_temp.uid('u1'), 'ig', 'https://instagram.com/reels/AbCdE123?igsh=x') ->> 'post_url')
                = 'https://www.instagram.com/reel/AbCdE123/', 'link cleaned and stored for review');

-- the state carries every kind
create temp table st as select rewards.state(pg_temp.uid('u5')) j;
select tests.ok((select j ?& array['quests', 'recharges', 'windows', 'friends', 'quizzes'] from st), 'state has the 0.2 keys');
select tests.ok((select jsonb_array_length(j -> 'windows') = 2 and jsonb_array_length(j -> 'recharges') = 1 from st), 'windows and recharges listed');

-- deletion covers the new tables
select rewards.delete_user(pg_temp.uid('u5'));
select tests.ok(not exists (select 1 from rewards.friend_pairs where pg_temp.uid('u5') in (user_a, user_b))
                and not exists (select 1 from rewards.friend_invites where user_id = pg_temp.uid('u5')), 'friend data deleted');
select rewards.delete_user(pg_temp.uid('u3'));
select tests.ok(not exists (select 1 from rewards.recharge where user_id = pg_temp.uid('u3')), 'recharge deleted');

rollback;
