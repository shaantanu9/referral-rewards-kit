-- referral-kit migration 2: codes, installs, members, claim (ADR 4.2, 6.2, 6.8, 7, 8, 11.7).
-- Inner functions live in `referral` and take the user id explicitly (testable, unreachable for API roles); the
-- `public.referral_*` wrappers read auth.uid() and are granted to `authenticated` only.

alter table referral.codes
  add column disabled_reason text check (disabled_reason in ('rotated', 'abuse', 'deleted')),
  add constraint disabled_has_reason check ((disabled_at is null) = (disabled_reason is null));

create table referral.claim_attempts (
  user_id uuid not null,
  install_id_hash bytea not null,
  at timestamptz not null default now()
);
create index claim_attempts_by_user on referral.claim_attempts (user_id, at);
create index claim_attempts_by_install on referral.claim_attempts (install_id_hash, at);
alter table referral.claim_attempts enable row level security;

-- Default age hook: allows everyone. The app replaces it (`create or replace`) with its own declared-age check
-- (ADR 6.2); the integration guide says so.
create function referral_app.app_referral_age_ok(user_id uuid, minimum_age int) returns boolean
language sql stable security definer set search_path = '' as $$ select true $$;

-- Code input normalisation (ADR 11.7), applied by the server whatever the client sent: drop Unicode format
-- characters (bidi isolates from share text, zero-width spaces, soft hyphen, BOM), whitespace and dashes; turn
-- Arabic-Indic, Extended Arabic-Indic and Devanagari digits into ASCII; NFKC folds full-width forms; upper-case.
create function referral.normalise_code(input text) returns text
language sql immutable set search_path = '' as $$
  select upper(normalize(
    translate(
      regexp_replace(coalesce(input, ''),
        '[­؜᠎​-‏‪-‮⁠-⁯﻿‐-―−[:space:]-]', '', 'g'),
      '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹०१२३४५६७८९',
      '012345678901234567890123456789'),
    NFKC))
$$;

-- 8 characters from the 31-symbol alphabet, rejection-sampled from secure random bytes so every symbol is equally
-- likely; skips codes in use or retired, and a short list of offensive substrings.
create function referral.new_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  denied constant text[] := array['FUCK', 'SHT', 'CNT', 'DCK', 'NAZ', 'RAPE', 'SEX', 'XXX', 'ASS', 'FAG', 'KKK', 'GAY', 'HATE', 'KYS'];
  b bytea;
  c text;
  i int;
  tries int := 0;
begin
  loop
    tries := tries + 1;
    if tries > 50 then
      raise exception 'referral: could not generate a free code after 50 tries';
    end if;
    c := '';
    while length(c) < 8 loop
      b := extensions.gen_random_bytes(16);
      for i in 0 .. 15 loop
        if get_byte(b, i) < 248 and length(c) < 8 then -- 248 = 8 * 31, so no modulo bias
          c := c || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
        end if;
      end loop;
    end loop;
    continue when exists (select 1 from unnest(denied) d where position(d in c) > 0);
    continue when exists (select 1 from referral.codes x where x.code = c);
    continue when exists (select 1 from referral.retired_codes r where r.code = c);
    return c;
  end loop;
end $$;

-- Records the install on every RPC (ADR 7, 8). install_id: the app's random UUID, never an advertising id.
create function referral.touch_install(uid uuid, install_id text) returns bytea
language plpgsql volatile security definer set search_path = '' as $$
declare
  h record;
begin
  if install_id is null or length(install_id) not between 8 and 64 or install_id !~ '^[A-Za-z0-9-]+$' then
    raise exception 'referral: install_id must be 8-64 letters, digits or dashes' using errcode = '22023';
  end if;
  select * into h from referral.hash_new(install_id);
  insert into referral.installs as i (install_id_hash, pepper_version, user_id)
    values (h.value_hash, h.pepper_version, uid)
  on conflict (install_id_hash, user_id) do update set last_seen = now();
  return h.value_hash;
end $$;

-- Verified and not anonymous (ADR 6.2): email or phone confirmed, or an OAuth identity.
create function referral.verified_since(uid uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case when u.is_anonymous then null else
    least(u.email_confirmed_at, u.phone_confirmed_at,
          (select min(i.created_at) from auth.identities i
           where i.user_id = u.id and i.provider not in ('email', 'phone', 'anonymous')))
  end
  from auth.users u where u.id = uid
$$;

-- members.eligible_from is set once, from the moment the account first became verified (ADR 6.8).
create function referral.touch_member(uid uuid) returns timestamptz
language plpgsql volatile security definer set search_path = '' as $$
declare
  since timestamptz := referral.verified_since(uid);
  result timestamptz;
begin
  insert into referral.members as m (user_id, eligible_from) values (uid, since)
  on conflict (user_id) do update set eligible_from = coalesce(m.eligible_from, excluded.eligible_from)
  returning m.eligible_from into result;
  return result;
end $$;

create function referral.is_anonymous(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select u.is_anonymous from auth.users u where u.id = uid), true)
      or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true'
$$;

-- my code ----------------------------------------------------------------------------------------------------------
create function referral.my_code(uid uuid, install_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
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
end $$;

create function referral.rotate_code(uid uuid, install_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  cur referral.codes;
  c text;
begin
  perform referral.touch_install(uid, install_id);
  select * into cur from referral.codes x where x.user_id = uid and x.disabled_at is null for update;
  if cur.id is null then
    return referral.my_code(uid, install_id);
  end if;
  if cur.created_at > now() - interval '30 days' then
    return jsonb_build_object('code', cur.code, 'reason', 'too_soon',
                              'next_allowed_at', cur.created_at + interval '30 days');
  end if;
  update referral.codes set disabled_at = now(), disabled_reason = 'rotated' where id = cur.id;
  insert into referral.retired_codes (code) values (cur.code) on conflict do nothing;
  insert into referral.codes (user_id, code) values (uid, referral.new_code()) returning code into c;
  return jsonb_build_object('code', c, 'reason', 'ok');
end $$;

-- claim ------------------------------------------------------------------------------------------------------------
-- Returns {reason, retry_after_seconds?, days_left?}. Order matters: the rate limit comes before anything that would
-- reveal whether a code exists, and `unknown_code` covers disabled and retired codes (ADR 7).
create function referral.claim(uid uuid, input_code text, install_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
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

  if eligible is null then
    return jsonb_build_object('reason', 'not_verified');
  end if;
  if not referral_app.app_referral_age_ok(uid, s.minimum_age) then
    return jsonb_build_object('reason', 'under_age');
  end if;
  if exists (select 1 from referral.referrals r where r.friend_id = uid) then
    return jsonb_build_object('reason', 'already_referred');
  end if;
  if now() > eligible + make_interval(days => s.claim_window_days) then
    return jsonb_build_object('reason', 'window_closed');
  end if;

  select * into c from referral.codes x where x.code = norm and x.disabled_at is null;
  if c.id is null or exists (select 1 from referral.members m where m.user_id = c.user_id and m.deleted_at is not null) then
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
end $$;

-- What the app and invite page show (ADR 11.1): the rules a claim made now is promised, caps and windows.
create function referral.terms() returns jsonb
language sql stable security definer set search_path = '' as $$
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
    'sharer_paid_per_365d', s.sharer_paid_per_365d)
  from referral.settings s where s.id
$$;

-- public wrappers (authenticated only) ------------------------------------------------------------------------------
create function public.referral_my_code(install_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return referral.my_code(auth.uid(), install_id);
end $$;

create function public.referral_rotate_code(install_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return referral.rotate_code(auth.uid(), install_id);
end $$;

create function public.referral_claim(code text, install_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return referral.claim(auth.uid(), code, install_id);
end $$;

create function public.referral_terms(install_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform referral.touch_install(auth.uid(), install_id);
  return referral.terms();
end $$;

-- grants: explicit, by name (Supabase's defaults grant new public functions to anon too) -------------------------
revoke all on function public.referral_my_code(text), public.referral_rotate_code(text),
  public.referral_claim(text, text), public.referral_terms(text) from public, anon, service_role;
grant execute on function public.referral_my_code(text), public.referral_rotate_code(text),
  public.referral_claim(text, text), public.referral_terms(text) to authenticated;

revoke all on all tables in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral_app from public, anon, authenticated, service_role;
