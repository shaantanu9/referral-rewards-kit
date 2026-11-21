-- Admin boost functions (migration 24): only admins; create, list and end; every refusal of migration 23's rules comes
-- back as {"ok": false, "reason": ...}; ending a boost not started deletes it, ending a running one stops new boosted
-- rewards; changes are in the admin log. Rolled back.
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u select x, gen_random_uuid() from unnest(array['admin', 'nobody', 'sharer', 'f1', 'f2']) x;
insert into auth.users (id, email, email_confirmed_at) select id, name || '@example.test', now() - interval '1 hour' from u;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to postgres, authenticated, anon;
insert into rewards.admins (user_id) values (pg_temp.uid('admin'));

insert into referral.rules (version, event, who, kind, amount) values
  (1, 'joined', 'sharer', 'minutes', 30), (1, 'joined', 'friend', 'minutes', 30);
create table public.app_progress (user_id uuid not null);
grant select on public.app_progress to postgres;
create or replace function referral_app.app_referral_is_active(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_progress p where p.user_id = app_referral_is_active.user_id) $$;
create or replace function referral_app.app_referral_grant(reward_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$ begin end $$;
revoke execute on function referral_app.app_referral_is_active(uuid),
  referral_app.app_referral_grant(uuid, uuid, text, numeric, jsonb) from public, anon, authenticated, service_role;
create temp table c as select referral.my_code(pg_temp.uid('sharer'), 'sharer-phone-0001') ->> 'code' as code;
grant select on c to authenticated;

-- Runs one admin call as the signed-in admin and returns its answer.
create function pg_temp.as_admin(q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform tests.act_as('authenticated', pg_temp.uid('admin'));
  execute q into r;
  reset role;
  return r;
end $$;
-- The same call as the service role (SQL editor, scripts).
create function pg_temp.as_service(q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  execute q into r;
  return r;
end $$;

-- 1. Who may call -----------------------------------------------------------------------------------------------------
do $$
declare fns text[] := array['select public.referral_admin_boosts()',
  'select public.referral_admin_boost_create(now() + interval ''1 day'', now() + interval ''2 days'', 2)',
  'select public.referral_admin_boost_end(gen_random_uuid())'];
  f text;
begin
  foreach f in array fns loop
    begin
      perform tests.act_as('authenticated', pg_temp.uid('nobody'));
      execute f;
      reset role;
      perform tests.ok(false, 'refused for a non-admin: ' || f);
    exception when insufficient_privilege then
      reset role;
      perform tests.ok(sqlerrm = 'referral: not_admin', 'refused for a non-admin: ' || f);
    end;
    begin
      perform tests.act_as('anon');
      execute f;
      reset role;
      perform tests.ok(false, 'anon cannot call: ' || f);
    exception when insufficient_privilege then
      reset role;
      perform tests.ok(true, 'anon cannot call: ' || f);
    end;
  end loop;
end $$;
select tests.ok(not exists (select 1 from referral.boosts) and not exists (select 1 from referral.admin_log),
                'refused calls change nothing and log nothing');
select tests.ok(not exists (select 1 from referral.privacy_problems()), 'privacy_problems() stays empty');

-- 2. Create, list ------------------------------------------------------------------------------------------------------
create temp table made as select pg_temp.as_admin(
  'select public.referral_admin_boost_create(now() + interval ''2 days'', now() + interval ''9 days'', 2, budget => 50)') j;
select tests.ok((select j ->> 'ok' = 'true' and j -> 'boost' ->> 'status' = 'scheduled'
                        and j -> 'boost' -> 'events' = '["joined"]' and j -> 'boost' -> 'who' = '["sharer", "friend"]'
                        and (j -> 'boost' ->> 'multiplier')::numeric = 2 and (j -> 'boost' ->> 'budget')::int = 50
                        and (j -> 'boost' ->> 'boosted_rewards')::int = 0 and (j -> 'boost' ->> 'budget_left')::int = 50
                        and (j -> 'boost' ->> 'starts_at')::timestamptz = now() + interval '2 days'
                 from made), 'create: scheduled, the defaults for events and sides, budget left');
select tests.ok((select jsonb_array_length(l) = 1 and l -> 0 ->> 'id' = (select j -> 'boost' ->> 'id' from made)
                 from (select pg_temp.as_admin('select public.referral_admin_boosts()') l) x), 'list: the new boost');
select tests.ok((select count(*) = 1 and bool_and(admin_id = pg_temp.uid('admin'))
                        and bool_and(details ->> 'boost_id' = (select j -> 'boost' ->> 'id' from made))
                 from referral.admin_log where action = 'boost_create'), 'create: logged with the admin and the boost');

-- 3. Each refusal, as a reason ----------------------------------------------------------------------------------------
create temp table refusals (q text, reason text);
insert into refusals values
  ('select public.referral_admin_boost_create(now() - interval ''1 hour'', now() + interval ''1 day'', 2)', 'starts_in_past'),
  ('select public.referral_admin_boost_create(now() + interval ''5 days'', now() + interval ''6 days'', 2)', 'overlap'),
  ('select public.referral_admin_boost_create(now() + interval ''1 day'', now() + interval ''3 days'', 2)', 'overlap'),
  ('select public.referral_admin_boost_create(now() + interval ''20 days'', now() + interval ''60 days'', 2)', 'too_long'),
  ('select public.referral_admin_boost_create(now() + interval ''20 days'', now() + interval ''19 days'', 2)', 'ends_before_start'),
  ('select public.referral_admin_boost_create(now() + interval ''20 days'', now() + interval ''20 days'', 2)', 'ends_before_start'),
  ('select public.referral_admin_boost_create(now() + interval ''20 days'', now() + interval ''21 days'', 1)', 'bad_multiplier'),
  ('select public.referral_admin_boost_create(now() + interval ''20 days'', now() + interval ''21 days'', 6)', 'bad_multiplier'),
  ('select public.referral_admin_boost_create(now() + interval ''20 days'', now() + interval ''21 days'', 2, ''{signup}'')', 'bad_events'),
  ('select public.referral_admin_boost_create(now() + interval ''20 days'', now() + interval ''21 days'', 2, ''{}'')', 'bad_events'),
  ('select public.referral_admin_boost_create(now() + interval ''20 days'', now() + interval ''21 days'', 2, who => ''{everyone}'')', 'bad_who'),
  ('select public.referral_admin_boost_create(now() + interval ''20 days'', now() + interval ''21 days'', 2, budget => -1)', 'bad_budget'),
  ('select public.referral_admin_boost_create(now() + interval ''20 days'', now() + interval ''21 days'', null)', 'missing'),
  ('select public.referral_admin_boost_create(null, now() + interval ''21 days'', 2)', 'missing'),
  ('select public.referral_admin_boost_end(gen_random_uuid())', 'not_found');
do $$
declare r record; a jsonb;
begin
  for r in select * from refusals loop
    a := pg_temp.as_service(r.q);
    perform tests.ok(a = jsonb_build_object('ok', false, 'reason', r.reason), r.reason || ': ' || r.q);
  end loop;
end $$;
select tests.ok((select count(*) = 1 from referral.boosts) and (select count(*) = 1 from referral.admin_log),
                'refusals create nothing and log nothing');
select tests.ok(pg_temp.as_service('select public.referral_admin_boosts()') -> 0 ->> 'status' = 'scheduled',
                'list works for the service role');

-- 4. End a boost not started yet: it is deleted -----------------------------------------------------------------------
select tests.ok(pg_temp.as_admin(format('select public.referral_admin_boost_end(%L)', (select j -> 'boost' ->> 'id' from made)))
                = '{"ok": true, "result": "deleted", "boost": null}', 'end a scheduled boost: deleted');
select tests.ok(not exists (select 1 from referral.boosts), 'it is gone');
select tests.ok((select count(*) = 1 and bool_and(admin_id = pg_temp.uid('admin') and details ->> 'result' = 'deleted')
                 from referral.admin_log where action = 'boost_end'), 'end: logged as deleted');

-- 5. A running boost (started a day ago; inserted past the guard, which refuses a start in the past) ------------------
set local session_replication_role = replica;
insert into referral.boosts (starts_at, ends_at, multiplier) values (now() - interval '1 day', now() + interval '6 days', 2);
set local session_replication_role = origin;
create temp table rb as select id from referral.boosts;
select tests.ok(pg_temp.as_admin('select public.referral_admin_boost_create(now() + interval ''1 day'', now() + interval ''2 days'', 3)')
                = '{"ok": false, "reason": "overlap"}', 'a new boost inside a running one: overlap');
select tests.ok(referral.claim(pg_temp.uid('f1'), (select code from c), 'friend-phone-0001') ->> 'reason' = 'ok', 'f1 claims during the boost');
insert into public.app_progress values (pg_temp.uid('f1'));
select tests.ok(referral.check_activation(pg_temp.uid('f1')) = 'joined', 'f1 joins');
select tests.ok((select count(*) = 2 and bool_and(amount = 60 and boost_id = (select id from rb)) from referral.rewards),
                'both rewards boosted');
select tests.ok((select l -> 0 ->> 'status' = 'running' and (l -> 0 ->> 'boosted_rewards')::int = 2 and l -> 0 -> 'budget' = 'null'
                        and l -> 0 -> 'budget_left' = 'null'
                 from (select pg_temp.as_admin('select public.referral_admin_boosts()') l) x), 'list: running, 2 rewards boosted, no budget');

create temp table ended as select pg_temp.as_admin(format('select public.referral_admin_boost_end(%L)', (select id from rb))) j;
select tests.ok((select j ->> 'ok' = 'true' and j ->> 'result' = 'ended' and j -> 'boost' ->> 'status' = 'ended'
                        and (j -> 'boost' ->> 'ends_at')::timestamptz = now() from ended), 'end a running boost: ends now');
select tests.ok((select ends_at = now() and starts_at = now() - interval '1 day' and multiplier = 2 from referral.boosts),
                'the row stays, only ends_at moved');
select tests.ok(referral.terms() -> 'boost' = 'null', 'terms: no boost shown after the end');
select tests.ok(referral.claim(pg_temp.uid('f2'), (select code from c), 'friend-phone-0002') ->> 'reason' = 'ok', 'f2 claims after the end');
select tests.ok(referral.my_claim(pg_temp.uid('f2')) -> 'rewards' -> 0 ->> 'boosted' = 'false', 'my_claim: not boosted');
insert into public.app_progress values (pg_temp.uid('f2'));
select tests.ok(referral.check_activation(pg_temp.uid('f2')) = 'joined', 'f2 joins');
select tests.ok((select bool_and(amount = 30 and boost_id is null) from referral.rewards w
                  join referral.referrals r on r.id = w.referral_id where r.friend_id = pg_temp.uid('f2')),
                'claimed after the end: not boosted');
select tests.ok((select bool_and(amount = 60) from referral.rewards w
                  join referral.referrals r on r.id = w.referral_id where r.friend_id = pg_temp.uid('f1')),
                'rewards boosted before the end stay boosted');
select tests.ok(pg_temp.as_admin(format('select public.referral_admin_boost_end(%L)', (select id from rb)))
                = '{"ok": false, "reason": "already_ended"}', 'end again: already_ended');
select tests.ok((select count(*) = 2 and bool_and(admin_id = pg_temp.uid('admin'))
                        and count(*) filter (where details ->> 'result' = 'ended' and details ->> 'boost_id' = (select id::text from rb)) = 1
                 from referral.admin_log where action = 'boost_end'), 'end: logged as ended');

-- 6. A start a few minutes ago means now (the time the form took); it never reaches back further --------------------
create temp table soon as select pg_temp.as_admin(
  'select public.referral_admin_boost_create(now() - interval ''2 minutes'', now() + interval ''7 days'', 1.5, ''{joined,paid}'', ''{friend}'')') j;
select tests.ok((select j ->> 'ok' = 'true' and (j -> 'boost' ->> 'starts_at')::timestamptz = now()
                        and j -> 'boost' ->> 'status' = 'running' and j -> 'boost' -> 'events' = '["joined", "paid"]'
                        and j -> 'boost' -> 'who' = '["friend"]' from soon),
                'a start 2 minutes ago starts now, right after the ended boost (no overlap)');
select tests.ok(pg_temp.as_admin(format('select public.referral_admin_boost_end(%L)', (select j -> 'boost' ->> 'id' from soon)))
                = '{"ok": false, "reason": "just_started"}', 'a boost that started this instant cannot end yet');
select tests.ok((select jsonb_array_length(l) = 2 and l -> 0 ->> 'id' = (select j -> 'boost' ->> 'id' from soon)
                        and l -> 1 ->> 'status' = 'ended'
                 from (select pg_temp.as_admin('select public.referral_admin_boosts()') l) x), 'list: newest start first');
select tests.ok((select count(*) = 2 from referral.admin_log where action = 'boost_create')
                and jsonb_array_length(pg_temp.as_admin('select public.referral_admin_log()')) = 4,
                'the admin log has every change: two created, two ended');
select tests.ok(not exists (select 1 from referral.privacy_problems()), 'privacy_problems() is still empty');

rollback;
