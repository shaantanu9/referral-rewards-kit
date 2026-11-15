-- referral-kit migration 3: activation, `joined` rewards, caps, grants through the app hook, stats / pending / ack
-- (ADR 4.2, 6.2, 7, 8). The RevenueCat `entitlement_days` grants come in migration 5 (grant queue).

-- Default hooks. Apps replace them with `create or replace` (the owner stays postgres, the grants stay revoked).
-- Activation: nobody counts as active until the app says how (safe default).
create function referral_app.app_referral_is_active(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select false $$;

-- Granting kinds other than entitlement_days (e.g. minutes, coins). Must be idempotent on reward_id.
create function referral_app.app_referral_grant(reward_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'referral: app_referral_grant is not implemented for kind %', kind;
end $$;

-- Backoff for retries: 2^attempts minutes, at most 6 hours (ADR 6.4).
create function referral.backoff(attempts int) returns interval
language sql immutable set search_path = '' as $$
  select least(interval '6 hours', make_interval(mins => power(2, least(attempts, 12))::int))
$$;

-- Queue the rewards of one event for one referral, from the rule set promised at claim time (ADR 5). A rule
-- deactivated later by the owner is not paid. Caps (ADR 8): sharer joined per 30 days, sharer paid per 365 days,
-- friend rewards once per install ever. A capped sharer reward is stored as `skipped_cap` so the app can show it.
create function referral.queue_rewards(ref_id uuid, ev text) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  s referral.settings := referral.settings();
  ref referral.referrals;
  rule referral.rules;
  recipient uuid;
  st text;
  key text;
  n int := 0;
  used int;
begin
  select * into ref from referral.referrals r where r.id = ref_id for update;
  for rule in
    select * from referral.rules r where r.version = ref.rule_set_version and r.event = ev and r.active order by r.who, r.kind
  loop
    recipient := case rule.who when 'sharer' then ref.sharer_id else ref.friend_id end;
    continue when recipient is null
      or exists (select 1 from referral.members m where m.user_id = recipient and m.deleted_at is not null);
    st := 'queued';
    if rule.who = 'sharer' then
      select count(*) into used from referral.rewards w
       where w.user_id = recipient and w.who = 'sharer' and w.event = ev
         and w.state not in ('skipped_cap', 'cancelled', 'void_fraud')
         and w.created_at > now() - case ev when 'joined' then interval '30 days' else interval '365 days' end;
      if used >= (case ev when 'joined' then s.sharer_joins_per_30d else s.sharer_paid_per_365d end) then
        st := 'skipped_cap';
      end if;
    elsif ref.claim_install_hash is not null then
      select count(*) into used from referral.rewards w join referral.referrals r on r.id = w.referral_id
       where w.who = 'friend' and w.event = ev and w.state not in ('skipped_cap', 'cancelled', 'void_fraud')
         and r.claim_install_hash = ref.claim_install_hash and r.id <> ref.id;
      if used > 0 then
        st := 'skipped_cap';
      end if;
    end if;
    key := case when rule.kind = 'entitlement_days'
                then 'entitlement:' || coalesce(rule.params ->> 'entitlement_id', s.entitlement_id) end;
    if rule.kind = 'entitlement_days' and key is null then
      raise exception 'referral: rule % grants entitlement_days but neither the rule nor settings name an entitlement', rule.id;
    end if;
    insert into referral.rewards (referral_id, user_id, who, event, rule_id, kind, amount, params, grant_key, state, available_at)
    values (ref.id, recipient, rule.who, ev, rule.id, rule.kind, rule.amount, rule.params, key, st,
            now() + case when ev = 'joined' then make_interval(hours => s.joined_delay_hours)
                         else make_interval(hours => s.hold_hours) end)
    on conflict (referral_id, who, event, rule_id) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Grant one due reward of a kind the app handles, through its hook. Idempotent: only queued / failed_retryable rows
-- are touched, and the hook is called with the reward id. A hook error never aborts the caller.
create function referral.grant_local(rid uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  s referral.settings := referral.settings();
  w referral.rewards;
begin
  select * into w from referral.rewards x
   where x.id = rid and x.kind <> 'entitlement_days' and x.state in ('queued', 'failed_retryable')
     and x.available_at <= now()
   for update skip locked;
  if w.id is null then
    return 'skipped';
  end if;
  if w.user_id is null or exists (select 1 from referral.members m where m.user_id = w.user_id and m.deleted_at is not null) then
    update referral.rewards set state = 'cancelled', last_error = 'recipient deleted', updated_at = now() where id = w.id;
    return 'cancelled';
  end if;
  begin
    perform referral_app.app_referral_grant(w.id, w.user_id, w.kind, w.amount, w.params);
    update referral.rewards set state = 'granted', attempts = w.attempts + 1, last_error = null, updated_at = now()
     where id = w.id;
    return 'granted';
  exception when others then
    update referral.rewards
       set state = case when w.attempts + 1 >= s.max_attempts then 'failed' else 'failed_retryable' end,
           attempts = w.attempts + 1, last_error = left(sqlerrm, 500),
           available_at = now() + referral.backoff(w.attempts + 1), updated_at = now()
     where id = w.id;
    return 'failed';
  end;
end $$;

create function referral.grant_local_due(max_rows int default 100) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  rid uuid;
  n int := 0;
begin
  for rid in
    select x.id from referral.rewards x
     where x.kind <> 'entitlement_days' and x.state in ('queued', 'failed_retryable') and x.available_at <= now()
     order by x.available_at limit max_rows
  loop
    if referral.grant_local(rid) = 'granted' then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Activation for one friend (ADR 6.2): expire after activate_window_days, otherwise ask the app's hook.
create function referral.check_activation(uid uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  s referral.settings := referral.settings();
  ref referral.referrals;
  rid uuid;
begin
  select * into ref from referral.referrals r where r.friend_id = uid for update;
  if ref.id is null then
    return 'no_referral';
  end if;
  if ref.state <> 'claimed' then
    return ref.state;
  end if;
  if now() > ref.claimed_at + make_interval(days => s.activate_window_days) then
    update referral.referrals set state = 'expired' where id = ref.id;
    return 'expired';
  end if;
  if not s.enabled or not referral_app.app_referral_is_active(uid) then
    return 'claimed';
  end if;
  update referral.referrals set state = 'joined', joined_at = now() where id = ref.id;
  perform referral.queue_rewards(ref.id, 'joined');
  for rid in select w.id from referral.rewards w where w.referral_id = ref.id and w.event = 'joined' loop
    perform referral.grant_local(rid);
  end loop;
  return 'joined';
end $$;

-- Worker sweep over claimed referrals (oldest first), so activation and expiry happen even if the app never asks.
create function referral.activation_sweep(max_rows int default 200) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  f uuid;
  n int := 0;
begin
  for f in select r.friend_id from referral.referrals r
            where r.state = 'claimed' and r.friend_id is not null order by r.claimed_at limit max_rows loop
    if referral.check_activation(f) in ('joined', 'expired') then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Trigger the app can attach to its own "activity" table: `create trigger … after insert on app.reading_progress
-- for each row execute function referral.activation_trigger('user_id');` Security definer, so it works when the
-- insert runs as `authenticated` (ADR 6.2). Never blocks the app's insert.
create function referral.activation_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
begin
  uid := (to_jsonb(new) ->> coalesce(tg_argv[0], 'user_id'))::uuid;
  if uid is not null and exists (select 1 from referral.referrals r where r.friend_id = uid and r.state = 'claimed') then
    begin
      perform referral.check_activation(uid);
    exception when others then
      raise warning 'referral: activation check failed for %: %', uid, sqlerrm;
    end;
  end if;
  return new;
end $$;

-- What the app shows (ADR 7). Friend and sharer counts appear only from stats_floor joined friends, so a single
-- friend's progress is never shown as a number.
create function referral.stats(uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with s as (select * from referral.settings x where x.id),
  mine as (select * from referral.rewards w where w.user_id = uid),
  joined as (select count(*) n from referral.referrals r where r.sharer_id = uid and r.joined_at is not null),
  paid as (select count(*) n from referral.referrals r where r.sharer_id = uid and r.paid_at is not null)
  select jsonb_build_object(
    'rewards_granted', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'who', who, 'event', event, 'kind', kind,
                                 'amount', amount, 'at', updated_at) order by updated_at desc)
                                 from mine where state = 'granted'), '[]'),
    'pending', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'event', event, 'kind', kind, 'amount', amount,
                         'available_at', available_at) order by available_at)
                         from mine where state in ('queued', 'granting', 'failed_retryable')), '[]'),
    'banked', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'amount', amount)) from mine
                        where state = 'banked'), '[]'),
    'skipped_cap', (select count(*) from mine where state = 'skipped_cap'),
    'joined_count', case when (select n from joined) >= (select stats_floor from s) then (select n from joined) end,
    'paid_count', case when (select n from joined) >= (select stats_floor from s) then (select n from paid) end)
$$;

-- Rewards granted or banked that this device has not shown yet (ADR 7).
create function referral.pending(uid uuid, install_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'who', w.who, 'event', w.event, 'kind', w.kind,
                  'amount', w.amount, 'state', w.state, 'params', w.params) order by w.updated_at), '[]')
  from referral.rewards w
  where w.user_id = uid and w.state in ('granted', 'banked')
    and not exists (select 1 from referral.reward_seen x
                    where x.reward_id = w.id and x.install_id_hash = any (referral.hashes_active(install_id)))
$$;

create function referral.ack(uid uuid, reward_ids uuid[], install_id text) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  h record;
  n int;
begin
  select * into h from referral.hash_new(install_id);
  insert into referral.reward_seen (reward_id, install_id_hash, pepper_version)
  select w.id, h.value_hash, h.pepper_version from referral.rewards w
   where w.id = any (reward_ids) and w.user_id = uid
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- public wrappers (authenticated only) ------------------------------------------------------------------------------
create function public.referral_check_activation(install_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform referral.touch_install(auth.uid(), install_id);
  return jsonb_build_object('state', referral.check_activation(auth.uid()));
end $$;

create function public.referral_stats(install_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform referral.touch_install(auth.uid(), install_id);
  return referral.stats(auth.uid());
end $$;

create function public.referral_pending(install_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform referral.touch_install(auth.uid(), install_id);
  return referral.pending(auth.uid(), install_id);
end $$;

create function public.referral_ack(reward_ids uuid[], install_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform referral.touch_install(auth.uid(), install_id);
  return jsonb_build_object('acknowledged', referral.ack(auth.uid(), reward_ids, install_id));
end $$;

revoke all on function public.referral_check_activation(text), public.referral_stats(text),
  public.referral_pending(text), public.referral_ack(uuid[], text) from public, anon, service_role;
grant execute on function public.referral_check_activation(text), public.referral_stats(text),
  public.referral_pending(text), public.referral_ack(uuid[], text) to authenticated;

revoke all on all tables in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral_app from public, anon, authenticated, service_role;
