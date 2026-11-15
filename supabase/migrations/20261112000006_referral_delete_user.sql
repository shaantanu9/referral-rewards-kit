-- referral-kit migration 6: account deletion and retention (ADR 9).
-- The app calls referral.delete_user(uid) from its deletion path (SQL), or referral_svc_delete_user from its server,
-- or attaches referral.on_auth_user_deleted() to auth.users so deletion is never missed.

create function referral.delete_user(uid uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
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
  on conflict (user_id) do update set deleted_at = now(), eligible_from = null, review_since = null;

  return jsonb_build_object('codes_retired', n_codes, 'rewards_cancelled', n_cancelled, 'tombstones', n_tomb,
                            'events_deleted', n_events, 'was_friend', ref.id is not null);
end $$;

-- Attach with: create trigger referral_delete_user before delete on auth.users
--              for each row execute function referral.on_auth_user_deleted();
create function referral.on_auth_user_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform referral.delete_user(old.id);
  return old;
end $$;

-- Tombstones are kept 12 months for fraud prevention, then removed (ADR 9). The sweep from migration 5 is kept and
-- extended.
alter function referral.sweep() rename to sweep_queue;
create function referral.sweep() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  result jsonb := referral.sweep_queue();
  n int;
begin
  delete from referral.tombstones where created_at < now() - interval '12 months';
  get diagnostics n = row_count;
  return result || jsonb_build_object('tombstones_purged', n);
end $$;

create function public.referral_svc_delete_user(user_id uuid) returns jsonb
language sql volatile security definer set search_path = '' as $$ select referral.delete_user(user_id) $$;
revoke all on function public.referral_svc_delete_user(uuid) from public, anon, authenticated;
grant execute on function public.referral_svc_delete_user(uuid) to service_role;

revoke all on all tables in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral_app from public, anon, authenticated, service_role;
