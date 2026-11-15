-- Paid path: ingest, context + fingerprint, apply with guards, refunds, reversals, transfers, abuse (ADR 6.3, 6.6,
-- 6.7, 8). Decisions are written the way logic.ts returns them; part 7 runs the real logic against this database.
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u select n, gen_random_uuid() from unnest(array['sharer', 'f1', 'f2', 'f3', 'f4', 'f5']) n;
insert into auth.users (id, email, email_confirmed_at) select id, name || '@example.test', now() - interval '1 hour' from u;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to postgres;
update referral.settings set entitlement_id = 'premium';
insert into referral.rules (version, event, who, kind, amount) values (1, 'joined', 'sharer', 'minutes', 30), (1, 'joined', 'friend', 'minutes', 30);
insert into referral.rules (version, event, who, kind, amount, params) values (1, 'paid', 'sharer', 'entitlement_days', 5, '{"entitlement_id":"premium"}');
create table public.app_ledger (reward_id uuid primary key, amount numeric);
grant insert, select on public.app_ledger to postgres;
create or replace function referral_app.app_referral_grant(reward_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin insert into public.app_ledger values (reward_id, amount) on conflict on constraint app_ledger_pkey do nothing; end $$;

create temp table c as select referral.my_code(pg_temp.uid('sharer'), 'sharer-phone-0001') ->> 'code' as code;
select tests.ok(referral.claim(pg_temp.uid(n), (select code from c), n || '-phone-00001') ->> 'reason' = 'ok', 'claim ok for ' || n)
from unnest(array['f1', 'f2', 'f3', 'f4', 'f5']) n;

-- helpers: an event in logic.ts's trimmed shape, and context / apply through the service wrappers
create function pg_temp.ev(eid text, typ text, ts bigint, f jsonb) returns jsonb language sql as $$
  select jsonb_build_object('event_id', eid, 'type', typ, 'event_timestamp_ms', ts, 'fields', f) $$;
create function pg_temp.ms(t timestamptz) returns bigint language sql as $$ select (extract(epoch from t) * 1000)::bigint $$;
create function pg_temp.purchase(friend uuid, otid text, tid text, at timestamptz) returns jsonb language sql as $$
  select jsonb_build_object('app_user_id', friend::text, 'original_transaction_id', otid, 'transaction_id', tid,
    'product_id', 'premium_monthly', 'entitlement_ids', jsonb_build_array('premium'), 'period_type', 'NORMAL', 'price', 4.99,
    'store', 'APP_STORE', 'environment', 'PRODUCTION', 'purchased_at_ms', pg_temp.ms(at)) $$;
create function pg_temp.ctx(eid text) returns jsonb language sql as $$ select public.referral_svc_event_context(eid) $$;
create function pg_temp.apply(eid text, d jsonb) returns text language sql as $$
  select public.referral_svc_apply_event(eid, (pg_temp.ctx(eid)) ->> 'fingerprint', d) $$;
create function pg_temp.ref(n text) returns referral.referrals language sql as $$
  select r from referral.referrals r where r.friend_id = pg_temp.uid(n) $$;

-- ingest ------------------------------------------------------------------------------------------------------------
select tests.ok(public.referral_svc_ingest_event(pg_temp.ev('e1', 'INITIAL_PURCHASE', pg_temp.ms(now()), pg_temp.purchase(pg_temp.uid('f1'), 'otid-1', 'tid-1a', now()))) = 'stored', 'ingest stores a new event');
select tests.ok(public.referral_svc_ingest_event(pg_temp.ev('e1', 'INITIAL_PURCHASE', pg_temp.ms(now()), pg_temp.purchase(pg_temp.uid('f1'), 'otid-1', 'tid-1a', now()))) = 'duplicate', 'ingest: a replay is a duplicate');
select tests.ok((select first_purchased_at_ms is not null and started_at_source = 'initial_purchase' and cardinality(transaction_ids_seen) = 1
                 and store = 'app_store' from referral.transactions where original_transaction_id_hash = referral.find_transaction('otid-1')),
                'ingest records the start, the store and the transaction id (hashed)');
select tests.ok(not exists (select 1 from referral.transactions where original_transaction_id_hash = convert_to('otid-1', 'UTF8')),
                'raw store ids are never the key');

-- context -----------------------------------------------------------------------------------------------------------
do $$
declare x jsonb := pg_temp.ctx('e1');
begin
  perform tests.ok(jsonb_array_length(x -> 'referrals') = 1 and x -> 'referrals' -> 0 ->> 'paid_reward' = 'none'
                   and (x -> 'referrals' -> 0 ->> 'reached_paid')::boolean = false
                   and x -> 'referrals' -> 0 ->> 'state' = 'claimed', 'context: the friend''s referral, nothing paid yet');
  perform tests.ok(x -> 'transaction' ->> 'refunded_at_ms' is null and (x -> 'transaction' ->> 'already_rewarded')::boolean = false
                   and x ->> 'fingerprint' ~ '^[0-9a-f]{32}$', 'context: transaction facts and a fingerprint');
end $$;

-- stale facts are never applied
do $$
declare fp text := pg_temp.ctx('e1') ->> 'fingerprint';
begin
  insert into referral.tombstones (kind, value_hash, pepper_version) values ('transaction', referral.hmac('otid-1', 1), 1);
  perform tests.ok(public.referral_svc_apply_event('e1', fp, '{"event_state":"processed","referrals":[]}') = 'retry',
                   'apply: facts changed since the context (tombstone added) → retry, nothing applied');
  perform tests.ok((select state from referral.events where event_id = 'e1') = 'received', 'event still waiting to run');
  delete from referral.tombstones;
end $$;

-- paid --------------------------------------------------------------------------------------------------------------
select tests.ok(pg_temp.apply('e1', jsonb_build_object('event_state', 'processed', 'referrals', jsonb_build_array(
                jsonb_build_object('referral_id', (pg_temp.ref('f1')).id, 'paid', jsonb_build_object('qualifying_at_ms', pg_temp.ms(now()), 'intro', false))))) = 'applied',
                'apply a paid decision');
select tests.ok((pg_temp.ref('f1')).state = 'paid' and (pg_temp.ref('f1')).joined_at is not null
                and (pg_temp.ref('f1')).original_transaction_id_hash = referral.find_transaction('otid-1'), 'referral is paid and holds the transaction');
select tests.ok((select count(*) from referral.rewards w where w.referral_id = (pg_temp.ref('f1')).id and w.event = 'joined' and w.state = 'granted') = 2,
                'paying before activity counts as joining: both joined rewards granted');
select tests.ok((select state = 'queued' and grant_key = 'entitlement:premium' and available_at between now() + interval '71 hours' and now() + interval '73 hours'
                 from referral.rewards w where w.referral_id = (pg_temp.ref('f1')).id and w.event = 'paid'),
                'paid reward queued for the sharer with the 72 h hold');
select tests.ok(pg_temp.apply('e1', '{"event_state":"processed","referrals":[]}') = 'already_done', 'apply is once per event');

-- guards: the same transaction can never pay twice, even if the logic were wrong
select public.referral_svc_ingest_event(pg_temp.ev('e2', 'RENEWAL', pg_temp.ms(now()), pg_temp.purchase(pg_temp.uid('f2'), 'otid-1', 'tid-1b', now())));
do $$ begin
  perform pg_temp.apply('e2', jsonb_build_object('event_state', 'processed', 'referrals', jsonb_build_array(
          jsonb_build_object('referral_id', (pg_temp.ref('f2')).id, 'paid', jsonb_build_object('qualifying_at_ms', pg_temp.ms(now()), 'intro', false)))));
  raise exception 'second reward for one transaction applied';
exception when invalid_parameter_value then
  perform tests.ok(sqlerrm like '%breaks a precondition%', 'apply refuses a paid decision for an already rewarded transaction');
end $$;

-- refund in the hold → cancelled; reversal → back in the queue ----------------------------------------------------
select public.referral_svc_ingest_event(pg_temp.ev('e3', 'CANCELLATION', pg_temp.ms(now()) + 1000,
  pg_temp.purchase(pg_temp.uid('f1'), 'otid-1', 'tid-1a', now()) || '{"cancel_reason":"CUSTOMER_SUPPORT","price":-4.99}'));
select tests.ok(pg_temp.ctx('e3') -> 'referrals' -> 0 ->> 'paid_reward' = 'held' and (pg_temp.ctx('e3') -> 'referrals' -> 0 ->> 'holds_transaction')::boolean,
                'context: the held reward of the referral holding this transaction');
select tests.ok(pg_temp.apply('e3', jsonb_build_object('event_state', 'processed', 'refund', jsonb_build_object('refunded', true, 'refund_state_ms', pg_temp.ms(now()) + 1000),
                'referrals', jsonb_build_array(jsonb_build_object('referral_id', (pg_temp.ref('f1')).id, 'referral_to', 'paid_cancelled', 'cancel_cause', 'refund')))) = 'applied',
                'apply a refund in the hold');
select tests.ok((pg_temp.ref('f1')).state = 'paid_cancelled' and (pg_temp.ref('f1')).paid_cancel_cause = 'refund'
                and (select state from referral.rewards where referral_id = (pg_temp.ref('f1')).id and event = 'paid') = 'cancelled'
                and (select refunded_at is not null from referral.transactions where original_transaction_id_hash = referral.find_transaction('otid-1')),
                'refund: referral paid_cancelled, reward cancelled, transaction refunded');
select public.referral_svc_ingest_event(pg_temp.ev('e4', 'REFUND_REVERSED', pg_temp.ms(now()) + 2000, pg_temp.purchase(pg_temp.uid('f1'), 'otid-1', 'tid-1a', now())));
select tests.ok(pg_temp.apply('e4', jsonb_build_object('event_state', 'processed', 'refund', jsonb_build_object('refunded', false, 'refund_state_ms', pg_temp.ms(now()) + 2000),
                'referrals', jsonb_build_array(jsonb_build_object('referral_id', (pg_temp.ref('f1')).id, 'uncancel', true, 'remove_intro_mark', false)))) = 'applied',
                'apply a refund reversal');
select tests.ok((pg_temp.ref('f1')).state = 'paid' and (select state from referral.rewards where referral_id = (pg_temp.ref('f1')).id and event = 'paid') = 'queued'
                and (select refunded_at is null from referral.transactions where original_transaction_id_hash = referral.find_transaction('otid-1')),
                'reversal: referral paid again, reward queued, refund cleared');

-- a refund that arrives before its purchase still blocks the reward -------------------------------------------------
select public.referral_svc_ingest_event(pg_temp.ev('e5', 'CANCELLATION', pg_temp.ms(now()) + 5000,
  pg_temp.purchase(pg_temp.uid('f3'), 'otid-3', 'tid-3a', now()) || '{"cancel_reason":"CUSTOMER_SUPPORT","price":-4.99}'));
select pg_temp.apply('e5', jsonb_build_object('event_state', 'processed', 'refund', jsonb_build_object('refunded', true, 'refund_state_ms', pg_temp.ms(now()) + 5000), 'referrals', '[]'::jsonb));
select public.referral_svc_ingest_event(pg_temp.ev('e6', 'INITIAL_PURCHASE', pg_temp.ms(now()), pg_temp.purchase(pg_temp.uid('f3'), 'otid-3', 'tid-3a', now())));
select tests.ok(pg_temp.ctx('e6') -> 'transaction' ->> 'refunded_at_ms' is not null, 'early refund is visible to the later purchase');
do $$ begin
  perform pg_temp.apply('e6', jsonb_build_object('event_state', 'processed', 'referrals', jsonb_build_array(
          jsonb_build_object('referral_id', (pg_temp.ref('f3')).id, 'paid', jsonb_build_object('qualifying_at_ms', pg_temp.ms(now()), 'intro', false)))));
  raise exception 'refunded purchase rewarded';
exception when invalid_parameter_value then perform tests.ok(true, 'apply refuses to reward a refunded transaction');
end $$;

-- transfer away while held: cancelled with cause transfer, and a reversal does not undo it ------------------------
select public.referral_svc_ingest_event(pg_temp.ev('e7', 'INITIAL_PURCHASE', pg_temp.ms(now()), pg_temp.purchase(pg_temp.uid('f4'), 'otid-4', 'tid-4a', now())));
select pg_temp.apply('e7', jsonb_build_object('event_state', 'processed', 'referrals', jsonb_build_array(
       jsonb_build_object('referral_id', (pg_temp.ref('f4')).id, 'paid', jsonb_build_object('qualifying_at_ms', pg_temp.ms(now()), 'intro', true)))));
select public.referral_svc_ingest_event(pg_temp.ev('e8', 'TRANSFER', pg_temp.ms(now()) + 100,
  jsonb_build_object('transferred_from', jsonb_build_array(pg_temp.uid('f4')::text), 'transferred_to', jsonb_build_array(gen_random_uuid()::text))));
select tests.ok(jsonb_array_length(pg_temp.ctx('e8') -> 'referrals') = 1, 'transfer matched on transferred_from');
select pg_temp.apply('e8', jsonb_build_object('event_state', 'processed', 'referrals', jsonb_build_array(
       jsonb_build_object('referral_id', (pg_temp.ref('f4')).id, 'referral_to', 'paid_cancelled', 'cancel_cause', 'transfer'))));
select tests.ok((pg_temp.ref('f4')).paid_cancel_cause = 'transfer'
                and (select state from referral.rewards where referral_id = (pg_temp.ref('f4')).id and event = 'paid') = 'cancelled',
                'transfer away cancels the held reward');
select public.referral_svc_ingest_event(pg_temp.ev('e9', 'REFUND_REVERSED', pg_temp.ms(now()) + 200, pg_temp.purchase(pg_temp.uid('f4'), 'otid-4', 'tid-4a', now())));
select pg_temp.apply('e9', jsonb_build_object('event_state', 'processed', 'refund', jsonb_build_object('refunded', false, 'refund_state_ms', pg_temp.ms(now()) + 200),
       'referrals', jsonb_build_array(jsonb_build_object('referral_id', (pg_temp.ref('f4')).id, 'uncancel', true))));
select tests.ok((pg_temp.ref('f4')).state = 'paid_cancelled', 'a refund reversal never undoes a transfer cancel');

-- late refund and abuse threshold -----------------------------------------------------------------------------------
update referral.rewards set state = 'granted' where referral_id = (pg_temp.ref('f1')).id and event = 'paid';
select public.referral_svc_ingest_event(pg_temp.ev('e10', 'CANCELLATION', pg_temp.ms(now()) + 9000,
  pg_temp.purchase(pg_temp.uid('f1'), 'otid-1', 'tid-1a', now()) || '{"cancel_reason":"CUSTOMER_SUPPORT","price":-4.99}'));
select tests.ok(pg_temp.ctx('e10') -> 'referrals' -> 0 ->> 'paid_reward' = 'granted', 'context: reward already granted');
select pg_temp.apply('e10', jsonb_build_object('event_state', 'processed', 'refund', jsonb_build_object('refunded', true, 'refund_state_ms', pg_temp.ms(now()) + 9000),
       'referrals', jsonb_build_array(jsonb_build_object('referral_id', (pg_temp.ref('f1')).id, 'referral_to', 'refunded_late', 'abuse_marks', jsonb_build_array('late_refund', 'intro_refund')))));
select tests.ok((pg_temp.ref('f1')).state = 'refunded_late'
                and (select state from referral.rewards where referral_id = (pg_temp.ref('f1')).id and event = 'paid') = 'granted',
                'late refund: no clawback, referral refunded_late');
select tests.ok((select count(*) from referral.abuse_marks where user_id = pg_temp.uid('sharer')) = 2, 'one event can carry two abuse causes');
select tests.ok(exists (select 1 from referral.codes where user_id = pg_temp.uid('sharer') and disabled_at is null), 'two marks: code still active');
select pg_temp.apply('e10', jsonb_build_object('event_state', 'processed'));
select public.referral_svc_ingest_event(pg_temp.ev('e11', 'TRANSFER', pg_temp.ms(now()) + 300,
  jsonb_build_object('transferred_from', jsonb_build_array(gen_random_uuid()::text), 'transferred_to', jsonb_build_array(pg_temp.uid('f5')::text))));
select pg_temp.apply('e11', jsonb_build_object('event_state', 'processed', 'referrals', jsonb_build_array(
       jsonb_build_object('referral_id', (pg_temp.ref('f5')).id, 'abuse_marks', jsonb_build_array('transfer_in')))));
select tests.ok(not exists (select 1 from referral.codes where user_id = pg_temp.uid('sharer') and disabled_at is null)
                and (select review_since is not null from referral.members where user_id = pg_temp.uid('sharer')),
                'third mark: code disabled for abuse and the sharer under review');
select pg_temp.apply('e11', jsonb_build_object('event_state', 'processed', 'referrals', jsonb_build_array(
       jsonb_build_object('referral_id', (pg_temp.ref('f5')).id, 'abuse_marks', jsonb_build_array('transfer_in')))));
select tests.ok((select count(*) from referral.abuse_marks where user_id = pg_temp.uid('sharer')) = 3, 'replaying an event adds no mark');

-- lost INITIAL_PURCHASE: wait for the start, then run again ---------------------------------------------------------
select public.referral_svc_ingest_event(pg_temp.ev('e12', 'RENEWAL', pg_temp.ms(now()), pg_temp.purchase(pg_temp.uid('f2'), 'otid-12', 'tid-12b', now())));
select pg_temp.apply('e12', '{"event_state":"waiting"}');
select tests.ok(public.referral_svc_pending_events() -> 'need_start' @> jsonb_build_array(jsonb_build_object('original_transaction_id', 'otid-12')),
                'worker is told to fetch the start of a waiting transaction');
select tests.ok(public.referral_svc_fill_start('otid-12', pg_temp.ms(now() - interval '10 minutes')) = 1, 'fill_start re-queues one waiting event');
select tests.ok((select state from referral.events where event_id = 'e12') = 'received'
                and (select started_at_source from referral.transactions where original_transaction_id_hash = referral.find_transaction('otid-12')) = 'api_starts_at',
                'fill_start records the start from the API and re-queues the event');

-- failures
select public.referral_svc_ingest_event(pg_temp.ev('e13', 'INITIAL_PURCHASE', pg_temp.ms(now()), pg_temp.purchase(pg_temp.uid('f5'), 'otid-13', 'tid-13a', now())));
update referral.settings set max_attempts = 2;
select tests.ok(public.referral_svc_mark_event_failed('e13', 'boom') = 'will_retry', 'a failing event is retried');
select tests.ok(public.referral_svc_mark_event_failed('e13', 'boom') = 'alert_owner', 'at max_attempts the owner is alerted');
select tests.ok((public.referral_svc_pending_events() ->> 'failed_for_owner')::int = 1 and not (public.referral_svc_pending_events() -> 'run') ? 'e13',
                'an event past max_attempts is not run again and is counted for the owner');

-- only the service role can call these
do $$ begin
  perform tests.act_as('authenticated', pg_temp.uid('f1'));
  perform public.referral_svc_ingest_event(pg_temp.ev('x', 'INITIAL_PURCHASE', 1, '{}'));
  raise exception 'authenticated ingested an event';
exception when insufficient_privilege then reset role; perform tests.ok(true, 'authenticated cannot call referral_svc_ingest_event');
end $$;

rollback;
