-- rewards engine 0.4: follow-ups (ADR 0002 section 18.7). A `followup` program brings people back by phone
-- notification (planned here, shown by the app) or email (sent by the Edge Function), using what the engine already
-- knows: activity, real streak deadlines, waiting rewards. Guardrails are enforced here for every app.

alter table rewards.programs drop constraint programs_kind_check;
alter table rewards.programs add constraint programs_kind_check
  check (kind in ('streak', 'milestone', 'social_tag', 'offer', 'quiz', 'quest_set', 'comeback', 'recharge', 'window',
                  'friend_streak', 'followup'));

alter table rewards.settings
  add column email_followups_enabled boolean not null default false,
  add column email_cooldown_days int not null default 4 check (email_cooldown_days between 0 and 60),
  add column email_max_series int not null default 3 check (email_max_series between 0 and 20),
  add column quiet_from time not null default '21:00',
  add column quiet_to time not null default '08:00',
  add column default_reminder_time time not null default '19:00';

-- Hooks: who signed up when, and their email (defaults read auth.users; replace in the app's config if needed).
create function rewards_app.app_signed_up_at(user_id uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select u.created_at from auth.users u where u.id = app_signed_up_at.user_id
$$;
create function rewards_app.app_email(user_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select u.email from auth.users u where u.id = app_email.user_id
$$;
create function rewards_app.app_users_signed_up_between(from_ts timestamptz, to_ts timestamptz) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u where u.created_at >= from_ts and u.created_at < to_ts
$$;

create table rewards.followup_prefs (
  user_id uuid primary key,
  notifications_off boolean not null default false,
  emails_off boolean not null default false,
  reminder_time time,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  updated_at timestamptz not null default now()
);

create table rewards.followup_sends (
  id uuid primary key default gen_random_uuid(),
  program_key text not null references rewards.programs (key),
  user_id uuid,
  channel text not null default 'email' check (channel in ('email')),
  state text not null default 'queued' check (state in ('queued', 'sent', 'failed')),
  provider_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index followup_sends_once on rewards.followup_sends (program_key, user_id) where channel = 'email';
create index followup_sends_user on rewards.followup_sends (user_id, created_at desc);

insert into rewards.event_types (name, source, daily_limit) values ('followup_opened', 'client', 20) on conflict do nothing;

-- Config checks for followup programs, and no rules on them.
create function rewards.check_followup() returns trigger
language plpgsql set search_path = '' as $$
declare
  c jsonb := new.config;
  t jsonb := new.config -> 'trigger';
  tt text := new.config #>> '{trigger,type}';
begin
  if new.kind <> 'followup' then return new; end if;
  if coalesce(c ->> 'channel', '') not in ('notification', 'email') then
    raise exception 'rewards: followup % needs channel notification or email', new.key using errcode = '22023';
  end if;
  if tt not in ('inactive_days', 'streak_at_risk', 'reward_waiting', 'weekly_recap', 'days_since_signup')
     or (tt = 'inactive_days' and coalesce(t ->> 'days', '') !~ '^[1-9][0-9]{0,2}$')
     or (tt = 'streak_at_risk' and not exists (select 1 from rewards.programs p where p.key = t ->> 'program' and p.kind = 'streak'))
     or (tt = 'streak_at_risk' and coalesce(t ->> 'hours_before', '4') !~ '^([1-9]|1[0-9]|2[0-3])$')
     or (tt = 'weekly_recap' and coalesce(t ->> 'weekday', '') !~ '^[1-7]$')
     or (tt = 'days_since_signup' and (coalesce(t ->> 'from', '') !~ '^[0-9]{1,3}$' or coalesce(t ->> 'to', '') !~ '^[0-9]{1,3}$'
                                       or (t ->> 'from')::int > (t ->> 'to')::int)) then
    raise exception 'rewards: followup % has an invalid trigger', new.key using errcode = '22023';
  end if;
  if c ->> 'channel' = 'email' and tt not in ('inactive_days', 'days_since_signup') then
    raise exception 'rewards: email followups use inactive_days or days_since_signup' using errcode = '22023';
  end if;
  if c ->> 'channel' = 'notification' then
    if coalesce(c ->> 'title', '') = '' or coalesce(c ->> 'body', '') = '' or length(c ->> 'body') > 200 then
      raise exception 'rewards: notification followup % needs a title and a body (200 characters at most)', new.key using errcode = '22023';
    end if;
    if coalesce(c ->> 'time', 'reminder') <> 'reminder' and coalesce(c ->> 'time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'rewards: followup % time must be HH:MM or reminder', new.key using errcode = '22023';
    end if;
  else
    if coalesce(c #>> '{email,subject}', '') = '' or coalesce(c #>> '{email,body}', '') = ''
       or coalesce(c #>> '{email,url}', 'https://x') !~ '^https://' then
      raise exception 'rewards: email followup % needs email.subject, email.body and an https email.url', new.key using errcode = '22023';
    end if;
  end if;
  if coalesce(c ->> 'group', 'daily') !~ '^[a-z][a-z0-9_]{0,39}$' or coalesce(c ->> 'priority', '0') !~ '^-?[0-9]{1,4}$' then
    raise exception 'rewards: followup % group must be a lower-case name and priority a whole number', new.key using errcode = '22023';
  end if;
  return new;
end $$;
create trigger check_followup before insert or update on rewards.programs
  for each row execute function rewards.check_followup();

create function rewards.check_rule_followup() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from rewards.programs p where p.key = new.program_key and p.kind = 'followup') then
    raise exception 'rewards: followup programs take no rules' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger check_rule_followup before insert on rewards.rules
  for each row execute function rewards.check_rule_followup();

-- Helpers ----------------------------------------------------------------------------------------------------------

create function rewards.followup_prefs_of(uid uuid) returns rewards.followup_prefs
language plpgsql volatile security definer set search_path = '' as $$
declare
  r rewards.followup_prefs;
begin
  insert into rewards.followup_prefs (user_id) values (uid) on conflict do nothing;
  select * into r from rewards.followup_prefs x where x.user_id = uid;
  return r;
end $$;

-- The user's last activity (anything but opening a follow-up), or null.
create function rewards.last_active(uid uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(e.occurred_at) from rewards.events e where e.user_id = uid and e.type <> 'followup_opened'
$$;

create function rewards.fill_text(t text, uid uuid, streak int, days int) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  nm text;
begin
  if t is null then return null; end if;
  if position('{{name}}' in t) > 0 then
    begin
      nm := rewards_app.app_display_name(uid);
    exception when others then
      nm := null;
    end;
  end if;
  return btrim(regexp_replace(replace(replace(replace(t, '{{name}}', coalesce(nm, '')), '{{streak}}', coalesce(streak, 0)::text),
                                      '{{days}}', coalesce(days, 0)::text), '\s+([,.!?])', '\1', 'g'));
end $$;

-- Phone notifications: the plan (18.7) ------------------------------------------------------------------------------

create function rewards.followups_plan(uid uuid, days int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s rewards.settings := rewards.settings();
  pr rewards.followup_prefs;
  tz text := rewards.member_tz(uid);
  today date := (now() at time zone tz)::date;
  horizon int := least(greatest(coalesce(days, 14), 1), 30);
  rem time;
  p rewards.programs;
  t jsonb;
  tm time;
  d date;
  sd date;
  last timestamptz;
  sj jsonb;
  cand jsonb := '[]';
  at_ timestamptz;
  lt time;
  streak int := 0;
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  pr := rewards.followup_prefs_of(uid);
  if not s.enabled or pr.notifications_off then
    return jsonb_build_object('server_time', now(), 'plan', '[]'::jsonb);
  end if;
  rem := coalesce(pr.reminder_time, s.default_reminder_time);
  last := rewards.last_active(uid);
  sd := (coalesce(rewards_app.app_signed_up_at(uid), now()) at time zone tz)::date;
  for p in select * from rewards.programs x where x.kind = 'followup' and x.config ->> 'channel' = 'notification' loop
    if not rewards.is_live(p) then continue; end if;
    t := p.config -> 'trigger';
    tm := case when coalesce(p.config ->> 'time', 'reminder') = 'reminder' then rem else (p.config ->> 'time')::time end;
    d := null;
    at_ := null;
    case t ->> 'type'
      when 'inactive_days' then
        d := coalesce((last at time zone tz)::date, sd) + (t ->> 'days')::int;
      when 'streak_at_risk' then
        select rewards.streak_json(uid, x) into sj from rewards.programs x where x.key = t ->> 'program';
        streak := coalesce((sj ->> 'current')::int, 0);
        if streak > 0 then
          d := case when (sj ->> 'today_done')::boolean then today + 1 else today end;
          at_ := ((d + 1)::timestamp at time zone tz) - make_interval(hours => coalesce((t ->> 'hours_before')::int, 4));
        end if;
      when 'reward_waiting' then
        if exists (select 1 from rewards.grants g where g.user_id = uid and g.state = 'granted' and g.seen_at is null) then
          d := case when ((today + tm) at time zone tz) > now() then today else today + 1 end;
        end if;
      when 'weekly_recap' then
        d := today + (((t ->> 'weekday')::int - extract(isodow from today)::int + 7) % 7);
        if d = today and ((today + tm) at time zone tz) <= now() then d := d + 7; end if;
      when 'days_since_signup' then
        if not coalesce((t ->> 'no_activity_since_signup')::boolean, false)
           or not exists (select 1 from rewards.events e where e.user_id = uid and e.type <> 'followup_opened' and e.local_day > sd) then
          if coalesce((t ->> 'quiet_days')::int, 0) = 0 or last is null
             or last <= now() - make_interval(days => (t ->> 'quiet_days')::int) then
            d := greatest(sd + (t ->> 'from')::int, today);
            if d > sd + (t ->> 'to')::int then d := null; end if;
          end if;
        end if;
      else null;
    end case;
    if d is null or d < today or d > today + horizon then continue; end if;
    if at_ is null then at_ := (d + tm) at time zone tz; end if;
    -- quiet hours: moved to one minute before they start, the same local day
    lt := (at_ at time zone tz)::time;
    if (s.quiet_from > s.quiet_to and (lt >= s.quiet_from or lt < s.quiet_to))
       or (s.quiet_from < s.quiet_to and lt >= s.quiet_from and lt < s.quiet_to) then
      at_ := (((at_ at time zone tz)::date) + s.quiet_from - interval '1 minute') at time zone tz;
    end if;
    if at_ <= now() then continue; end if;
    cand := cand || jsonb_build_array(jsonb_build_object(
      'program', p.key, 'day', (at_ at time zone tz)::date, 'at', at_, 'group', coalesce(p.config ->> 'group', 'daily'),
      'priority', coalesce((p.config ->> 'priority')::int, 0),
      'title', rewards.fill_text(p.config ->> 'title', uid, streak, (now()::date - coalesce((last at time zone tz)::date, sd))),
      'body', rewards.fill_text(p.config ->> 'body', uid, streak, (now()::date - coalesce((last at time zone tz)::date, sd))),
      'payload', coalesce(p.config ->> 'payload', '/')));
  end loop;
  return jsonb_build_object('server_time', now(), 'plan', coalesce((
    select jsonb_agg(jsonb_build_object('id', hashtext(c ->> 'program' || ':' || (c ->> 'day')) & 2147483647,
             'program', c ->> 'program', 'at', c -> 'at', 'title', c ->> 'title', 'body', c ->> 'body',
             'payload', c ->> 'payload', 'group', c ->> 'group') order by (c ->> 'at')::timestamptz)
      from (select c, row_number() over (partition by c ->> 'day', c ->> 'group'
                                         order by (c ->> 'priority')::int desc, (c ->> 'at')::timestamptz) n
              from jsonb_array_elements(cand) c) x
     where x.n = 1), '[]'));
end $$;

create function rewards.followup_prefs_set(uid uuid, patch jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  bad text;
  r rewards.followup_prefs;
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  select k into bad from jsonb_object_keys(coalesce(patch, '{}')) k
   where k not in ('notifications_off', 'emails_off', 'reminder_time') limit 1;
  if bad is not null then raise exception 'rewards: unknown_pref %', bad using errcode = '22023'; end if;
  if patch ? 'reminder_time' and jsonb_typeof(patch -> 'reminder_time') <> 'null'
     and (patch ->> 'reminder_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    raise exception 'rewards: bad_time' using errcode = '22023';
  end if;
  perform rewards.followup_prefs_of(uid);
  update rewards.followup_prefs x set
    notifications_off = coalesce((patch ->> 'notifications_off')::boolean, x.notifications_off),
    emails_off = coalesce((patch ->> 'emails_off')::boolean, x.emails_off),
    reminder_time = case when patch ? 'reminder_time' then (patch ->> 'reminder_time')::time else x.reminder_time end,
    updated_at = now()
  where x.user_id = uid returning * into r;
  return jsonb_build_object('notifications_off', r.notifications_off, 'emails_off', r.emails_off,
                            'reminder_time', to_char(r.reminder_time, 'HH24:MI'));
end $$;

-- Emails (18.7) ------------------------------------------------------------------------------------------------------

-- Who an email followup program would reach now, every guardrail applied (except the per-run maximum).
create function rewards.followup_candidates(p rewards.programs) returns table (user_id uuid, email text)
language plpgsql stable security definer set search_path = '' as $$
declare
  s rewards.settings := rewards.settings();
  t jsonb := p.config -> 'trigger';
begin
  return query
  with pool as (
    select u from rewards_app.app_users_signed_up_between(
             now() - make_interval(days => coalesce((t ->> 'to')::int, 0) + 1), now() - make_interval(days => coalesce((t ->> 'from')::int, 0))) u
     where t ->> 'type' = 'days_since_signup'
    union
    select e.user_id from rewards.events e
     where t ->> 'type' = 'inactive_days' and e.type <> 'followup_opened'
     group by e.user_id
    having max(e.occurred_at) <= now() - make_interval(days => (t ->> 'days')::int)
       and max(e.occurred_at) > now() - make_interval(days => (t ->> 'days')::int + 2)),
  ok as (
    select pl.u from pool pl
     where not exists (select 1 from rewards.admins a where a.user_id = pl.u)
       and not exists (select 1 from rewards.followup_prefs f where f.user_id = pl.u and f.emails_off)
       and not exists (select 1 from rewards.followup_sends x where x.user_id = pl.u and x.program_key = p.key
                        and x.channel = 'email' and x.state <> 'failed')
       and (select count(*) from rewards.followup_sends x where x.user_id = pl.u and x.channel = 'email'
             and x.state <> 'failed') < s.email_max_series
       and not exists (select 1 from rewards.followup_sends x where x.user_id = pl.u and x.channel = 'email'
                        and x.state <> 'failed' and x.created_at > now() - make_interval(days => s.email_cooldown_days))
       and (t ->> 'type' <> 'days_since_signup'
            or ((not coalesce((t ->> 'no_activity_since_signup')::boolean, false)
                 or not exists (select 1 from rewards.events e where e.user_id = pl.u and e.type <> 'followup_opened'
                                  and e.occurred_at > rewards_app.app_signed_up_at(pl.u) + interval '1 day'))
                and (coalesce((t ->> 'quiet_days')::int, 0) = 0
                     or coalesce(rewards.last_active(pl.u), '-infinity') <= now() - make_interval(days => (t ->> 'quiet_days')::int)))))
  select ok.u, rewards_app.app_email(ok.u) from ok where rewards_app.app_email(ok.u) is not null;
end $$;

create function rewards.followup_claim(dry_run boolean, max_rows int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s rewards.settings := rewards.settings();
  p rewards.programs;
  c record;
  sid uuid;
  pr rewards.followup_prefs;
  out jsonb := '[]';
  left_ int := least(greatest(coalesce(max_rows, 200), 1), 1000);
begin
  if not s.enabled or not s.email_followups_enabled then return out; end if;
  for p in select * from rewards.programs x where x.kind = 'followup' and x.config ->> 'channel' = 'email'
            order by coalesce((x.config ->> 'priority')::int, 0) desc, x.key loop
    if not rewards.is_live(p) then continue; end if;
    for c in select * from rewards.followup_candidates(p) limit left_ loop
      sid := null;
      if not dry_run then
        insert into rewards.followup_sends as f (program_key, user_id, channel) values (p.key, c.user_id, 'email')
        on conflict (program_key, user_id) where channel = 'email'
        do update set state = 'queued', error = null, created_at = now() where f.state = 'failed'
        returning f.id into sid;
        if sid is null then continue; end if;
      end if;
      pr := rewards.followup_prefs_of(c.user_id);
      out := out || jsonb_build_array(jsonb_build_object('send_id', sid, 'program', p.key, 'user_id', c.user_id,
        'email', c.email, 'name', (select rewards_app.app_display_name(c.user_id)),
        'subject', rewards.fill_text(p.config #>> '{email,subject}', c.user_id, 0, 0),
        'heading', rewards.fill_text(p.config #>> '{email,heading}', c.user_id, 0, 0),
        'body', rewards.fill_text(p.config #>> '{email,body}', c.user_id, 0, 0),
        'button', coalesce(p.config #>> '{email,button}', 'Open the app'), 'url', p.config #>> '{email,url}',
        'unsubscribe_token', pr.unsubscribe_token));
      left_ := left_ - 1;
      exit when left_ <= 0;
    end loop;
    exit when left_ <= 0;
  end loop;
  return out;
end $$;

create function rewards.followup_finish(send_id uuid, ok boolean, provider_id text, error text) returns boolean
language sql volatile security definer set search_path = '' as $$
  with x as (update rewards.followup_sends f set state = case when ok then 'sent' else 'failed' end,
               provider_id = left(followup_finish.provider_id, 200), error = left(followup_finish.error, 500),
               sent_at = case when ok then now() end
              where f.id = send_id and f.state = 'queued' returning 1)
  select exists (select 1 from x)
$$;

create function rewards.followup_unsubscribe(token uuid) returns jsonb
language sql volatile security definer set search_path = '' as $$
  with x as (update rewards.followup_prefs f set emails_off = true, updated_at = now()
              where f.unsubscribe_token = token returning 1)
  select jsonb_build_object('ok', exists (select 1 from x))
$$;

-- Admin: preview, sends, retention ------------------------------------------------------------------------------------

create function public.rewards_admin_followup_preview(program text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p rewards.programs;
begin
  perform rewards.require_admin();
  select * into p from rewards.programs x where x.key = program and x.kind = 'followup';
  if p.key is null then raise exception 'rewards: unknown_program' using errcode = '22023'; end if;
  if p.config ->> 'channel' <> 'email' then
    return jsonb_build_object('channel', 'notification',
      'note', 'Notifications are planned on each phone (rewards_followups_plan); preview a user with Users → Follow-up plan.');
  end if;
  return (select jsonb_build_object('channel', 'email', 'emails_on', (select s.email_followups_enabled from rewards.settings s where s.id),
    'count', count(*), 'sample', coalesce(jsonb_agg(jsonb_build_object('user_id', c.user_id,
      'email', regexp_replace(c.email, '^(.).*(@.*)$', '\1***\2'))) filter (where c.rn <= 20), '[]'))
    from (select f.*, row_number() over () rn from rewards.followup_candidates(p) f) c);
end $$;

create function public.rewards_admin_followup_plan(user_id uuid, days int default 14) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform rewards.require_admin();
  return rewards.followups_plan(rewards_admin_followup_plan.user_id, days);
end $$;

create function public.rewards_admin_followup_sends(max_rows int default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform rewards.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc)
    from (select * from rewards.followup_sends f order by f.created_at desc limit least(greatest(max_rows, 1), 500)) f), '[]');
end $$;

-- Retention by sign-up week (counts only).
create function public.rewards_admin_retention(weeks int default 8) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  since timestamptz := date_trunc('week', now()) - make_interval(weeks => least(greatest(weeks, 1), 52) - 1);
begin
  perform rewards.require_admin();
  return coalesce((
    with users as (
      select u, rewards_app.app_signed_up_at(u) at_ from rewards_app.app_users_signed_up_between(since, now()) u),
    per as (
      select date_trunc('week', us.at_)::date wk, us.u,
        exists (select 1 from rewards.events e where e.user_id = us.u and e.type <> 'followup_opened'
                 and e.occurred_at < us.at_ + interval '24 hours') activated,
        exists (select 1 from rewards.events e where e.user_id = us.u and e.type <> 'followup_opened'
                 and e.occurred_at >= us.at_ + interval '24 hours' and e.occurred_at < us.at_ + interval '48 hours') d1,
        (select count(distinct e.local_day) from rewards.events e where e.user_id = us.u and e.type <> 'followup_opened'
          and e.occurred_at < us.at_ + interval '7 days') >= 3 a37,
        (select count(*) from rewards.events e where e.user_id = us.u and e.type = 'followup_opened') opens,
        (select count(*) from rewards.events o where o.user_id = us.u and o.type = 'followup_opened'
          and exists (select 1 from rewards.events e where e.user_id = us.u and e.type <> 'followup_opened'
                       and e.occurred_at > o.occurred_at and e.occurred_at < o.occurred_at + interval '24 hours')) opens_active,
        (select count(*) from rewards.followup_sends f where f.user_id = us.u and f.state = 'sent') sent,
        exists (select 1 from rewards.followup_prefs f where f.user_id = us.u and f.emails_off) unsub
      from users us)
    select jsonb_agg(jsonb_build_object('week', wk, 'signups', n, 'activated_24h', a, 'returned_d1', d,
             'active_3_of_7', t, 'notification_opens', o, 'opens_then_active_24h', oa, 'emails_sent', es, 'unsubscribed', un)
             order by wk)
      from (select wk, count(*) n, count(*) filter (where activated) a, count(*) filter (where d1) d,
                   count(*) filter (where a37) t, sum(opens) o, sum(opens_active) oa, sum(sent) es,
                   count(*) filter (where unsub) un
              from per group by wk) g), '[]');
end $$;

-- Public and service wrappers ----------------------------------------------------------------------------------------
create function public.rewards_followups_plan(days int default 14) returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.followups_plan(auth.uid(), days) $$;
create function public.rewards_followup_prefs(patch jsonb default '{}') returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.followup_prefs_set(auth.uid(), patch) $$;
create function public.rewards_svc_followup_claim(dry_run boolean default true, max_rows int default 200) returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.followup_claim(dry_run, max_rows) $$;
create function public.rewards_svc_followup_finish(send_id uuid, ok boolean, provider_id text default null,
                                                   error text default null) returns boolean
language sql volatile security definer set search_path = '' as $$
  select rewards.followup_finish(send_id, ok, provider_id, error)
$$;
create function public.rewards_svc_followup_unsubscribe(token uuid) returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.followup_unsubscribe(token) $$;

-- The new settings keys in the admin API and imports; follow-up data deleted with the account: patch the deployed
-- definitions (checked), never retype them.
do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.rewards_admin_save_settings(jsonb)'::regprocedure);
  n := replace(d, '''surprise_daily_cap'') limit 1',
    '''surprise_daily_cap'', ''email_followups_enabled'', ''email_cooldown_days'', ''email_max_series'', ''quiet_from'', ''quiet_to'', ''default_reminder_time'') limit 1');
  n := replace(n, 'surprise_daily_cap = coalesce((patch ->> ''surprise_daily_cap'')::int, s.surprise_daily_cap)',
    'surprise_daily_cap = coalesce((patch ->> ''surprise_daily_cap'')::int, s.surprise_daily_cap),
    email_followups_enabled = coalesce((patch ->> ''email_followups_enabled'')::boolean, s.email_followups_enabled),
    email_cooldown_days = coalesce((patch ->> ''email_cooldown_days'')::int, s.email_cooldown_days),
    email_max_series = coalesce((patch ->> ''email_max_series'')::int, s.email_max_series),
    quiet_from = coalesce((patch ->> ''quiet_from'')::time, s.quiet_from),
    quiet_to = coalesce((patch ->> ''quiet_to'')::time, s.quiet_to),
    default_reminder_time = coalesce((patch ->> ''default_reminder_time'')::time, s.default_reminder_time)');
  if position('default_reminder_time = coalesce' in n) = 0 or position('''default_reminder_time'') limit 1' in n) = 0 then
    raise exception 'rewards: could not patch rewards_admin_save_settings';
  end if;
  execute n;
  d := pg_get_functiondef('rewards.import_config(jsonb,boolean)'::regprocedure);
  n := replace(d, '''surprise_daily_cap''];',
    '''surprise_daily_cap'', ''email_followups_enabled'', ''email_cooldown_days'', ''email_max_series'', ''quiet_from'', ''quiet_to'', ''default_reminder_time''];');
  if n = d then raise exception 'rewards: could not patch import_config'; end if;
  execute n;
  d := pg_get_functiondef('rewards.delete_user(uuid)'::regprocedure);
  n := replace(d, '  delete from rewards.members x where x.user_id = uid;',
    '  delete from rewards.members x where x.user_id = uid;
  delete from rewards.followup_prefs x where x.user_id = uid;
  delete from rewards.followup_sends x where x.user_id = uid;');
  if n = d then raise exception 'rewards: could not patch delete_user'; end if;
  execute n;
end $$;

revoke all on all tables in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards_app from public, anon, authenticated, service_role;
revoke all on function public.rewards_followups_plan(int), public.rewards_followup_prefs(jsonb),
  public.rewards_svc_followup_claim(boolean, int), public.rewards_svc_followup_finish(uuid, boolean, text, text),
  public.rewards_svc_followup_unsubscribe(uuid) from public, anon, authenticated, service_role;
grant execute on function public.rewards_followups_plan(int), public.rewards_followup_prefs(jsonb) to authenticated;
grant execute on function public.rewards_svc_followup_claim(boolean, int), public.rewards_svc_followup_finish(uuid, boolean, text, text),
  public.rewards_svc_followup_unsubscribe(uuid) to service_role;
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
