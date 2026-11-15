-- Worker support (migration 7): need_start carries what the worker matches on; worker_plan's daily banked slot.
\set ON_ERROR_STOP 1
begin;

create function pg_temp.ev(eid text, typ text, f jsonb) returns jsonb language sql as $$
  select jsonb_build_object('event_id', eid, 'type', typ, 'event_timestamp_ms', 1762003600000, 'fields', f) $$;

-- two waiting renewals of one transaction (its INITIAL_PURCHASE was lost), one of another, one running event
select public.referral_svc_ingest_event(pg_temp.ev('w1', 'RENEWAL', '{"app_user_id":"u-1","aliases":["u-1b"],"original_transaction_id":"ot-1","transaction_id":"t-1b","store":"APP_STORE","environment":"PRODUCTION"}'));
select public.referral_svc_ingest_event(pg_temp.ev('w2', 'RENEWAL', '{"app_user_id":"u-1","original_transaction_id":"ot-1","transaction_id":"t-1c","store":"APP_STORE","environment":"PRODUCTION"}'));
select public.referral_svc_ingest_event(pg_temp.ev('w3', 'RENEWAL', '{"app_user_id":"u-2","original_transaction_id":"ot-2","store":"PLAY_STORE","environment":"SANDBOX"}'));
select public.referral_svc_ingest_event(pg_temp.ev('r1', 'RENEWAL', '{"app_user_id":"u-3","original_transaction_id":"ot-3"}'));
update referral.events set state = 'waiting' where event_id in ('w1', 'w2', 'w3');

do $$
declare
  p jsonb;
  a jsonb;
  b jsonb;
begin
  perform tests.act_as('service_role');
  p := public.referral_svc_pending_events(50);
  reset role;
  perform tests.ok(p -> 'run' = '["r1"]', 'run lists the received event only');
  perform tests.ok(jsonb_array_length(p -> 'need_start') = 2, 'one need_start entry per waiting transaction');
  select x into a from jsonb_array_elements(p -> 'need_start') x where x ->> 'original_transaction_id' = 'ot-1';
  select x into b from jsonb_array_elements(p -> 'need_start') x where x ->> 'original_transaction_id' = 'ot-2';
  perform tests.ok(a -> 'event_ids' @> '["w1","w2"]' and jsonb_array_length(a -> 'event_ids') = 2, 'need_start: both waiting event ids');
  perform tests.ok(a -> 'transaction_ids' @> '["t-1b","t-1c"]' and jsonb_array_length(a -> 'transaction_ids') = 2,
                   'need_start: the raw transaction ids seen while waiting');
  perform tests.ok(a -> 'app_user_ids' @> '["u-1","u-1b"]' and jsonb_array_length(a -> 'app_user_ids') = 2, 'need_start: every user id, once');
  perform tests.ok(a ->> 'store' = 'app_store' and a ->> 'environment' = 'production', 'need_start: store and environment, lower case');
  perform tests.ok(b -> 'transaction_ids' = '[]' and b ->> 'store' = 'play_store' and b ->> 'environment' = 'sandbox',
                   'need_start: no transaction id is an empty list');
end $$;

select tests.ok(public.referral_svc_fill_start('ot-1', 1762000000000) = 2, 'fill_start releases both waiting events of the transaction');
select tests.ok(not exists (select 1 from jsonb_array_elements(public.referral_svc_pending_events(50) -> 'need_start') x
                            where x ->> 'original_transaction_id' = 'ot-1'), 'filled transaction no longer needs a start');

-- worker_plan --------------------------------------------------------------------------------------------------------
update referral.settings set worker_batch = 7, worker_time_budget_seconds = 42, entitlement_id = 'premium';
do $$
declare
  p1 jsonb;
  p2 jsonb;
begin
  perform tests.act_as('service_role');
  p1 := public.referral_svc_worker_plan();
  p2 := public.referral_svc_worker_plan();
  reset role;
  perform tests.ok((p1 ->> 'worker_batch')::int = 7 and (p1 ->> 'worker_time_budget_seconds')::int = 42
                   and p1 ->> 'entitlement_id' = 'premium', 'worker_plan: batch, budget and entitlement from settings');
  perform tests.ok((p1 ->> 'banked_check_due')::boolean and not (p2 ->> 'banked_check_due')::boolean,
                   'worker_plan: the banked check is due once a day');
end $$;
update referral.worker_state set last_banked_check_at = now() - interval '25 hours';
select tests.ok((public.referral_svc_worker_plan() ->> 'banked_check_due')::boolean, 'worker_plan: due again after a day');

select tests.ok(not has_function_privilege('authenticated', 'public.referral_svc_worker_plan()', 'EXECUTE')
                and not has_function_privilege('anon', 'public.referral_svc_worker_plan()', 'EXECUTE')
                and has_function_privilege('service_role', 'public.referral_svc_worker_plan()', 'EXECUTE'),
                'worker_plan: service_role only');
select tests.ok(not exists (select 1 from referral.privacy_problems()), 'privacy_problems() still empty');

rollback;
