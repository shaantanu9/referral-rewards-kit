-- referral-kit migration 5: the grant queue for `entitlement_days` (ADR 6.4), the worker sweep, the daily cap,
-- banked release and the owner's retry. The RevenueCat calls themselves happen in the Edge Function (part 7); every
-- write here after a claim is compare-and-set on the claim's attempt_token, so a worker whose lease was swept can
-- never overwrite the row.

-- step 1: claim one due reward --------------------------------------------------------------------------------------
-- Returns null when nothing is due, or {cap_reached:true} when the daily cap is used up (ADR 6.4).
create function referral.claim_reward() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s referral.settings := referral.settings();
  w referral.rewards;
  ref referral.referrals;
  t referral.transactions;
  granted_today int;
begin
  select count(*) into granted_today from referral.rewards x
   where x.kind = 'entitlement_days' and x.state in ('granted', 'granting') and x.updated_at >= date_trunc('day', now());
  if granted_today >= s.daily_grant_cap then
    return jsonb_build_object('cap_reached', true);
  end if;

  select * into w from referral.rewards x
   where x.kind = 'entitlement_days' and x.state in ('queued', 'failed_retryable') and x.available_at <= now()
     and x.user_id is not null
     -- one unfinished grant per user and entitlement (the partial unique index is the backstop)
     and not exists (select 1 from referral.rewards y where y.user_id = x.user_id and y.grant_key = x.grant_key
                     and y.id <> x.id and y.state in ('granting', 'failed_retryable'))
     -- sharers under abuse review wait for the owner (ADR 8)
     and not exists (select 1 from referral.members m where m.user_id = x.user_id and m.review_since is not null)
   order by x.available_at
   limit 1
   for update skip locked;
  if w.id is null then
    return null;
  end if;

  begin
    update referral.rewards
       set state = 'granting', granting_started_at = now(), attempt_token = gen_random_uuid(),
           attempts = attempts + 1, updated_at = now()
     where id = w.id
    returning * into w;
  exception when unique_violation then -- a parallel claim took the user's slot first
    return null;
  end;

  select * into ref from referral.referrals r where r.id = w.referral_id;
  select * into t from referral.transactions x where x.original_transaction_id_hash = ref.original_transaction_id_hash;
  return jsonb_build_object(
    'reward_id', w.id, 'attempt_token', w.attempt_token, 'user_id', w.user_id, 'event', w.event,
    'entitlement_id', substr(w.grant_key, length('entitlement:') + 1), 'days', w.amount::int, 'params', w.params,
    'target_expires_at_ms', (extract(epoch from w.target_expires_at) * 1000)::bigint, 'attempts', w.attempts,
    'user_deleted', exists (select 1 from referral.members m where m.user_id = w.user_id and m.deleted_at is not null),
    -- for the fresh check of a paid reward (ADR 6.5)
    'friend_id', ref.friend_id, 'friend_deleted', ref.friend_deleted_at is not null,
    'transaction', case when t.original_transaction_id_hash is null then null else jsonb_build_object(
      'first_purchased_at_ms', t.first_purchased_at_ms, 'store', t.store, 'environment', t.environment,
      'refunded', t.refunded_at is not null) end);
end $$;

-- Which of these API v2 store_subscription_identifiers were seen in this reward's webhooks (HMAC compare in SQL, so
-- the pepper never leaves the database).
create function referral.seen_ids(rid uuid, ids text[]) returns boolean[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(exists (
           select 1 from referral.rewards w join referral.referrals r on r.id = w.referral_id
             join referral.transactions t on t.original_transaction_id_hash = r.original_transaction_id_hash
           where w.id = rid and t.transaction_ids_seen && referral.hashes_active(i)) order by n), '{}')
  from unnest(ids) with ordinality as x(i, n)
$$;

-- step 2: store the target once -------------------------------------------------------------------------------------
create function referral.set_target(rid uuid, token uuid, target timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  w referral.rewards;
begin
  update referral.rewards set target_expires_at = target, updated_at = now()
   where id = rid and attempt_token = token and state = 'granting' and target_expires_at is null
  returning * into w;
  if w.id is null then
    select * into w from referral.rewards where id = rid and attempt_token = token and state = 'granting';
    if w.id is null then
      return jsonb_build_object('status', 'lost_lease');
    end if;
  end if;
  return jsonb_build_object('status', 'ok', 'target_expires_at_ms', (extract(epoch from w.target_expires_at) * 1000)::bigint);
end $$;

-- step 3: record the outcome ----------------------------------------------------------------------------------------
-- outcome: granted | banked | cancelled | retry | failed. `retry` backs off (2^attempts min, or retry_after_seconds
-- from a 429) and becomes `failed` at max_attempts; `failed` alerts the owner.
create function referral.finish_reward(rid uuid, token uuid, outcome text, error text default null,
                                       retry_after_seconds int default null) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  s referral.settings := referral.settings();
  w referral.rewards;
  next_state text;
begin
  if outcome not in ('granted', 'banked', 'cancelled', 'retry', 'failed') then
    raise exception 'referral: unknown outcome %', outcome using errcode = '22023';
  end if;
  select * into w from referral.rewards where id = rid and attempt_token = token and state = 'granting' for update;
  if w.id is null then
    return 'lost_lease';
  end if;
  next_state := case outcome
    when 'retry' then case when w.attempts >= s.max_attempts then 'failed' else 'failed_retryable' end
    when 'banked' then 'banked'
    else outcome end;
  update referral.rewards
     set state = next_state, last_error = left(error, 500), updated_at = now(), granting_started_at = null,
         attempt_token = case when next_state = 'failed_retryable' then attempt_token end,
         -- a banked reward computes a new target when released (ADR 6.4)
         target_expires_at = case when next_state = 'banked' then null else target_expires_at end,
         available_at = case when next_state = 'failed_retryable'
                             then now() + coalesce(make_interval(secs => retry_after_seconds), referral.backoff(w.attempts))
                             else available_at end
   where id = rid;
  return next_state;
end $$;

-- banked release (ADR 6.4): on a store EXPIRATION for the user, or from the daily sweep after RevenueCat shows no
-- active store subscription. Step 2 runs again, so a sharer who resubscribed in between is banked again.
create function referral.release_banked(uid uuid) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  n int;
begin
  update referral.rewards set state = 'queued', available_at = now(), updated_at = now()
   where user_id = uid and state = 'banked';
  get diagnostics n = row_count;
  return n;
end $$;

-- the sweep: everything time-based, then a summary for alerts ----------------------------------------------------
create function referral.sweep() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s referral.settings := referral.settings();
  leases int;
  activated int;
  local_granted int;
  purged_events int;
  purged_attempts int;
begin
  -- leases: a granting row older than the lease is retried (attempts were counted at claim), or failed at the limit
  with stale as (
    select id, attempts from referral.rewards
     where state = 'granting' and granting_started_at < now() - make_interval(mins => s.granting_lease_minutes)
     for update skip locked)
  update referral.rewards w
     set state = case when stale.attempts >= s.max_attempts then 'failed' else 'failed_retryable' end,
         last_error = 'lease expired', granting_started_at = null, updated_at = now(),
         available_at = now() + referral.backoff(stale.attempts)
    from stale where w.id = stale.id;
  get diagnostics leases = row_count;

  activated := referral.activation_sweep();
  local_granted := referral.grant_local_due();

  delete from referral.events
   where state in ('processed', 'ignored') and coalesce(processed_at, received_at) < now() - make_interval(days => s.events_retention_days);
  get diagnostics purged_events = row_count;
  delete from referral.claim_attempts where at < now() - interval '1 hour';
  get diagnostics purged_attempts = row_count;

  return jsonb_build_object(
    'leases_released', leases,
    'activated_or_expired', activated,
    'local_rewards_granted', local_granted,
    'events_purged', purged_events,
    'claim_attempts_purged', purged_attempts,
    'alerts', jsonb_build_object(
      'failed_rewards', (select count(*) from referral.rewards where state = 'failed'),
      'failed_events', (select count(*) from referral.events e where e.state = 'failed' and e.attempts >= s.max_attempts),
      'sharers_under_review', (select count(*) from referral.members where review_since is not null),
      'privacy_problems', (select count(*) from referral.privacy_problems()),
      'daily_cap_reached', (select count(*) >= s.daily_grant_cap from referral.rewards x
                             where x.kind = 'entitlement_days' and x.state in ('granted', 'granting')
                               and x.updated_at >= date_trunc('day', now()))),
    'banked_users', coalesce((select jsonb_agg(distinct user_id) from referral.rewards where state = 'banked'), '[]'));
end $$;

-- owner's retry of a failed reward (ADR 6.4): recompute = false resends the stored target; true clears it so step 2
-- runs again (only after checking the customer in the RevenueCat dashboard). Not exposed to any API role.
create function referral.admin_retry_reward(rid uuid, recompute boolean) returns text
language plpgsql volatile security definer set search_path = '' as $$
begin
  update referral.rewards
     set state = 'queued', attempts = 0, last_error = null, available_at = now(), updated_at = now(),
         attempt_token = null, target_expires_at = case when recompute then null else target_expires_at end
   where id = rid and state = 'failed';
  return case when found then 'queued' else 'not_failed' end;
end $$;

-- the owner's decision after an abuse review (ADR 8): restore the code or void the sharer's unfinished rewards.
create function referral.admin_review(uid uuid, restore boolean) returns text
language plpgsql volatile security definer set search_path = '' as $$
begin
  if restore then
    update referral.codes set disabled_at = null, disabled_reason = null
     where id = (select id from referral.codes where user_id = uid and disabled_reason = 'abuse' order by created_at desc limit 1)
       and not exists (select 1 from referral.codes c where c.user_id = uid and c.disabled_at is null);
    delete from referral.abuse_marks where user_id = uid;
  else
    update referral.rewards set state = 'void_fraud', updated_at = now()
     where user_id = uid and state in ('queued', 'banked', 'failed_retryable', 'failed');
    update referral.referrals set state = 'void' where sharer_id = uid and state in ('claimed', 'joined', 'paid');
  end if;
  update referral.members set review_since = null where user_id = uid;
  return case when restore then 'restored' else 'voided' end;
end $$;

-- service_role wrappers ----------------------------------------------------------------------------------------------
create function public.referral_svc_claim_reward() returns jsonb
language sql volatile security definer set search_path = '' as $$ select referral.claim_reward() $$;
create function public.referral_svc_seen_ids(reward_id uuid, ids text[]) returns boolean[]
language sql stable security definer set search_path = '' as $$ select referral.seen_ids(reward_id, ids) $$;
create function public.referral_svc_set_target(reward_id uuid, attempt_token uuid, target_expires_at_ms bigint) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select referral.set_target(reward_id, attempt_token, to_timestamp(target_expires_at_ms / 1000.0)) $$;
create function public.referral_svc_finish_reward(reward_id uuid, attempt_token uuid, outcome text, error text default null,
                                                  retry_after_seconds int default null) returns text
language sql volatile security definer set search_path = '' as $$
  select referral.finish_reward(reward_id, attempt_token, outcome, error, retry_after_seconds) $$;
create function public.referral_svc_release_banked(user_id uuid) returns int
language sql volatile security definer set search_path = '' as $$ select referral.release_banked(user_id) $$;
create function public.referral_svc_sweep() returns jsonb
language sql volatile security definer set search_path = '' as $$ select referral.sweep() $$;

revoke all on function public.referral_svc_claim_reward(), public.referral_svc_seen_ids(uuid, text[]),
  public.referral_svc_set_target(uuid, uuid, bigint), public.referral_svc_finish_reward(uuid, uuid, text, text, int),
  public.referral_svc_release_banked(uuid), public.referral_svc_sweep() from public, anon, authenticated;
grant execute on function public.referral_svc_claim_reward(), public.referral_svc_seen_ids(uuid, text[]),
  public.referral_svc_set_target(uuid, uuid, bigint), public.referral_svc_finish_reward(uuid, uuid, text, text, int),
  public.referral_svc_release_banked(uuid), public.referral_svc_sweep() to service_role;

revoke all on all tables in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral_app from public, anon, authenticated, service_role;
