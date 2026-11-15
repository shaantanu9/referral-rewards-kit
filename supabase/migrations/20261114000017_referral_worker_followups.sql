-- referral-kit migration 17: worker follow-ups (docs/ISSUES.md; ADR 0001 6.3, 6.4).
--
-- 1. Give up on events waiting for a start. An event whose INITIAL_PURCHASE was lost waits (`waiting`) until the
--    worker fills the start from API v2 `starts_at`. When no subscription ever matches, it used to wait for ever and
--    the worker alerted every run. Now the sweep moves a `waiting` event received more than `paid_window_days` ago to
--    `given_up` with a reason in `last_error` and `processed_at = now()`. The row is kept (audit trail) and purged
--    with processed events after `events_retention_days`. The clock is the event's own `received_at`, not the
--    claim: a waiting event already passed the paid-window check (logic.ts checks the window before the start), so
--    received_at + paid_window_days is never before the referral's own window closes, and an event that arrived late
--    in the window still gets the full wait. The sweep reports `starts_given_up` once, in its alerts, on the run that
--    gives up.
-- 2. Banked release per entitlement. Banked rewards are released for the entitlements a store EXPIRATION names, or
--    per (user, entitlement) from the daily check, whatever the rule's `params.entitlement_id` was. The sweep's new
--    `banked` list carries each banked user's lookup keys; `banked_users` stays for older workers.
-- 3. Lifetime fallback (ADR 6.4). A rule granting `entitlement_days` may name `params.fallback`
--    (`{"kind": "<kind>", "amount": <n > 0>, "params": {…}}`, any kind except `entitlement_days`). When the sharer
--    holds the entitlement for life, the worker turns the claimed reward into that kind, granted at once through the
--    app hook (`referral_app.app_referral_grant`), instead of cancelling it with `lifetime`. The original kind,
--    amount and grant key are kept in `params.fallback_from`. Without `params.fallback` nothing changes.
--
-- Existing functions are patched from their deployed definitions (pg_get_functiondef + replace), never retyped.

-- 1. given_up ---------------------------------------------------------------------------------------------------------
alter table referral.events drop constraint events_state_check;
alter table referral.events add constraint events_state_check
  check (state in ('received', 'processed', 'ignored', 'failed', 'waiting', 'given_up'));

create function referral.give_up_waiting() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  s referral.settings := referral.settings();
  n int;
begin
  update referral.events
     set state = 'given_up', processed_at = now(),
         last_error = 'start not found: gave up ' || s.paid_window_days || ' days (paid_window_days) after the event was received'
   where state = 'waiting' and received_at < now() - make_interval(days => s.paid_window_days);
  get diagnostics n = row_count;
  return n;
end $$;

-- 3. fallback validation (used by the rules constraint and by fallback_reward) ----------------------------------------
create function referral.valid_fallback(f jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    f is not null and jsonb_typeof(f) = 'object'
    and coalesce(f ->> 'kind', '') ~ '^[a-z][a-z0-9_]{0,39}$' and f ->> 'kind' <> 'entitlement_days'
    and case when jsonb_typeof(f -> 'amount') = 'number' then (f ->> 'amount')::numeric > 0 else false end
    and (not (f ? 'params') or jsonb_typeof(f -> 'params') = 'object'),
    false)
$$;

alter table referral.rules add constraint fallback_is_valid
  check (not (params ? 'fallback') or (kind = 'entitlement_days' and referral.valid_fallback(params -> 'fallback')));

-- Within the claim's lease: turn the reward into its fallback kind and grant it through the app hook now.
-- Returns lost_lease | no_fallback | grant_local's answer (granted / failed / cancelled).
create function referral.fallback_reward(rid uuid, token uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  w referral.rewards;
  f jsonb;
begin
  select * into w from referral.rewards where id = rid and attempt_token = token and state = 'granting' for update;
  if w.id is null then
    return 'lost_lease';
  end if;
  f := w.params -> 'fallback';
  if w.kind <> 'entitlement_days' or not referral.valid_fallback(f) then
    return 'no_fallback';
  end if;
  update referral.rewards
     set kind = f ->> 'kind', amount = (f ->> 'amount')::numeric,
         params = coalesce(f -> 'params', '{}') || jsonb_build_object('fallback_from', jsonb_build_object(
                    'kind', w.kind, 'amount', w.amount, 'grant_key', w.grant_key, 'reason', 'lifetime')),
         grant_key = null, state = 'queued', attempts = 0, attempt_token = null, granting_started_at = null,
         target_expires_at = null, available_at = now(), last_error = 'lifetime: fallback', updated_at = now()
   where id = rid;
  return referral.grant_local(rid);
end $$;

-- 2. banked release per entitlement ---------------------------------------------------------------------------------
-- Releases the user's banked rewards whose grant key names one of these lookup keys (`premium` → entitlement:premium).
create function referral.release_banked_keys(uid uuid, entitlement_ids text[]) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  n int;
begin
  update referral.rewards set state = 'queued', available_at = now(), updated_at = now()
   where user_id = uid and state = 'banked'
     and grant_key in (select 'entitlement:' || k from unnest(coalesce(entitlement_ids, '{}')) k);
  get diagnostics n = row_count;
  return n;
end $$;

-- sweep: give up waiting events, report them once, and list banked users with their entitlements ---------------------
do $patch$
declare
  d text;
  n text;
begin
  -- events purge also removes given_up events after the retention period
  d := pg_get_functiondef('referral.sweep_queue()'::regprocedure);
  n := replace(d, $old$where state in ('processed', 'ignored') and coalesce(processed_at, received_at)$old$,
                  $new$where state in ('processed', 'ignored', 'given_up') and coalesce(processed_at, received_at)$new$);
  if n = d then raise exception 'referral migration 17: sweep_queue purge clause not found'; end if;
  execute n;

  d := pg_get_functiondef('referral.sweep()'::regprocedure);
  n := replace(d, $old$  return result || jsonb_build_object('tombstones_purged', n);$old$,
$new$  result := result || jsonb_build_object('tombstones_purged', n);
  -- migration 17: give up on events waiting for a start, alerted once; banked users with their entitlements
  n := referral.give_up_waiting();
  result := result || jsonb_build_object(
    'starts_given_up', n,
    'banked', coalesce((select jsonb_agg(jsonb_build_object('user_id', b.user_id, 'entitlement_ids', b.keys) order by b.user_id)
                          from (select w.user_id, jsonb_agg(distinct substr(w.grant_key, length('entitlement:') + 1)) keys
                                  from referral.rewards w
                                 where w.state = 'banked' and w.user_id is not null and w.grant_key like 'entitlement:%'
                                 group by w.user_id) b), '[]'));
  if n > 0 then
    result := jsonb_set(result, '{alerts,starts_given_up}', to_jsonb(n));
  end if;
  return result;$new$);
  if n = d then raise exception 'referral migration 17: sweep return not found'; end if;
  execute n;
end $patch$;

-- service_role wrappers ----------------------------------------------------------------------------------------------
create function public.referral_svc_release_banked_keys(user_id uuid, entitlement_ids text[]) returns int
language sql volatile security definer set search_path = '' as $$ select referral.release_banked_keys(user_id, entitlement_ids) $$;
create function public.referral_svc_fallback_reward(reward_id uuid, attempt_token uuid) returns text
language sql volatile security definer set search_path = '' as $$ select referral.fallback_reward(reward_id, attempt_token) $$;

revoke all on function public.referral_svc_release_banked_keys(uuid, text[]), public.referral_svc_fallback_reward(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.referral_svc_release_banked_keys(uuid, text[]), public.referral_svc_fallback_reward(uuid, uuid)
  to service_role;

revoke all on all tables in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral_app from public, anon, authenticated, service_role;
