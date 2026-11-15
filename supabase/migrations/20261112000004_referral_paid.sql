-- referral-kit migration 4: webhook events, store transactions, the paid path, refunds, transfers (ADR 6.3, 6.6, 6.7).
--
-- Who decides what: the decision tables live in ONE place, `supabase/functions/referral/logic.ts` (part 4). The
-- database only stores events, keeps the transaction facts, and applies decisions:
--   1. referral_svc_ingest_event   stores the trimmed event and updates its transaction (idempotent bookkeeping);
--   2. referral_svc_event_context  returns the facts the logic needs, plus a fingerprint of them;
--   3. referral_svc_apply_event    locks the event, transaction and referrals, recomputes the facts, and applies the
--                                  decision only if the fingerprint still matches (otherwise 'retry'), so a decision
--                                  made on stale facts is never applied.

alter table referral.referrals
  add column paid_intro boolean not null default false,
  add column paid_cancel_cause text check (paid_cancel_cause in ('refund', 'transfer')),
  add constraint cancel_cause_matches_state check ((state = 'paid_cancelled') = (paid_cancel_cause is not null));
alter table referral.abuse_marks add column referral_id uuid;
alter table referral.members add column review_since timestamptz; -- abuse threshold reached: owner review (ADR 8)
alter table referral.events drop constraint events_state_check;
alter table referral.events add constraint events_state_check
  check (state in ('received', 'processed', 'ignored', 'failed', 'waiting'));
drop index referral.events_pending;
create index events_pending on referral.events (received_at) where state in ('received', 'failed', 'waiting');

-- helpers -----------------------------------------------------------------------------------------------------------
-- The transaction row for a raw store id, under any active pepper version.
create function referral.find_transaction(original_transaction_id text) returns bytea
language sql stable security definer set search_path = '' as $$
  select t.original_transaction_id_hash from referral.transactions t
  where t.original_transaction_id_hash = any (referral.hashes_active(original_transaction_id))
  limit 1
$$;

-- User ids an event concerns (mirrors logic.ts usersInEvent): TRANSFER is matched on its two lists only.
create function referral.event_users(ev_type text, f jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct u) filter (where u is not null and u <> ''), '{}')
  from (
    select f ->> 'app_user_id' u where ev_type <> 'TRANSFER'
    union all select f ->> 'original_app_user_id' where ev_type <> 'TRANSFER'
    union all select jsonb_array_elements_text(coalesce(f -> 'aliases', '[]')) where ev_type <> 'TRANSFER'
    union all select jsonb_array_elements_text(coalesce(f -> 'transferred_from', '[]')) where ev_type = 'TRANSFER'
    union all select jsonb_array_elements_text(coalesce(f -> 'transferred_to', '[]')) where ev_type = 'TRANSFER'
  ) x
$$;

-- What the paid reward of a referral looks like to the cancel table: none yet, still cancellable, or possibly sent
-- to RevenueCat (granting, granted, or a retry whose target is stored and may have landed).
create function referral.paid_reward_status(ref_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when bool_or(w.state in ('granted', 'granting') or (w.state = 'failed_retryable' and w.target_expires_at is not null))
      then 'granted'
    when bool_or(w.state in ('queued', 'banked', 'failed_retryable', 'failed')) then 'held'
    else 'none' end
  from referral.rewards w where w.referral_id = ref_id and w.event = 'paid' and w.who = 'sharer'
$$;

-- ingest (transaction 1 of ADR 6.7) ---------------------------------------------------------------------------------
create function referral.ingest_event(ev jsonb) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  f jsonb := ev -> 'fields';
  otid text := f ->> 'original_transaction_id';
  tid text := f ->> 'transaction_id';
  th bytea;
  h record;
  tidh bytea;
begin
  if ev ->> 'event_id' is null or ev ->> 'type' is null or ev ->> 'event_timestamp_ms' is null
     or jsonb_typeof(f) is distinct from 'object' then
    raise exception 'referral: event needs event_id, type, event_timestamp_ms and fields' using errcode = '22023';
  end if;
  insert into referral.events (event_id, type, fields, event_timestamp_ms)
  values (ev ->> 'event_id', ev ->> 'type', f, (ev ->> 'event_timestamp_ms')::bigint)
  on conflict (event_id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if otid is not null and otid <> '' then
    th := referral.find_transaction(otid);
    if th is null then
      select * into h from referral.hash_new(otid);
      insert into referral.transactions (original_transaction_id_hash, pepper_version, product_id, store, environment)
      values (h.value_hash, h.pepper_version, f ->> 'product_id', lower(f ->> 'store'), lower(f ->> 'environment'))
      on conflict do nothing;
      th := h.value_hash;
    end if;
    -- The start is known only from INITIAL_PURCHASE (or later from API v2 starts_at, which it overrides).
    if ev ->> 'type' = 'INITIAL_PURCHASE' and (f ->> 'purchased_at_ms') is not null then
      update referral.transactions
         set first_purchased_at_ms = (f ->> 'purchased_at_ms')::bigint, started_at_source = 'initial_purchase'
       where original_transaction_id_hash = th and started_at_source is distinct from 'initial_purchase';
    end if;
    if tid is not null and tid <> '' then
      tidh := (referral.hash_new(tid)).value_hash;
      update referral.transactions
         set transaction_ids_seen = array_append(transaction_ids_seen, tidh)
       where original_transaction_id_hash = th and not (tidh = any (transaction_ids_seen));
    end if;
  end if;
  return 'stored';
end $$;

-- context (what logic.ts needs) ------------------------------------------------------------------------------------
create function referral.event_context(eid text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  e referral.events;
  s referral.settings := referral.settings();
  otid text;
  th bytea;
  t referral.transactions;
  txn jsonb := null;
  refs jsonb;
begin
  select * into e from referral.events x where x.event_id = eid;
  if e.event_id is null then
    return null;
  end if;
  otid := e.fields ->> 'original_transaction_id';
  if otid is not null and otid <> '' then
    th := referral.find_transaction(otid);
    select * into t from referral.transactions x where x.original_transaction_id_hash = th;
    txn := jsonb_build_object(
      'first_purchased_at_ms', t.first_purchased_at_ms,
      'refunded_at_ms', (extract(epoch from t.refunded_at) * 1000)::bigint,
      'refund_state_ms', t.refund_state_ms,
      'already_rewarded', exists (select 1 from referral.referrals r
                                  where r.original_transaction_id_hash = th and r.paid_at is not null),
      'tombstoned', exists (select 1 from referral.tombstones b
                            where b.kind = 'transaction' and b.value_hash = any (referral.hashes_active(otid))));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'referral_id', r.id,
           'friend_id', r.friend_id,
           'sharer_id', r.sharer_id,
           'claimed_at_ms', (extract(epoch from r.claimed_at) * 1000)::bigint,
           'state', r.state,
           'reached_paid', r.paid_at is not null,
           'paid_reward', referral.paid_reward_status(r.id),
           'rewarded_intro', r.paid_intro,
           'cancel_cause', r.paid_cancel_cause,
           'holds_transaction', th is not null and r.original_transaction_id_hash = th,
           'intro_rule', coalesce((select p.params ->> 'intro_rule' from referral.rules p
                                   where p.version = r.rule_set_version and p.event = 'paid' and p.who = 'sharer'
                                     and p.active order by p.created_at limit 1), 'if_price_positive'),
           'count_one_time', coalesce((select (p.params ->> 'count_one_time')::boolean from referral.rules p
                                       where p.version = r.rule_set_version and p.event = 'paid' and p.who = 'sharer'
                                         and p.active order by p.created_at limit 1), false))
         order by r.id), '[]')
    into refs
    from referral.referrals r
   where r.friend_id is not null
     and (r.friend_id::text = any (referral.event_users(e.type, e.fields))
          or (th is not null and r.original_transaction_id_hash = th));

  return jsonb_build_object(
    'event', jsonb_build_object('event_id', e.event_id, 'type', e.type, 'event_timestamp_ms', e.event_timestamp_ms,
                                'fields', e.fields, 'state', e.state),
    'settings', jsonb_build_object('entitlement_id', s.entitlement_id, 'allow_sandbox', s.allow_sandbox,
                                   'paid_window_days', s.paid_window_days, 'paid_enabled', s.paid_enabled),
    'transaction', txn,
    'referrals', refs);
end $$;

-- Abuse marks and the review threshold (ADR 8).
create function referral.add_abuse_mark(sharer uuid, eid text, ref_id uuid, why text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  s referral.settings := referral.settings();
  score int;
begin
  if sharer is null then
    return;
  end if;
  insert into referral.abuse_marks (user_id, event_id, cause, referral_id) values (sharer, eid, why, ref_id)
  on conflict do nothing;
  select coalesce(sum(m.points), 0) into score from referral.abuse_marks m
   where m.user_id = sharer and m.created_at > now() - interval '365 days';
  if score >= s.abuse_threshold then
    update referral.codes set disabled_at = now(), disabled_reason = 'abuse'
     where user_id = sharer and disabled_at is null;
    insert into referral.members as m (user_id, review_since) values (sharer, now())
    on conflict (user_id) do update set review_since = coalesce(m.review_since, now());
  end if;
end $$;

-- apply (transaction 2 of ADR 6.7) ----------------------------------------------------------------------------------
-- decision: {
--   "event_state": "processed" | "ignored" | "waiting",
--   "refund": null | {"refunded": bool, "refund_state_ms": n},
--   "referrals": [{ "referral_id": uuid,
--                   "paid": null | {"qualifying_at_ms": n, "intro": bool},
--                   "referral_to": null | "paid_cancelled" | "refunded_late", "cancel_cause": "refund" | "transfer",
--                   "uncancel": bool, "remove_intro_mark": bool, "abuse_marks": ["late_refund", ...] }] }
create function referral.apply_event(eid text, fingerprint text, decision jsonb) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  s referral.settings := referral.settings();
  e referral.events;
  th bytea;
  d jsonb;
  ref referral.referrals;
  rid uuid;
  cause text;
  mark text;
  ev_state text := coalesce(decision ->> 'event_state', 'processed');
begin
  if ev_state not in ('processed', 'ignored', 'waiting') then
    raise exception 'referral: event_state must be processed, ignored or waiting' using errcode = '22023';
  end if;
  select * into e from referral.events x where x.event_id = eid for update;
  if e.event_id is null then
    return 'unknown_event';
  end if;
  if e.state not in ('received', 'failed', 'waiting') then
    return 'already_done';
  end if;

  -- Lock everything the decision depends on, then make sure the facts did not change since the context was read.
  th := referral.find_transaction(e.fields ->> 'original_transaction_id');
  if th is not null then
    perform 1 from referral.transactions t where t.original_transaction_id_hash = th for update;
  end if;
  perform 1 from referral.referrals r
   where r.friend_id::text = any (referral.event_users(e.type, e.fields)) or (th is not null and r.original_transaction_id_hash = th)
   order by r.id for update;
  if md5(referral.event_context(eid)::text) is distinct from fingerprint then
    return 'retry';
  end if;

  if decision -> 'refund' is not null and jsonb_typeof(decision -> 'refund') = 'object' then
    if th is null then
      raise exception 'referral: refund decision for an event without a transaction' using errcode = '22023';
    end if;
    update referral.transactions
       set refunded_at = case when (decision -> 'refund' ->> 'refunded')::boolean
                              then to_timestamp(((decision -> 'refund' ->> 'refund_state_ms')::bigint) / 1000.0) end,
           refund_state_ms = (decision -> 'refund' ->> 'refund_state_ms')::bigint
     where original_transaction_id_hash = th;
  end if;

  for d in select * from jsonb_array_elements(coalesce(decision -> 'referrals', '[]')) loop
    rid := (d ->> 'referral_id')::uuid;
    select * into ref from referral.referrals r where r.id = rid;
    if ref.id is null then
      raise exception 'referral: decision names an unknown referral %', rid using errcode = '22023';
    end if;

    if d -> 'paid' is not null and jsonb_typeof(d -> 'paid') = 'object' then
      -- Guards repeat the decision's own preconditions; a decision that breaks one is refused, never applied.
      if th is null or ref.paid_at is not null or ref.state not in ('claimed', 'joined')
         or exists (select 1 from referral.transactions t where t.original_transaction_id_hash = th and t.refunded_at is not null)
         or exists (select 1 from referral.referrals r where r.original_transaction_id_hash = th and r.paid_at is not null) then
        raise exception 'referral: paid decision for referral % breaks a precondition', rid using errcode = '22023';
      end if;
      if s.paid_enabled then
        if ref.state = 'claimed' then -- paying counts as starting to use the app (joined rewards first)
          update referral.referrals set state = 'joined', joined_at = now() where id = rid;
          perform referral.queue_rewards(rid, 'joined');
          perform referral.grant_local(w.id) from referral.rewards w where w.referral_id = rid and w.event = 'joined';
        end if;
        update referral.referrals
           set state = 'paid', paid_at = to_timestamp(((d -> 'paid' ->> 'qualifying_at_ms')::bigint) / 1000.0),
               original_transaction_id_hash = th, paid_intro = coalesce((d -> 'paid' ->> 'intro')::boolean, false)
         where id = rid;
        perform referral.queue_rewards(rid, 'paid');
      end if;
    end if;

    if d ->> 'referral_to' = 'paid_cancelled' then
      cause := coalesce(d ->> 'cancel_cause', 'refund');
      update referral.referrals set state = 'paid_cancelled', paid_cancel_cause = cause where id = rid;
      update referral.rewards w
         set state = 'cancelled', last_error = cause, updated_at = now()
       where w.referral_id = rid and w.event = 'paid' and w.who = 'sharer'
         and (w.state in ('queued', 'banked', 'failed') or (w.state = 'failed_retryable' and w.target_expires_at is null));
    elsif d ->> 'referral_to' = 'refunded_late' then
      update referral.referrals set state = 'refunded_late', paid_cancel_cause = null where id = rid;
    end if;

    if coalesce((d ->> 'uncancel')::boolean, false) then
      -- Only a refund cancel can be undone (ADR 6.3); a transfer cancel stays, whatever the decision says.
      update referral.referrals set state = 'paid', paid_cancel_cause = null
       where id = rid and state = 'paid_cancelled' and paid_cancel_cause = 'refund';
      update referral.rewards w
         set state = 'queued', last_error = null, available_at = now(), updated_at = now()
       where w.referral_id = rid and w.event = 'paid' and w.who = 'sharer' and w.state = 'cancelled' and w.last_error = 'refund';
    end if;

    if coalesce((d ->> 'remove_intro_mark')::boolean, false) then
      delete from referral.abuse_marks m where m.referral_id = rid and m.cause = 'intro_refund';
    end if;

    for mark in select jsonb_array_elements_text(coalesce(d -> 'abuse_marks', '[]')) loop
      perform referral.add_abuse_mark(ref.sharer_id, eid, rid, mark);
    end loop;
  end loop;

  update referral.events set state = ev_state, processed_at = case when ev_state = 'waiting' then null else now() end,
                             last_error = null
   where event_id = eid;
  return 'applied';
end $$;

create function referral.mark_event_failed(eid text, error text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  s referral.settings := referral.settings();
  n int;
begin
  update referral.events set state = 'failed', attempts = attempts + 1, last_error = left(error, 500)
   where event_id = eid and state in ('received', 'failed', 'waiting')
  returning attempts into n;
  return case when n is null then 'unknown_event' when n >= s.max_attempts then 'alert_owner' else 'will_retry' end;
end $$;

-- The worker filled the subscription start from API v2 `starts_at` (ADR 6.3); events waiting on it run again.
create function referral.fill_start(original_transaction_id text, starts_at_ms bigint) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  th bytea := referral.find_transaction(original_transaction_id);
  n int;
begin
  if th is null then
    return 0;
  end if;
  update referral.transactions set first_purchased_at_ms = starts_at_ms, started_at_source = 'api_starts_at'
   where original_transaction_id_hash = th and first_purchased_at_ms is null;
  update referral.events set state = 'received'
   where state = 'waiting' and fields ->> 'original_transaction_id' = original_transaction_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- What the worker must do next for events: run (received / failed under max_attempts), or fetch a start (waiting).
create function referral.pending_events(max_rows int default 50) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'run', coalesce((select jsonb_agg(x.event_id order by x.received_at) from (
              select e.event_id, e.received_at from referral.events e, referral.settings s
               where s.id and (e.state = 'received' or (e.state = 'failed' and e.attempts < s.max_attempts))
               order by e.received_at limit max_rows) x), '[]'),
    'need_start', coalesce((select jsonb_agg(distinct jsonb_build_object(
                     'original_transaction_id', e.fields ->> 'original_transaction_id',
                     'app_user_ids', referral.event_users(e.type, e.fields)))
                   from referral.events e where e.state = 'waiting'), '[]'),
    'failed_for_owner', (select count(*) from referral.events e, referral.settings s
                          where s.id and e.state = 'failed' and e.attempts >= s.max_attempts))
$$;

-- service_role wrappers (ADR 7) ------------------------------------------------------------------------------------
create function public.referral_svc_ingest_event(event jsonb) returns text
language sql volatile security definer set search_path = '' as $$ select referral.ingest_event(event) $$;

create function public.referral_svc_event_context(event_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select c || jsonb_build_object('fingerprint', md5(c::text), 'now_ms', (extract(epoch from now()) * 1000)::bigint)
  from (select referral.event_context(event_id) c) x where c is not null
$$;

create function public.referral_svc_apply_event(event_id text, fingerprint text, decision jsonb) returns text
language sql volatile security definer set search_path = '' as $$ select referral.apply_event(event_id, fingerprint, decision) $$;

create function public.referral_svc_mark_event_failed(event_id text, error text) returns text
language sql volatile security definer set search_path = '' as $$ select referral.mark_event_failed(event_id, error) $$;

create function public.referral_svc_fill_start(original_transaction_id text, starts_at_ms bigint) returns int
language sql volatile security definer set search_path = '' as $$ select referral.fill_start(original_transaction_id, starts_at_ms) $$;

create function public.referral_svc_pending_events(max_rows int default 50) returns jsonb
language sql stable security definer set search_path = '' as $$ select referral.pending_events(max_rows) $$;

revoke all on function public.referral_svc_ingest_event(jsonb), public.referral_svc_event_context(text),
  public.referral_svc_apply_event(text, text, jsonb), public.referral_svc_mark_event_failed(text, text),
  public.referral_svc_fill_start(text, bigint), public.referral_svc_pending_events(int)
  from public, anon, authenticated;
grant execute on function public.referral_svc_ingest_event(jsonb), public.referral_svc_event_context(text),
  public.referral_svc_apply_event(text, text, jsonb), public.referral_svc_mark_event_failed(text, text),
  public.referral_svc_fill_start(text, bigint), public.referral_svc_pending_events(int)
  to service_role;

revoke all on all tables in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral_app from public, anon, authenticated, service_role;
