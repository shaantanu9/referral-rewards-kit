-- Grant queue (ADR 6.4): claim one at a time per user, lease, stale writers, outcomes, backoff, daily cap, banked
-- release, review, sweep. Rolled back at the end.
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u select n, gen_random_uuid() from unnest(array['s1', 's2', 'f1', 'f2', 'f3']) n;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to postgres;
insert into referral.rules (version, event, who, kind, amount, params) values (1, 'paid', 'sharer', 'entitlement_days', 5, '{"entitlement_id":"premium"}');

-- three paid rewards, two for s1 and one for s2, all due now
create function pg_temp.reward(sharer text, friend text) returns uuid language plpgsql as $$
declare ref uuid; rid uuid;
begin
  insert into referral.referrals (code, sharer_id, friend_id, rule_set_version, state, paid_at)
    values ('ABCDEFGH', pg_temp.uid(sharer), pg_temp.uid(friend), 1, 'paid', now()) returning id into ref;
  insert into referral.rewards (referral_id, user_id, who, event, rule_id, kind, amount, params, grant_key, available_at)
    select ref, pg_temp.uid(sharer), 'sharer', 'paid', r.id, 'entitlement_days', 5, r.params, 'entitlement:premium', now() - interval '1 minute'
    from referral.rules r where r.event = 'paid' returning id into rid;
  return rid;
end $$;
create temp table r as select pg_temp.reward('s1', 'f1') a, pg_temp.reward('s1', 'f2') b, pg_temp.reward('s2', 'f3') c;
grant select on r to postgres;

-- claim: one per user ------------------------------------------------------------------------------------------------
create temp table claims (n int, j jsonb);
insert into claims select g, public.referral_svc_claim_reward() from generate_series(1, 4) g;
select tests.ok((select count(*) from claims where j is not null) = 2, 'two claims succeed: one per sharer');
select tests.ok((select count(distinct j ->> 'user_id') from claims where j is not null) = 2, 'never two unfinished grants for one sharer');
select tests.ok((select bool_and((j ->> 'days')::int = 5 and j ->> 'entitlement_id' = 'premium' and (j ->> 'attempts')::int = 1)
                 from claims where j is not null), 'claim returns entitlement, days and the attempt count');

create temp table s1 as select (j ->> 'reward_id')::uuid id, (j ->> 'attempt_token')::uuid tok from claims where j ->> 'user_id' = pg_temp.uid('s1')::text;
grant select on s1 to postgres;

-- step 2: target stored once
select tests.ok(public.referral_svc_set_target((select id from s1), (select tok from s1), 1800000000000) ->> 'target_expires_at_ms' = '1800000000000', 'target stored');
select tests.ok(public.referral_svc_set_target((select id from s1), (select tok from s1), 1900000000000) ->> 'target_expires_at_ms' = '1800000000000', 'a stored target is never recomputed');
select tests.ok(public.referral_svc_set_target((select id from s1), gen_random_uuid(), 1900000000000) ->> 'status' = 'lost_lease', 'wrong token cannot set a target');

-- a timeout: retry with backoff, the second s1 reward still waits behind it
select tests.ok(public.referral_svc_finish_reward((select id from s1), (select tok from s1), 'retry', 'timeout') = 'failed_retryable', 'timeout → failed_retryable');
select tests.ok((select available_at > now() and target_expires_at is not null from referral.rewards where id = (select id from s1)),
                'backoff set, target kept for the resend');
update referral.rewards set available_at = now() - interval '1 second' where id = (select id from s1);
-- the other s1 reward is due too, but the unfinished one must go first
do $$
declare j jsonb;
begin
  j := public.referral_svc_claim_reward();
  perform tests.ok(j ->> 'reward_id' = (select id from s1)::text and (j ->> 'target_expires_at_ms')::bigint = 1800000000000
                   and (j ->> 'attempts')::int = 2, 'the retry is claimed again with its stored target; the second reward waits');
  perform tests.ok(public.referral_svc_finish_reward((select id from s1), (select tok from s1), 'granted') = 'lost_lease',
                   'the old attempt''s token can no longer write (stale worker)');
  perform tests.ok(public.referral_svc_finish_reward((select id from s1), (j ->> 'attempt_token')::uuid, 'granted') = 'granted',
                   'the current attempt records granted');
end $$;
select tests.ok((public.referral_svc_claim_reward() ->> 'reward_id')::uuid = (select b from r), 'after the first is granted, the second s1 reward can start');

-- lease: a granting row that never finishes is released by the sweep
update referral.rewards set granting_started_at = now() - interval '16 minutes' where id = (select b from r);
select tests.ok((public.referral_svc_sweep() ->> 'leases_released')::int = 1, 'sweep releases an expired lease');
select tests.ok((select state = 'failed_retryable' and last_error = 'lease expired' and available_at > now() from referral.rewards where id = (select b from r)),
                'released row is failed_retryable with backoff');
-- at max_attempts the lease turns into failed
update referral.settings set max_attempts = 1;
update referral.rewards set state = 'granting', attempt_token = gen_random_uuid(), granting_started_at = now() - interval '16 minutes' where id = (select b from r);
select public.referral_svc_sweep();
select tests.ok((select state from referral.rewards where id = (select b from r)) = 'failed', 'a lease at max_attempts becomes failed');
select tests.ok((public.referral_svc_sweep() -> 'alerts' ->> 'failed_rewards')::int = 1, 'sweep reports failed rewards for the owner');
update referral.settings set max_attempts = 8;

-- owner retry
select tests.ok(referral.admin_retry_reward((select b from r), false) = 'queued', 'owner can retry a failed reward');
select tests.ok((select state = 'queued' and attempts = 0 from referral.rewards where id = (select b from r)), 'retry resets attempts');

-- 429: Retry-After wins
do $$
declare j jsonb;
begin
  j := public.referral_svc_claim_reward();
  perform tests.ok(public.referral_svc_finish_reward((j ->> 'reward_id')::uuid, (j ->> 'attempt_token')::uuid, 'retry', '429', 120) = 'failed_retryable', '429 retried');
  perform tests.ok((select available_at between now() + interval '119 seconds' and now() + interval '121 seconds' from referral.rewards where id = (j ->> 'reward_id')::uuid),
                   'Retry-After decides the next try');
end $$;

-- banked: sharer already pays; released later with a new target
do $$
declare j jsonb; k jsonb;
begin
  select x.j into j from claims x where x.j ->> 'user_id' = pg_temp.uid('s2')::text;
  perform tests.ok(public.referral_svc_finish_reward((j ->> 'reward_id')::uuid, (j ->> 'attempt_token')::uuid, 'banked') = 'banked', 'banked when the sharer already subscribes');
  perform tests.ok(public.referral_svc_sweep() -> 'banked_users' ? pg_temp.uid('s2')::text, 'sweep lists banked sharers for the daily check');
  perform tests.ok(public.referral_svc_release_banked(pg_temp.uid('s2')) = 1, 'release on expiry');
  perform tests.ok((select state = 'queued' and target_expires_at is null from referral.rewards where id = (j ->> 'reward_id')::uuid), 'released reward is queued with no target');
end $$;

-- daily cap
update referral.settings set daily_grant_cap = 1;
select tests.ok((public.referral_svc_claim_reward() ->> 'cap_reached')::boolean, 'daily cap reached: nothing claimed, nothing dropped');
update referral.settings set daily_grant_cap = 500;

-- review: a sharer under review is not granted
update referral.members set review_since = now() where user_id = pg_temp.uid('s2');
insert into referral.members (user_id, review_since) values (pg_temp.uid('s2'), now()) on conflict (user_id) do update set review_since = now();
select tests.ok(not exists (select 1 from (select public.referral_svc_claim_reward() j) x where x.j ->> 'user_id' = pg_temp.uid('s2')::text),
                'a sharer under review waits');
select tests.ok(referral.admin_review(pg_temp.uid('s2'), false) = 'voided', 'owner voids after review');
select tests.ok((select state from referral.rewards where user_id = pg_temp.uid('s2')) = 'void_fraud', 'voided rewards are void_fraud');

-- seen ids (HMAC compare in SQL)
insert into referral.transactions (original_transaction_id_hash, pepper_version, transaction_ids_seen)
  values (referral.hmac('otid-x', 1), 1, array[referral.hmac('tid-x2', 1)]);
update referral.referrals set original_transaction_id_hash = referral.hmac('otid-x', 1) where friend_id = pg_temp.uid('f1');
select tests.ok(public.referral_svc_seen_ids((select a from r), array['tid-x1', 'tid-x2']) = array[false, true], 'seen_ids matches hashed transaction ids');

-- sweep housekeeping
insert into referral.events (event_id, type, fields, event_timestamp_ms, state, processed_at) values ('old', 'RENEWAL', '{}', 1, 'processed', now() - interval '31 days');
insert into referral.claim_attempts (user_id, install_id_hash, at) values (gen_random_uuid(), '\x00', now() - interval '2 hours');
do $$
declare x jsonb := public.referral_svc_sweep();
begin
  perform tests.ok((x ->> 'events_purged')::int = 1 and (x ->> 'claim_attempts_purged')::int = 1, 'sweep purges old events and claim attempts');
  perform tests.ok((x -> 'alerts' ->> 'privacy_problems')::int = 0, 'sweep reports no privacy problems');
end $$;

rollback;
