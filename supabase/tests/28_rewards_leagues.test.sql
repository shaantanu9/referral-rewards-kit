-- Rewards 0.6 weekly leagues (ADR 0002 18.10): opt-in, small groups, scores from the member's own events, the board
-- by display name only, the weekly close (best tier of rewards, promotion, no demotion on ties), leaving, admin
-- overview, deletion, export. Times are UTC (the default timezone). A week is "ended" by moving rows back 7 days.
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u select n, gen_random_uuid() from unnest(array['a','b','c','d','e','f','g','h','x','p','adm']) n;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to public;
insert into auth.users (id, email, created_at) select id, name || '@example.test', now() - interval '30 days' from u;
insert into rewards.admins (user_id) values (pg_temp.uid('adm'));
create or replace function rewards_app.app_display_name(user_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when x.name = 'c' then '' else 'P-' || x.name end from pg_temp.u x where x.id = user_id $$;
insert into rewards.event_types (name, source, daily_limit) values ('lesson', 'client', 100);
create function pg_temp.lesson(n text, k text, props jsonb default '{}') returns void language sql as $$
  select null from (select rewards.track(pg_temp.uid(n), 'lesson', k, props, null, false)) t $$;
create function pg_temp.board(j jsonb, n text) returns jsonb language sql as $$
  select x from jsonb_array_elements(j -> 'members') x where x ->> 'name' = 'P-' || n $$;
create function pg_temp.grants(n text) returns int language sql as $$
  select count(*)::int from rewards.grants g where g.user_id = pg_temp.uid(n) and g.program_key = 'weekly' $$;

-- checks -----------------------------------------------------------------------------------------------------------
select tests.ok((select pg_get_constraintdef(c.oid) like '%''followup''%''league''%' from pg_constraint c
                  where c.conrelid = 'rewards.programs'::regclass and c.conname = 'programs_kind_check'),
                'kind league added, earlier kinds kept');
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad1', 'league', '{"event":"nope"}');
  raise exception 'unknown event accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'a league needs a registered event');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad2', 'league', '{"event":"lesson","group_size":3}');
  raise exception 'group of 3 accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'group_size is 5-50');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad3', 'league', '{"event":"lesson","promote":2}');
  raise exception 'promotion without tiers accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'promotion needs at least two tiers');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad4', 'league', '{"event":"lesson","group_size":5,"tiers":["A","B"],"promote":3,"demote":2}');
  raise exception 'promote + demote = group accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'promote + demote stay below the group size');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad5', 'league', '{"event":"lesson","tiers":[""]}');
  raise exception 'empty tier name accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'tier names are 1-30 characters');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('bad6', 'league', '{"event":"lesson","score":"xp"}');
  raise exception 'bad score accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'score is events or prop:<name>');
end $$;

insert into rewards.programs (key, kind, config, public) values
  ('weekly', 'league', '{"event":"lesson","group_size":5,"tiers":["Bronze","Silver"],"promote":1,"demote":1}', '{"title":"Weekly league"}');
do $$ begin
  insert into rewards.rules (program_key, threshold, repeat, kind, amount) values ('weekly', null, 'once', 'coins', 5);
  raise exception 'rule without a place accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'league rules need a threshold (a place)');
end $$;
do $$ begin
  insert into rewards.rules (program_key, threshold, repeat, kind, amount) values ('weekly', 3, 'every', 'coins', 5);
  raise exception 'repeat every accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'league rules repeat once (each week pays once)');
end $$;
insert into rewards.rules (program_key, threshold, repeat, kind, amount, params) values
  ('weekly', 1, 'once', 'coins', 100, '{}'), ('weekly', 1, 'once', 'badge', 1, '{"badge":"league_winner"}'),
  ('weekly', 3, 'once', 'coins', 30, '{}');

-- 1. opt-in only ----------------------------------------------------------------------------------------------------
select pg_temp.lesson('x', 'x1');
select tests.ok(not exists (select 1 from rewards.league_entries where user_id = pg_temp.uid('x')), 'an event never enrols anyone');
select tests.act_as('authenticated', pg_temp.uid('x'));
create temp table j0 as select public.rewards_league('weekly') j;
reset role;
select tests.ok((select j ->> 'joined' = 'false' and j -> 'members' = '[]' and (j ->> 'size')::int = 0 from j0),
                'a non-member sees the rules but no board');
select tests.ok((select extract(isodow from (j ->> 'week')::date) = 1 and (j ->> 'week')::date <= current_date
                        and (j ->> 'week')::date + 7 > current_date
                        and (j ->> 'ends_at')::timestamptz = (((j ->> 'week')::date + 7)::timestamp at time zone 'UTC') from j0),
                'the week starts on Monday 00:00 in the default timezone and ends_at is its real end');
select tests.ok((select jsonb_array_length(j -> 'rewards') = 3 and j -> 'rewards' -> 0 ->> 'threshold' = '1' from j0), 'the rewards by place are shown');

-- 2. joining fills small groups -------------------------------------------------------------------------------------
-- g did a lesson an hour before joining: it does not count
select pg_temp.lesson('g', 'g0');
update rewards.events set occurred_at = now() - interval '1 hour' where user_id = pg_temp.uid('g');
do $$
declare
  n text;
begin
  foreach n in array array['a','b','c','d','e','f','g','h'] loop
    perform tests.act_as('authenticated', pg_temp.uid(n));
    perform public.rewards_league_join('weekly');
    reset role;
  end loop;
end $$;
select tests.ok((select count(*) = 2 from rewards.league_groups where program_key = 'weekly')
                and (select array_agg(n order by n) = array[3,5]
                       from (select count(*)::int n from rewards.league_entries where program_key = 'weekly' group by group_id) x),
                'eight members: a group of 5 and a group of 3 (never more than group_size)');
select tests.ok((select count(distinct group_id) = 1 from rewards.league_entries
                  where user_id in (pg_temp.uid('a'), pg_temp.uid('e'))), 'the first five share a group');

-- scores: a 3, b 2, c 2, e 1, d 0
select pg_temp.lesson('a', 'a1'), pg_temp.lesson('a', 'a2'), pg_temp.lesson('a', 'a3');
select pg_temp.lesson('b', 'b1'), pg_temp.lesson('b', 'b2');
select pg_temp.lesson('c', 'c1'), pg_temp.lesson('c', 'c2');
select pg_temp.lesson('e', 'e1');
select tests.act_as('authenticated', pg_temp.uid('a'));
create temp table ja as select public.rewards_league('weekly') j;
reset role;
select tests.ok((select (j ->> 'rank')::int = 1 and (j ->> 'score')::int = 3 and (j ->> 'size')::int = 5
                        and j ->> 'tier_name' = 'Bronze' and j ->> 'joined' = 'true' from ja), 'a: first with 3');
select tests.ok((select (pg_temp.board(j, 'b') ->> 'rank')::int = 2 and (pg_temp.board(j, 'b') ->> 'score')::int = 2 from ja)
                and (select exists (select 1 from jsonb_array_elements(j -> 'members') x
                                     where x ->> 'name' is null and x ->> 'rank' = '2') from ja),
                'ties share a place (b and c are both 2nd); an empty display name is null');
select tests.ok((select (pg_temp.board(j, 'd') -> 'rank') = 'null' and (pg_temp.board(j, 'd') ->> 'score')::int = 0 from ja),
                'no points: no rank (min_score 1)');
select tests.ok((select (pg_temp.board(j, 'a') ->> 'me')::boolean and not (pg_temp.board(j, 'b') ->> 'me')::boolean from ja),
                'the member''s own row is marked');
select tests.ok((select position(pg_temp.uid('b')::text in j::text) = 0 and position('@example' in j::text) = 0 from ja),
                'no other member''s id or email is in the answer');
select tests.ok((select array_agg(x ->> 'score' order by o) = array['3','2','2','1','0']
                   from ja, jsonb_array_elements(j -> 'members') with ordinality m(x, o)), 'the board is sorted by score');
select tests.act_as('authenticated', pg_temp.uid('g'));
select tests.ok((public.rewards_league('weekly') ->> 'score')::int = 0, 'points count only from the moment of placement');
reset role;

-- a failing name hook never breaks the board
create or replace function rewards_app.app_display_name(user_id uuid) returns text
language sql stable security definer set search_path = '' as $$ select (1 / 0)::text $$;
select tests.act_as('authenticated', pg_temp.uid('a'));
select tests.ok((select bool_and(x -> 'name' = 'null') from jsonb_array_elements(public.rewards_league('weekly') -> 'members') x),
                'a failing display name hook gives null names');
reset role;
create or replace function rewards_app.app_display_name(user_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when x.name = 'c' then '' else 'P-' || x.name end from pg_temp.u x where x.id = user_id $$;

-- placement on the first event of the week (the trigger)
delete from rewards.league_entries where user_id = pg_temp.uid('h');
select pg_temp.lesson('h', 'h1');
select tests.ok(exists (select 1 from rewards.league_entries where user_id = pg_temp.uid('h')), 'a member is placed by their first event of the week');
delete from rewards.events where user_id = pg_temp.uid('h');  -- g and h both end the week on 0 (a tie at the bottom)

-- 3. leaving --------------------------------------------------------------------------------------------------------
select tests.act_as('authenticated', pg_temp.uid('f'));
create temp table jf as select public.rewards_league_leave('weekly') j;
reset role;
select tests.ok((select j ->> 'joined' = 'false' and j -> 'members' = '[]' from jf)
                and not exists (select 1 from rewards.league_entries where user_id = pg_temp.uid('f')),
                'leaving takes the member off this week''s board at once');
select pg_temp.lesson('f', 'f1');
select tests.ok(not exists (select 1 from rewards.league_entries where user_id = pg_temp.uid('f')), 'after leaving, events place nobody');

-- 4. the weekly close -----------------------------------------------------------------------------------------------
update rewards.league_members set tier = 1 where user_id in (pg_temp.uid('d'), pg_temp.uid('g'));
update rewards.league_groups set week = week - 7 where program_key = 'weekly';
update rewards.league_entries set week = week - 7, joined_at = joined_at - interval '7 days' where program_key = 'weekly';
update rewards.events set occurred_at = occurred_at - interval '7 days', local_day = local_day - 7 where type = 'lesson';
update rewards.settings set enabled = false;
select tests.ok(rewards.league_close() = 0, 'nothing closes while the engine is off');
update rewards.settings set enabled = true;
select tests.act_as('service_role');
select public.rewards_svc_expire_social();
reset role;
select tests.ok(not exists (select 1 from rewards.league_groups where program_key = 'weekly' and closed_at is null),
                'the worker''s call (rewards_svc_expire_social) closes ended weeks');
select tests.ok(pg_temp.grants('a') = 2 and (select bool_and(kind in ('coins', 'badge') and (kind <> 'coins' or amount = 100))
                                              from rewards.grants where user_id = pg_temp.uid('a') and program_key = 'weekly'),
                'first place: only the best tier (100 coins + badge), not the top-3 coins too');
select tests.ok(pg_temp.grants('b') = 1 and pg_temp.grants('c') = 1, 'tied 2nd places both get the top-3 reward');
select tests.ok(pg_temp.grants('e') = 0 and pg_temp.grants('d') = 0, 'fourth and unranked get nothing');
select tests.ok(exists (select 1 from rewards.badges where user_id = pg_temp.uid('a') and badge = 'league_winner'), 'the badge is granted by the kit');
select tests.ok((select tier from rewards.league_members where user_id = pg_temp.uid('a') and program_key = 'weekly') = 1
                and (select tier_change from rewards.league_entries where user_id = pg_temp.uid('a')) = 1, 'top 1 moves up');
select tests.ok((select tier from rewards.league_members where user_id = pg_temp.uid('d') and program_key = 'weekly') = 0
                and (select tier_change from rewards.league_entries where user_id = pg_temp.uid('d')) = -1, 'the last place moves down');
select tests.ok((select tier from rewards.league_members where user_id = pg_temp.uid('g') and program_key = 'weekly') = 1,
                'a tie at the bottom moves nobody down');
select tests.ok(rewards.league_close() = 0 and pg_temp.grants('a') = 2, 'closing again does nothing (paid once a week)');
select tests.ok((select tier from rewards.league_members where user_id = pg_temp.uid('f') and program_key = 'weekly') = 0,
                'a member who left keeps their tier');

-- the member sees last week's result and is placed in the higher tier this week
select tests.act_as('authenticated', pg_temp.uid('a'));
create temp table ja2 as select public.rewards_league('weekly') j;
reset role;
select tests.ok((select j -> 'last_week' ->> 'rank' = '1' and j -> 'last_week' ->> 'tier_change' = 'up'
                        and jsonb_array_length(j -> 'last_week' -> 'grants') = 2 and j ->> 'tier_name' = 'Silver'
                        and (j ->> 'size')::int = 1 from ja2),
                'last week: own rank, "up", the grants; this week in Silver');
select tests.ok((select tier from rewards.league_groups g join rewards.league_entries e on e.group_id = g.id
                  where e.user_id = pg_temp.uid('a') and g.closed_at is null) = 1, 'this week''s group is the Silver tier');

-- lazy close: opening the board closes an ended week without the worker (moved 14 days back: a different week from
-- the one already paid, as the grant key carries the week)
select pg_temp.lesson('a', 'a4');
update rewards.league_entries e set week = e.week - 14, joined_at = e.joined_at - interval '14 days' from rewards.league_groups g
 where g.id = e.group_id and g.closed_at is null and g.program_key = 'weekly';
update rewards.league_groups set week = week - 14 where program_key = 'weekly' and closed_at is null;
update rewards.events set occurred_at = occurred_at - interval '14 days' where user_id = pg_temp.uid('a') and dedupe_key = 'a4';
select tests.act_as('authenticated', pg_temp.uid('a'));
create temp table ja3 as select public.rewards_league('weekly') j;
reset role;
select tests.ok((select e.final_rank = 1 and e.final_score = 1 and e.tier_change = 0 from rewards.league_entries e, ja3
                  where e.user_id = pg_temp.uid('a') and e.week = (j ->> 'week')::date - 14)
                and (select j ->> 'tier_name' = 'Silver' from ja3), 'opening the board closes the ended week (the top tier stays)');
select tests.ok(pg_temp.grants('a') = 4, 'another week pays again (grant key per week)');

-- 5. points from a prop, capped per event ---------------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values
  ('xp_league', 'league', '{"event":"lesson","score":"prop:xp","max_points_per_event":50,"group_size":5}');
select tests.act_as('authenticated', pg_temp.uid('p'));
select public.rewards_league_join('xp_league');
reset role;
select pg_temp.lesson('p', 'p1', '{"xp":30}'), pg_temp.lesson('p', 'p2', '{"xp":500}'), pg_temp.lesson('p', 'p3', '{"xp":"abc"}');
select tests.act_as('authenticated', pg_temp.uid('p'));
select tests.ok((public.rewards_league('xp_league') ->> 'score')::int = 80, 'prop score: 30 + 50 (capped) + 0 (not a number)');
reset role;

-- 6. admin ----------------------------------------------------------------------------------------------------------
select tests.act_as('authenticated', pg_temp.uid('adm'));
create temp table ov as select public.rewards_admin_leagues('weekly', 4) j;
select tests.ok((public.rewards_admin_league_close() ->> 'closed')::int = 0, 'admin can run the close');
reset role;
select tests.ok((select (j -> 0 ->> 'members')::int = 7 and (j -> 0 ->> 'left')::int = 1
                        and jsonb_array_length(j -> 0 -> 'weeks') >= 2 from ov), 'overview: members, left, weeks');
select tests.ok((select position(pg_temp.uid('a')::text in j::text) = 0 and position('P-' in j::text) = 0 from ov),
                'the overview has counts only (no ids, no names)');
select tests.act_as('authenticated', pg_temp.uid('a'));
do $$ begin
  perform public.rewards_admin_leagues(null, 4);
  raise exception 'non-admin read the overview';
exception when sqlstate '42501' then perform tests.ok(true, 'the overview is admin-only');
end $$;
reset role;

-- 7. export, deletion, privileges ----------------------------------------------------------------------------------
create temp table ex as select rewards.export_config(false) j;
select tests.ok((select exists (select 1 from jsonb_array_elements(j -> 'programs') x where x ->> 'key' = 'weekly' and x ->> 'kind' = 'league')
                        and (select count(*) = 3 from jsonb_array_elements(j -> 'rules') r where r ->> 'program' = 'weekly') from ex),
                'export carries the league and its rules');
update rewards.programs set config = jsonb_set(config, '{group_size}', '10') where key = 'weekly';
select tests.ok((select exists (select 1 from jsonb_array_elements(rewards.import_config(j, true) -> 'changes') c
                                 where c ->> 'key' = 'weekly' and c ->> 'action' = 'update') from ex), 'import sees a changed league');

select rewards.delete_user(pg_temp.uid('b'));
select tests.ok(not exists (select 1 from rewards.league_members where user_id = pg_temp.uid('b'))
                and not exists (select 1 from rewards.league_entries where user_id = pg_temp.uid('b')), 'deletion removes league rows');

select tests.ok(not has_function_privilege('anon', 'public.rewards_league(text)', 'EXECUTE')
                and has_function_privilege('authenticated', 'public.rewards_league_join(text)', 'EXECUTE')
                and has_function_privilege('authenticated', 'public.rewards_league_leave(text)', 'EXECUTE'), 'user RPCs: signed-in only');
select tests.ok(not has_function_privilege('authenticated', 'public.rewards_svc_league_close()', 'EXECUTE')
                and has_function_privilege('service_role', 'public.rewards_svc_league_close()', 'EXECUTE'), 'the service close is service-role only');
select tests.ok(not has_function_privilege('authenticated', 'rewards.league_close(text)', 'EXECUTE')
                and not has_table_privilege('authenticated', 'rewards.league_entries', 'SELECT'), 'internals are not reachable');
select tests.act_as('authenticated', pg_temp.uid('x'));
do $$ begin
  perform public.rewards_league('nope');
  raise exception 'unknown league answered';
exception when sqlstate '22023' then perform tests.ok(sqlerrm like 'rewards: unknown_program%', 'an unknown league is unknown_program');
end $$;
reset role;

rollback;
