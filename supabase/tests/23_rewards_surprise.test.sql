-- Rewards 0.3: surprise bonus (chance), random amounts, the daily surprise cap, odds in the state (ADR 0002 18.6).
\set ON_ERROR_STOP 1
begin;
select setseed(0.42);

create temp table u (name text primary key, id uuid not null);
insert into u select 'u' || g, gen_random_uuid() from generate_series(1, 4) g;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to authenticated, service_role;
create table public.app_coins (grant_id uuid primary key, user_id uuid, amount numeric);
grant select, insert on public.app_coins to postgres;
create or replace function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_coins values (grant_id, user_id, amount) on conflict do nothing;
end $$;
insert into rewards.event_types (name, source, daily_limit) values ('chapter_done', 'client', 1000);
insert into rewards.programs (key, kind, config, public) values
  ('reads', 'milestone', '{"event":"chapter_done"}', '{"title":"Reading"}');

-- rule checks
do $$ begin
  insert into rewards.rules (program_key, threshold, repeat, kind, amount, params) values ('reads', 1, 'every', 'coins', 5, '{"chance":1.5}');
  raise exception 'chance 1.5 accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'chance must be at most 1');
end $$;
do $$ begin
  insert into rewards.rules (program_key, threshold, repeat, kind, amount, params) values ('reads', 1, 'every', 'coins', 5, '{"chance":0}');
  raise exception 'chance 0 accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'chance must be above 0');
end $$;
do $$ begin
  insert into rewards.rules (program_key, threshold, repeat, kind, amount, params) values ('reads', 1, 'every', 'coins', 40, '{"amount_range":[5,50]}');
  raise exception 'amount not max accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'a ranged rule''s amount must be its max');
end $$;
do $$ begin
  insert into rewards.rules (program_key, threshold, repeat, kind, amount, params) values ('reads', 1, 'every', 'coins', 5, '{"amount_range":[50,5]}');
  raise exception 'reversed range accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'min must not exceed max');
end $$;
do $$ begin
  insert into rewards.rules (program_key, threshold, repeat, kind, amount, params)
  values ('reads', 1, 'every', 'mystery', 1, '{"amount_range":[1,2],"table":[{"kind":"coins","amount":1,"weight":1},{"kind":"coins","amount":2,"weight":1}]}');
  raise exception 'range on a mystery accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'no amount_range on a mystery');
end $$;

-- random amounts: every chapter pays 5-50
insert into rewards.rules (program_key, threshold, repeat, kind, amount, params) values ('reads', 1, 'every', 'coins', 50, '{"amount_range":[5,50]}');
select rewards.track(pg_temp.uid('u1'), 'chapter_done', 'c' || g, '{}', null, false) from generate_series(1, 60) g;
select tests.ok((select count(*) = 60 and min(amount) >= 5 and max(amount) <= 50 and bool_and(amount = trunc(amount))
                   and count(distinct amount) > 10 and bool_and(params -> 'range' = '[5,50]')
                 from rewards.grants where user_id = pg_temp.uid('u1')), 'amounts are whole, within 5-50, varied, and carry their range');
select tests.ok((select sum(amount) from public.app_coins where user_id = pg_temp.uid('u1'))
                = (select sum(amount) from rewards.grants where user_id = pg_temp.uid('u1')), 'the drawn amount is what the app hook pays');

-- a surprise on every chapter with chance 0.5, cap raised so it does not interfere
update rewards.rules set active = false where program_key = 'reads';
insert into rewards.rules (program_key, threshold, repeat, kind, amount, params) values ('reads', 1, 'every', 'coins', 7, '{"chance":0.5}');
update rewards.settings set surprise_daily_cap = 100;
select rewards.track(pg_temp.uid('u2'), 'chapter_done', 'd' || g, '{}', null, false) from generate_series(1, 200) g;
select tests.ok((select count(*) between 60 and 140 from rewards.grants where user_id = pg_temp.uid('u2')),
                'chance 0.5: about half of 200 chapters paid (between 60 and 140)');
select tests.ok((select bool_and((params ->> 'surprise')::boolean) from rewards.grants where user_id = pg_temp.uid('u2')),
                'each surprise grant is marked surprise (the app reveals it)');

-- the daily cap: at most 3 surprises a day per user
update rewards.settings set surprise_daily_cap = 3;
update rewards.rules set active = false where program_key = 'reads';
insert into rewards.rules (program_key, threshold, repeat, kind, amount, params) values ('reads', 1, 'every', 'coins', 9, '{"chance":1}');
select rewards.track(pg_temp.uid('u3'), 'chapter_done', 'e' || g, '{}', null, false) from generate_series(1, 10) g;
select tests.ok((select count(*) from rewards.grants where user_id = pg_temp.uid('u3')) = 3, 'chance 1 but the cap: 3 surprises, then nothing');
update rewards.settings set surprise_daily_cap = 0;
select rewards.track(pg_temp.uid('u4'), 'chapter_done', 'f1', '{}', null, false);
select tests.ok(not exists (select 1 from rewards.grants where user_id = pg_temp.uid('u4')), 'cap 0 turns surprises off');

-- a surprise mystery keeps both marks
update rewards.settings set surprise_daily_cap = 3;
update rewards.rules set active = false where program_key = 'reads';
insert into rewards.rules (program_key, threshold, repeat, kind, amount, params) values ('reads', 1, 'every', 'mystery', 1,
  '{"chance":1,"table":[{"kind":"coins","amount":5,"weight":1},{"kind":"badge","amount":1,"weight":1,"params":{"badge":"lucky"}}]}');
select rewards.track(pg_temp.uid('u4'), 'chapter_done', 'g1', '{}', null, false);
select tests.ok((select (params ->> 'surprise')::boolean and (params ->> 'mystery')::boolean from rewards.grants where user_id = pg_temp.uid('u4')),
                'a surprise mystery carries surprise and mystery');

-- odds in the state, through the public API
select tests.act_as('authenticated', pg_temp.uid('u4'));
create temp table st as select public.rewards_state() j;
reset role;
select tests.ok((select jsonb_array_length(j -> 'surprises') = 1 and (j -> 'surprises' -> 0 ->> 'chance')::numeric = 1
                 and j -> 'surprises' -> 0 ->> 'program' = 'reads' and jsonb_array_length(j -> 'surprises' -> 0 -> 'odds') = 2 from st),
                'state lists the surprise with its chance and the mystery odds');
update rewards.settings set surprise_daily_cap = 0;
select tests.act_as('authenticated', pg_temp.uid('u4'));
select tests.ok(jsonb_array_length(public.rewards_state() -> 'surprises') = 0, 'no odds shown while surprises are off');
reset role;

-- the admin API and imports accept the new setting
insert into rewards.admins (user_id) values (pg_temp.uid('u1'));
select tests.act_as('authenticated', pg_temp.uid('u1'));
select tests.ok((public.rewards_admin_save_settings('{"surprise_daily_cap": 5}') ->> 'surprise_daily_cap')::int = 5, 'admin sets the surprise cap');
select tests.ok(public.rewards_admin_import('{"format":"rewards-config","version":1,"settings":{"surprise_daily_cap":2}}', true)
                -> 'changes' @> '[{"what":"setting","key":"surprise_daily_cap","action":"update"}]', 'imports carry the surprise cap');
reset role;
select tests.ok(not has_function_privilege('authenticated', 'rewards.surprises_json()', 'EXECUTE'), 'inner function not callable by users');

rollback;
