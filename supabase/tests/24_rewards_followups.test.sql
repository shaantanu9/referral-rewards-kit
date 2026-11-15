-- Rewards 0.4 follow-ups: the phone notification plan, the email series with every guardrail, prefs, unsubscribe,
-- admin preview and retention (ADR 0002 18.7). Times are UTC (the default timezone) so days are predictable.
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u select n, gen_random_uuid() from unnest(array['a','b','c','s1','s2','s3','s4','i1','i2','adm']) n;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to authenticated, service_role;
insert into auth.users (id, email, created_at)
select id, name || '@example.test',
       case when name in ('s1','s2','s3','s4') then now() - interval '2 days 12 hours' else now() - interval '30 days' end
  from u;
insert into rewards.admins (user_id) values (pg_temp.uid('adm'));
create or replace function rewards_app.app_display_name(user_id uuid) returns text
language sql stable security definer set search_path = '' as $$ select 'Asha'::text $$;

insert into rewards.event_types (name, source, daily_limit) values ('practice', 'client', 100);
insert into rewards.programs (key, kind, config) values ('daily', 'streak', '{"event":"practice"}');

-- checks
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad1', 'followup', '{"channel":"email","trigger":{"type":"streak_at_risk","program":"daily"},"email":{"subject":"s","body":"b","url":"https://x"}}');
  raise exception 'email streak_at_risk accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'email follow-ups use inactive_days or days_since_signup only');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad2', 'followup', '{"channel":"notification","trigger":{"type":"inactive_days","days":2},"title":"x"}');
  raise exception 'no body accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'a notification needs a body');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad3', 'followup', '{"channel":"email","trigger":{"type":"inactive_days","days":7},"email":{"subject":"s","body":"b","url":"http://insecure"}}');
  raise exception 'http url accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'email links must be https');
end $$;

-- notification programs
insert into rewards.programs (key, kind, config) values
  ('n_inactive2', 'followup', '{"channel":"notification","trigger":{"type":"inactive_days","days":2},"time":"10:00","priority":30,"title":"App","body":"Your next step is still here, {{name}}.","payload":"/home"}'),
  ('n_inactive5', 'followup', '{"channel":"notification","trigger":{"type":"inactive_days","days":5},"time":"10:00","priority":20,"title":"App","body":"Even one step keeps it warm.","payload":"/home"}'),
  ('n_streak', 'followup', '{"channel":"notification","trigger":{"type":"streak_at_risk","program":"daily","hours_before":4},"priority":50,"title":"App","body":"Day {{streak}} ends tonight.","payload":"/home"}'),
  ('n_reward', 'followup', '{"channel":"notification","trigger":{"type":"reward_waiting"},"time":"reminder","group":"rewards","title":"App","body":"Something is waiting for you.","payload":"/rewards"}'),
  ('n_recap', 'followup', '{"channel":"notification","trigger":{"type":"weekly_recap","weekday":7},"time":"18:00","group":"recap","title":"App","body":"Your week.","payload":"/recap"}'),
  ('n_late', 'followup', '{"channel":"notification","trigger":{"type":"inactive_days","days":3},"time":"22:30","group":"late","title":"App","body":"Late one.","payload":"/"}');
do $$ begin
  insert into rewards.rules (program_key, kind, amount) values ('n_inactive2', 'coins', 1);
  raise exception 'rule on a followup accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'followup programs take no rules');
end $$;

-- a: practised today, a 1-day streak
select rewards.track(pg_temp.uid('a'), 'practice', 'p1', '{}', null, false);
create temp table pa as select rewards.followups_plan(pg_temp.uid('a'), 14) j;
create function pg_temp.item(j jsonb, prog text) returns jsonb language sql as $$
  select x from jsonb_array_elements(j -> 'plan') x where x ->> 'program' = prog $$;
select tests.ok((select (pg_temp.item(j, 'n_inactive2') ->> 'at')::timestamptz = ((current_date + 2) + time '10:00') at time zone 'UTC' from pa),
                'inactive 2 days: 10:00 two days after today''s activity');
select tests.ok((select pg_temp.item(j, 'n_inactive2') ->> 'body' = 'Your next step is still here, Asha.' from pa), '{{name}} filled by the app hook');
select tests.ok((select (pg_temp.item(j, 'n_streak') ->> 'at')::timestamptz = ((current_date + 2)::timestamp - interval '4 hours') at time zone 'UTC'
                   and pg_temp.item(j, 'n_streak') ->> 'body' = 'Day 1 ends tonight.' from pa),
                'today done: the streak reminder is tomorrow, 4 h before the streak would break');
select tests.ok((select pg_temp.item(j, 'n_late') is not null
                   and ((pg_temp.item(j, 'n_late') ->> 'at')::timestamptz at time zone 'UTC')::time = time '20:59' from pa),
                '22:30 is in quiet hours (21:00-08:00): moved to 20:59');
select tests.ok((select extract(isodow from (pg_temp.item(j, 'n_recap') ->> 'at')::timestamptz at time zone 'UTC') = 7 from pa), 'weekly recap on Sunday');
select tests.ok((select pg_temp.item(j, 'n_reward') is null from pa), 'no reward waiting: no reward reminder');
select tests.ok((select (select count(*) from jsonb_array_elements(j -> 'plan') x) = (select count(distinct x ->> 'id') from jsonb_array_elements(j -> 'plan') x) from pa),
                'ids are distinct');
select tests.ok((select j -> 'plan' = rewards.followups_plan(pg_temp.uid('a'), 14) -> 'plan' from pa), 'replanning gives the same plan and ids');
select tests.ok((select bool_and((x ->> 'at')::timestamptz > now()) from pa, jsonb_array_elements(j -> 'plan') x), 'nothing in the past');

-- one per day per group: inactive2 (priority 30) and the streak (50) can meet on a day; the higher wins
update rewards.streaks set last_day = current_date - 1 where user_id = pg_temp.uid('a');
update rewards.events set occurred_at = now() - interval '1 day', local_day = current_date - 1 where user_id = pg_temp.uid('a');
create temp table pb as select rewards.followups_plan(pg_temp.uid('a'), 14) j;
select tests.ok((select count(*) <= 1 from pb, jsonb_array_elements(j -> 'plan') x
                  where x ->> 'group' = 'daily' and ((x ->> 'at')::timestamptz at time zone 'UTC')::date = current_date + 1),
                'at most one daily-group notification on a day');

-- quiet user: inactive 5 is planned, inactive 2 has passed and is not sent late
update rewards.events set occurred_at = now() - interval '3 days', local_day = current_date - 3 where user_id = pg_temp.uid('a');
create temp table pc as select rewards.followups_plan(pg_temp.uid('a'), 14) j;
select tests.ok((select pg_temp.item(j, 'n_inactive2') is null and (pg_temp.item(j, 'n_inactive5') ->> 'at')::timestamptz
                   = ((current_date + 2) + time '10:00') at time zone 'UTC' from pc), 'quiet 3 days: the 2-day nudge is not sent late; the 5-day one is planned');

-- reward waiting and the user's reminder time
insert into rewards.programs (key, kind, config) values ('m1', 'milestone', '{"event":"practice"}');
insert into rewards.rules (program_key, threshold, kind, amount, params) values ('m1', 1, 'badge', 1, '{"badge":"first"}');
select rewards.track(pg_temp.uid('b'), 'practice', 'b1', '{}', null, false);
select rewards.followup_prefs_set(pg_temp.uid('b'), '{"reminder_time":"09:15"}');
create temp table pr as select rewards.followups_plan(pg_temp.uid('b'), 14) j;
select tests.ok((select ((pg_temp.item(j, 'n_reward') ->> 'at')::timestamptz at time zone 'UTC')::time = time '09:15' from pr),
                'reward waiting: reminded at the user''s own time');

-- off switch and a disabled program
select rewards.followup_prefs_set(pg_temp.uid('b'), '{"notifications_off":true}');
select tests.ok(jsonb_array_length(rewards.followups_plan(pg_temp.uid('b'), 14) -> 'plan') = 0, 'notifications off: empty plan');
update rewards.programs set enabled = false where key = 'n_recap';
select tests.ok((select pg_temp.item(rewards.followups_plan(pg_temp.uid('a'), 14), 'n_recap') is null), 'a program switched off is not planned');

-- prefs API
select tests.act_as('authenticated', pg_temp.uid('c'));
select tests.ok(public.rewards_followup_prefs('{"emails_off":true,"reminder_time":"07:45"}') @> '{"emails_off":true,"reminder_time":"07:45","notifications_off":false}', 'user sets prefs');
select tests.ok(public.rewards_followup_prefs() ->> 'reminder_time' = '07:45', 'prefs read back');
do $$ begin
  perform public.rewards_followup_prefs('{"marketing":true}');
  raise exception 'unknown pref accepted';
exception when sqlstate '22023' then perform tests.ok(sqlerrm like 'rewards: unknown_pref%', 'unknown pref refused');
end $$;
do $$ begin
  perform public.rewards_followup_prefs('{"reminder_time":"25:00"}');
  raise exception 'bad time accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'bad time refused');
end $$;
select tests.ok(jsonb_typeof(public.rewards_followups_plan(14) -> 'plan') = 'array', 'the user reads their own plan');
reset role;

-- emails -------------------------------------------------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values
  ('e_day2', 'followup', '{"channel":"email","trigger":{"type":"days_since_signup","from":2,"to":3,"no_activity_since_signup":true},"priority":10,"email":{"subject":"Your first take is still saved, {{name}}","heading":"Hi {{name}}","body":"Two minutes today.","button":"Open","url":"https://app.example/open"}}'),
  ('e_inactive7', 'followup', '{"channel":"email","trigger":{"type":"inactive_days","days":7},"priority":5,"email":{"subject":"One week","body":"One step keeps it.","url":"https://app.example/open"}}');
-- s1 no activity → yes; s2 practised a day later → no; s3 is s3 (emails off); i1 quiet 7.5 days → yes; adm → never
select rewards.track(pg_temp.uid('s2'), 'practice', 's2a', '{}', null, false);
update rewards.events set occurred_at = now() - interval '1 day' where user_id = pg_temp.uid('s2');
select rewards.followup_prefs_set(pg_temp.uid('s3'), '{"emails_off":true}');
select rewards.track(pg_temp.uid('i1'), 'practice', 'i1a', '{}', null, false);
update rewards.events set occurred_at = now() - interval '7 days 12 hours' where user_id = pg_temp.uid('i1');
select rewards.track(pg_temp.uid('adm'), 'practice', 'ad', '{}', null, false);
update rewards.events set occurred_at = now() - interval '7 days 12 hours' where user_id = pg_temp.uid('adm');

select tests.ok(rewards.followup_claim(true, 100) = '[]', 'emails switched off (default): nothing');
update rewards.settings set email_followups_enabled = true;
create temp table dry as select rewards.followup_claim(true, 100) j;
select tests.ok((select (select array_agg(x ->> 'email' order by x ->> 'email') from jsonb_array_elements(j) x)
                 = array['i1@example.test', 's1@example.test', 's4@example.test'] from dry),
                'dry run: s1 and s4 (no activity since sign-up) and i1 (quiet 7 days); not s2, the opted-out s3 or the admin');
select tests.ok((select bool_and(x ->> 'send_id' is null) from dry, jsonb_array_elements(j) x) and not exists (select 1 from rewards.followup_sends),
                'a dry run writes nothing');
select tests.ok((select x ->> 'subject' = 'Your first take is still saved, Asha' and x ->> 'heading' = 'Hi Asha' and x ->> 'unsubscribe_token' is not null
                  from dry, jsonb_array_elements(j) x where x ->> 'email' = 's1@example.test'), 'subject and heading filled; unsubscribe token included');
create temp table real1 as select rewards.followup_claim(false, 100) j;
select tests.ok((select jsonb_array_length(j) = 3 from real1) and (select count(*) from rewards.followup_sends where state = 'queued') = 3, 'real claim queues 3');
select tests.ok(jsonb_array_length(rewards.followup_claim(false, 100)) = 0, 'claimed again: nothing (each program once per user, and the cooldown)');
select rewards.followup_finish((x ->> 'send_id')::uuid, x ->> 'email' <> 's4@example.test', 'resend-1', case when x ->> 'email' = 's4@example.test' then 'bounced' end)
  from real1, jsonb_array_elements(j) x;
select tests.ok((select count(*) from rewards.followup_sends where state = 'sent') = 2 and (select count(*) from rewards.followup_sends where state = 'failed') = 1,
                'finish marks sent and failed');
select tests.ok((select jsonb_array_length(j) = 1 and j -> 0 ->> 'email' = 's4@example.test' from (select rewards.followup_claim(true, 100) j) x),
                'a failed send can be tried again');
-- cooldown and the series cap
update rewards.followup_sends set created_at = now() - interval '10 days' where user_id = pg_temp.uid('i1');
update rewards.events set occurred_at = now() - interval '7 days 12 hours' where user_id = pg_temp.uid('i1');
insert into rewards.programs (key, kind, config) values
  ('e_inactive7b', 'followup', '{"channel":"email","trigger":{"type":"inactive_days","days":7},"email":{"subject":"Again","body":"b","url":"https://app.example"}}');
select tests.ok(exists (select 1 from jsonb_array_elements(rewards.followup_claim(true, 100)) x where x ->> 'program' = 'e_inactive7b'
                         and x ->> 'email' = 'i1@example.test'), 'after the cooldown a different email may go');
update rewards.settings set email_max_series = 1;
select tests.ok(not exists (select 1 from jsonb_array_elements(rewards.followup_claim(true, 100)) x where x ->> 'email' = 'i1@example.test'),
                'the series cap stops it');
update rewards.settings set email_max_series = 3;

-- unsubscribe
select tests.ok((rewards.followup_unsubscribe((select unsubscribe_token from rewards.followup_prefs where user_id = pg_temp.uid('i1'))) ->> 'ok')::boolean,
                'one-click unsubscribe answers ok');
select tests.ok((select emails_off from rewards.followup_prefs where user_id = pg_temp.uid('i1')), 'and the user is opted out');
select tests.ok(not (rewards.followup_unsubscribe(gen_random_uuid()) ->> 'ok')::boolean, 'unknown token: ok false');

-- admin
select tests.act_as('authenticated', pg_temp.uid('adm'));
create temp table pv as select public.rewards_admin_followup_preview('e_inactive7b') j;
select tests.ok((select (j ->> 'count')::int = 0 from pv), 'preview applies the guardrails (i1 unsubscribed)');
select tests.ok((select (public.rewards_admin_followup_preview('e_day2') -> 'sample' -> 0 ->> 'email') ~ '^s\*\*\*@example\.test$'), 'preview masks emails');
select tests.ok(jsonb_array_length(public.rewards_admin_followup_sends(10)) = 3, 'send log');
select tests.ok(jsonb_typeof(public.rewards_admin_followup_plan(pg_temp.uid('a'), 7) -> 'plan') = 'array', 'admin sees a user''s plan');
create temp table rt as select public.rewards_admin_retention(8) j;
select tests.ok((select sum((x ->> 'signups')::int) = 10 and sum((x ->> 'emails_sent')::int) = 2 and sum((x ->> 'unsubscribed')::int) = 3
                 from rt, jsonb_array_elements(j) x), 'retention: 10 sign-ups, 2 emails sent, 3 opted out (s3, c, i1)');
select tests.ok((public.rewards_admin_save_settings('{"email_cooldown_days":5,"quiet_from":"22:00"}') ->> 'email_cooldown_days')::int = 5, 'new settings saved');
reset role;
select tests.ok(not has_function_privilege('authenticated', 'public.rewards_svc_followup_claim(boolean,integer)', 'EXECUTE')
                and has_function_privilege('authenticated', 'public.rewards_followups_plan(integer)', 'EXECUTE'), 'claim is service-only; the plan is the user''s');

-- opening a notification counts as an event, never as activity for the nudges
select rewards.track(pg_temp.uid('a'), 'followup_opened', 'n_inactive5:' || current_date, '{"program":"n_inactive5"}', null, false);
select tests.ok(rewards.last_active(pg_temp.uid('a')) < now() - interval '2 days', 'opening a follow-up is not counted as activity');

-- deletion
select rewards.delete_user(pg_temp.uid('s1'));
select tests.ok(not exists (select 1 from rewards.followup_sends where user_id = pg_temp.uid('s1'))
                and not exists (select 1 from rewards.followup_prefs where user_id = pg_temp.uid('s1')), 'follow-up data deleted with the account');

rollback;
