-- referral-kit migration 23: the growth round (research: docs/research/referral-growth.md).
--
--   1. Invite page name (G7): members.show_name / display_name, opt-in per sharer, read by the anon
--      referral_invite_preview (never writes). Shown only when opted in, not left, age check passes, code active.
--   2. Leaving the invite program (G9): members.left_at. The user's codes stop accepting claims (claim answers
--      unknown_code, like a missing code); referral_my_code answers {"left": true}; queued rewards still go out;
--      joining again clears left_at and keeps the same code.
--   3. Boosts (G8): referral.boosts, a multiplier for referrals CLAIMED inside [starts_at, ends_at). Once started a boost
--      can only end earlier or lower its budget; it can never be extended, changed or deleted. No two overlap.
--      rewards.boost_id / base_amount record what was applied. referral_terms shows only the running boost.
--   4. Age before install (G10): touch_install and touch_member write nothing for an under-age user.
--   5. The friend's own claim (G2): referral_my_claim. 6. Admin funnel (G11): referral_admin_funnel.
--
-- Replaced functions are built from their deployed definitions (pg_get_functiondef after migrations 1-22) with only
-- the marked "Migration 23" lines added: touch_install, touch_member, my_code, claim_core, queue_rewards, terms,
-- delete_user, privacy_problems.

-- 1. Members: name on the invite page, leaving -----------------------------------------------------------------------
-- A display name: 1-40 characters, already trimmed, no '@' or '://' (no emails or links on a public page), no control
-- characters, at least one letter. "Letter" is checked as a locale letter or a code point in the letter-heavy ranges
-- (Latin-1 letters through the Indic, Thai, Greek, Cyrillic, Hebrew, Arabic blocks; kana and CJK; Hangul), so the
-- answer does not depend on the database locale (`[[:alpha:]]` is ASCII-only under the C locale).
create function referral.valid_display_name(n text) returns boolean
language sql immutable set search_path = '' as $$
  select n is null or (
    n = btrim(n) and char_length(n) between 1 and 40
    and strpos(n, '@') = 0 and strpos(n, '://') = 0
    and n !~ '[\x01-\x1f\x7f]'
    and (n ~ '[A-Za-z]' or n ~ '[À-῿぀-﫿가-힯]'))
$$;

alter table referral.members
  add column show_name boolean not null default false,
  add column display_name text constraint display_name_valid check (referral.valid_display_name(display_name)),
  add column left_at timestamptz;

-- 2. Boosts -------------------------------------------------------------------------------------------------------
create table referral.boosts (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  multiplier numeric not null check (multiplier > 1 and multiplier <= 5),
  events text[] not null default '{joined}' check (cardinality(events) >= 1 and events <@ array['joined', 'paid']),
  who text[] not null default '{sharer,friend}' check (cardinality(who) >= 1 and who <@ array['sharer', 'friend']),
  budget int check (budget is null or budget >= 0), -- null = no limit; the most rewards it may boost
  created_at timestamptz not null default now(),
  constraint boost_length check (ends_at > starts_at and ends_at <= starts_at + interval '31 days'),
  constraint boosts_no_overlap exclude using gist (tstzrange(starts_at, ends_at) with &&)
);
alter table referral.boosts enable row level security;

-- Once now() >= starts_at: starts_at, multiplier, events and who are fixed, ends_at may only move earlier (not before
-- now), budget may only be lowered, and the row cannot be deleted. A boost cannot be created already started, so a
-- multiplier is never applied to claims made before anyone could see it.
create function referral.boosts_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.starts_at < now() then
      raise exception 'referral: a boost cannot start in the past' using errcode = '22023';
    end if;
    return new;
  end if;
  if old.starts_at > now() then -- not started yet: free to change or delete
    if tg_op = 'DELETE' then return old; end if;
    if new.starts_at < now() then
      raise exception 'referral: a boost cannot start in the past' using errcode = '22023';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'referral: a started boost cannot be deleted; end it earlier instead' using errcode = '22023';
  end if;
  if new.id <> old.id or new.starts_at <> old.starts_at or new.multiplier <> old.multiplier
     or new.events <> old.events or new.who <> old.who or new.created_at <> old.created_at then
    raise exception 'referral: a started boost cannot change; only ends_at (earlier) and budget (lower)' using errcode = '22023';
  end if;
  if new.ends_at > old.ends_at then
    raise exception 'referral: a started boost cannot be extended' using errcode = '22023';
  end if;
  if new.ends_at < old.ends_at and new.ends_at < now() then
    raise exception 'referral: a started boost can end now at the earliest' using errcode = '22023';
  end if;
  if new.budget is distinct from old.budget and (new.budget is null or (old.budget is not null and new.budget > old.budget)) then
    raise exception 'referral: a started boost''s budget can only be lowered' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger boosts_guard before insert or update or delete on referral.boosts
  for each row execute function referral.boosts_guard();

-- 3. Rewards: which boost, and the amount before it -------------------------------------------------------------------
alter table referral.rewards
  add column boost_id uuid references referral.boosts (id),
  add column base_amount numeric; -- set on every reward queued from migration 23 on (= amount when not boosted)
create index rewards_by_boost on referral.rewards (boost_id) where boost_id is not null;

-- 4. Boost helpers ------------------------------------------------------------------------------------------------------
-- entitlement_days are whole days: rounded down, never below the base.
create function referral.boosted_amount(kind text, amount numeric, multiplier numeric) returns numeric
language sql immutable set search_path = '' as $$
  select case when kind = 'entitlement_days' then greatest(floor(amount * multiplier), amount) else amount * multiplier end
$$;

-- Rewards a boost has applied to (cancelled and voided ones give their slot back).
create function referral.boost_used(boost_id uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from referral.rewards w where w.boost_id = boost_used.boost_id and w.state not in ('cancelled', 'void_fraud')
$$;

-- The boost a reward of this event and side would get for a referral claimed at `at_time` (null row when none, or when its
-- budget is used up).
create function referral.boost_for(at_time timestamptz, ev text, side text) returns referral.boosts
language sql stable security definer set search_path = '' as $$
  select b.* from referral.boosts b
   where at_time >= b.starts_at and at_time < b.ends_at and ev = any (b.events) and side = any (b.who)
     and (b.budget is null or referral.boost_used(b.id) < b.budget)
$$;

-- The boost running now with budget left (zero or one row).
create function referral.running_boost() returns setof referral.boosts
language sql stable security definer set search_path = '' as $$
  select b.* from referral.boosts b
   where now() >= b.starts_at and now() < b.ends_at and (b.budget is null or referral.boost_used(b.id) < b.budget)
   limit 1
$$;

-- The friend's joined rewards of a rule set, with a boost applied when one is given.
create function referral.friend_joined_rewards(rule_set int, b referral.boosts) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', r.kind,
           'amount', case when b.id is null then r.amount else referral.boosted_amount(r.kind, r.amount, b.multiplier) end,
           'base_amount', r.amount, 'params', r.params, 'boosted', b.id is not null) order by r.kind, r.amount), '[]')
  from referral.rules r
  where r.version = rule_set and r.event = 'joined' and r.who = 'friend' and r.active
$$;

-- 5. Replaced functions (deployed definitions, "Migration 23" lines added) --------------------------------------------

CREATE OR REPLACE FUNCTION referral.touch_install(uid uuid, install_id text)
 RETURNS bytea
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  h record;
begin
  if install_id is null or length(install_id) not between 8 and 64 or install_id !~ '^[A-Za-z0-9-]+$' then
    raise exception 'referral: install_id must be 8-64 letters, digits or dashes' using errcode = '22023';
  end if;
  select * into h from referral.hash_new(install_id);
  -- Migration 23: an under-age user leaves no install row (COPPA 2025, DPDP s.9); the hash is still returned.
  if not referral_app.app_referral_age_ok(uid, (referral.settings()).minimum_age) then
    return h.value_hash;
  end if;
  insert into referral.installs as i (install_id_hash, pepper_version, user_id)
    values (h.value_hash, h.pepper_version, uid)
  on conflict (install_id_hash, user_id) do update set last_seen = now();
  return h.value_hash;
end $function$;

CREATE OR REPLACE FUNCTION referral.touch_member(uid uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  since timestamptz := referral.verified_since(uid);
  result timestamptz;
begin
  -- Migration 23: nothing is written for an under-age user; the verified time is still answered.
  if not referral_app.app_referral_age_ok(uid, (referral.settings()).minimum_age) then
    return since;
  end if;
  insert into referral.members as m (user_id, eligible_from) values (uid, since)
  on conflict (user_id) do update set eligible_from = coalesce(m.eligible_from, excluded.eligible_from)
  returning m.eligible_from into result;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION referral.my_code(uid uuid, install_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s referral.settings := referral.settings();
  c text;
begin
  perform referral.touch_install(uid, install_id);
  perform referral.touch_member(uid);
  if not s.enabled then
    return jsonb_build_object('code', null, 'reason', 'program_paused');
  end if;
  if referral.is_anonymous(uid) then
    return jsonb_build_object('code', null, 'reason', 'anonymous_user');
  end if;
  if exists (select 1 from referral.members m where m.user_id = uid and m.deleted_at is not null) then
    return jsonb_build_object('code', null, 'reason', 'account_deleted');
  end if;
  -- Migration 23: an under-age user gets no code (nothing is written for them: COPPA 2025, DPDP s.9).
  if not referral_app.app_referral_age_ok(uid, s.minimum_age) then
    return jsonb_build_object('code', null, 'reason', 'under_age');
  end if;
  -- Migration 23: a user who left the invite program gets no code until they join again (the code is kept).
  if exists (select 1 from referral.members m where m.user_id = uid and m.left_at is not null) then
    return jsonb_build_object('code', null, 'reason', 'left', 'left', true);
  end if;
  select x.code into c from referral.codes x where x.user_id = uid and x.disabled_at is null;
  if c is not null then
    return jsonb_build_object('code', c, 'reason', 'ok');
  end if;
  if exists (select 1 from referral.codes x where x.user_id = uid and x.disabled_reason = 'abuse') then
    return jsonb_build_object('code', null, 'reason', 'code_disabled');
  end if;
  begin
    insert into referral.codes (user_id, code) values (uid, referral.new_code()) returning code into c;
  exception when unique_violation then -- a parallel call created it first
    select x.code into c from referral.codes x where x.user_id = uid and x.disabled_at is null;
  end;
  return jsonb_build_object('code', c, 'reason', 'ok');
end $function$;

CREATE OR REPLACE FUNCTION referral.claim_core(uid uuid, input_code text, install_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s referral.settings := referral.settings();
  inst bytea;
  inst_all bytea[];
  eligible timestamptz;
  c referral.codes;
  rs int;
  oldest timestamptz;
  n_user int;
  n_inst int;
  norm text := referral.normalise_code(input_code);
  days_left int;
begin
  inst := referral.touch_install(uid, install_id);
  inst_all := referral.hashes_active(install_id);
  eligible := referral.touch_member(uid);

  if not s.enabled then
    return jsonb_build_object('reason', 'program_paused');
  end if;
  if referral.is_anonymous(uid) then
    return jsonb_build_object('reason', 'anonymous_user');
  end if;

  -- Answered before the attempt is counted (migration 19): the answer says nothing about the code, and an app that
  -- retries a kept code on every resume while the friend verifies their email would otherwise use up the 5 attempts.
  if eligible is null then
    return jsonb_build_object('reason', 'not_verified');
  end if;

  -- Migration 23: an under-age user is answered before the attempt is counted, so nothing about them is written
  -- (COPPA as amended 2025, DPDP s.9). The answer says nothing about the code.
  if not referral_app.app_referral_age_ok(uid, s.minimum_age) then
    return jsonb_build_object('reason', 'under_age');
  end if;

  -- 5 attempts per hour per account and per install (ADR 8); every attempt counts, successful or not.
  insert into referral.claim_attempts (user_id, install_id_hash) values (uid, inst);
  select count(*) filter (where a.user_id = uid),
         count(*) filter (where a.install_id_hash = any (inst_all)),
         min(a.at)
    into n_user, n_inst, oldest
    from referral.claim_attempts a
   where a.at > now() - interval '1 hour' and (a.user_id = uid or a.install_id_hash = any (inst_all));
  if n_user > 5 or n_inst > 5 then
    return jsonb_build_object('reason', 'rate_limited',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (oldest + interval '1 hour' - now())))::int));
  end if;

  if exists (select 1 from referral.referrals r where r.friend_id = uid) then
    return jsonb_build_object('reason', 'already_referred');
  end if;
  if now() > eligible + make_interval(days => s.claim_window_days) then
    return jsonb_build_object('reason', 'window_closed');
  end if;

  select * into c from referral.codes x where x.code = norm and x.disabled_at is null;
  -- Migration 23: a sharer who left the program answers like a missing code, so nobody learns who left.
  if c.id is null or exists (select 1 from referral.members m where m.user_id = c.user_id
                                and (m.deleted_at is not null or m.left_at is not null)) then
    return jsonb_build_object('reason', 'unknown_code');
  end if;
  if c.user_id = uid then
    return jsonb_build_object('reason', 'own_code');
  end if;

  -- Same install: the sharer ever used this phone, another account already claimed on it, or a deleted friend did.
  if exists (select 1 from referral.installs i where i.user_id = c.user_id and i.install_id_hash = any (inst_all))
     or exists (select 1 from referral.referrals r where r.claim_install_hash = any (inst_all))
     or exists (select 1 from referral.tombstones t where t.kind = 'install' and t.value_hash = any (inst_all)) then
    return jsonb_build_object('reason', 'same_install');
  end if;

  rs := referral.current_rule_set();
  if rs is null then
    return jsonb_build_object('reason', 'program_paused');
  end if;

  begin
    insert into referral.referrals (code, sharer_id, friend_id, rule_set_version, claim_install_hash, pepper_version)
      values (c.code, c.user_id, uid, rs, inst, s.pepper_version);
  exception when unique_violation then -- a parallel claim by the same friend won
    return jsonb_build_object('reason', 'already_referred');
  end;

  days_left := greatest(0, ceil(extract(epoch from (eligible + make_interval(days => s.activate_window_days) - now())) / 86400)::int);
  return jsonb_build_object('reason', 'ok', 'days_left', days_left);
end $function$;

CREATE OR REPLACE FUNCTION referral.queue_rewards(ref_id uuid, ev text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s referral.settings := referral.settings();
  ref referral.referrals;
  rule referral.rules;
  recipient uuid;
  st text;
  key text;
  n int := 0;
  used int;
  b referral.boosts;
  amt numeric;
  boosted uuid;
begin
  select * into ref from referral.referrals r where r.id = ref_id for update;
  -- Migration 23: the boost (if any) running when the referral was CLAIMED; locked so its budget is counted once.
  select * into b from referral.boosts x
   where ref.claimed_at >= x.starts_at and ref.claimed_at < x.ends_at and ev = any (x.events)
   for update;
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
    amt := rule.amount;
    boosted := null;
    if b.id is not null and st = 'queued' and rule.who = any (b.who)
       and (b.budget is null or (select count(*) from referral.rewards w
                                  where w.boost_id = b.id and w.state not in ('cancelled', 'void_fraud')) < b.budget) then
      amt := referral.boosted_amount(rule.kind, rule.amount, b.multiplier);
      boosted := b.id;
    end if;
    insert into referral.rewards (referral_id, user_id, who, event, rule_id, kind, amount, params, grant_key, state, available_at,
                                  boost_id, base_amount)
    values (ref.id, recipient, rule.who, ev, rule.id, rule.kind, amt, rule.params, key, st,
            now() + case when ev = 'joined' then make_interval(hours => s.joined_delay_hours)
                         else make_interval(hours => s.hold_hours) end,
            boosted, rule.amount)
    on conflict (referral_id, who, event, rule_id) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION referral.terms()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'enabled', s.enabled,
    'paid_enabled', s.paid_enabled,
    'rule_set_version', referral.current_rule_set(),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('event', r.event, 'who', r.who, 'kind', r.kind,
                                                           'amount', r.amount, 'params', r.params)
                                        order by r.event, r.who, r.kind)
                       from referral.rules r
                       where r.active and r.version = referral.current_rule_set()), '[]'::jsonb),
    'claim_window_days', s.claim_window_days,
    'activate_window_days', s.activate_window_days,
    'paid_window_days', s.paid_window_days,
    'hold_hours', s.hold_hours,
    'sharer_joins_per_30d', s.sharer_joins_per_30d,
    'sharer_paid_per_365d', s.sharer_paid_per_365d,
    -- Migration 23: only the boost running now (never a future one: no countdown to a start).
    'boost', (select jsonb_build_object('starts_at', b.starts_at, 'ends_at', b.ends_at, 'multiplier', b.multiplier,
                                        'events', to_jsonb(b.events), 'who', to_jsonb(b.who))
              from referral.running_boost() b where b.id is not null))
  from referral.settings s where s.id
$function$;

CREATE OR REPLACE FUNCTION referral.delete_user(uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ref referral.referrals;
  n_codes int;
  n_cancelled int;
  n_tomb int := 0;
  n_events int;
  x int;
begin
  if uid is null then
    raise exception 'referral: delete_user needs a user id' using errcode = '22023';
  end if;

  -- As a friend: tombstones (every install used + the transaction), cancel the sharer's unfinished paid reward,
  -- keep the referral pseudonymous so the sharer's books and caps stay right.
  select * into ref from referral.referrals r where r.friend_id = uid for update;
  if ref.id is not null then
    insert into referral.tombstones (kind, value_hash, pepper_version)
    select 'install', i.install_id_hash, i.pepper_version from referral.installs i where i.user_id = uid
    on conflict do nothing;
    get diagnostics x = row_count; n_tomb := n_tomb + x;
    if ref.original_transaction_id_hash is not null then
      insert into referral.tombstones (kind, value_hash, pepper_version)
      select 'transaction', t.original_transaction_id_hash, t.pepper_version
        from referral.transactions t where t.original_transaction_id_hash = ref.original_transaction_id_hash
      on conflict do nothing;
      get diagnostics x = row_count; n_tomb := n_tomb + x;
    end if;
    update referral.rewards set state = 'cancelled', last_error = 'friend deleted', updated_at = now(),
                                attempt_token = null, granting_started_at = null
     where referral_id = ref.id and who = 'sharer' and event = 'paid'
       and state in ('queued', 'banked', 'granting', 'failed_retryable', 'failed');
    update referral.referrals set friend_id = null, friend_deleted_at = now() where id = ref.id;
  end if;

  -- As a sharer: retire every code for good, unlink referrals.
  insert into referral.retired_codes (code) select c.code from referral.codes c where c.user_id = uid on conflict do nothing;
  delete from referral.codes where user_id = uid;
  get diagnostics n_codes = row_count;
  update referral.referrals set sharer_id = null where sharer_id = uid;

  -- Their own rewards: stop every unfinished one (the worker also re-checks members.deleted_at before RevenueCat),
  -- then keep the rows without the user id so caps and books stay right.
  update referral.rewards set state = 'cancelled', last_error = 'account deleted', updated_at = now(),
                              attempt_token = null, granting_started_at = null
   where user_id = uid and state in ('queued', 'banked', 'granting', 'failed_retryable', 'failed');
  get diagnostics n_cancelled = row_count;
  delete from referral.reward_seen s using referral.rewards w where w.id = s.reward_id and w.user_id = uid;
  update referral.rewards set user_id = null where user_id = uid;

  -- Personal rows.
  delete from referral.installs where user_id = uid;
  delete from referral.claim_attempts where user_id = uid;
  delete from referral.abuse_marks where user_id = uid;
  delete from referral.events e where uid::text = any (referral.event_users(e.type, e.fields));
  get diagnostics n_events = row_count;
  insert into referral.members as m (user_id, deleted_at) values (uid, now())
  on conflict (user_id) do update set deleted_at = now(), eligible_from = null, review_since = null,
                                      show_name = false, display_name = null, left_at = null;

  return jsonb_build_object('codes_retired', n_codes, 'rewards_cancelled', n_cancelled, 'tombstones', n_tomb,
                            'events_deleted', n_events, 'was_friend', ref.id is not null);
end $function$;

CREATE OR REPLACE FUNCTION referral.privacy_problems()
 RETURNS TABLE(problem text, role_name text, object_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with api(r) as (values ('anon'), ('authenticated'), ('service_role')),
  client_rpcs(sig) as (values
    ('public.referral_my_code(text)'), ('public.referral_rotate_code(text)'), ('public.referral_claim(text,text)'),
    ('public.referral_terms(text)'), ('public.referral_check_activation(text)'), ('public.referral_stats(text)'),
    ('public.referral_pending(text)'), ('public.referral_ack(uuid[],text)'),
    -- migration 23
    ('public.referral_preferences(text)'), ('public.referral_preferences_set(text,jsonb)'),
    ('public.referral_my_claim(text)'), ('public.referral_invite_preview(text)')),
  kit_fn as (
    select p.oid, n.oid as nsoid, n.nspname, p.proname, p.proacl,
           n.nspname || '.' || p.proname as name,
           n.nspname || '.' || p.proname || '(' ||
             coalesce((select string_agg(pg_catalog.format_type(t, null), ',' order by i)
                       from unnest(p.proargtypes::oid[]) with ordinality as a(t, i)), '') || ')' as sig
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('referral', 'referral_app') or (n.nspname = 'public' and p.proname like 'referral\_%')
  )
  select 'schema usage', api.r, s.nspname::text
  from api, pg_catalog.pg_namespace s
  where s.nspname in ('referral', 'referral_app') and pg_catalog.has_schema_privilege(api.r, s.oid, 'USAGE')
  union all
  select 'table access', api.r, t.schemaname || '.' || t.tablename
  from api, pg_catalog.pg_tables t
  where t.schemaname = 'referral'
    and pg_catalog.has_table_privilege(api.r, (t.schemaname || '.' || t.tablename)::regclass,
                                       'SELECT,INSERT,UPDATE,DELETE')
  union all
  select 'function reachable', api.r, f.name
  from api, kit_fn f
  where f.nspname in ('referral', 'referral_app')
    and pg_catalog.has_schema_privilege(api.r, f.nsoid, 'USAGE')
    and pg_catalog.has_function_privilege(api.r, f.oid, 'EXECUTE')
  union all
  select 'public execute', 'PUBLIC', f.name
  from kit_fn f
  where f.proacl is null
     or exists (select 1 from pg_catalog.aclexplode(f.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  union all
  select 'anon execute', 'anon', f.name
  from kit_fn f
  where f.nspname = 'public' and pg_catalog.has_function_privilege('anon', f.oid, 'EXECUTE')
    and f.sig <> 'public.referral_invite_preview(text)' -- the invite page's read (migration 23): anon by design
  union all
  select 'unexpected client function', 'authenticated', f.sig
  from kit_fn f
  where f.nspname = 'public' and f.proname not like 'referral\_svc\_%' and f.proname not like 'referral\_admin\_%'
    and f.sig not in (select sig from client_rpcs)
    and pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
  union all
  select 'admin function without check', 'authenticated', f.name
  from kit_fn f join pg_catalog.pg_proc p on p.oid = f.oid
  where f.nspname = 'public' and f.proname like 'referral\_admin\_%'
    and pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
    and position('referral.require_admin()' in p.prosrc) = 0
  union all
  select 'client function not granted', 'authenticated', c.sig
  from client_rpcs c join kit_fn f on f.sig = c.sig
  where not pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
  union all
  select 'service function exposed', 'authenticated', f.name
  from kit_fn f
  where f.nspname = 'public' and f.proname like 'referral\_svc\_%'
    and pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
  union all
  select 'definer without search_path', null, f.name
  from kit_fn f join pg_catalog.pg_proc p on p.oid = f.oid
  where p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'], false)
$function$;

-- 6. Preferences: name on the invite page, participating ------------------------------------------------------------
create function referral.preferences_json(uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('show_name', coalesce(m.show_name, false), 'display_name', m.display_name,
                            'participating', m.left_at is null)
  from (select 1) one left join referral.members m on m.user_id = uid
$$;

create function referral.preferences(uid uuid, install_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform referral.touch_install(uid, install_id);
  perform referral.touch_member(uid);
  if referral.is_anonymous(uid) then
    return jsonb_build_object('reason', 'anonymous_user');
  end if;
  if not referral_app.app_referral_age_ok(uid, (referral.settings()).minimum_age) then
    return jsonb_build_object('reason', 'under_age');
  end if;
  return referral.preferences_json(uid);
end $$;

-- prefs: any of show_name (boolean), display_name (string or null; "" clears it), participating (boolean). Unknown
-- keys or wrong types raise 22023 (a programming error, not a user's). participating false = leave (left_at, kept if
-- already set), true = join again.
create function referral.preferences_set(uid uuid, install_id text, prefs jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  nm text;
begin
  if prefs is null or jsonb_typeof(prefs) <> 'object' then
    raise exception 'referral: prefs must be a JSON object' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(prefs) k where k not in ('show_name', 'display_name', 'participating')) then
    raise exception 'referral: unknown preference (allowed: show_name, display_name, participating)' using errcode = '22023';
  end if;
  if (prefs ? 'show_name' and jsonb_typeof(prefs -> 'show_name') <> 'boolean')
     or (prefs ? 'participating' and jsonb_typeof(prefs -> 'participating') <> 'boolean')
     or (prefs ? 'display_name' and jsonb_typeof(prefs -> 'display_name') not in ('string', 'null')) then
    raise exception 'referral: show_name and participating are booleans, display_name a string or null' using errcode = '22023';
  end if;

  perform referral.touch_install(uid, install_id);
  perform referral.touch_member(uid);
  if referral.is_anonymous(uid) then
    return jsonb_build_object('reason', 'anonymous_user');
  end if;
  if not referral_app.app_referral_age_ok(uid, (referral.settings()).minimum_age) then
    return jsonb_build_object('reason', 'under_age');
  end if;

  nm := nullif(btrim(regexp_replace(prefs ->> 'display_name', '\s+', ' ', 'g')), '');
  if not referral.valid_display_name(nm) then
    return jsonb_build_object('reason', 'invalid_name');
  end if;

  update referral.members m set
    show_name = case when prefs ? 'show_name' then (prefs ->> 'show_name')::boolean else m.show_name end,
    display_name = case when prefs ? 'display_name' then nm else m.display_name end,
    left_at = case when not prefs ? 'participating' then m.left_at
                   when (prefs ->> 'participating')::boolean then null
                   else coalesce(m.left_at, now()) end
   where m.user_id = uid;
  return referral.preferences_json(uid);
end $$;

-- 7. The caller's own claim as a friend (G2) -------------------------------------------------------------------------
-- none | claimed (with the friend's joined rewards and the boost the claim gets) | joined (joined and every later
-- state: the friend already activated) | expired (also a claim past its window the sweep has not reached yet).
create function referral.my_claim(uid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s referral.settings := referral.settings();
  ref referral.referrals;
  activate_by timestamptz;
begin
  select * into ref from referral.referrals r where r.friend_id = uid;
  if ref.id is null then
    return jsonb_build_object('state', 'none');
  end if;
  activate_by := ref.claimed_at + make_interval(days => s.activate_window_days); -- as check_activation expires it
  if ref.state = 'expired' or (ref.state = 'claimed' and now() > activate_by) then
    return jsonb_build_object('state', 'expired');
  end if;
  if ref.state <> 'claimed' then
    return jsonb_build_object('state', 'joined', 'joined_at', ref.joined_at);
  end if;
  return jsonb_build_object(
    'state', 'claimed', 'claimed_at', ref.claimed_at, 'activate_by', activate_by,
    'days_left', greatest(0, ceil(extract(epoch from (activate_by - now())) / 86400)::int),
    'rewards', referral.friend_joined_rewards(ref.rule_set_version, referral.boost_for(ref.claimed_at, 'joined', 'friend')));
end $$;

-- 8. Invite page preview (anon; reads only) ----------------------------------------------------------------------------
-- Unknown, disabled (review), retired, left or deleted codes, and a paused program, all answer {"valid": false}.
create function referral.invite_preview(input_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s referral.settings := referral.settings();
  rs int := referral.current_rule_set();
  c referral.codes;
  m referral.members;
  b referral.boosts;
  nm text;
begin
  if not s.enabled or rs is null or input_code is null or length(input_code) > 64 then
    return jsonb_build_object('valid', false);
  end if;
  select * into c from referral.codes x where x.code = referral.normalise_code(input_code) and x.disabled_at is null;
  if c.id is null then
    return jsonb_build_object('valid', false);
  end if;
  select * into m from referral.members x where x.user_id = c.user_id;
  if m.deleted_at is not null or m.left_at is not null then
    return jsonb_build_object('valid', false);
  end if;
  if m.show_name and m.display_name is not null and referral_app.app_referral_age_ok(c.user_id, s.minimum_age) then
    nm := m.display_name;
  end if;
  select * into b from referral.running_boost();
  return jsonb_build_object(
    'valid', true,
    'name', nm,
    'friend_rewards', (select coalesce(jsonb_agg(e - 'base_amount' - 'boosted'), '[]')
                       from jsonb_array_elements(referral.friend_joined_rewards(rs, referral.boost_for(now(), 'joined', 'friend'))) e),
    'sharer_rewarded', exists (select 1 from referral.rules r where r.version = rs and r.who = 'sharer' and r.active),
    'boost', case when b.id is null then null else jsonb_build_object('ends_at', b.ends_at, 'multiplier', b.multiplier) end);
end $$;

-- 9. Public wrappers ---------------------------------------------------------------------------------------------------
create function public.referral_preferences(install_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return referral.preferences(auth.uid(), install_id);
end $$;

create function public.referral_preferences_set(install_id text, prefs jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return referral.preferences_set(auth.uid(), install_id, prefs);
end $$;

create function public.referral_my_claim(install_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform referral.touch_install(auth.uid(), install_id);
  return referral.my_claim(auth.uid());
end $$;

create function public.referral_invite_preview(code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return referral.invite_preview(code);
end $$;

-- 10. Admin funnel (G11) ---------------------------------------------------------------------------------------------
-- Cohort view by claim day (UTC): of the referrals claimed that day, how many joined, paid, expired.
create function public.referral_admin_funnel(days int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d int := least(greatest(coalesce(days, 30), 1), 365);
  today date := (now() at time zone 'UTC')::date;
  day0 date;
begin
  perform referral.require_admin();
  day0 := today - (d - 1);
  return (
    with cohort as (
      select r.id, r.state, r.claimed_at, r.joined_at, r.paid_at, (r.claimed_at at time zone 'UTC')::date as claim_day
        from referral.referrals r
       where r.claimed_at >= (day0::timestamp at time zone 'UTC')
    )
    select jsonb_build_object(
      'days', (select jsonb_agg(to_jsonb(x) order by x.day) from (
                 select g.day::date as day, count(c.id) as claimed, count(c.joined_at) as joined, count(c.paid_at) as paid,
                        count(c.id) filter (where c.state = 'expired') as expired
                   from generate_series(day0, today, interval '1 day') g(day)
                   left join cohort c on c.claim_day = g.day::date
                  group by g.day) x),
      'totals', jsonb_build_object(
        'claimed', (select count(*) from cohort),
        'joined', (select count(c.joined_at) from cohort c),
        'paid', (select count(c.paid_at) from cohort c),
        'expired', (select count(*) from cohort c where c.state = 'expired'),
        'boosted_rewards', (select count(*) from referral.rewards w join cohort c on c.id = w.referral_id
                             where w.boost_id is not null)),
      'median_hours_to_join', (select round((percentile_cont(0.5) within group (
                                       order by extract(epoch from (c.joined_at - c.claimed_at)) / 3600))::numeric, 1)
                                 from cohort c where c.joined_at is not null)));
end $$;

-- 11. Grants: explicit, by name --------------------------------------------------------------------------------------
revoke all on function public.referral_preferences(text), public.referral_preferences_set(text, jsonb),
  public.referral_my_claim(text) from public, anon, service_role;
grant execute on function public.referral_preferences(text), public.referral_preferences_set(text, jsonb),
  public.referral_my_claim(text) to authenticated;
-- the invite page reads the preview without signing in
revoke all on function public.referral_invite_preview(text) from public, service_role;
grant execute on function public.referral_invite_preview(text) to anon, authenticated;
revoke all on function public.referral_admin_funnel(int) from public, anon;
grant execute on function public.referral_admin_funnel(int) to authenticated, service_role;

revoke all on all tables in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral_app from public, anon, authenticated, service_role;
