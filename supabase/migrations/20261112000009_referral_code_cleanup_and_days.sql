-- referral-kit migration 9: locale-proof code cleanup, the right `days_left`, and `claim_days_left` in the terms
-- (issues found by the Flutter package build, docs/ISSUES.md).
--
-- 1. `[:space:]` depends on the database locale: under the C locale Postgres does not treat U+00A0 or U+3000 as space,
--    so a pasted code with a non-breaking or ideographic space was `unknown_code`. The list is now explicit.
-- 2. Dashes were removed before NFKC, so a full-width hyphen (U+FF0D) became `-` and survived. NFKC now runs first.
--    The same order is used by the Flutter package (code_format.dart) and the invite page (render.ts).

create or replace function referral.normalise_code(input text) returns text
language sql immutable set search_path = '' as $$
  select upper(
    translate(
      regexp_replace(
        normalize(coalesce(input, ''), NFKC),
        '[\u0009-\u000D  ­؜ ᠎ -‏‐-―  ‪-  ⁠-⁯−　﻿-]',
        '', 'g'),
      '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹०१२३४५६७८९',
      '012345678901234567890123456789'))
$$;

-- 3. `days_left` after a successful claim is the activation window, which starts at the claim (ADR 6.2), not at the
--    moment the account was verified.
alter function referral.claim(uuid, text, text) rename to claim_core;
create function referral.claim(uid uuid, input_code text, install_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r jsonb := referral.claim_core(uid, input_code, install_id);
begin
  if r ->> 'reason' = 'ok' then
    r := r || jsonb_build_object('days_left', (referral.settings()).activate_window_days);
  end if;
  return r;
end $$;

-- 4. How many days the caller still has to add a code (ADR 4.2 step 3 countdown); null when they cannot add one.
create function referral.claim_days_left(uid uuid) returns int
language sql stable security definer set search_path = '' as $$
  select case
    when m.eligible_from is null or exists (select 1 from referral.referrals r where r.friend_id = uid) then null
    else greatest(0, ceil(extract(epoch from (m.eligible_from + make_interval(days => s.claim_window_days) - now())) / 86400)::int)
  end
  from referral.settings s left join referral.members m on m.user_id = uid
  where s.id
$$;

create or replace function public.referral_terms(install_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform referral.touch_install(auth.uid(), install_id);
  perform referral.touch_member(auth.uid());
  return referral.terms() || jsonb_build_object('claim_days_left', referral.claim_days_left(auth.uid()));
end $$;

revoke all on function public.referral_terms(text) from public, anon, service_role;
grant execute on function public.referral_terms(text) to authenticated;
revoke execute on all functions in schema referral from public, anon, authenticated, service_role;
