-- referral-kit migration 19: a friend waiting to verify their email no longer loses the kept invite code.
--
-- referral.claim_core counted every call against the 5-per-hour limit before answering `not_verified`. The package
-- keeps the code on `not_verified` and retries it on every app resume; after 5 resumes in an hour (switching to the
-- mail app and back) the answer became `rate_limited` and the code was cleared. `not_verified` is now answered before
-- the attempt is counted. Same body as migration 2 (renamed claim_core in migration 9) with only that check moved.
-- The package (0.4.0) also keeps a retried code on `rate_limited` and `anonymous_user`.

create or replace function referral.claim_core(uid uuid, input_code text, install_id text) returns jsonb
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

  -- Answered before the attempt is counted (migration 19): the answer says nothing about the code, and an app that
  -- retries a kept code on every resume while the friend verifies their email would otherwise use up the 5 attempts.
  if eligible is null then
    return jsonb_build_object('reason', 'not_verified');
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

revoke execute on function referral.claim_core(uuid, text, text) from public, anon, authenticated, service_role;
