-- The growth round (migration 23, design spec section 4): preferences (name on the invite page, leaving), the anon
-- invite preview, boosts (by claim time, budget, immutable once started, no overlap, terms), the friend's own claim,
-- under-age users leave no install row, delete_user clears the new columns, the admin funnel. Rolled back.
-- The JSON fixtures in packages/referral_kit/test/fixtures/growth/ come from the same functions on a local database:
-- scripts/growth-fixtures.sh (it runs supabase/tests/fixtures/growth_fixtures.sql after every migration).
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u select x, gen_random_uuid()
  from unnest(array['sharer', 'sharer2', 'quiet', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'kid', 'anon_user', 'admin', 'nobody']) x;
insert into auth.users (id, email, email_confirmed_at, is_anonymous)
  select id, name || '@example.test', case when name <> 'anon_user' then now() - interval '1 hour' end, name = 'anon_user' from u;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to postgres, authenticated, anon;
insert into rewards.admins (user_id) values (pg_temp.uid('admin'));

insert into referral.rules (version, event, who, kind, amount) values
  (1, 'joined', 'sharer', 'minutes', 30), (1, 'joined', 'friend', 'minutes', 30);
create table public.app_progress (user_id uuid not null);
create table public.app_minors (user_id uuid not null);
grant select on public.app_progress, public.app_minors to postgres;
create or replace function referral_app.app_referral_is_active(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_progress p where p.user_id = app_referral_is_active.user_id) $$;
create or replace function referral_app.app_referral_grant(reward_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$ begin end $$;
create or replace function referral_app.app_referral_age_ok(user_id uuid, minimum_age int) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.app_minors m where m.user_id = app_referral_age_ok.user_id) $$;
revoke execute on function referral_app.app_referral_is_active(uuid), referral_app.app_referral_age_ok(uuid, int),
  referral_app.app_referral_grant(uuid, uuid, text, numeric, jsonb) from public, anon, authenticated, service_role;
insert into public.app_minors values (pg_temp.uid('kid'));

create temp table c (who text primary key, code text);
insert into c select 'sharer', referral.my_code(pg_temp.uid('sharer'), 'sharer-phone-0001') ->> 'code';
insert into c select 'sharer2', referral.my_code(pg_temp.uid('sharer2'), 'sharer-phone-0002') ->> 'code';
insert into c select 'quiet', referral.my_code(pg_temp.uid('quiet'), 'quiet-phone-0001') ->> 'code';
create function pg_temp.code(n text) returns text language sql as $$ select code from c where who = n $$;
grant select on c to authenticated, anon;

-- 1. Preferences ----------------------------------------------------------------------------------------------------
select tests.ok(referral.preferences(pg_temp.uid('sharer'), 'sharer-phone-0001')
                = '{"show_name": false, "display_name": null, "participating": true}', 'preferences: the defaults');
select tests.ok(referral.preferences_set(pg_temp.uid('sharer'), 'sharer-phone-0001', '{"show_name": true, "display_name": "  Priya \t K "}')
                = '{"show_name": true, "display_name": "Priya K", "participating": true}', 'set: name trimmed, inner spaces collapsed');
select tests.ok(referral.preferences_set(pg_temp.uid('sharer'), 'sharer-phone-0001', '{"show_name": false}')
                = '{"show_name": false, "display_name": "Priya K", "participating": true}', 'set: one key leaves the others');
select tests.ok(referral.preferences_set(pg_temp.uid('quiet'), 'quiet-phone-0001', '{"display_name": "प्रिया"}') ->> 'display_name' = 'प्रिया',
                'set: a Devanagari name is a name');
select tests.ok(bool_and(referral.preferences_set(pg_temp.uid('quiet'), 'quiet-phone-0001', jsonb_build_object('display_name', n))
                         = '{"reason": "invalid_name"}'), 'set: invalid_name for an email, a link, digits only, 41 letters, an emoji')
  from unnest(array['priya@example.com', 'see https://x.test', '12345', repeat('a', 41), '😀']) n;
select tests.ok(referral.preferences(pg_temp.uid('quiet'), 'quiet-phone-0001') ->> 'display_name' = 'प्रिया', 'a refused name changes nothing');
select tests.ok(referral.preferences_set(pg_temp.uid('quiet'), 'quiet-phone-0001', '{"display_name": ""}') -> 'display_name' = 'null',
                'set: an empty name clears it');
do $$
declare bad jsonb;
begin
  foreach bad in array array['{"photo": "x"}', '{"show_name": "yes"}', '{"participating": 1}', '{"display_name": 5}', '[]']::jsonb[] loop
    begin
      perform referral.preferences_set(pg_temp.uid('sharer'), 'sharer-phone-0001', bad);
      perform tests.ok(false, 'refused: ' || bad::text);
    exception when sqlstate '22023' then
      perform tests.ok(true, 'refused (22023): ' || bad::text);
    end;
  end loop;
end $$;
select tests.ok(referral.preferences(pg_temp.uid('anon_user'), 'anon-phone-0001') = '{"reason": "anonymous_user"}'
                and referral.preferences_set(pg_temp.uid('anon_user'), 'anon-phone-0001', '{"show_name": true}') = '{"reason": "anonymous_user"}',
                'anonymous_user for both');
select tests.ok(referral.preferences(pg_temp.uid('kid'), 'kid-phone-0001') = '{"reason": "under_age"}'
                and referral.preferences_set(pg_temp.uid('kid'), 'kid-phone-0001', '{"show_name": true}') = '{"reason": "under_age"}',
                'under_age for both');

-- the wrappers, as the signed-in user; anon cannot call them
create temp table w (k text primary key, j jsonb);
grant all on w to authenticated, anon;
do $$ begin
  perform tests.act_as('authenticated', pg_temp.uid('sharer'));
  insert into w values ('prefs_set', public.referral_preferences_set('sharer-phone-0001', '{"show_name": true}'));
  insert into w values ('prefs', public.referral_preferences('sharer-phone-0001'));
  reset role;
end $$;
select tests.ok((select j from w where k = 'prefs') = '{"show_name": true, "display_name": "Priya K", "participating": true}'
                and (select j from w where k = 'prefs_set') = (select j from w where k = 'prefs'), 'wrappers: set and read back');
do $$ begin
  perform tests.act_as('anon');
  perform public.referral_preferences('anon-phone-0002');
  reset role;
  perform tests.ok(false, 'anon cannot read preferences');
exception when insufficient_privilege then
  reset role;
  perform tests.ok(true, 'anon cannot read preferences');
end $$;

-- 2. Invite preview -----------------------------------------------------------------------------------------------------
create temp table counts as select (select count(*) from referral.installs) i, (select count(*) from referral.members) m,
                                  (select count(*) from referral.claim_attempts) a;
select tests.ok(referral.invite_preview(pg_temp.code('sharer'))
                = '{"valid": true, "name": "Priya K", "friend_rewards": [{"kind": "minutes", "amount": 30, "params": {}}],
                    "sharer_rewarded": true, "boost": null}', 'preview: opted-in name, the friend''s reward, no boost');
select tests.ok(referral.invite_preview(lower(' ' || pg_temp.code('sharer') || ' ')) ->> 'name' = 'Priya K', 'preview: the code is normalised');
select tests.ok(referral.invite_preview(pg_temp.code('quiet')) -> 'name' = 'null'
                and referral.invite_preview(pg_temp.code('quiet')) ->> 'valid' = 'true', 'preview: no name without opting in');
update referral.members set show_name = true, display_name = 'Quiet' where user_id = pg_temp.uid('quiet');
insert into public.app_minors values (pg_temp.uid('quiet'));
select tests.ok(referral.invite_preview(pg_temp.code('quiet')) -> 'name' = 'null', 'preview: no name when the age check fails');
delete from public.app_minors where user_id = pg_temp.uid('quiet');
select tests.ok(referral.invite_preview(pg_temp.code('quiet')) ->> 'name' = 'Quiet', 'control: shown once the age check passes');
select tests.ok(referral.invite_preview('ZZZZZZZZ') = '{"valid": false}' and referral.invite_preview(null) = '{"valid": false}'
                and referral.invite_preview(repeat('A', 100)) = '{"valid": false}', 'preview: unknown, null or long code: valid false');
update referral.codes set disabled_at = now(), disabled_reason = 'abuse' where user_id = pg_temp.uid('quiet');
select tests.ok(referral.invite_preview(pg_temp.code('quiet')) = '{"valid": false}', 'preview: disabled code: valid false');
insert into referral.retired_codes (code) select code from referral.codes where user_id = pg_temp.uid('quiet');
delete from referral.codes where user_id = pg_temp.uid('quiet');
select tests.ok(referral.invite_preview(pg_temp.code('quiet')) = '{"valid": false}', 'preview: retired code: valid false');
update referral.settings set enabled = false;
select tests.ok(referral.invite_preview(pg_temp.code('sharer')) = '{"valid": false}', 'preview: paused program: valid false');
update referral.settings set enabled = true;
select tests.ok((select (select count(*) from referral.installs) = i and (select count(*) from referral.members) = m
                        and (select count(*) from referral.claim_attempts) = a from counts), 'preview wrote nothing');
do $$ begin
  perform tests.act_as('anon');
  insert into w values ('preview_anon', public.referral_invite_preview(pg_temp.code('sharer')));
  reset role;
end $$;
select tests.ok((select j ->> 'name' = 'Priya K' from w where k = 'preview_anon'), 'anon calls the preview (the invite page)');

-- 3. Leaving and joining again ----------------------------------------------------------------------------------------
select tests.ok(referral.preferences_set(pg_temp.uid('sharer2'), 'sharer-phone-0002', '{"participating": false}')
                = '{"show_name": false, "display_name": null, "participating": false}', 'sharer2 leaves');
select tests.ok(referral.my_code(pg_temp.uid('sharer2'), 'sharer-phone-0002') = '{"code": null, "left": true, "reason": "left"}',
                'my_code: left, no code');
select tests.ok(referral.claim(pg_temp.uid('f5'), pg_temp.code('sharer2'), 'friend-phone-0005') = '{"reason": "unknown_code"}',
                'a claim on a left user''s code: unknown_code');
select tests.ok(referral.invite_preview(pg_temp.code('sharer2')) = '{"valid": false}', 'preview of a left user''s code: valid false');
select tests.ok(referral.claim(pg_temp.uid('sharer2'), pg_temp.code('sharer'), 'sharer-phone-0002') ->> 'reason' = 'ok',
                'a user who left can still claim as a friend');
select tests.ok(referral.preferences_set(pg_temp.uid('sharer2'), 'sharer-phone-0002', '{"participating": true}') ->> 'participating' = 'true',
                'sharer2 joins again');
select tests.ok(referral.my_code(pg_temp.uid('sharer2'), 'sharer-phone-0002') ->> 'code' = pg_temp.code('sharer2'), 'the same code is back');
select tests.ok(referral.claim(pg_temp.uid('f5'), pg_temp.code('sharer2'), 'friend-phone-0005') ->> 'reason' = 'ok', 'and accepts claims again');

-- queued rewards still go out after leaving
insert into public.app_progress values (pg_temp.uid('f5'));
update referral.settings set joined_delay_hours = 24;
select tests.ok(referral.check_activation(pg_temp.uid('f5')) = 'joined', 'f5 joins; rewards queued for a day');
select referral.preferences_set(pg_temp.uid('sharer2'), 'sharer-phone-0002', '{"participating": false}');
select tests.ok((select state = 'queued' from referral.rewards where user_id = pg_temp.uid('sharer2') and who = 'sharer'),
                'leaving leaves the queued reward queued');
update referral.settings set joined_delay_hours = 0;

-- 4. Boosts ------------------------------------------------------------------------------------------------------------
select tests.ok(referral.terms() -> 'boost' = 'null', 'terms: no boost');
select tests.ok(referral.boosted_amount('entitlement_days', 3, 1.5) = 4 and referral.boosted_amount('entitlement_days', 1, 1.2) = 1
                and referral.boosted_amount('minutes', 30, 1.5) = 45, 'amounts: days rounded down, never below the base');
do $$ begin
  insert into referral.boosts (starts_at, ends_at, multiplier) values (now() - interval '1 hour', now() + interval '1 day', 2);
  perform tests.ok(false, 'a boost cannot start in the past');
exception when sqlstate '22023' then perform tests.ok(true, 'a boost cannot start in the past');
end $$;
do $$ begin
  insert into referral.boosts (starts_at, ends_at, multiplier) values (now() + interval '1 day', now() + interval '40 days', 2);
  perform tests.ok(false, 'at most 31 days');
exception when check_violation then perform tests.ok(true, 'at most 31 days');
end $$;
do $$ begin
  insert into referral.boosts (starts_at, ends_at, multiplier) values (now() + interval '1 day', now() + interval '2 days', 6);
  perform tests.ok(false, 'multiplier at most 5');
exception when check_violation then perform tests.ok(true, 'multiplier at most 5');
end $$;
insert into referral.boosts (starts_at, ends_at, multiplier) values (now() + interval '10 days', now() + interval '12 days', 3);
select tests.ok(referral.terms() -> 'boost' = 'null', 'terms: a future boost is not shown');
insert into referral.boosts (starts_at, ends_at, multiplier, budget) values (now(), now() + interval '7 days', 2, 10);
create temp table b as select * from referral.boosts where starts_at = now();
select tests.ok(referral.terms() -> 'boost' = (select jsonb_build_object('starts_at', starts_at, 'ends_at', ends_at, 'multiplier', 2,
                                                  'events', '["joined"]'::jsonb, 'who', '["sharer", "friend"]'::jsonb) from b),
                'terms: the running boost');
do $$ begin
  insert into referral.boosts (starts_at, ends_at, multiplier) values (now() + interval '6 days', now() + interval '8 days', 2);
  perform tests.ok(false, 'overlap refused');
exception when exclusion_violation then perform tests.ok(true, 'overlap refused');
end $$;
delete from referral.boosts where starts_at > now();
select tests.ok(not exists (select 1 from referral.boosts where starts_at > now()), 'a boost not started yet can be deleted');

-- inside the window: both sides boosted; the friend's claim shows it before activating
select tests.ok(referral.claim(pg_temp.uid('f1'), pg_temp.code('sharer'), 'friend-phone-0001') ->> 'reason' = 'ok', 'f1 claims inside the boost');
select tests.ok(referral.my_claim(pg_temp.uid('f1')) -> 'rewards'
                = '[{"kind": "minutes", "amount": 60, "base_amount": 30, "params": {}, "boosted": true}]', 'my_claim: the boosted reward');
insert into public.app_progress values (pg_temp.uid('f1'));
select tests.ok(referral.check_activation(pg_temp.uid('f1')) = 'joined', 'f1 joins');
select tests.ok((select count(*) = 2 and bool_and(amount = 60 and base_amount = 30 and boost_id = (select id from b))
                 from referral.rewards w join referral.referrals r on r.id = w.referral_id where r.friend_id = pg_temp.uid('f1')),
                'both rewards: amount x2, base_amount, boost_id');
-- a paid reward when the boost lists only joined: not boosted
insert into referral.rules (version, event, who, kind, amount, params) values (1, 'paid', 'sharer', 'entitlement_days', 7, '{"entitlement_id": "premium"}');
select referral.queue_rewards((select id from referral.referrals where friend_id = pg_temp.uid('f1')), 'paid');
select tests.ok((select amount = 7 and base_amount = 7 and boost_id is null from referral.rewards
                  where event = 'paid' and user_id = pg_temp.uid('sharer')), 'paid reward not boosted (events = {joined})');
-- claimed before the boost started: not boosted even when it activates during the boost
select tests.ok(referral.claim(pg_temp.uid('f2'), pg_temp.code('sharer'), 'friend-phone-0002') ->> 'reason' = 'ok', 'f2 claims');
update referral.referrals set claimed_at = now() - interval '1 day' where friend_id = pg_temp.uid('f2');
select tests.ok(referral.my_claim(pg_temp.uid('f2')) -> 'rewards'
                = '[{"kind": "minutes", "amount": 30, "base_amount": 30, "params": {}, "boosted": false}]', 'my_claim: claimed outside, not boosted');
insert into public.app_progress values (pg_temp.uid('f2'));
select referral.check_activation(pg_temp.uid('f2'));
select tests.ok((select bool_and(amount = 30 and base_amount = 30 and boost_id is null) from referral.rewards w
                  join referral.referrals r on r.id = w.referral_id where r.friend_id = pg_temp.uid('f2')), 'claimed before the boost: x1');
-- budget: lowered to what is used, so the next claim is not boosted and terms stop showing it
update referral.boosts set budget = 2 where id = (select id from b);
select tests.ok(referral.terms() -> 'boost' = 'null', 'terms: a boost with its budget used up is not shown');
select tests.ok(referral.claim(pg_temp.uid('f3'), pg_temp.code('sharer'), 'friend-phone-0003') ->> 'reason' = 'ok', 'f3 claims');
insert into public.app_progress values (pg_temp.uid('f3'));
select referral.check_activation(pg_temp.uid('f3'));
select tests.ok((select bool_and(amount = 30 and boost_id is null) from referral.rewards w
                  join referral.referrals r on r.id = w.referral_id where r.friend_id = pg_temp.uid('f3')), 'budget used up: not boosted');
-- a started boost: never extended, changed or deleted; it may end earlier (not before now) and lower its budget
do $$
declare stmt text;
begin
  foreach stmt in array array[
    'update referral.boosts set ends_at = ends_at + interval ''1 day''',
    'update referral.boosts set multiplier = 3',
    'update referral.boosts set events = ''{joined,paid}''',
    'update referral.boosts set who = ''{friend}''',
    'update referral.boosts set starts_at = starts_at + interval ''1 hour''',
    'update referral.boosts set budget = 5',
    'update referral.boosts set budget = null',
    'update referral.boosts set ends_at = now() - interval ''1 minute''',
    'delete from referral.boosts'] loop
    begin
      execute stmt;
      perform tests.ok(false, 'started boost refused: ' || stmt);
    exception when sqlstate '22023' then
      perform tests.ok(true, 'started boost refused: ' || stmt);
    end;
  end loop;
end $$;
update referral.boosts set ends_at = now() + interval '1 day', budget = 1 where id = (select id from b);
select tests.ok((select ends_at = now() + interval '1 day' and budget = 1 from referral.boosts), 'it may end earlier and lower its budget');

-- 5. The friend's own claim ---------------------------------------------------------------------------------------------
select tests.ok(referral.my_claim(pg_temp.uid('f6')) = '{"state": "none"}', 'my_claim: none');
select tests.ok(referral.claim(pg_temp.uid('f6'), pg_temp.code('sharer'), 'friend-phone-0006') ->> 'reason' = 'ok', 'f6 claims');
select tests.ok((select j ->> 'state' = 'claimed' and (j ->> 'days_left')::int = 30
                        and (j ->> 'activate_by')::timestamptz = (j ->> 'claimed_at')::timestamptz + interval '30 days'
                        and jsonb_array_length(j -> 'rewards') = 1
                 from (select referral.my_claim(pg_temp.uid('f6')) j) x), 'my_claim: claimed, days_left, activate_by, rewards');
select tests.ok(referral.my_claim(pg_temp.uid('f1')) = jsonb_build_object('state', 'joined', 'joined_at',
                  (select joined_at from referral.referrals where friend_id = pg_temp.uid('f1'))), 'my_claim: joined');
update referral.referrals set state = 'paid', paid_at = now() where friend_id = pg_temp.uid('f2');
select tests.ok(referral.my_claim(pg_temp.uid('f2')) ->> 'state' = 'joined', 'my_claim: paid shows as joined');
update referral.referrals set claimed_at = now() - interval '31 days' where friend_id = pg_temp.uid('f6');
select tests.ok(referral.my_claim(pg_temp.uid('f6')) = '{"state": "expired"}', 'my_claim: past the window is expired before the sweep');
select referral.check_activation(pg_temp.uid('f6'));
select tests.ok(referral.my_claim(pg_temp.uid('f6')) = '{"state": "expired"}', 'my_claim: expired after the sweep');
do $$ begin
  perform tests.act_as('authenticated', pg_temp.uid('f1'));
  insert into w values ('my_claim', public.referral_my_claim('friend-phone-0001'));
  reset role;
end $$;
select tests.ok((select j ->> 'state' = 'joined' from w where k = 'my_claim'), 'wrapper: referral_my_claim');

-- 6. Under age: no install row, no member row ---------------------------------------------------------------------------
select tests.ok(referral.touch_install(pg_temp.uid('kid'), 'kid-phone-0001') is not null, 'touch_install still answers the hash');
select tests.ok(referral.my_code(pg_temp.uid('kid'), 'kid-phone-0001') ->> 'reason' = 'under_age', 'kid: my_code under_age');
select tests.ok(referral.claim(pg_temp.uid('kid'), pg_temp.code('sharer'), 'kid-phone-0001') ->> 'reason' = 'under_age', 'kid: under_age');
select tests.ok(not exists (select 1 from referral.codes where user_id = pg_temp.uid('kid')), 'under age: no code created');
select tests.ok(not exists (select 1 from referral.claim_attempts where user_id = pg_temp.uid('kid')), 'under age: no claim attempt recorded');
do $$ begin
  perform tests.act_as('authenticated', pg_temp.uid('kid'));
  perform public.referral_terms('kid-phone-0001');
  perform public.referral_my_claim('kid-phone-0001');
  reset role;
end $$;
select tests.ok(not exists (select 1 from referral.installs where user_id = pg_temp.uid('kid')), 'under age: no installs row');
select tests.ok(not exists (select 1 from referral.members where user_id = pg_temp.uid('kid')), 'under age: no members row');

-- 7. delete_user clears the new columns ---------------------------------------------------------------------------------
select referral.preferences_set(pg_temp.uid('sharer'), 'sharer-phone-0001', '{"participating": false}');
select referral.delete_user(pg_temp.uid('sharer'));
select tests.ok((select not show_name and display_name is null and left_at is null and deleted_at is not null
                 from referral.members where user_id = pg_temp.uid('sharer')), 'delete_user: name and left_at cleared');

-- privacy: still empty with the new functions and table
select tests.ok(not exists (select 1 from referral.privacy_problems()), 'privacy_problems() empty after migration 23');

rollback;

-- 8. Admin funnel: a fixture of five referrals on known UTC days ----------------------------------------------------------
begin;
create temp table u (name text primary key, id uuid not null);
insert into u select x, gen_random_uuid() from unnest(array['admin', 'nobody', 's', 'f1', 'f2', 'f3', 'f4', 'f5']) x;
insert into auth.users (id, email, email_confirmed_at) select id, name || '@example.test', now() - interval '1 hour' from u;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to authenticated;
insert into rewards.admins (user_id) values (pg_temp.uid('admin'));
insert into referral.rules (version, event, who, kind, amount) values (1, 'joined', 'sharer', 'minutes', 30);
create temp table t as select (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') as today;
insert into referral.referrals (code, sharer_id, friend_id, state, rule_set_version, claimed_at, joined_at, paid_at)
select 'FUNNEL1', pg_temp.uid('s'), pg_temp.uid(f), st, 1, today + c, today + c + j, today + c + p
  from t, (values ('f1', 'joined', interval '1 minute', interval '10 hours', null::interval),
                  ('f2', 'claimed', interval '2 minutes', null, null),
                  ('f3', 'paid', interval '-12 hours', interval '20 hours', interval '30 hours'),
                  ('f4', 'expired', interval '-13 hours', null, null),
                  ('f5', 'joined', interval '-40 days', interval '1 hour', null)) v(f, st, c, j, p);
insert into referral.boosts (starts_at, ends_at, multiplier) values (now(), now() + interval '7 days', 2);
insert into referral.rewards (referral_id, user_id, who, event, rule_id, kind, amount, base_amount, boost_id)
select r.id, pg_temp.uid('s'), 'sharer', 'joined', (select id from referral.rules limit 1), 'minutes', 60, 30, (select id from referral.boosts)
  from referral.referrals r where r.friend_id = pg_temp.uid('f1');

create temp table fu (j jsonb);
grant all on fu to authenticated;
do $$ begin
  perform tests.act_as('authenticated', pg_temp.uid('admin'));
  insert into fu select public.referral_admin_funnel(7);
  reset role;
end $$;
select tests.ok((select jsonb_array_length(j -> 'days') = 7 from fu), 'funnel: 7 days');
select tests.ok((select j -> 'days' -> 6 = jsonb_build_object('day', (select today::date from t), 'claimed', 2, 'joined', 1, 'paid', 0, 'expired', 0)
                 from fu), 'funnel: today (cohort by claim day)');
select tests.ok((select j -> 'days' -> 5 = jsonb_build_object('day', (select today::date - 1 from t), 'claimed', 2, 'joined', 1, 'paid', 1, 'expired', 1)
                 from fu), 'funnel: yesterday, joined and paid counted on the claim day');
select tests.ok((select j -> 'totals' = '{"claimed": 4, "joined": 2, "paid": 1, "expired": 1, "boosted_rewards": 1}' from fu),
                'funnel: totals in the window (the 40-day-old claim is outside)');
select tests.ok((select j -> 'median_hours_to_join' = '15.0' from fu), 'funnel: median hours claim to join');
select tests.ok((public.referral_admin_funnel(60) -> 'totals' ->> 'claimed')::int = 5, 'funnel: 60 days includes the old claim (service role)');
do $$ begin
  perform tests.act_as('authenticated', pg_temp.uid('nobody'));
  perform public.referral_admin_funnel();
  reset role;
  perform tests.ok(false, 'funnel refused for a non-admin');
exception when insufficient_privilege then
  reset role;
  perform tests.ok(sqlerrm = 'referral: not_admin', 'funnel refused for a non-admin');
end $$;
do $$ begin
  perform tests.act_as('anon');
  perform public.referral_admin_funnel();
  reset role;
  perform tests.ok(false, 'anon cannot call the funnel');
exception when insufficient_privilege then
  reset role;
  perform tests.ok(true, 'anon cannot call the funnel');
end $$;
rollback;
