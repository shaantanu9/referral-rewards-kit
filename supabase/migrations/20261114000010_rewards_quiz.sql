-- rewards engine 0.2, migration 4 of 4 (part 1): the daily quiz module (ADR 0002 sections 18.2, 18.3).
-- Questions live on the server; the answer never reaches the phone. Each question has its own timer, counted from
-- the moment the server first sends it. Each finished attempt pays its best score tier and emits `quiz_finished`.

create table rewards.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  bank text not null default 'default' check (bank ~ '^[a-z][a-z0-9_]{0,39}$'),
  kind text not null default 'choice' check (kind in ('choice', 'true_false', 'odd_one_out', 'listen', 'picture')),
  prompt text not null check (length(prompt) between 1 and 500),
  choices jsonb not null check (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) between 2 and 6),
  answer int not null,
  time_limit_s int not null default 15 check (time_limit_s between 3 and 120),
  media jsonb not null default '{}' check (jsonb_typeof(media) = 'object'),
  explanation text check (explanation is null or length(explanation) <= 500),
  tags text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (answer >= 0 and answer < jsonb_array_length(choices)),
  check (kind <> 'true_false' or jsonb_array_length(choices) = 2),
  check (kind <> 'listen' or coalesce(media ->> 'sound_id', '') <> ''),
  check (kind <> 'picture' or coalesce(media ->> 'image_url', '') ~ '^https://')
);
create index quiz_questions_bank on rewards.quiz_questions (bank, kind) where active;

create table rewards.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  program_key text not null references rewards.programs (key),
  day date not null,
  attempt int not null check (attempt >= 1),
  question_ids uuid[] not null,
  served_at timestamptz[] not null,
  answers jsonb not null default '[]',
  score int not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  grant_ids uuid[] not null default '{}',
  unique (user_id, program_key, day, attempt)
);
create index quiz_attempts_recent on rewards.quiz_attempts (user_id, program_key, started_at desc);

-- Today's questions: unseen first (nothing served to this user in `avoid_days`), each kind's minimum from `mix`, at
-- most its maximum, then shuffled. Seen questions fill in only when the unseen ones run out.
create function rewards.quiz_pick(uid uuid, p rewards.programs) returns uuid[]
language plpgsql volatile security definer set search_path = '' as $$
declare
  n int := coalesce((p.config ->> 'questions')::int, 10);
  bnk text := coalesce(p.config ->> 'bank', 'default');
  mix jsonb := coalesce(p.config -> 'mix', '{}');
  seen uuid[];
  picked uuid[] := '{}';
  k record;
  q uuid;
begin
  select coalesce(array_agg(distinct x), '{}') into seen
    from rewards.quiz_attempts a, unnest(a.question_ids) x
   where a.user_id = uid and a.program_key = p.key
     and a.started_at > now() - make_interval(days => coalesce((p.config ->> 'avoid_days')::int, 30));
  -- minimums per kind
  for k in select key, coalesce((value ->> 0)::int, 0) mn from jsonb_each(mix) loop
    picked := picked || array(
      select x.id from rewards.quiz_questions x
       where x.bank = bnk and x.active and x.kind = k.key and x.id <> all(picked)
       order by (x.id = any(seen)), random() limit least(k.mn, n - cardinality(picked)));
  end loop;
  -- the rest, respecting each kind's maximum
  for q in select x.id from rewards.quiz_questions x
            where x.bank = bnk and x.active and x.id <> all(picked)
            order by (x.id = any(seen)), random() loop
    exit when cardinality(picked) >= n;
    if mix ? (select x.kind from rewards.quiz_questions x where x.id = q)
       and (select count(*) from rewards.quiz_questions x where x.id = any(picked)
              and x.kind = (select y.kind from rewards.quiz_questions y where y.id = q))
           >= coalesce((mix -> (select x.kind from rewards.quiz_questions x where x.id = q) ->> 1)::int, n) then
      continue;
    end if;
    picked := picked || q;
  end loop;
  return array(select x from unnest(picked) x order by random());
end $$;

create function rewards.quiz_latest(uid uuid, p rewards.programs) returns rewards.quiz_attempts
language sql stable security definer set search_path = '' as $$
  select * from rewards.quiz_attempts a
   where a.user_id = uid and a.program_key = p.key and a.day = (now() at time zone rewards.member_tz(uid))::date
   order by a.attempt desc limit 1
$$;

create function rewards.quiz_json(uid uuid, p rewards.programs) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := rewards.member_tz(uid);
  today date := (now() at time zone tz)::date;
  a rewards.quiz_attempts := rewards.quiz_latest(uid, p);
  per_day int := coalesce((p.config ->> 'attempts_per_day')::int, 1);
  done_last rewards.quiz_attempts;
begin
  select * into done_last from rewards.quiz_attempts x
   where x.user_id = uid and x.program_key = p.key and x.day = today and x.finished_at is not null
   order by x.attempt desc limit 1;
  return jsonb_build_object('program', p.key,
    'state', case when a.id is null then 'not_started' when a.finished_at is null then 'in_progress' else 'finished' end,
    'day', today, 'ends_at', ((today + 1)::timestamp at time zone tz),
    'total', coalesce(cardinality(a.question_ids), coalesce((p.config ->> 'questions')::int, 10)),
    'current', coalesce(jsonb_array_length(a.answers), 0), 'score', coalesce(a.score, 0),
    'attempts_left', greatest(per_day - coalesce(a.attempt, 0), 0),
    'last_result', case when done_last.id is not null then jsonb_build_object('score', done_last.score,
      'total', cardinality(done_last.question_ids), 'grants', rewards.grants_json(uid, done_last.grant_ids)) end);
end $$;

create function rewards.quiz_program(program text) returns rewards.programs
language plpgsql stable security definer set search_path = '' as $$
declare
  p rewards.programs;
begin
  select * into p from rewards.programs x where x.key = program and x.kind = 'quiz';
  if p.key is null or not rewards.is_live(p) then raise exception 'rewards: unknown_program' using errcode = '22023'; end if;
  return p;
end $$;

create function rewards.quiz_start(uid uuid, program text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p rewards.programs := rewards.quiz_program(program);
  a rewards.quiz_attempts;
  ids uuid[];
  today date;
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  if not (rewards.settings()).enabled then raise exception 'rewards: disabled' using errcode = '22023'; end if;
  perform rewards.member_timezone(uid, null);
  today := (now() at time zone rewards.member_tz(uid))::date;
  a := rewards.quiz_latest(uid, p);
  if a.id is not null and a.finished_at is null then return rewards.quiz_json(uid, p); end if;
  if coalesce(a.attempt, 0) >= coalesce((p.config ->> 'attempts_per_day')::int, 1) then
    raise exception 'rewards: no_attempts_left' using errcode = '22023';
  end if;
  ids := rewards.quiz_pick(uid, p);
  if cardinality(ids) < coalesce((p.config ->> 'questions')::int, 10) then
    raise exception 'rewards: not_enough_questions' using errcode = '22023';
  end if;
  insert into rewards.quiz_attempts (user_id, program_key, day, attempt, question_ids, served_at)
  values (uid, p.key, today, coalesce(a.attempt, 0) + 1, ids, array_fill(null::timestamptz, array[cardinality(ids)]));
  return rewards.quiz_json(uid, p);
end $$;

-- The current question, never its answer. The timer starts the first time the server sends it.
create function rewards.quiz_question(uid uuid, program text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p rewards.programs := rewards.quiz_program(program);
  a rewards.quiz_attempts;
  i int;
  q rewards.quiz_questions;
  served timestamptz;
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  select * into a from rewards.quiz_attempts x where x.id = (rewards.quiz_latest(uid, p)).id for update;
  if a.id is null or a.finished_at is not null then raise exception 'rewards: no_attempt' using errcode = '22023'; end if;
  i := jsonb_array_length(a.answers) + 1;
  served := coalesce(a.served_at[i], now());
  if a.served_at[i] is null then
    update rewards.quiz_attempts x set served_at[i] = served where x.id = a.id;
  end if;
  select * into q from rewards.quiz_questions x where x.id = a.question_ids[i];
  return jsonb_build_object('index', i - 1, 'total', cardinality(a.question_ids),
    'question', jsonb_build_object('id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'choices', q.choices, 'media', q.media),
    'time_limit_s', q.time_limit_s, 'served_at', served, 'ends_at', served + make_interval(secs => q.time_limit_s));
end $$;

create function rewards.quiz_answer(uid uuid, program text, idx int, choice int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p rewards.programs := rewards.quiz_program(program);
  a rewards.quiz_attempts;
  i int;
  q rewards.quiz_questions;
  late boolean;
  right_ boolean;
  r rewards.rules;
  gid uuid;
  ids uuid[] := '{}';
  total int;
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  select * into a from rewards.quiz_attempts x where x.id = (rewards.quiz_latest(uid, p)).id for update;
  if a.id is null or a.finished_at is not null then raise exception 'rewards: no_attempt' using errcode = '22023'; end if;
  i := jsonb_array_length(a.answers) + 1;
  if idx is distinct from i - 1 then raise exception 'rewards: wrong_question' using errcode = '22023'; end if;
  if a.served_at[i] is null then raise exception 'rewards: not_served' using errcode = '22023'; end if;
  select * into q from rewards.quiz_questions x where x.id = a.question_ids[i];
  late := now() > a.served_at[i] + make_interval(secs => q.time_limit_s + coalesce((p.config ->> 'grace_s')::int, 2));
  -- no choice (the app's own countdown ran out: choice -1 or null) is a timeout, never a wrong pick
  late := late or coalesce(choice, -1) < 0;
  right_ := not late and choice = q.answer;
  total := cardinality(a.question_ids);
  update rewards.quiz_attempts x
     set answers = x.answers || jsonb_build_array(jsonb_build_object('choice', choice, 'correct', right_, 'timed_out', late,
                     'ms', (extract(epoch from now() - a.served_at[i]) * 1000)::int)),
         score = x.score + case when right_ then 1 else 0 end,
         finished_at = case when i = total then now() end
   where x.id = a.id returning * into a;
  if a.finished_at is not null then
    -- only the best tier reached pays
    select * into r from rewards.rules x where x.program_key = p.key and x.active and x.threshold <= a.score
     order by x.threshold desc, x.created_at limit 1;
    if r.id is not null then
      for r in select * from rewards.rules x where x.program_key = p.key and x.active
                 and x.threshold = r.threshold order by x.created_at loop
        gid := rewards.queue(uid, r, 'd' || a.day || ':a' || a.attempt);
        if gid is not null then ids := ids || gid; end if;
      end loop;
    end if;
    update rewards.quiz_attempts x set grant_ids = ids where x.id = a.id;
    insert into rewards.event_types (name, source, daily_limit) values ('quiz_finished', 'server', 100) on conflict do nothing;
    begin
      perform rewards.track(uid, 'quiz_finished', 'quiz:' || a.id,
                            jsonb_build_object('program', p.key, 'score', a.score, 'total', total), null, true);
    exception when others then
      raise warning 'rewards: quiz_finished event: %', sqlerrm;
    end;
  end if;
  return jsonb_build_object('correct', right_, 'answer', q.answer, 'explanation', q.explanation, 'timed_out', late,
    'score', a.score, 'finished', a.finished_at is not null,
    'grants', rewards.grants_json(uid, (select array_agg(g.id) from rewards.grants g where g.user_id = uid and g.created_at = now())));
end $$;

create function public.rewards_quiz_today(program text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  return rewards.quiz_json(auth.uid(), rewards.quiz_program(program));
end $$;
create function public.rewards_quiz_start(program text) returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.quiz_start(auth.uid(), program) $$;
create function public.rewards_quiz_question(program text) returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.quiz_question(auth.uid(), program) $$;
create function public.rewards_quiz_answer(program text, index int, choice int) returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.quiz_answer(auth.uid(), program, index, choice) $$;

revoke all on all tables in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards from public, anon, authenticated, service_role;
revoke all on function public.rewards_quiz_today(text), public.rewards_quiz_start(text), public.rewards_quiz_question(text),
  public.rewards_quiz_answer(text, int, int) from public, anon, authenticated, service_role;
grant execute on function public.rewards_quiz_today(text), public.rewards_quiz_start(text), public.rewards_quiz_question(text),
  public.rewards_quiz_answer(text, int, int) to authenticated;
