-- Builds a small referral state and prints the real JSON of the growth RPCs (migration 23), one "name<TAB>json" line
-- each, for packages/referral_kit/test/fixtures/growth/. Run by scripts/growth-fixtures.sh; not a test (no *.test.sql
-- name, so scripts/test-db.sh skips it). Rolled back.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
set timezone = 'UTC'; -- as PostgREST returns it
\o /dev/null
begin;

create temp table u (name text primary key, id uuid not null);
insert into u select x, gen_random_uuid()
  from unnest(array['sharer', 'leaver', 'f_none', 'f_claimed', 'f_joined', 'f_expired', 'f_lapsed', 'admin']) x;
insert into auth.users (id, email, email_confirmed_at) select id, name || '@example.test', now() - interval '1 hour' from u;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to authenticated, anon;
insert into rewards.admins (user_id) values (pg_temp.uid('admin'));

insert into referral.rules (version, event, who, kind, amount, params) values
  (1, 'joined', 'sharer', 'entitlement_days', 7, '{"entitlement_id": "premium"}'),
  (1, 'joined', 'friend', 'minutes', 30, '{}');
create table public.app_progress (user_id uuid not null);
grant select on public.app_progress to postgres;
create or replace function referral_app.app_referral_is_active(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_progress p where p.user_id = app_referral_is_active.user_id) $$;
create or replace function referral_app.app_referral_grant(reward_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$ begin end $$;

-- a boost running now: x2 on joined rewards for both sides, for 7 days
insert into referral.boosts (starts_at, ends_at, multiplier) values (now(), now() + interval '7 days', 2);

create temp table c (who text primary key, code text);
insert into c select 'sharer', referral.my_code(pg_temp.uid('sharer'), 'sharer-phone-0001') ->> 'code';
insert into c select 'leaver', referral.my_code(pg_temp.uid('leaver'), 'leaver-phone-0001') ->> 'code';
grant select on c to authenticated, anon;

select referral.claim(pg_temp.uid('f_claimed'), (select code from c where who = 'sharer'), 'friend-phone-0001');
select referral.claim(pg_temp.uid('f_joined'), (select code from c where who = 'sharer'), 'friend-phone-0002');
insert into public.app_progress values (pg_temp.uid('f_joined'));
select referral.check_activation(pg_temp.uid('f_joined'));
select referral.claim(pg_temp.uid('f_expired'), (select code from c where who = 'sharer'), 'friend-phone-0003');
update referral.referrals set claimed_at = now() - interval '31 days' where friend_id = pg_temp.uid('f_expired');
select referral.check_activation(pg_temp.uid('f_expired'));
-- for the funnel: the joined friend had claimed 26.5 hours earlier; one claim 3 days ago expired (set directly)
update referral.referrals set claimed_at = joined_at - interval '26.5 hours' where friend_id = pg_temp.uid('f_joined');
select referral.claim(pg_temp.uid('f_lapsed'), (select code from c where who = 'sharer'), 'friend-phone-0004');
update referral.referrals set claimed_at = now() - interval '3 days', state = 'expired' where friend_id = pg_temp.uid('f_lapsed');

create temp table out (name text primary key, j jsonb);
grant all on out to authenticated, anon;

do $$ begin
  perform tests.act_as('authenticated', pg_temp.uid('sharer'));
  insert into out values ('preferences_default', public.referral_preferences('sharer-phone-0001'));
  insert into out values ('preferences', public.referral_preferences_set('sharer-phone-0001',
                                             '{"show_name": true, "display_name": "Priya"}'));
  insert into out values ('preferences_invalid_name', public.referral_preferences_set('sharer-phone-0001',
                                             '{"display_name": "priya@example.com"}'));
  insert into out values ('terms_boost', public.referral_terms('sharer-phone-0001'));
  reset role;

  perform tests.act_as('authenticated', pg_temp.uid('leaver'));
  insert into out values ('preferences_left', public.referral_preferences_set('leaver-phone-0001', '{"participating": false}'));
  insert into out values ('my_code_left', public.referral_my_code('leaver-phone-0001'));
  reset role;

  perform tests.act_as('authenticated', pg_temp.uid('f_none'));
  insert into out values ('my_claim_none', public.referral_my_claim('friend-phone-0009'));
  reset role;
  perform tests.act_as('authenticated', pg_temp.uid('f_claimed'));
  insert into out values ('my_claim_claimed', public.referral_my_claim('friend-phone-0001'));
  reset role;
  perform tests.act_as('authenticated', pg_temp.uid('f_joined'));
  insert into out values ('my_claim_joined', public.referral_my_claim('friend-phone-0002'));
  reset role;
  perform tests.act_as('authenticated', pg_temp.uid('f_expired'));
  insert into out values ('my_claim_expired', public.referral_my_claim('friend-phone-0003'));
  reset role;

  perform tests.act_as('anon');
  insert into out values ('invite_preview_valid', public.referral_invite_preview((select code from c where who = 'sharer')));
  insert into out values ('invite_preview_invalid', public.referral_invite_preview((select code from c where who = 'leaver')));
  reset role;

  perform tests.act_as('authenticated', pg_temp.uid('admin'));
  insert into out values ('admin_funnel', public.referral_admin_funnel(7));
  reset role;
end $$;

\o
\pset format unaligned
\pset tuples_only on
\pset fieldsep '\t'
select name, j::text from out order by name;
rollback;
