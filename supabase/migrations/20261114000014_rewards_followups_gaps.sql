-- rewards engine 0.5: the six follow-up gaps against an earlier app's own engagement code (ADR 0002 section 18.8): a plain daily
-- reminder, per-follow-up activity events, min_actions, an exclusion hook, branded email templates, per-group mutes.

-- Who never gets follow-ups (staff, testers…). Replace in the app's config, e.g.
--   select exists (select 1 from public.profiles p where p.id = user_id and p.role in ('admin', 'tester'))
create function rewards_app.app_excluded_from_followups(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select false $$;

alter table rewards.followup_prefs add column muted_groups text[] not null default '{}';

create table rewards.email_templates (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  html text not null check (length(html) <= 200000 and position('{{unsubscribe_url}}' in html) > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Helpers ----------------------------------------------------------------------------------------------------------

-- The event types that count as activity for a follow-up, or null = every event but followup_opened.
create function rewards.followup_events(p rewards.programs) returns text[]
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p.config -> 'activity_events') = 'array'
              then array(select jsonb_array_elements_text(p.config -> 'activity_events')) end
$$;

create function rewards.last_active_in(uid uuid, evs text[]) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(e.occurred_at) from rewards.events e
   where e.user_id = uid and e.type <> 'followup_opened' and (evs is null or e.type = any(evs))
$$;

create function rewards.activity_count(uid uuid, evs text[]) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from rewards.events e
   where e.user_id = uid and e.type <> 'followup_opened' and (evs is null or e.type = any(evs))
$$;

-- The app's exclusion hook; an error in it excludes (never message someone by mistake).
create function rewards.followup_excluded(uid uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return coalesce(rewards_app.app_excluded_from_followups(uid), false);
exception when others then
  raise warning 'rewards: app_excluded_from_followups failed: %', sqlerrm;
  return true;
end $$;

-- Config checks (replaces 0.4): the daily trigger, activity_events, min_actions, email.template.
create or replace function rewards.check_followup() returns trigger
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
  if tt not in ('inactive_days', 'streak_at_risk', 'reward_waiting', 'weekly_recap', 'days_since_signup', 'daily')
     or (tt = 'inactive_days' and coalesce(t ->> 'days', '') !~ '^[1-9][0-9]{0,2}$')
     or (tt = 'streak_at_risk' and not exists (select 1 from rewards.programs p where p.key = t ->> 'program' and p.kind = 'streak'))
     or (tt = 'streak_at_risk' and coalesce(t ->> 'hours_before', '4') !~ '^([1-9]|1[0-9]|2[0-3])$')
     or (tt = 'weekly_recap' and coalesce(t ->> 'weekday', '') !~ '^[1-7]$')
     or (tt = 'days_since_signup' and (coalesce(t ->> 'from', '') !~ '^[0-9]{1,3}$' or coalesce(t ->> 'to', '') !~ '^[0-9]{1,3}$'
                                       or (t ->> 'from')::int > (t ->> 'to')::int))
     or coalesce(t ->> 'min_actions', '0') !~ '^[0-9]{1,5}$' then
    raise exception 'rewards: followup % has an invalid trigger', new.key using errcode = '22023';
  end if;
  if c ? 'activity_events' and (jsonb_typeof(c -> 'activity_events') <> 'array' or jsonb_array_length(c -> 'activity_events') = 0
     or exists (select 1 from jsonb_array_elements_text(c -> 'activity_events') e
                 where not exists (select 1 from rewards.event_types x where x.name = e))) then
    raise exception 'rewards: followup % activity_events must list registered event types', new.key using errcode = '22023';
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
       or coalesce(c #>> '{email,url}', 'https://x') !~ '^https://'
       or coalesce(c #>> '{email,template}', 'x') !~ '^[a-z][a-z0-9_]{0,39}$' then
      raise exception 'rewards: email followup % needs email.subject, email.body, an https email.url and a valid template name', new.key
        using errcode = '22023';
    end if;
  end if;
  if coalesce(c ->> 'group', 'daily') !~ '^[a-z][a-z0-9_]{0,39}$' or coalesce(c ->> 'priority', '0') !~ '^-?[0-9]{1,4}$' then
    raise exception 'rewards: followup % group must be a lower-case name and priority a whole number', new.key using errcode = '22023';
  end if;
  return new;
end $$;

-- The plan (replaces 0.4): exclusion, muted groups, activity events, min_actions, the daily trigger.
create or replace function rewards.followups_plan(uid uuid, days int) returns jsonb
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
  dd date;
  ds date[];
  sd date;
  last timestamptz;
  evs text[];
  grp text;
  sj jsonb;
  cand jsonb := '[]';
  fixed_at timestamptz;
  at_ timestamptz;
  lt time;
  streak int;
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  pr := rewards.followup_prefs_of(uid);
  if not s.enabled or pr.notifications_off or rewards.followup_excluded(uid) then
    return jsonb_build_object('server_time', now(), 'plan', '[]'::jsonb);
  end if;
  rem := coalesce(pr.reminder_time, s.default_reminder_time);
  sd := (coalesce(rewards_app.app_signed_up_at(uid), now()) at time zone tz)::date;
  for p in select * from rewards.programs x where x.kind = 'followup' and x.config ->> 'channel' = 'notification' loop
    if not rewards.is_live(p) then continue; end if;
    grp := coalesce(p.config ->> 'group', 'daily');
    if grp = any(pr.muted_groups) then continue; end if;
    t := p.config -> 'trigger';
    evs := rewards.followup_events(p);
    if coalesce((t ->> 'min_actions')::int, 0) > 0 and rewards.activity_count(uid, evs) < (t ->> 'min_actions')::int then
      continue;
    end if;
    tm := case when coalesce(p.config ->> 'time', 'reminder') = 'reminder' then rem else (p.config ->> 'time')::time end;
    last := rewards.last_active_in(uid, evs);
    ds := '{}';
    fixed_at := null;
    streak := 0;
    case t ->> 'type'
      when 'inactive_days' then
        ds := array[coalesce((last at time zone tz)::date, sd) + (t ->> 'days')::int];
      when 'streak_at_risk' then
        select rewards.streak_json(uid, x) into sj from rewards.programs x where x.key = t ->> 'program';
        streak := coalesce((sj ->> 'current')::int, 0);
        if streak > 0 then
          dd := case when (sj ->> 'today_done')::boolean then today + 1 else today end;
          ds := array[dd];
          fixed_at := ((dd + 1)::timestamp at time zone tz) - make_interval(hours => coalesce((t ->> 'hours_before')::int, 4));
        end if;
      when 'reward_waiting' then
        if exists (select 1 from rewards.grants g where g.user_id = uid and g.state = 'granted' and g.seen_at is null) then
          ds := array[case when ((today + tm) at time zone tz) > now() then today else today + 1 end];
        end if;
      when 'weekly_recap' then
        dd := today + (((t ->> 'weekday')::int - extract(isodow from today)::int + 7) % 7);
        if dd = today and ((today + tm) at time zone tz) <= now() then dd := dd + 7; end if;
        ds := array[dd];
      when 'days_since_signup' then
        if (not coalesce((t ->> 'no_activity_since_signup')::boolean, false)
            or not exists (select 1 from rewards.events e where e.user_id = uid and e.type <> 'followup_opened'
                            and (evs is null or e.type = any(evs)) and e.local_day > sd))
           and (coalesce((t ->> 'quiet_days')::int, 0) = 0 or last is null
                or last <= now() - make_interval(days => (t ->> 'quiet_days')::int)) then
          dd := greatest(sd + (t ->> 'from')::int, today);
          if dd <= sd + (t ->> 'to')::int then ds := array[dd]; end if;
        end if;
      when 'daily' then
        -- every day; not today when the user was already active today
        ds := array(select (today + i) from generate_series(0, horizon) i
                     where i > 0 or not exists (select 1 from rewards.events e where e.user_id = uid
                                                  and e.type <> 'followup_opened' and (evs is null or e.type = any(evs))
                                                  and e.local_day = today));
      else null;
    end case;
    foreach dd in array ds loop
      if dd is null or dd < today or dd > today + horizon then continue; end if;
      at_ := coalesce(fixed_at, (dd + tm) at time zone tz);
      lt := (at_ at time zone tz)::time;
      if (s.quiet_from > s.quiet_to and (lt >= s.quiet_from or lt < s.quiet_to))
         or (s.quiet_from < s.quiet_to and lt >= s.quiet_from and lt < s.quiet_to) then
        at_ := (((at_ at time zone tz)::date) + s.quiet_from - interval '1 minute') at time zone tz;
      end if;
      if at_ <= now() then continue; end if;
      cand := cand || jsonb_build_array(jsonb_build_object(
        'program', p.key, 'day', (at_ at time zone tz)::date, 'at', at_, 'group', grp,
        'priority', coalesce((p.config ->> 'priority')::int, 0),
        'title', rewards.fill_text(p.config ->> 'title', uid, streak, (today - coalesce((last at time zone tz)::date, sd))),
        'body', rewards.fill_text(p.config ->> 'body', uid, streak, (today - coalesce((last at time zone tz)::date, sd))),
        'payload', coalesce(p.config ->> 'payload', '/')));
    end loop;
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

-- Email candidates (replaces 0.4): activity events, min_actions, the exclusion hook.
create or replace function rewards.followup_candidates(p rewards.programs) returns table (user_id uuid, email text)
language plpgsql stable security definer set search_path = '' as $$
declare
  s rewards.settings := rewards.settings();
  t jsonb := p.config -> 'trigger';
  evs text[] := rewards.followup_events(p);
  mn int := coalesce((p.config #>> '{trigger,min_actions}')::int, 0);
begin
  return query
  with pool as (
    select u from rewards_app.app_users_signed_up_between(
             now() - make_interval(days => coalesce((t ->> 'to')::int, 0) + 1), now() - make_interval(days => coalesce((t ->> 'from')::int, 0))) u
     where t ->> 'type' = 'days_since_signup'
    union
    select e.user_id from rewards.events e
     where t ->> 'type' = 'inactive_days' and e.type <> 'followup_opened' and (evs is null or e.type = any(evs))
     group by e.user_id
    having max(e.occurred_at) <= now() - make_interval(days => (t ->> 'days')::int)
       and max(e.occurred_at) > now() - make_interval(days => (t ->> 'days')::int + 2)),
  ok as (
    select pl.u from pool pl
     where not exists (select 1 from rewards.admins a where a.user_id = pl.u)
       and not rewards.followup_excluded(pl.u)
       and (mn = 0 or rewards.activity_count(pl.u, evs) >= mn)
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
                                  and (evs is null or e.type = any(evs))
                                  and e.occurred_at > rewards_app.app_signed_up_at(pl.u) + interval '1 day'))
                and (coalesce((t ->> 'quiet_days')::int, 0) = 0
                     or coalesce(rewards.last_active_in(pl.u, evs), '-infinity') <= now() - make_interval(days => (t ->> 'quiet_days')::int)))))
  select ok.u, rewards_app.app_email(ok.u) from ok where rewards_app.app_email(ok.u) is not null;
end $$;

-- Prefs (replaces 0.4): muted_groups, and the groups the user can switch.
create or replace function rewards.followup_prefs_set(uid uuid, patch jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  bad text;
  r rewards.followup_prefs;
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  select k into bad from jsonb_object_keys(coalesce(patch, '{}')) k
   where k not in ('notifications_off', 'emails_off', 'reminder_time', 'muted_groups') limit 1;
  if bad is not null then raise exception 'rewards: unknown_pref %', bad using errcode = '22023'; end if;
  if patch ? 'reminder_time' and jsonb_typeof(patch -> 'reminder_time') <> 'null'
     and (patch ->> 'reminder_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    raise exception 'rewards: bad_time' using errcode = '22023';
  end if;
  if patch ? 'muted_groups' and (jsonb_typeof(patch -> 'muted_groups') <> 'array' or jsonb_array_length(patch -> 'muted_groups') > 50
     or exists (select 1 from jsonb_array_elements(patch -> 'muted_groups') g
                 where jsonb_typeof(g) <> 'string' or (g #>> '{}') !~ '^[a-z][a-z0-9_]{0,39}$')) then
    raise exception 'rewards: bad_groups' using errcode = '22023';
  end if;
  perform rewards.followup_prefs_of(uid);
  update rewards.followup_prefs x set
    notifications_off = coalesce((patch ->> 'notifications_off')::boolean, x.notifications_off),
    emails_off = coalesce((patch ->> 'emails_off')::boolean, x.emails_off),
    reminder_time = case when patch ? 'reminder_time' then (patch ->> 'reminder_time')::time else x.reminder_time end,
    muted_groups = case when patch ? 'muted_groups'
                        then array(select distinct jsonb_array_elements_text(patch -> 'muted_groups') order by 1)
                        else x.muted_groups end,
    updated_at = now()
  where x.user_id = uid returning * into r;
  return jsonb_build_object('notifications_off', r.notifications_off, 'emails_off', r.emails_off,
    'reminder_time', to_char(r.reminder_time, 'HH24:MI'), 'muted_groups', to_jsonb(r.muted_groups),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('group', g.grp, 'label', g.label, 'muted', g.grp = any(r.muted_groups)) order by g.ord)
        from (select distinct on (coalesce(p.config ->> 'group', 'daily')) coalesce(p.config ->> 'group', 'daily') grp,
                     coalesce(p.public ->> 'group_label', coalesce(p.config ->> 'group', 'daily')) label, p.sort ord
                from rewards.programs p
               where p.kind = 'followup' and p.config ->> 'channel' = 'notification' and rewards.is_live(p)
               order by coalesce(p.config ->> 'group', 'daily'), p.sort, p.key) g), '[]'));
end $$;

-- Admin: email templates ------------------------------------------------------------------------------------------
create function public.rewards_admin_email_template_save(key text, html text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := rewards.require_admin();
begin
  if html is null then
    delete from rewards.email_templates t where t.key = rewards_admin_email_template_save.key;
    perform rewards.log('email_template_delete', jsonb_build_object('key', key));
    return jsonb_build_object('key', key, 'deleted', true);
  end if;
  if position('{{unsubscribe_url}}' in html) = 0 then
    raise exception 'rewards: template_needs_unsubscribe' using errcode = '22023';
  end if;
  insert into rewards.email_templates as t (key, html, updated_by) values (rewards_admin_email_template_save.key, html, me)
  on conflict on constraint email_templates_pkey do update set html = excluded.html, updated_at = now(), updated_by = me;
  perform rewards.log('email_template_save', jsonb_build_object('key', key, 'length', length(html)));
  return jsonb_build_object('key', key, 'saved', true);
end $$;

create function public.rewards_admin_email_templates() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform rewards.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('key', t.key, 'html', t.html, 'updated_at', t.updated_at) order by t.key)
                     from rewards.email_templates t), '[]');
end $$;

-- Claim carries the template; export / import carry the templates: patch the deployed definitions (checked).
do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('rewards.followup_claim(boolean,integer)'::regprocedure);
  n := replace(d, '''unsubscribe_token'', pr.unsubscribe_token));',
    '''unsubscribe_token'', pr.unsubscribe_token,
        ''template_html'', (select et.html from rewards.email_templates et where et.key = p.config #>> ''{email,template}'')));');
  if n = d then raise exception 'rewards: could not patch followup_claim'; end if;
  execute n;
  d := pg_get_functiondef('rewards.export_config(boolean)'::regprocedure);
  n := replace(d, '''quiz_questions'', case when include_quiz',
    '''email_templates'', coalesce((select jsonb_agg(jsonb_build_object(''key'', et.key, ''html'', et.html) order by et.key)
                         from rewards.email_templates et), ''[]''),
    ''quiz_questions'', case when include_quiz');
  if n = d then raise exception 'rewards: could not patch export_config'; end if;
  execute n;
  d := pg_get_functiondef('rewards.import_config(jsonb,boolean)'::regprocedure);
  n := replace(d, '  return jsonb_build_object(''applied'', not dry_run, ''changes'', changes);',
    '  for x in select * from jsonb_array_elements(coalesce(cfg -> ''email_templates'', ''[]'')) loop
    if (select et.html from rewards.email_templates et where et.key = x ->> ''key'') is distinct from x ->> ''html'' then
      changes := changes || jsonb_build_array(jsonb_build_object(''what'', ''email_template'', ''key'', x ->> ''key'',
        ''action'', case when exists (select 1 from rewards.email_templates et where et.key = x ->> ''key'') then ''update'' else ''create'' end));
      if not dry_run then
        insert into rewards.email_templates as et (key, html) values (x ->> ''key'', x ->> ''html'')
        on conflict (key) do update set html = excluded.html, updated_at = now();
      end if;
    end if;
  end loop;
  return jsonb_build_object(''applied'', not dry_run, ''changes'', changes);');
  if n = d then raise exception 'rewards: could not patch import_config'; end if;
  -- fix (0.2): an export without quiz carries "quiz_questions": null, which jsonb_array_elements refused on import
  d := n;
  n := replace(d, 'jsonb_array_elements(coalesce(cfg -> ''quiz_questions'', ''[]''))',
    'jsonb_array_elements(case when jsonb_typeof(cfg -> ''quiz_questions'') = ''array'' then cfg -> ''quiz_questions'' else ''[]'' end)');
  if n = d then raise exception 'rewards: could not patch import_config (quiz_questions null)'; end if;
  execute n;
end $$;

revoke all on all tables in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards_app from public, anon, authenticated, service_role;
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
