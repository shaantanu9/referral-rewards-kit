-- rewards engine migration 4: state, worker support, deletion, referral bridge, public API and privileges
-- (ADR 0002 sections 7, 9, 10, 11, 12).

-- Everything the app shows, in one call. Starts `first_seen` offer windows (so it is volatile).
create function rewards.state(uid uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s rewards.settings := rewards.settings();
  p rewards.programs;
  progs jsonb := '[]';
  streaks jsonb := '[]';
  milestones jsonb := '[]';
  offers jsonb := '[]';
  social jsonb := '[]';
  o jsonb;
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  if not s.enabled then
    return jsonb_build_object('enabled', false, 'server_time', now(), 'programs', '[]'::jsonb, 'streaks', '[]'::jsonb,
      'milestones', '[]'::jsonb, 'offers', '[]'::jsonb, 'social', '[]'::jsonb, 'inbox', '[]'::jsonb, 'badges', '[]'::jsonb);
  end if;
  for p in select * from rewards.programs x order by x.sort, x.key loop
    if p.kind = 'offer' then
      if coalesce(p.config ->> 'start_on', 'first_seen') = 'first_seen' then perform rewards.start_offer(uid, p); end if;
      o := rewards.offer_json(uid, p);
      -- an offer the user never started is shown only while it is live; a started one stays (claimed / expired)
      if o ->> 'state' <> 'not_started' or rewards.is_live(p) then offers := offers || jsonb_build_array(o); end if;
      if rewards.is_live(p) or o ->> 'state' <> 'not_started' then
        progs := progs || jsonb_build_array(jsonb_build_object('key', p.key, 'kind', p.kind, 'starts_at', p.starts_at,
                                                               'ends_at', p.ends_at, 'public', p.public));
      end if;
      continue;
    end if;
    if not rewards.is_live(p) then continue; end if;
    progs := progs || jsonb_build_array(jsonb_build_object('key', p.key, 'kind', p.kind, 'starts_at', p.starts_at,
                                                           'ends_at', p.ends_at, 'public', p.public));
    if p.kind = 'streak' then streaks := streaks || jsonb_build_array(rewards.streak_json(uid, p));
    elsif p.kind = 'milestone' then milestones := milestones || jsonb_build_array(rewards.milestone_json(uid, p));
    elsif p.kind = 'social_tag' then social := social || jsonb_build_array(rewards.social_json(uid, p));
    end if;
  end loop;
  return jsonb_build_object('enabled', true, 'server_time', now(), 'programs', progs, 'streaks', streaks,
    'milestones', milestones, 'offers', offers, 'social', social,
    'inbox', rewards.grants_json(uid, array(
      select g.id from rewards.grants g
       where g.user_id = uid and g.seen_at is null and g.state in ('granted', 'queued', 'granting', 'failed_retryable')
       order by g.created_at desc limit 50)),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('badge', b.badge, 'program', b.program_key,
                                                             'granted_at', b.granted_at) order by b.granted_at)
                          from rewards.badges b where b.user_id = uid), '[]'));
end $$;

-- Only granted rewards can be marked seen; pending ones stay in the inbox until they land.
create function rewards.mark_seen(uid uuid, ids uuid[]) returns int
language sql volatile security definer set search_path = '' as $$
  with x as (update rewards.grants g set seen_at = now()
              where g.user_id = uid and g.id = any(coalesce(ids, '{}')) and g.seen_at is null and g.state = 'granted'
             returning 1)
  select count(*)::int from x
$$;

-- Worker support (section 7, 10.1) -----------------------------------------------------------------------------------

create function rewards.retry_local(max_rows int default 200) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  gid uuid;
  n int := 0;
begin
  for gid in select g.id from rewards.grants g
              where g.state in ('queued', 'failed_retryable') and g.kind <> 'entitlement_days' and g.user_id is not null
              order by g.created_at limit max_rows loop
    if rewards.grant_local(gid) = 'granted' then n := n + 1; end if;
  end loop;
  return n;
end $$;

create function rewards.claim_grants(batch int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s rewards.settings := rewards.settings();
  out jsonb;
begin
  update rewards.grants g set state = 'failed_retryable', attempt_token = null, granting_started_at = null,
         last_error = 'lease expired', updated_at = now()
   where g.state = 'granting' and g.granting_started_at < now() - make_interval(mins => s.lease_minutes);
  with c as (
    select g.id from rewards.grants g
     where g.kind = 'entitlement_days' and g.state in ('queued', 'failed_retryable') and g.attempts < s.max_attempts
     order by g.created_at limit greatest(least(batch, 100), 1) for update skip locked),
  u as (
    update rewards.grants g set state = 'granting', attempt_token = gen_random_uuid(), granting_started_at = now(),
           attempts = g.attempts + 1, updated_at = now()
      from c where g.id = c.id
    returning g.*)
  select coalesce(jsonb_agg(jsonb_build_object('grant_id', u.id, 'attempt_token', u.attempt_token, 'user_id', u.user_id,
           'user_deleted', u.user_id is null, 'entitlement_id', u.params ->> 'entitlement_id', 'days', u.amount::int,
           'params', u.params, 'target_expires_at_ms', u.target_expires_at_ms, 'attempts', u.attempts)
           order by u.created_at), '[]')
    into out from u;
  return out;
end $$;

-- Stores the target expiry before the RevenueCat call, once: a retry after a timeout reuses the same target.
create function rewards.set_target(gid uuid, token uuid, target_ms bigint) returns boolean
language sql volatile security definer set search_path = '' as $$
  with x as (update rewards.grants g set target_expires_at_ms = coalesce(g.target_expires_at_ms, target_ms), updated_at = now()
              where g.id = gid and g.attempt_token = token and g.state = 'granting' returning 1)
  select exists (select 1 from x)
$$;

create function rewards.finish_grant(gid uuid, token uuid, outcome text, error text, target_ms bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s rewards.settings := rewards.settings();
  g rewards.grants;
begin
  if outcome not in ('granted', 'retry', 'failed', 'cancelled') then
    raise exception 'rewards: unknown outcome %', outcome using errcode = '22023';
  end if;
  select * into g from rewards.grants x where x.id = gid for update;
  if g.id is null or g.state <> 'granting' or g.attempt_token is distinct from token then
    return jsonb_build_object('state', 'lost_lease');
  end if;
  update rewards.grants x
     set state = case outcome when 'granted' then 'granted' when 'failed' then 'failed' when 'cancelled' then 'cancelled'
                              else case when x.attempts >= s.max_attempts then 'failed' else 'failed_retryable' end end,
         granted_at = case when outcome = 'granted' then now() end,
         last_error = left(error, 500), attempt_token = null, granting_started_at = null, updated_at = now(),
         target_expires_at_ms = coalesce(target_ms, x.target_expires_at_ms)
   where x.id = gid returning * into g;
  return jsonb_build_object('state', g.state);
end $$;

-- Retention: events past events_retention_days are deleted, except those a milestone counts by dedupe key (their
-- props are cleared instead), so tracking the same item again never counts twice.
create function rewards.purge_events() returns int
language sql volatile security definer set search_path = '' as $$
  with cutoff as (select now() - make_interval(days => s.events_retention_days) t from rewards.settings s where s.id),
  kept as (select distinct p.config ->> 'event' t from rewards.programs p where p.kind = 'milestone'),
  cleared as (update rewards.events e set props = '{}' from cutoff
               where e.occurred_at < cutoff.t and e.type in (select t from kept) and e.props <> '{}' returning 1),
  gone as (delete from rewards.events e using cutoff
            where e.occurred_at < cutoff.t and e.type not in (select t from kept where t is not null) returning 1)
  select ((select count(*) from cleared) + (select count(*) from gone))::int
$$;

-- Deletion (section 12) ----------------------------------------------------------------------------------------------

create function rewards.delete_user(uid uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  n_cancelled int;
  n_posts int;
begin
  if uid is null then raise exception 'rewards: delete_user needs a user id' using errcode = '22023'; end if;
  delete from rewards.events e where e.user_id = uid;
  delete from rewards.streaks x where x.user_id = uid;
  delete from rewards.counters x where x.user_id = uid;
  delete from rewards.offer_windows x where x.user_id = uid;
  delete from rewards.badges x where x.user_id = uid;
  delete from rewards.social_posts x where x.user_id = uid;
  get diagnostics n_posts = row_count;
  delete from rewards.members x where x.user_id = uid;
  update rewards.grants g set state = 'cancelled', last_error = 'user deleted', attempt_token = null,
         granting_started_at = null, updated_at = now()
   where g.user_id = uid and g.state in ('queued', 'granting', 'failed_retryable');
  get diagnostics n_cancelled = row_count;
  update rewards.grants g set user_id = null where g.user_id = uid;
  return jsonb_build_object('cancelled', n_cancelled, 'social_posts', n_posts);
end $$;

-- Attach in the app's config: create trigger rewards_delete_user before delete on auth.users
--   for each row execute function rewards.on_auth_user_deleted();
create function rewards.on_auth_user_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform rewards.delete_user(old.id);
  return old;
end $$;

-- Referral bridge (section 9) ----------------------------------------------------------------------------------------
-- Reads the row as JSON so this file does not depend on the referral schema's columns at compile time.
create function rewards.referral_bridge() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
begin
  if n ->> 'state' is not distinct from o ->> 'state' then return new; end if;
  begin
    if n ->> 'state' = 'joined' then
      if n ->> 'sharer_id' is not null then
        perform rewards.track((n ->> 'sharer_id')::uuid, 'referral_joined', n ->> 'id', '{}', null, true);
      end if;
      if n ->> 'friend_id' is not null then
        perform rewards.track((n ->> 'friend_id')::uuid, 'referral_welcomed', n ->> 'id', '{}', null, true);
      end if;
    elsif n ->> 'state' = 'paid' and n ->> 'sharer_id' is not null then
      perform rewards.track((n ->> 'sharer_id')::uuid, 'referral_paid', n ->> 'id', '{}', null, true);
    end if;
  exception when others then
    raise warning 'rewards: referral bridge failed for %: %', n ->> 'id', sqlerrm;
  end;
  return new;
end $$;

do $$
begin
  insert into rewards.event_types (name, source, daily_limit) values
    ('referral_joined', 'server', 1000), ('referral_welcomed', 'server', 1000), ('referral_paid', 'server', 1000)
  on conflict do nothing;
  if to_regclass('referral.referrals') is not null then
    create trigger rewards_bridge after insert or update of state on referral.referrals
      for each row execute function rewards.referral_bridge();
  end if;
end $$;

-- Public API (section 11) --------------------------------------------------------------------------------------------

create function public.rewards_state() returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.state(auth.uid()) $$;

create function public.rewards_track(type text, dedupe_key text default null, props jsonb default '{}',
                                     timezone text default null) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select rewards.track(auth.uid(), type, dedupe_key, props, timezone, false)
$$;

create function public.rewards_offer_claim(program text) returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.offer_claim(auth.uid(), program) $$;

create function public.rewards_social_start(program text, handle text) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select rewards.social_start(auth.uid(), program, handle)
$$;

create function public.rewards_mark_seen(grant_ids uuid[]) returns int
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  return rewards.mark_seen(auth.uid(), grant_ids);
end $$;

-- Service role only (Edge Function and the app's own server).
create function public.rewards_svc_track(user_id uuid, type text, dedupe_key text default null, props jsonb default '{}')
returns jsonb language sql volatile security definer set search_path = '' as $$
  select rewards.track(user_id, type, dedupe_key, props, null, true)
$$;
create function public.rewards_svc_claim_grants(batch int) returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.claim_grants(batch) $$;
create function public.rewards_svc_set_target(grant_id uuid, attempt_token uuid, target_expires_at_ms bigint) returns boolean
language sql volatile security definer set search_path = '' as $$
  select rewards.set_target(grant_id, attempt_token, target_expires_at_ms)
$$;
create function public.rewards_svc_finish_grant(grant_id uuid, attempt_token uuid, outcome text, error text default null,
                                                target_expires_at_ms bigint default null) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select rewards.finish_grant(grant_id, attempt_token, outcome, error, target_expires_at_ms)
$$;
create function public.rewards_svc_retry_local() returns int
language sql volatile security definer set search_path = '' as $$ select rewards.retry_local() $$;
-- Expires stale social posts and runs the events retention purge; returns the number of posts expired.
create function public.rewards_svc_expire_social() returns int
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform rewards.purge_events();
  return rewards.expire_social();
end $$;
create function public.rewards_svc_verify_social(platform text, username text, caption text, media_id text) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select rewards.verify_social(platform, username, caption, media_id)
$$;
create function public.rewards_svc_review_social(post_id uuid, approve boolean) returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.review_social(post_id, approve) $$;
create function public.rewards_svc_delete_user(user_id uuid) returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.delete_user(user_id) $$;

-- Privileges (Postgres gives PUBLIC EXECUTE to every new function; Supabase adds the API roles in `public`).
revoke all on all tables in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards_app from public, anon, authenticated, service_role;
revoke all on function public.rewards_state(), public.rewards_track(text, text, jsonb, text),
  public.rewards_offer_claim(text), public.rewards_social_start(text, text), public.rewards_mark_seen(uuid[]),
  public.rewards_svc_track(uuid, text, text, jsonb), public.rewards_svc_claim_grants(int),
  public.rewards_svc_set_target(uuid, uuid, bigint), public.rewards_svc_finish_grant(uuid, uuid, text, text, bigint),
  public.rewards_svc_retry_local(), public.rewards_svc_expire_social(),
  public.rewards_svc_verify_social(text, text, text, text), public.rewards_svc_review_social(uuid, boolean),
  public.rewards_svc_delete_user(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.rewards_state(), public.rewards_track(text, text, jsonb, text),
  public.rewards_offer_claim(text), public.rewards_social_start(text, text), public.rewards_mark_seen(uuid[])
  to authenticated;
grant execute on function public.rewards_svc_track(uuid, text, text, jsonb), public.rewards_svc_claim_grants(int),
  public.rewards_svc_set_target(uuid, uuid, bigint), public.rewards_svc_finish_grant(uuid, uuid, text, text, bigint),
  public.rewards_svc_retry_local(), public.rewards_svc_expire_social(),
  public.rewards_svc_verify_social(text, text, text, text), public.rewards_svc_review_social(uuid, boolean),
  public.rewards_svc_delete_user(uuid)
  to service_role;
