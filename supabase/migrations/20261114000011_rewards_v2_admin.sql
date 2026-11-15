-- rewards engine 0.2, migration 4 of 4 (part 2): copy one app's setup to another (export / import), quiz bank admin,
-- the new settings, account deletion of the new tables, and privileges (ADR 0002 section 18.4).

-- Settings: the 0.1 keys plus ads_enabled and rc_allow_sandbox (replaces 0.1).
create or replace function public.rewards_admin_save_settings(patch jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  bad text;
begin
  perform rewards.require_admin();
  select k into bad from jsonb_object_keys(coalesce(patch, '{}')) k
   where k not in ('enabled', 'daily_grant_cap', 'default_timezone', 'max_attempts', 'lease_minutes',
                   'social_window_days', 'events_retention_days', 'ads_enabled', 'rc_allow_sandbox') limit 1;
  if bad is not null then raise exception 'rewards: unknown_setting %', bad using errcode = '22023'; end if;
  update rewards.settings s set
    enabled = coalesce((patch ->> 'enabled')::boolean, s.enabled),
    daily_grant_cap = coalesce((patch ->> 'daily_grant_cap')::int, s.daily_grant_cap),
    default_timezone = coalesce(patch ->> 'default_timezone', s.default_timezone),
    max_attempts = coalesce((patch ->> 'max_attempts')::int, s.max_attempts),
    lease_minutes = coalesce((patch ->> 'lease_minutes')::int, s.lease_minutes),
    social_window_days = coalesce((patch ->> 'social_window_days')::int, s.social_window_days),
    events_retention_days = coalesce((patch ->> 'events_retention_days')::int, s.events_retention_days),
    ads_enabled = coalesce((patch ->> 'ads_enabled')::boolean, s.ads_enabled),
    rc_allow_sandbox = coalesce((patch ->> 'rc_allow_sandbox')::boolean, s.rc_allow_sandbox)
  where s.id;
  perform rewards.log('save_settings', patch);
  return (select to_jsonb(s) - 'id' from rewards.settings s where s.id);
end $$;

-- Export / import ------------------------------------------------------------------------------------------------------

create function rewards.export_config(include_quiz boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('format', 'rewards-config', 'version', 1, 'exported_at', now(),
    'settings', (select to_jsonb(s) - 'id' from rewards.settings s where s.id),
    'event_types', coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from rewards.event_types t), '[]'),
    'programs', coalesce((select jsonb_agg(to_jsonb(p) - 'created_at' order by p.sort, p.key) from rewards.programs p), '[]'),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('program', r.program_key, 'threshold', r.threshold,
                         'repeat', r.repeat, 'kind', r.kind, 'amount', r.amount, 'params', r.params)
                         order by r.program_key, r.threshold nulls first, r.created_at)
                         from rewards.rules r where r.active), '[]'),
    'quiz_questions', case when include_quiz then coalesce((select jsonb_agg(to_jsonb(q) - 'created_at' - 'updated_at'
                         order by q.bank, q.created_at) from rewards.quiz_questions q where q.active), '[]') end)
$$;

-- Merge a config into this app: create or update event types, programs, settings and quiz questions; add rules not
-- already active. Never deletes, never changes a program's kind. dry_run (the default) only lists what would change.
create function rewards.import_config(cfg jsonb, dry_run boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  changes jsonb := '[]';
  x jsonb;
  cur jsonb;
  k text;
  act text;
  allowed constant text[] := array['enabled', 'daily_grant_cap', 'default_timezone', 'max_attempts', 'lease_minutes',
                                   'social_window_days', 'events_retention_days', 'ads_enabled', 'rc_allow_sandbox'];
begin
  if cfg ->> 'format' is distinct from 'rewards-config' or coalesce((cfg ->> 'version')::int, 0) <> 1 then
    raise exception 'rewards: bad_config (format rewards-config, version 1)' using errcode = '22023';
  end if;
  -- settings: only listed keys, only when different
  for k in select key from jsonb_each(coalesce(cfg -> 'settings', '{}')) where key = any(allowed) loop
    if (select to_jsonb(s) -> k from rewards.settings s where s.id) is distinct from cfg -> 'settings' -> k then
      changes := changes || jsonb_build_array(jsonb_build_object('what', 'setting', 'key', k, 'action', 'update'));
      if not dry_run then
        perform public.rewards_admin_save_settings(jsonb_build_object(k, cfg -> 'settings' -> k));
      end if;
    end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(cfg -> 'event_types', '[]')) loop
    select to_jsonb(t) into cur from rewards.event_types t where t.name = x ->> 'name';
    act := case when cur is null then 'create'
                when cur ->> 'source' = x ->> 'source' and cur -> 'daily_limit' = coalesce(x -> 'daily_limit', '50') then 'same'
                else 'update' end;
    if act <> 'same' then
      changes := changes || jsonb_build_array(jsonb_build_object('what', 'event_type', 'key', x ->> 'name', 'action', act));
      if not dry_run then
        insert into rewards.event_types as t (name, source, daily_limit)
        values (x ->> 'name', x ->> 'source', coalesce((x ->> 'daily_limit')::int, 50))
        on conflict (name) do update set source = excluded.source, daily_limit = excluded.daily_limit;
      end if;
    end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(cfg -> 'programs', '[]')) loop
    select to_jsonb(p) - 'created_at' into cur from rewards.programs p where p.key = x ->> 'key';
    act := case when cur is null then 'create'
                when cur ->> 'kind' <> x ->> 'kind' then 'refused_kind_change'
                when cur = (cur || (x - 'created_at')) then 'same'
                else 'update' end;
    if act <> 'same' then
      changes := changes || jsonb_build_array(jsonb_build_object('what', 'program', 'key', x ->> 'key', 'action', act));
      if not dry_run and act in ('create', 'update') then
        insert into rewards.programs as p (key, kind, enabled, starts_at, ends_at, config, public, sort)
        values (x ->> 'key', x ->> 'kind', coalesce((x ->> 'enabled')::boolean, true), (x ->> 'starts_at')::timestamptz,
                (x ->> 'ends_at')::timestamptz, coalesce(x -> 'config', '{}'), coalesce(x -> 'public', '{}'),
                coalesce((x ->> 'sort')::int, 0))
        on conflict (key) do update set enabled = excluded.enabled, starts_at = excluded.starts_at,
          ends_at = excluded.ends_at, config = excluded.config, public = excluded.public, sort = excluded.sort;
      end if;
    end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(cfg -> 'rules', '[]')) loop
    if exists (select 1 from rewards.rules r where r.active and r.program_key = x ->> 'program'
                 and r.threshold is not distinct from (x ->> 'threshold')::int and r.repeat = coalesce(x ->> 'repeat', 'once')
                 and r.kind = x ->> 'kind' and r.amount = (x ->> 'amount')::numeric and r.params = coalesce(x -> 'params', '{}')) then
      continue;
    end if;
    changes := changes || jsonb_build_array(jsonb_build_object('what', 'rule', 'key',
      (x ->> 'program') || ':' || coalesce(x ->> 'threshold', '-') || ':' || (x ->> 'kind'), 'action', 'add'));
    if not dry_run then
      insert into rewards.rules (program_key, version, threshold, repeat, kind, amount, params)
      values (x ->> 'program', coalesce((select max(r.version) from rewards.rules r where r.program_key = x ->> 'program'), 0) + 1,
              (x ->> 'threshold')::int, coalesce(x ->> 'repeat', 'once'), x ->> 'kind', (x ->> 'amount')::numeric,
              coalesce(x -> 'params', '{}'));
    end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(cfg -> 'quiz_questions', '[]')) loop
    act := case when x ? 'id' and exists (select 1 from rewards.quiz_questions q where q.id = (x ->> 'id')::uuid)
                then 'update' else 'create' end;
    changes := changes || jsonb_build_array(jsonb_build_object('what', 'quiz_question', 'key',
      coalesce(x ->> 'bank', 'default') || ':' || left(x ->> 'prompt', 40), 'action', act));
    if not dry_run then perform rewards.quiz_save_one(x); end if;
  end loop;
  return jsonb_build_object('applied', not dry_run, 'changes', changes);
end $$;

-- Quiz bank admin ------------------------------------------------------------------------------------------------------

create function rewards.quiz_save_one(x jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  qid uuid := coalesce((x ->> 'id')::uuid, gen_random_uuid());
begin
  insert into rewards.quiz_questions as q (id, bank, kind, prompt, choices, answer, time_limit_s, media, explanation, tags, active)
  values (qid, coalesce(x ->> 'bank', 'default'), coalesce(x ->> 'kind', 'choice'), x ->> 'prompt', x -> 'choices',
          (x ->> 'answer')::int, coalesce((x ->> 'time_limit_s')::int, 15), coalesce(x -> 'media', '{}'), x ->> 'explanation',
          coalesce(array(select jsonb_array_elements_text(x -> 'tags')), '{}'), coalesce((x ->> 'active')::boolean, true))
  on conflict (id) do update set bank = excluded.bank, kind = excluded.kind, prompt = excluded.prompt,
    choices = excluded.choices, answer = excluded.answer, time_limit_s = excluded.time_limit_s, media = excluded.media,
    explanation = excluded.explanation, tags = excluded.tags, active = excluded.active, updated_at = now();
  return qid;
end $$;

create function public.rewards_admin_quiz_save(bank text, questions jsonb) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  x jsonb;
  n int := 0;
begin
  perform rewards.require_admin();
  if jsonb_typeof(questions) <> 'array' then raise exception 'rewards: questions must be an array' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(questions) loop
    perform rewards.quiz_save_one(jsonb_build_object('bank', bank) || x);
    n := n + 1;
  end loop;
  perform rewards.log('quiz_save', jsonb_build_object('bank', bank, 'count', n));
  return n;
end $$;

create function public.rewards_admin_quiz_list(bank text, active boolean default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform rewards.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at) from rewards.quiz_questions q
                    where q.bank = rewards_admin_quiz_list.bank
                      and (rewards_admin_quiz_list.active is null or q.active = rewards_admin_quiz_list.active)), '[]');
end $$;

-- Per question: how often served and answered, right, timed out (counts only, never a user).
create function public.rewards_admin_quiz_stats(bank text, days int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform rewards.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt, 'kind', q.kind, 'served', coalesce(t.served, 0),
             'answered', coalesce(t.answered, 0), 'correct', coalesce(t.correct, 0), 'timed_out', coalesce(t.timed_out, 0),
             'correct_rate', case when t.answered > 0 then round(t.correct::numeric / t.answered, 3) end)
             order by coalesce(t.served, 0) desc, q.created_at)
      from rewards.quiz_questions q
      left join (
        select u.qid, count(*) filter (where a.served_at[u.i::int] is not null) served,
               count(*) filter (where a.answers -> (u.i::int - 1) is not null) answered,
               count(*) filter (where (a.answers -> (u.i::int - 1) ->> 'correct')::boolean) correct,
               count(*) filter (where (a.answers -> (u.i::int - 1) ->> 'timed_out')::boolean) timed_out
          from rewards.quiz_attempts a, unnest(a.question_ids) with ordinality u(qid, i)
         where a.started_at > now() - make_interval(days => least(greatest(days, 1), 365))
         group by u.qid) t on t.qid = q.id
     where q.bank = rewards_admin_quiz_stats.bank), '[]');
end $$;

create function public.rewards_admin_export(include_quiz boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform rewards.require_admin();
  return rewards.export_config(include_quiz);
end $$;

create function public.rewards_admin_import(config jsonb, dry_run boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  out jsonb;
begin
  perform rewards.require_admin();
  out := rewards.import_config(config, dry_run);
  if not dry_run then perform rewards.log('import', jsonb_build_object('changes', jsonb_array_length(out -> 'changes'))); end if;
  return out;
end $$;

-- Deletion covers the 0.2 tables (replaces 0.1) ------------------------------------------------------------------------
create or replace function rewards.delete_user(uid uuid) returns jsonb
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
  delete from rewards.distinct_seen x where x.user_id = uid;
  delete from rewards.quest_progress x where x.user_id = uid;
  delete from rewards.activity x where x.user_id = uid;
  delete from rewards.recharge x where x.user_id = uid;
  delete from rewards.friend_invites x where x.user_id = uid;
  delete from rewards.friend_pairs x where uid in (x.user_a, x.user_b);
  delete from rewards.quiz_attempts x where x.user_id = uid;
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
