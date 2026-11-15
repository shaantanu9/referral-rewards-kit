-- Rewards engine: entitlement_days leases for the Edge Function, deletion, retention and the referral bridge
-- (ADR 0002 sections 7, 9, 10.1, 12).
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u values ('sharer', gen_random_uuid()), ('friend', gen_random_uuid()), ('x', gen_random_uuid());
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
create table public.app_coins (grant_id uuid primary key, user_id uuid, amount numeric);
grant select, insert on public.app_coins to postgres;
create or replace function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_coins values (grant_id, user_id, amount) on conflict do nothing;
end $$;

insert into rewards.event_types (name, source) values ('lesson_done', 'client');
insert into rewards.programs (key, kind, config) values ('lessons', 'milestone', '{"event":"lesson_done"}');
insert into rewards.rules (program_key, threshold, kind, amount, params) values
  ('lessons', 1, 'entitlement_days', 3, '{"entitlement_id":"premium"}');

-- entitlement_days waits for the worker
select rewards.track(pg_temp.uid('x'), 'lesson_done', 'l1', '{}', null, false);
select tests.ok((select state from rewards.grants where kind = 'entitlement_days') = 'queued', 'entitlement_days stays queued');
select tests.ok(rewards.retry_local() = 0, 'retry_local never touches entitlement_days');

create temp table cl as select public.rewards_svc_claim_grants(10) j;
select tests.ok((select jsonb_array_length(j) = 1 and j -> 0 ->> 'entitlement_id' = 'premium' and (j -> 0 ->> 'days')::int = 3
                 and not (j -> 0 ->> 'user_deleted')::boolean from cl), 'claim returns the grant with entitlement and days');
select tests.ok(jsonb_array_length(rewards.claim_grants(10)) = 0, 'a leased grant is not claimed twice');
select tests.ok(public.rewards_svc_set_target((select (j -> 0 ->> 'grant_id')::uuid from cl), (select (j -> 0 ->> 'attempt_token')::uuid from cl), 1000),
                'set_target with the lease token');
select tests.ok(public.rewards_svc_set_target((select (j -> 0 ->> 'grant_id')::uuid from cl), (select (j -> 0 ->> 'attempt_token')::uuid from cl), 2000)
                and (select target_expires_at_ms from rewards.grants where kind = 'entitlement_days') = 1000,
                'the first stored target is kept on a retry');
select tests.ok(not rewards.set_target((select (j -> 0 ->> 'grant_id')::uuid from cl), gen_random_uuid(), 5), 'set_target with a wrong token refused');
select tests.ok((rewards.finish_grant((select (j -> 0 ->> 'grant_id')::uuid from cl), gen_random_uuid(), 'granted', null, null) ->> 'state') = 'lost_lease',
                'finish with a wrong token: lost_lease');
select tests.ok((rewards.finish_grant((select (j -> 0 ->> 'grant_id')::uuid from cl), (select (j -> 0 ->> 'attempt_token')::uuid from cl), 'retry', 'rc 503', null) ->> 'state')
                = 'failed_retryable', 'retry outcome: failed_retryable');
-- expired lease returns to the queue
create temp table cl2 as select rewards.claim_grants(10) j;
update rewards.grants set granting_started_at = now() - interval '1 hour' where kind = 'entitlement_days';
create temp table cl3 as select rewards.claim_grants(10) j;
select tests.ok((select jsonb_array_length(j) = 1 and (j -> 0 ->> 'attempt_token') <> (select j -> 0 ->> 'attempt_token' from cl2) from cl3),
                'an expired lease is reclaimed with a new token');
select tests.ok((rewards.finish_grant((select (j -> 0 ->> 'grant_id')::uuid from cl2), (select (j -> 0 ->> 'attempt_token')::uuid from cl2), 'granted', null, null) ->> 'state')
                = 'lost_lease', 'the old lease can no longer finish');
select tests.ok((rewards.finish_grant((select (j -> 0 ->> 'grant_id')::uuid from cl3), (select (j -> 0 ->> 'attempt_token')::uuid from cl3), 'granted', null, 9000) ->> 'state')
                = 'granted', 'the new lease finishes: granted');
do $$ begin
  perform rewards.finish_grant(gen_random_uuid(), gen_random_uuid(), 'maybe', null, null);
  raise exception 'bad outcome';
exception when sqlstate '22023' then perform tests.ok(true, 'unknown outcome refused');
end $$;

-- max attempts on retry
update rewards.settings set max_attempts = 1;
select rewards.track(pg_temp.uid('sharer'), 'lesson_done', 'l1', '{}', null, false);
create temp table cl4 as select rewards.claim_grants(10) j;
select tests.ok((rewards.finish_grant((select (j -> 0 ->> 'grant_id')::uuid from cl4), (select (j -> 0 ->> 'attempt_token')::uuid from cl4), 'retry', 'x', null) ->> 'state')
                = 'failed', 'retry at max_attempts: failed');
update rewards.settings set max_attempts = 8;

-- deletion
select rewards.track(pg_temp.uid('x'), 'lesson_done', 'l2', '{"page":3}', null, false);
insert into rewards.programs (key, kind, config) values ('ig', 'social_tag', '{"platform":"instagram","account":"myapp","code_prefix":"AB"}');
select rewards.social_start(pg_temp.uid('x'), 'ig', 'x.handle');
insert into rewards.rules (program_key, threshold, repeat, kind, amount, params) values ('lessons', 1, 'every', 'entitlement_days', 1, '{"entitlement_id":"premium"}');
select rewards.track(pg_temp.uid('x'), 'lesson_done', 'l3', '{}', null, false);
create temp table d as select public.rewards_svc_delete_user(pg_temp.uid('x')) j;
select tests.ok((select (j ->> 'social_posts')::int = 1 and (j ->> 'cancelled')::int >= 1 from d), 'delete removes the post and cancels open grants');
select tests.ok(not exists (select 1 from rewards.events where user_id = pg_temp.uid('x'))
                and not exists (select 1 from rewards.social_posts where handle = 'x.handle')
                and not exists (select 1 from rewards.counters where user_id = pg_temp.uid('x')), 'events, handle and counters gone');
select tests.ok(not exists (select 1 from rewards.grants where user_id = pg_temp.uid('x'))
                and exists (select 1 from rewards.grants where user_id is null and state = 'granted'), 'grants kept without the user id');
select tests.ok(jsonb_array_length(rewards.claim_grants(10)) = 0, 'cancelled grants of a deleted user are never claimed');

-- auth delete trigger
create trigger rewards_delete_user before delete on auth.users for each row execute function rewards.on_auth_user_deleted();
insert into auth.users (id, email, email_confirmed_at) values (pg_temp.uid('friend'), 'f@example.test', now() - interval '1 hour'),
                                                             (pg_temp.uid('sharer'), 's@example.test', now() - interval '1 hour');
select rewards.track(pg_temp.uid('friend'), 'lesson_done', 'z', '{}', null, false);

-- retention: milestone events keep their row (props cleared), other events go
insert into rewards.event_types (name, source) values ('app_open', 'client');
select rewards.track(pg_temp.uid('friend'), 'app_open', 'o1', '{"a":1}', null, false);
update rewards.events set occurred_at = now() - interval '100 days' where user_id = pg_temp.uid('friend');
update rewards.events set props = '{"page":1}' where user_id = pg_temp.uid('friend') and type = 'lesson_done';
select rewards.purge_events();
select tests.ok(not exists (select 1 from rewards.events where user_id = pg_temp.uid('friend') and type = 'app_open'), 'old plain events purged');
select tests.ok((select props = '{}' from rewards.events where user_id = pg_temp.uid('friend') and type = 'lesson_done'),
                'old milestone events kept with props cleared');
select tests.ok((rewards.track(pg_temp.uid('friend'), 'lesson_done', 'z', '{}', null, false) ->> 'duplicate')::boolean,
                'a purged-props milestone event still deduplicates');

-- referral bridge ---------------------------------------------------------------------------------------------------
select tests.ok(exists (select 1 from pg_trigger where tgname = 'rewards_bridge'), 'bridge trigger installed on referral.referrals');
insert into rewards.programs (key, kind, config) values ('inviter', 'milestone', '{"event":"referral_joined"}'),
                                                        ('welcomed', 'milestone', '{"event":"referral_welcomed"}');
insert into rewards.rules (program_key, threshold, kind, amount, params) values ('inviter', 1, 'badge', 1, '{"badge":"connector"}'),
                                                                                ('welcomed', 1, 'coins', 25, '{}');
create or replace function referral_app.app_referral_is_active(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select true $$;
create or replace function referral_app.app_referral_grant(reward_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$ begin null; end $$;
insert into referral.rules (version, event, who, kind, amount) values (1, 'joined', 'sharer', 'minutes', 30);
create temp table c as select referral.my_code(pg_temp.uid('sharer'), 'sharer-phone-0001') ->> 'code' as code;
grant select on c to postgres;
create temp table cr as select referral.claim(pg_temp.uid('friend'), (select code from c), 'friend-phone-0001') j;
select tests.ok((select j ->> 'reason' from cr) = 'ok', 'friend claims: ' || (select j::text from cr));
select tests.ok(referral.check_activation(pg_temp.uid('friend')) = 'joined', 'friend joins');
select tests.ok(exists (select 1 from rewards.badges where user_id = pg_temp.uid('sharer') and badge = 'connector'),
                'sharer earns the "invite 1 friend" badge through the bridge');
select tests.ok(exists (select 1 from public.app_coins where user_id = pg_temp.uid('friend') and amount = 25),
                'friend earns the welcome milestone through the bridge');
update referral.referrals set state = 'paid', paid_at = now() where friend_id = pg_temp.uid('friend');
select tests.ok(exists (select 1 from rewards.events where user_id = pg_temp.uid('sharer') and type = 'referral_paid'),
                'paid referral becomes a referral_paid event for the sharer');
update referral.referrals set state = 'paid' where friend_id = pg_temp.uid('friend');
select tests.ok((select count(*) from rewards.events where type = 'referral_paid') = 1, 'no event when the state does not change');

-- a failing rewards side never blocks the referral
-- the sharer already has one referral_joined event in 24 h, so a limit of 1 makes rewards.track raise
update rewards.event_types set daily_limit = 1 where name = 'referral_joined';
update referral.referrals set state = 'joined' where friend_id = pg_temp.uid('friend');
select tests.ok((select state from referral.referrals where friend_id = pg_temp.uid('friend')) = 'joined',
                'referral update succeeds even when the rewards bridge fails');

delete from auth.users where id = pg_temp.uid('friend');
select tests.ok(not exists (select 1 from rewards.events where user_id = pg_temp.uid('friend')), 'auth delete trigger removes rewards data');

-- state shape
create temp table st as select rewards.state(pg_temp.uid('sharer')) j;
select tests.ok((select j ?& array['enabled', 'server_time', 'programs', 'streaks', 'milestones', 'offers', 'social', 'inbox', 'badges'] from st),
                'state has every top-level key from ADR 0002 section 11');
select tests.ok((select j -> 'badges' -> 0 ->> 'badge' = 'connector' from st), 'state lists badges');
update rewards.settings set enabled = false;
select tests.ok(not (rewards.state(pg_temp.uid('sharer')) ->> 'enabled')::boolean, 'disabled engine: enabled false in state');

rollback;
