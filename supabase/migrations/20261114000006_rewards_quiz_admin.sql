-- rewards engine migration 5: events straight from the app's own tables (quizzes, lessons, chapters), and the admin
-- API a small dashboard is built on: setup, checks, support and analytics (ADR 0002 sections 16, 17).

-- 1. Events from the app's tables ------------------------------------------------------------------------------------
-- Attach to any table the app already writes, e.g. its quiz results:
--   create trigger rewards_quiz_passed after insert or update of score on public.quiz_attempts
--     for each row when (new.completed_at is not null and new.score >= 0.8)
--     execute function rewards.event_from_row('quiz_passed', 'user_id', 'id', 'quiz_id,score');
-- Arguments: event type, user id column (default user_id), dedupe column (default id; use quiz_id for "each quiz
-- once"), and optional comma-separated columns copied into props. The dedupe key makes an update trigger safe: the
-- same row never counts twice. It never blocks the app's write: any error becomes a warning.
create function rewards.event_from_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(new);
  uid uuid;
  dedupe text;
  props jsonb := '{}';
  col text;
begin
  begin
    uid := (r ->> coalesce(nullif(tg_argv[1], ''), 'user_id'))::uuid;
    dedupe := r ->> coalesce(nullif(tg_argv[2], ''), 'id');
    if tg_nargs > 3 and tg_argv[3] <> '' then
      foreach col in array string_to_array(tg_argv[3], ',') loop
        props := props || jsonb_build_object(btrim(col), r -> btrim(col));
      end loop;
    end if;
    if uid is not null and dedupe is not null then
      perform rewards.track(uid, tg_argv[0], tg_table_name || ':' || dedupe, props, null, true);
    end if;
  exception when others then
    raise warning 'rewards: event_from_row % on %: %', tg_argv[0], tg_table_name, sqlerrm;
  end;
  return new;
end $$;

-- 2. Admins and the audit log ----------------------------------------------------------------------------------------
create table rewards.admins (
  user_id uuid primary key,
  added_at timestamptz not null default now(),
  added_by uuid
);

create table rewards.admin_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null,
  detail jsonb not null default '{}'
);
create index admin_log_at on rewards.admin_log (at desc);

-- The service role (the app's server, SQL editor) or a signed-in user listed in rewards.admins.
create function rewards.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return null; end if;
  if auth.uid() is null or not exists (select 1 from rewards.admins a where a.user_id = auth.uid()) then
    raise exception 'rewards: not_admin' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create function rewards.log(action text, detail jsonb) returns void
language sql volatile security definer set search_path = '' as $$
  insert into rewards.admin_log (actor, action, detail) values (auth.uid(), action, coalesce(detail, '{}'))
$$;

-- 3. State without side effects, for an admin looking at a user (never starts their offer windows) -------------------
drop function public.rewards_state();
drop function rewards.state(uuid);
create function rewards.state(uid uuid, start_offers boolean default true) returns jsonb
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
      if start_offers and coalesce(p.config ->> 'start_on', 'first_seen') = 'first_seen' then
        perform rewards.start_offer(uid, p);
      end if;
      o := rewards.offer_json(uid, p);
      if o ->> 'state' <> 'not_started' or rewards.is_live(p) then
        offers := offers || jsonb_build_array(o);
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
create function public.rewards_state() returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.state(auth.uid(), true) $$;

-- 4. Admin API: setup -------------------------------------------------------------------------------------------------

create function public.rewards_admin_config() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform rewards.require_admin();
  return jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from rewards.settings s where s.id),
    'event_types', coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from rewards.event_types t), '[]'),
    'programs', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('live', rewards.is_live(p), 'rules',
        coalesce((select jsonb_agg(to_jsonb(r) - 'program_key' order by r.active desc, r.threshold nulls first, r.created_at)
                    from rewards.rules r where r.program_key = p.key), '[]')) order by p.sort, p.key)
      from rewards.programs p), '[]'));
end $$;

-- Only the listed keys; anything else is refused so a typo never silently does nothing.
create function public.rewards_admin_save_settings(patch jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  bad text;
begin
  perform rewards.require_admin();
  select k into bad from jsonb_object_keys(coalesce(patch, '{}')) k
   where k not in ('enabled', 'daily_grant_cap', 'default_timezone', 'max_attempts', 'lease_minutes',
                   'social_window_days', 'events_retention_days') limit 1;
  if bad is not null then raise exception 'rewards: unknown_setting %', bad using errcode = '22023'; end if;
  update rewards.settings s set
    enabled = coalesce((patch ->> 'enabled')::boolean, s.enabled),
    daily_grant_cap = coalesce((patch ->> 'daily_grant_cap')::int, s.daily_grant_cap),
    default_timezone = coalesce(patch ->> 'default_timezone', s.default_timezone),
    max_attempts = coalesce((patch ->> 'max_attempts')::int, s.max_attempts),
    lease_minutes = coalesce((patch ->> 'lease_minutes')::int, s.lease_minutes),
    social_window_days = coalesce((patch ->> 'social_window_days')::int, s.social_window_days),
    events_retention_days = coalesce((patch ->> 'events_retention_days')::int, s.events_retention_days)
  where s.id;
  perform rewards.log('save_settings', patch);
  return (select to_jsonb(s) - 'id' from rewards.settings s where s.id);
end $$;

create function public.rewards_admin_save_event_type(name text, source text, daily_limit int default 50) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t rewards.event_types;
begin
  perform rewards.require_admin();
  insert into rewards.event_types as x (name, source, daily_limit)
  values (rewards_admin_save_event_type.name, rewards_admin_save_event_type.source, rewards_admin_save_event_type.daily_limit)
  on conflict on constraint event_types_pkey do update set source = excluded.source, daily_limit = excluded.daily_limit
  returning x.* into t;
  perform rewards.log('save_event_type', to_jsonb(t));
  return to_jsonb(t);
end $$;

-- Create or update a program. The kind of an existing program never changes (the table refuses it).
create function public.rewards_admin_save_program(key text, kind text, enabled boolean default true,
  config jsonb default '{}', public jsonb default '{}', starts_at timestamptz default null,
  ends_at timestamptz default null, sort int default 0) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p rewards.programs;
begin
  perform rewards.require_admin();
  insert into rewards.programs as x (key, kind, enabled, config, public, starts_at, ends_at, sort)
  values (rewards_admin_save_program.key, rewards_admin_save_program.kind, rewards_admin_save_program.enabled,
          coalesce(rewards_admin_save_program.config, '{}'), coalesce(rewards_admin_save_program.public, '{}'),
          rewards_admin_save_program.starts_at, rewards_admin_save_program.ends_at, rewards_admin_save_program.sort)
  on conflict on constraint programs_pkey do update set kind = excluded.kind, enabled = excluded.enabled,
    config = excluded.config, public = excluded.public, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    sort = excluded.sort
  returning x.* into p;
  perform rewards.log('save_program', to_jsonb(p));
  return to_jsonb(p);
end $$;

-- Rules are append-only: this adds the next version. To change a reward, add the new rule and deactivate the old.
create function public.rewards_admin_add_rule(program text, kind text, amount numeric, threshold int default null,
  repeat text default 'once', params jsonb default '{}') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r rewards.rules;
begin
  perform rewards.require_admin();
  if not exists (select 1 from rewards.programs p where p.key = program) then
    raise exception 'rewards: unknown_program' using errcode = '22023';
  end if;
  insert into rewards.rules (program_key, version, threshold, repeat, kind, amount, params)
  values (program, coalesce((select max(x.version) from rewards.rules x where x.program_key = program), 0) + 1,
          threshold, coalesce(repeat, 'once'), kind, amount, coalesce(params, '{}'))
  returning * into r;
  perform rewards.log('add_rule', to_jsonb(r));
  return to_jsonb(r);
end $$;

create function public.rewards_admin_set_rule_active(rule_id uuid, active boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r rewards.rules;
begin
  perform rewards.require_admin();
  update rewards.rules x set active = rewards_admin_set_rule_active.active where x.id = rule_id returning x.* into r;
  if r.id is null then raise exception 'rewards: unknown_rule' using errcode = '22023'; end if;
  perform rewards.log('set_rule_active', jsonb_build_object('rule_id', rule_id, 'active', active));
  return to_jsonb(r);
end $$;

create function public.rewards_admin_set_admin(user_id uuid, admin boolean) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := rewards.require_admin();
begin
  if admin then
    insert into rewards.admins (user_id, added_by) values (rewards_admin_set_admin.user_id, me) on conflict do nothing;
  else
    if me = rewards_admin_set_admin.user_id then
      raise exception 'rewards: cannot_remove_self' using errcode = '22023';
    end if;
    delete from rewards.admins a where a.user_id = rewards_admin_set_admin.user_id;
  end if;
  perform rewards.log('set_admin', jsonb_build_object('user_id', user_id, 'admin', admin));
  return admin;
end $$;

-- 5. Admin API: checks and support ------------------------------------------------------------------------------------

-- Everything about one user: what they see (without starting offers), every grant, event counts, social posts.
create function public.rewards_admin_user(user_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := rewards_admin_user.user_id;
begin
  perform rewards.require_admin();
  return jsonb_build_object(
    'state', rewards.state(uid, false),
    'timezone', (select m.timezone from rewards.members m where m.user_id = uid),
    'grants', coalesce((select jsonb_agg(to_jsonb(g) - 'attempt_token' - 'user_id' order by g.created_at desc)
                          from (select * from rewards.grants g where g.user_id = uid order by g.created_at desc limit 200) g), '[]'),
    'events', coalesce((select jsonb_agg(jsonb_build_object('type', e.type, 'count', e.n, 'last_at', e.last_at) order by e.type)
                          from (select x.type, count(*) n, max(x.occurred_at) last_at from rewards.events x
                                 where x.user_id = uid group by x.type) e), '[]'),
    'social_posts', coalesce((select jsonb_agg(to_jsonb(s) - 'user_id' order by s.created_at desc)
                                from rewards.social_posts s where s.user_id = uid), '[]'));
end $$;

-- Fire an event for a user by hand (e.g. a test account while setting up), server types included.
create function public.rewards_admin_track(user_id uuid, type text, dedupe_key text default null,
  props jsonb default '{}') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform rewards.require_admin();
  perform rewards.log('track', jsonb_build_object('user_id', user_id, 'type', type, 'dedupe_key', dedupe_key));
  return rewards.track(user_id, type, coalesce(dedupe_key, 'admin:' || gen_random_uuid()), props, null, true);
end $$;

create function public.rewards_admin_grants(state text default null, program text default null, max_rows int default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform rewards.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(g) - 'attempt_token' order by g.created_at desc)
    from (select * from rewards.grants g
           where (rewards_admin_grants.state is null or g.state = rewards_admin_grants.state)
             and (program is null or g.program_key = program)
           order by g.created_at desc limit least(greatest(max_rows, 1), 500)) g), '[]');
end $$;

-- Give a failed grant a fresh set of attempts; a local kind is granted at once, entitlement_days on the next worker run.
create function public.rewards_admin_retry_grant(grant_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  g rewards.grants;
begin
  perform rewards.require_admin();
  update rewards.grants x set state = 'failed_retryable', attempts = 0, attempt_token = null, granting_started_at = null,
         updated_at = now()
   where x.id = grant_id and x.state in ('failed', 'failed_retryable') and x.user_id is not null
  returning x.* into g;
  if g.id is null then raise exception 'rewards: not_retryable' using errcode = '22023'; end if;
  if g.kind <> 'entitlement_days' then perform rewards.grant_local(g.id); end if;
  perform rewards.log('retry_grant', jsonb_build_object('grant_id', grant_id));
  return (select to_jsonb(x) - 'attempt_token' from rewards.grants x where x.id = grant_id);
end $$;

create function public.rewards_admin_social_queue(state text default 'pending', max_rows int default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform rewards.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at)
    from (select * from rewards.social_posts s where s.state = coalesce(rewards_admin_social_queue.state, 'pending')
           order by s.created_at limit least(greatest(max_rows, 1), 500)) s), '[]');
end $$;

create function public.rewards_admin_review_social(post_id uuid, approve boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform rewards.require_admin();
  perform rewards.log('review_social', jsonb_build_object('post_id', post_id, 'approve', approve));
  return rewards.review_social(post_id, approve);
end $$;

create function public.rewards_admin_log(max_rows int default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform rewards.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(l) order by l.at desc)
    from (select * from rewards.admin_log l order by l.at desc limit least(greatest(max_rows, 1), 500)) l), '[]');
end $$;

-- 6. Admin API: analytics (UTC days) ----------------------------------------------------------------------------------
-- Counts only, never a user id. Streak buckets count users whose streak is still alive.
create function public.rewards_admin_analytics(days int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  since timestamptz := ((now() at time zone 'UTC')::date - (least(greatest(days, 1), 365) - 1))::timestamp at time zone 'UTC';
begin
  perform rewards.require_admin();
  return jsonb_build_object(
    'since', since,
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'events', d.events, 'active_users', d.users,
                                          'grants', coalesce(g.n, 0)) order by d.day)
      from (select (e.occurred_at at time zone 'UTC')::date as day, count(*) events, count(distinct e.user_id) users
              from rewards.events e where e.occurred_at >= since group by 1) d
      left join (select (x.created_at at time zone 'UTC')::date as day, count(*) n
                   from rewards.grants x where x.created_at >= since and x.state = 'granted' group by 1) g using (day)), '[]'),
    'events_by_type', coalesce((
      select jsonb_agg(jsonb_build_object('type', t.type, 'events', t.n, 'users', t.u) order by t.n desc)
      from (select e.type, count(*) n, count(distinct e.user_id) u from rewards.events e
             where e.occurred_at >= since group by e.type) t), '[]'),
    'grants_by_program', coalesce((
      select jsonb_agg(jsonb_build_object('program', t.program_key, 'kind', t.kind, 'state', t.state, 'count', t.n,
                                          'amount', t.amount) order by t.program_key, t.kind, t.state)
      from (select g.program_key, g.kind, g.state, count(*) n, sum(g.amount) amount from rewards.grants g
             where g.created_at >= since group by 1, 2, 3) t), '[]'),
    'streaks', coalesce((
      select jsonb_agg(jsonb_build_object('program', t.program_key, 'bucket', t.bucket, 'users', t.n) order by t.program_key, t.lo)
      from (select s.program_key, b.bucket, b.lo, count(*) n
              from rewards.streaks s
              join rewards.programs p on p.key = s.program_key
              join lateral (select case when s.current >= 30 then '30+' when s.current >= 14 then '14-29'
                                        when s.current >= 7 then '7-13' when s.current >= 4 then '4-6'
                                        when s.current >= 2 then '2-3' else '1' end bucket,
                                   case when s.current >= 30 then 30 when s.current >= 14 then 14 when s.current >= 7 then 7
                                        when s.current >= 4 then 4 when s.current >= 2 then 2 else 1 end lo) b on true
             where s.current > 0
               and s.last_day >= rewards.local_today(s.user_id) - 1
                                  - case when coalesce((p.config ->> 'auto_freeze')::boolean, true) then s.freezes else 0 end
             group by 1, 2, 3) t), '[]'),
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object('program', c.program_key, 'users', c.n, 'avg_count', c.avg) order by c.program_key)
      from (select x.program_key, count(*) n, round(avg(x.count), 2) avg from rewards.counters x group by 1) c), '[]'),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object('program', o.program_key, 'started', o.started, 'claimed', o.claimed,
                                          'expired_unclaimed', o.expired,
                                          'claim_rate', case when o.started > 0 then round(o.claimed::numeric / o.started, 3) end)
                       order by o.program_key)
      from (select w.program_key, count(*) started, count(w.claimed_at) claimed,
                   count(*) filter (where w.claimed_at is null and w.ends_at <= now()) expired
              from rewards.offer_windows w where w.started_at >= since group by 1) o), '[]'),
    'social', coalesce((
      select jsonb_agg(jsonb_build_object('program', s.program_key, 'state', s.state, 'verified_by', s.verified_by,
                                          'count', s.n) order by s.program_key, s.state)
      from (select x.program_key, x.state, x.verified_by, count(*) n from rewards.social_posts x
             where x.created_at >= since group by 1, 2, 3) s), '[]'),
    'open_problems', jsonb_build_object(
      'failed', (select count(*) from rewards.grants g where g.state = 'failed'),
      'retrying', (select count(*) from rewards.grants g where g.state = 'failed_retryable'),
      'skipped_cap_today', (select count(*) from rewards.grants g where g.state = 'skipped_cap'
                              and g.created_at >= ((now() at time zone 'UTC')::date)::timestamp at time zone 'UTC'),
      'social_pending', (select count(*) from rewards.social_posts s where s.state = 'pending')));
end $$;

-- 7. Privileges -------------------------------------------------------------------------------------------------------
revoke all on all tables in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards from public, anon, authenticated, service_role;
revoke all on function public.rewards_state() from public, anon, authenticated, service_role;
grant execute on function public.rewards_state() to authenticated;
do $$
declare
  f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'rewards\_admin\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
