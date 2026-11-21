-- Worker follow-ups (migration 17): give up on events waiting for a start, banked release per entitlement, lifetime
-- fallback. Rolled back at the end.
\set ON_ERROR_STOP 1
begin;

update referral.settings set paid_window_days = 90, events_retention_days = 30, entitlement_id = 'premium';

-- 1. give up on waiting events ---------------------------------------------------------------------------------------
create function pg_temp.ev(eid text, f jsonb) returns jsonb language sql as $$
  select jsonb_build_object('event_id', eid, 'type', 'RENEWAL', 'event_timestamp_ms', 1762003600000, 'fields', f) $$;
select public.referral_svc_ingest_event(pg_temp.ev('old', '{"app_user_id":"u-1","original_transaction_id":"ot-old"}'));
select public.referral_svc_ingest_event(pg_temp.ev('young', '{"app_user_id":"u-2","original_transaction_id":"ot-young"}'));
update referral.events set state = 'waiting' where event_id in ('old', 'young');
update referral.events set received_at = now() - interval '91 days' where event_id = 'old';
update referral.events set received_at = now() - interval '89 days' where event_id = 'young';

create temp table sw (n int, j jsonb);
grant all on sw to postgres;
do $$
declare a jsonb; b jsonb;
begin
  perform tests.act_as('service_role');
  a := public.referral_svc_sweep();
  b := public.referral_svc_sweep();
  reset role;
  insert into sw values (1, a), (2, b);
end $$;

select tests.ok((select state from referral.events where event_id = 'old') = 'given_up',
                'give up: a waiting event received more than paid_window_days ago is given up');
select tests.ok((select last_error from referral.events where event_id = 'old')
                  = 'start not found: gave up 90 days (paid_window_days) after the event was received',
                'give up: the reason is recorded');
select tests.ok((select processed_at is not null from referral.events where event_id = 'old'), 'give up: processed_at set');
select tests.ok((select state from referral.events where event_id = 'young') = 'waiting',
                'give up: an event inside paid_window_days keeps waiting');
select tests.ok((select (j ->> 'starts_given_up')::int = 1 and (j -> 'alerts' ->> 'starts_given_up')::int = 1 from sw where n = 1),
                'give up: the sweep reports and alerts it once');
select tests.ok((select (j ->> 'starts_given_up')::int = 0 and not (j -> 'alerts' ? 'starts_given_up') from sw where n = 2),
                'give up: the next sweep does not alert again');
select tests.ok(not exists (select 1 from jsonb_array_elements(public.referral_svc_pending_events(50) -> 'need_start') x
                            where x ->> 'original_transaction_id' = 'ot-old'), 'give up: the worker no longer looks for its start');
select tests.ok(public.referral_svc_fill_start('ot-old', 1762000000000) = 0, 'give up: a late start does not re-run it');
select tests.ok(public.referral_svc_mark_event_failed('old', 'x') = 'unknown_event', 'give up: it cannot be marked failed');
update referral.events set processed_at = now() - interval '31 days' where event_id = 'old';
select public.referral_svc_sweep();
select tests.ok(not exists (select 1 from referral.events where event_id = 'old'), 'give up: purged after events_retention_days');
select tests.ok(exists (select 1 from referral.events where event_id = 'young'), 'give up: a waiting event is never purged');

-- 2. banked release per entitlement ----------------------------------------------------------------------------------
create temp table u (name text primary key, id uuid not null);
insert into u select n, gen_random_uuid() from unnest(array['s1', 'f1', 'f2', 'f3', 's2', 'f4']) n;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to postgres;
insert into referral.rules (version, event, who, kind, amount, params) values
  (1, 'paid', 'sharer', 'entitlement_days', 5, '{"entitlement_id":"premium"}'),
  (2, 'paid', 'sharer', 'entitlement_days', 5, '{"entitlement_id":"pro"}'),
  (3, 'paid', 'sharer', 'entitlement_days', 7, '{"entitlement_id":"premium","fallback":{"kind":"coins","amount":50,"params":{"note":"x"}}}'),
  (4, 'paid', 'sharer', 'entitlement_days', 7, '{"entitlement_id":"premium"}');

create function pg_temp.reward(sharer text, friend text, ver int, st text) returns uuid language plpgsql as $$
declare ref uuid; rid uuid;
begin
  insert into referral.referrals (code, sharer_id, friend_id, rule_set_version, state, paid_at)
    values ('ABCDEFGH', pg_temp.uid(sharer), pg_temp.uid(friend), ver, 'paid', now()) returning id into ref;
  insert into referral.rewards (referral_id, user_id, who, event, rule_id, kind, amount, params, grant_key, state, available_at)
    select ref, pg_temp.uid(sharer), 'sharer', 'paid', r.id, 'entitlement_days', r.amount, r.params,
           'entitlement:' || (r.params ->> 'entitlement_id'), st, now() - interval '1 minute'
    from referral.rules r where r.version = ver returning id into rid;
  return rid;
end $$;
create temp table r as select pg_temp.reward('s1', 'f1', 1, 'banked') premium, pg_temp.reward('s1', 'f2', 2, 'banked') pro;
grant select on r to postgres;

select tests.ok((select x -> 'entitlement_ids' from jsonb_array_elements(public.referral_svc_sweep() -> 'banked') x
                  where x ->> 'user_id' = pg_temp.uid('s1')::text) = '["premium", "pro"]',
                'banked: the sweep lists each banked user with their entitlements');
do $$
declare n int; s1 uuid := pg_temp.uid('s1');
begin
  perform tests.act_as('service_role');
  n := public.referral_svc_release_banked_keys(s1, array['pro']);
  reset role;
  perform tests.ok(n = 1, 'banked: release names one entitlement');
end $$;
select tests.ok((select state from referral.rewards where id = (select pro from r)) = 'queued', 'banked: the pro reward is released');
select tests.ok((select state from referral.rewards where id = (select premium from r)) = 'banked', 'banked: the premium reward stays banked');
select tests.ok(public.referral_svc_release_banked_keys(pg_temp.uid('s1'), array['other']) = 0
                and public.referral_svc_release_banked_keys(pg_temp.uid('s1'), null) = 0, 'banked: unknown or no keys release nothing');
select tests.ok(not has_function_privilege('authenticated', 'public.referral_svc_release_banked_keys(uuid, text[])', 'EXECUTE')
                and not has_function_privilege('anon', 'public.referral_svc_release_banked_keys(uuid, text[])', 'EXECUTE')
                and has_function_privilege('service_role', 'public.referral_svc_release_banked_keys(uuid, text[])', 'EXECUTE'),
                'banked: release_banked_keys is service_role only');
update referral.rewards set state = 'cancelled' where user_id = pg_temp.uid('s1');

-- 3. lifetime fallback -----------------------------------------------------------------------------------------------
create function pg_temp.rule_rejected(kind text, params jsonb) returns boolean language plpgsql as $$
begin
  insert into referral.rules (version, event, who, kind, amount, params) values (9, 'paid', 'sharer', kind, 1, params);
  return false;
exception when check_violation then
  return true;
end $$;
select tests.ok(pg_temp.rule_rejected('entitlement_days', '{"fallback":{"kind":"entitlement_days","amount":1}}'), 'fallback: kind entitlement_days refused');
select tests.ok(pg_temp.rule_rejected('entitlement_days', '{"fallback":{"kind":"coins","amount":0}}'), 'fallback: amount 0 refused');
select tests.ok(pg_temp.rule_rejected('entitlement_days', '{"fallback":{"kind":"coins","amount":"5"}}'), 'fallback: amount as text refused');
select tests.ok(pg_temp.rule_rejected('entitlement_days', '{"fallback":{"kind":"Coins!","amount":5}}'), 'fallback: bad kind refused');
select tests.ok(pg_temp.rule_rejected('entitlement_days', '{"fallback":{"kind":"coins","amount":5,"params":[1]}}'), 'fallback: params must be an object');
select tests.ok(pg_temp.rule_rejected('entitlement_days', '{"fallback":"coins"}'), 'fallback: must be an object');
select tests.ok(pg_temp.rule_rejected('coins', '{"fallback":{"kind":"minutes","amount":5}}'), 'fallback: only on entitlement_days rules');
select tests.ok(not pg_temp.rule_rejected('entitlement_days', '{"fallback":{"kind":"coins","amount":2.5}}'), 'fallback: a valid one is accepted');

create temp table hook_calls (reward_id uuid, kind text, amount numeric, params jsonb);
grant all on hook_calls to postgres;
create or replace function referral_app.app_referral_grant(reward_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into pg_temp.hook_calls values (reward_id, kind, amount, params);
end $$;

create temp table fr as select pg_temp.reward('s2', 'f3', 3, 'queued') fb, pg_temp.reward('s2', 'f4', 4, 'queued') plain;
grant select on fr to postgres;
update referral.rewards set available_at = now() + interval '1 day' where id = (select plain from fr);
create temp table c as select public.referral_svc_claim_reward() j;
grant select on c to postgres;
select tests.ok((select (j ->> 'reward_id')::uuid from c) = (select fb from fr), 'fallback: the reward is claimed as entitlement_days');
select tests.ok((select j -> 'params' -> 'fallback' ->> 'kind' from c) = 'coins', 'fallback: the claim carries params.fallback');
select tests.ok(public.referral_svc_fallback_reward((select fb from fr), gen_random_uuid()) = 'lost_lease', 'fallback: a wrong token changes nothing');
do $$
declare res text; rid uuid := (select fb from fr); tok uuid := (select (j ->> 'attempt_token')::uuid from c);
begin
  perform tests.act_as('service_role');
  res := public.referral_svc_fallback_reward(rid, tok);
  reset role;
  perform tests.ok(res = 'granted', 'fallback: granted through the app hook');
end $$;
select tests.ok((select kind = 'coins' and amount = 50 and state = 'granted' and grant_key is null and target_expires_at is null
                   and attempt_token is null
                 from referral.rewards where id = (select fb from fr)), 'fallback: the reward became the fallback kind');
select tests.ok((select base_amount = 50 and boost_id is null from referral.rewards where id = (select fb from fr)),
                'fallback: base_amount follows the fallback amount and it carries no boost (migration 25)');
select tests.ok((select params -> 'fallback_from' = '{"kind":"entitlement_days","amount":7,"grant_key":"entitlement:premium","reason":"lifetime"}'
                   and params ->> 'note' = 'x'
                 from referral.rewards where id = (select fb from fr)), 'fallback: the original reward is kept in params.fallback_from');
select tests.ok((select count(*) = 1 and bool_and(kind = 'coins' and amount = 50) from hook_calls), 'fallback: the hook was called once');
select tests.ok(public.referral_svc_claim_reward() is null, 'fallback: the RevenueCat worker never claims it again');

-- a reward without params.fallback: no_fallback, still granting (the worker then cancels it with `lifetime`)
update referral.rewards set available_at = now() - interval '1 minute' where id = (select plain from fr);
create temp table c2 as select public.referral_svc_claim_reward() j;
grant select on c2 to postgres;
select tests.ok(public.referral_svc_fallback_reward((select plain from fr), (select (j ->> 'attempt_token')::uuid from c2)) = 'no_fallback',
                'fallback: none set → no_fallback');
select tests.ok((select state = 'granting' and kind = 'entitlement_days' from referral.rewards where id = (select plain from fr)),
                'fallback: none set → the reward is untouched');
select tests.ok(not has_function_privilege('authenticated', 'public.referral_svc_fallback_reward(uuid, uuid)', 'EXECUTE')
                and not has_function_privilege('anon', 'public.referral_svc_fallback_reward(uuid, uuid)', 'EXECUTE')
                and has_function_privilege('service_role', 'public.referral_svc_fallback_reward(uuid, uuid)', 'EXECUTE'),
                'fallback: service_role only');

-- definer + empty search_path on every new function, nothing exposed
select tests.ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where (n.nspname, p.proname) in (('referral', 'give_up_waiting'), ('referral', 'fallback_reward'),
                       ('referral', 'release_banked_keys'), ('public', 'referral_svc_release_banked_keys'),
                       ('public', 'referral_svc_fallback_reward'))), 'new functions: security definer, empty search_path');
select tests.ok(not exists (select 1 from referral.privacy_problems()), 'privacy_problems() still empty');

rollback;
