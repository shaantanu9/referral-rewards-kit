-- Rewards 0.5 follow-up gaps (ADR 0002 18.8): the daily reminder, activity_events, min_actions, the exclusion hook,
-- branded email templates and per-group mutes. Times are UTC so days are predictable.
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u select n, gen_random_uuid() from unnest(array['a','b','c','x','e1','e2','e3','adm']) n;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to authenticated, service_role;
insert into auth.users (id, email, created_at) select id, name || '@example.test', now() - interval '30 days' from u;
insert into rewards.admins (user_id) values (pg_temp.uid('adm'));
insert into rewards.event_types (name, source, daily_limit) values ('practice', 'client', 100), ('app_open', 'client', 100);
create function pg_temp.item(j jsonb, prog text) returns jsonb language sql as $$
  select x from jsonb_array_elements(j -> 'plan') x where x ->> 'program' = prog order by x ->> 'at' limit 1 $$;
create function pg_temp.count(j jsonb, prog text) returns int language sql as $$
  select count(*)::int from jsonb_array_elements(j -> 'plan') x where x ->> 'program' = prog $$;

-- checks
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad1', 'followup', '{"channel":"notification","trigger":{"type":"daily"},"activity_events":["nope"],"title":"t","body":"b"}');
  raise exception 'unknown activity event accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'activity_events must be registered event types');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad2', 'followup', '{"channel":"notification","trigger":{"type":"daily","min_actions":-1},"title":"t","body":"b"}');
  raise exception 'negative min_actions accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'min_actions is a whole number');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad3', 'followup', '{"channel":"email","trigger":{"type":"daily"},"email":{"subject":"s","body":"b"}}');
  raise exception 'email daily accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'the daily trigger is notification-only');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad4', 'followup', '{"channel":"email","trigger":{"type":"inactive_days","days":7},"email":{"subject":"s","body":"b","template":"Bad Name"}}');
  raise exception 'bad template name accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'a template name is lower-case');
end $$;

-- 1. the daily reminder ---------------------------------------------------------------------------------------------
insert into rewards.programs (key, kind, config, public) values
  ('n_daily', 'followup', '{"channel":"notification","trigger":{"type":"daily"},"activity_events":["practice"],"time":"23:30","group":"reminder","title":"App","body":"Time for today''s practice.","payload":"/practice"}',
   '{"group_label":"Daily reminder"}');
update rewards.settings set quiet_from = '23:59', quiet_to = '23:59:30';
-- a never practised: today and every day after
select tests.ok(pg_temp.count(rewards.followups_plan(pg_temp.uid('a'), 7), 'n_daily') = 8, 'daily: today plus 7 days');
select tests.ok((pg_temp.item(rewards.followups_plan(pg_temp.uid('a'), 7), 'n_daily') ->> 'at')::timestamptz = (current_date + time '23:30') at time zone 'UTC',
                'daily: at the program''s time');
-- an app_open does not count (activity_events = practice); a practice today skips today
select rewards.track(pg_temp.uid('a'), 'app_open', 'o1', '{}', null, false);
select tests.ok(pg_temp.count(rewards.followups_plan(pg_temp.uid('a'), 7), 'n_daily') = 8, 'activity_events: opening the app is not practising');
select rewards.track(pg_temp.uid('a'), 'practice', 'p1', '{}', null, false);
select tests.ok(pg_temp.count(rewards.followups_plan(pg_temp.uid('a'), 7), 'n_daily') = 7
                and (pg_temp.item(rewards.followups_plan(pg_temp.uid('a'), 7), 'n_daily') ->> 'at')::timestamptz = ((current_date + 1) + time '23:30') at time zone 'UTC',
                'practised today: the reminder starts tomorrow');
select tests.ok((select count(distinct x ->> 'id') = 7 from jsonb_array_elements(rewards.followups_plan(pg_temp.uid('a'), 7) -> 'plan') x where x ->> 'program' = 'n_daily'),
                'one id per day');

-- 2. activity_events on inactive_days -------------------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values
  ('n_back', 'followup', '{"channel":"notification","trigger":{"type":"inactive_days","days":2},"activity_events":["practice"],"time":"10:00","group":"comeback","title":"App","body":"b","payload":"/"}');
select rewards.track(pg_temp.uid('b'), 'practice', 'b1', '{}', null, false);
update rewards.events set occurred_at = now() - interval '5 days', local_day = current_date - 5 where user_id = pg_temp.uid('b');
select rewards.track(pg_temp.uid('b'), 'app_open', 'b2', '{}', null, false);
select tests.ok(pg_temp.item(rewards.followups_plan(pg_temp.uid('b'), 7), 'n_back') is null,
                'activity_events: an app open today does not restart the practice gap (its day already passed)');
update rewards.programs set config = config - 'activity_events' where key = 'n_back';
select tests.ok((pg_temp.item(rewards.followups_plan(pg_temp.uid('b'), 7), 'n_back') ->> 'at')::timestamptz = ((current_date + 2) + time '10:00') at time zone 'UTC',
                'without activity_events any event counts');

-- 3. min_actions ----------------------------------------------------------------------------------------------------
update rewards.programs set config = jsonb_set(config, '{trigger,min_actions}', '3') where key = 'n_back';
select tests.ok(pg_temp.item(rewards.followups_plan(pg_temp.uid('b'), 7), 'n_back') is null, 'min_actions 3: b with 2 events gets nothing');
select rewards.track(pg_temp.uid('b'), 'practice', 'b3', '{}', null, false);
select tests.ok(pg_temp.item(rewards.followups_plan(pg_temp.uid('b'), 7), 'n_back') is not null, 'min_actions reached: planned');

-- 4. the exclusion hook ---------------------------------------------------------------------------------------------
create temp table excluded (id uuid primary key);
insert into excluded values (pg_temp.uid('x'));
grant select on excluded to public;
create or replace function rewards_app.app_excluded_from_followups(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select exists (select 1 from pg_temp.excluded e where e.id = user_id) $$;
select tests.ok(jsonb_array_length(rewards.followups_plan(pg_temp.uid('x'), 7) -> 'plan') = 0, 'excluded user: empty plan');
select tests.ok(pg_temp.count(rewards.followups_plan(pg_temp.uid('c'), 7), 'n_daily') = 8, 'others unaffected');
create or replace function rewards_app.app_excluded_from_followups(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select 1 / 0 = 1 $$;
select tests.ok(jsonb_array_length(rewards.followups_plan(pg_temp.uid('c'), 7) -> 'plan') = 0, 'a failing hook excludes (never message by mistake)');
create or replace function rewards_app.app_excluded_from_followups(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select exists (select 1 from pg_temp.excluded e where e.id = user_id) $$;

-- 6. per-group mutes ------------------------------------------------------------------------------------------------
select tests.act_as('authenticated', pg_temp.uid('c'));
create temp table pr as select public.rewards_followup_prefs('{"muted_groups":["reminder"]}') j;
reset role;
select tests.ok((select j -> 'muted_groups' = '["reminder"]' from pr), 'muted_groups saved');
select tests.ok((select x = '{"group":"reminder","label":"Daily reminder","muted":true}' from pr, jsonb_array_elements(j -> 'groups') x where x ->> 'group' = 'reminder'),
                'groups lists the label from public.group_label and muted');
select tests.ok((select x ->> 'label' = 'comeback' and not (x ->> 'muted')::boolean from pr, jsonb_array_elements(j -> 'groups') x where x ->> 'group' = 'comeback'),
                'a group without a label shows its name');
select tests.ok(pg_temp.count(rewards.followups_plan(pg_temp.uid('c'), 7), 'n_daily') = 0, 'a muted group is not planned');
select tests.act_as('authenticated', pg_temp.uid('c'));
do $$ begin
  perform public.rewards_followup_prefs('{"muted_groups":["Bad Group"]}');
  raise exception 'bad group accepted';
exception when sqlstate '22023' then perform tests.ok(sqlerrm like 'rewards: bad_groups%', 'bad group names refused');
end $$;
select tests.ok(public.rewards_followup_prefs('{"muted_groups":[]}') -> 'muted_groups' = '[]', 'unmute all');
reset role;
select tests.ok(pg_temp.count(rewards.followups_plan(pg_temp.uid('c'), 7), 'n_daily') = 8, 'unmuted: planned again');

-- 5. branded email templates + the exclusion hook and min_actions for email -----------------------------------------
update rewards.settings set email_followups_enabled = true;
insert into rewards.programs (key, kind, config) values
  ('e_back', 'followup', '{"channel":"email","trigger":{"type":"inactive_days","days":7,"min_actions":2},"activity_events":["practice"],"email":{"subject":"We kept your place","body":"b","url":"https://app.example","template":"brand"}}');
-- e1: 2 practices 7.5 days ago → yes; e2: only 1 → no (min_actions); e3: excluded → no
select rewards.track(pg_temp.uid('e1'), 'practice', 'e1a', '{}', null, false), rewards.track(pg_temp.uid('e1'), 'practice', 'e1b', '{}', null, false);
select rewards.track(pg_temp.uid('e2'), 'practice', 'e2a', '{}', null, false);
select rewards.track(pg_temp.uid('e3'), 'practice', 'e3a', '{}', null, false), rewards.track(pg_temp.uid('e3'), 'practice', 'e3b', '{}', null, false);
update rewards.events set occurred_at = now() - interval '7 days 12 hours' where user_id in (pg_temp.uid('e1'), pg_temp.uid('e2'), pg_temp.uid('e3'));
insert into excluded values (pg_temp.uid('e3'));
create temp table cl as select x from jsonb_array_elements(rewards.followup_claim(true, 100)) x where x ->> 'program' = 'e_back';
select tests.ok((select array_agg(x ->> 'email') = array['e1@example.test'] from cl), 'email: min_actions and the exclusion hook apply');
select tests.ok((select x ? 'template_html' and x -> 'template_html' = 'null' from cl), 'no template saved: template_html is null (built-in layout)');

select tests.act_as('authenticated', pg_temp.uid('adm'));
do $$ begin
  perform public.rewards_admin_email_template_save('brand', '<p>{{body}}</p>');
  raise exception 'template without unsubscribe accepted';
exception when sqlstate '22023' then perform tests.ok(sqlerrm like 'rewards: template_needs_unsubscribe%', 'a template must contain {{unsubscribe_url}}');
end $$;
select tests.ok(public.rewards_admin_email_template_save('brand', '<h1>{{heading}}</h1><p>{{body}}</p><a href="{{unsubscribe_url}}">Stop</a>') ->> 'saved' = 'true', 'admin saves a template');
select tests.ok((public.rewards_admin_email_templates() -> 0 ->> 'key') = 'brand', 'admin lists templates');
reset role;
select tests.ok((select x ->> 'template_html' like '<h1>{{heading}}%' from jsonb_array_elements(rewards.followup_claim(true, 100)) x where x ->> 'program' = 'e_back'),
                'claim carries the template html');
select tests.act_as('authenticated', pg_temp.uid('a'));
do $$ begin
  perform public.rewards_admin_email_templates();
  raise exception 'non-admin read templates';
exception when sqlstate '42501' then perform tests.ok(true, 'templates are admin-only');
end $$;
reset role;

-- export / import carry templates
create temp table ex as select rewards.export_config(false) j;
select tests.ok((select j -> 'email_templates' -> 0 ->> 'key' = 'brand' from ex), 'export carries templates');
delete from rewards.email_templates;
select tests.ok((select exists (select 1 from jsonb_array_elements(rewards.import_config(j, true) -> 'changes') c
                                 where c ->> 'what' = 'email_template' and c ->> 'action' = 'create') from ex)
                and not exists (select 1 from rewards.email_templates), 'import dry run lists the template and writes nothing');
select rewards.import_config(j, false) from ex;
select tests.ok(exists (select 1 from rewards.email_templates where key = 'brand' and html like '%{{unsubscribe_url}}%'), 'import restores the template');

-- privileges
select tests.ok(not has_function_privilege('anon', 'public.rewards_admin_email_template_save(text,text)', 'EXECUTE')
                and has_function_privilege('authenticated', 'public.rewards_admin_email_templates()', 'EXECUTE'), 'template RPCs: signed-in only, admin-checked inside');
select tests.ok(not has_function_privilege('authenticated', 'rewards_app.app_excluded_from_followups(uuid)', 'EXECUTE'), 'the hook is not callable by users');

rollback;
