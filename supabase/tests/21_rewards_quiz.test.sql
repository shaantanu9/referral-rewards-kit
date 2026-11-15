-- Rewards 0.2 quiz module: bank, daily pick, server-side answers and timers, score tiers, quiz_finished event, admin.
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u values ('admin', gen_random_uuid()), ('kid', gen_random_uuid()), ('two', gen_random_uuid());
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to authenticated;
create table public.app_coins (grant_id uuid primary key, user_id uuid, kind text, amount numeric);
grant select, insert on public.app_coins to postgres;
create or replace function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_coins values (grant_id, user_id, kind, amount) on conflict do nothing;
end $$;
insert into rewards.admins (user_id) values (pg_temp.uid('admin'));

-- bank through the admin API
select tests.act_as('authenticated', pg_temp.uid('admin'));
select tests.ok(public.rewards_admin_quiz_save('manga', (
  select jsonb_agg(q) from (
    select jsonb_build_object('kind', 'choice', 'prompt', 'Choice ' || g, 'choices', '["a","b","c","d"]'::jsonb, 'answer', 1,
                              'time_limit_s', 15, 'explanation', 'b is right') q from generate_series(1, 8) g
    union all
    select jsonb_build_object('kind', 'true_false', 'prompt', 'True? ' || g, 'choices', '["True","False"]'::jsonb, 'answer', 0,
                              'time_limit_s', 10) from generate_series(1, 4) g
    union all
    select jsonb_build_object('kind', 'listen', 'prompt', 'Which sound?', 'choices', '["boom","whoosh"]'::jsonb, 'answer', 0,
                              'media', '{"sound_id":"boom_1"}'::jsonb, 'time_limit_s', 20)) x)) = 13, 'thirteen questions saved');
do $$ begin
  perform public.rewards_admin_quiz_save('manga', '[{"kind":"true_false","prompt":"x","choices":["a","b","c"],"answer":0}]');
  raise exception 'three-choice true/false accepted';
exception when check_violation then perform tests.ok(true, 'true/false needs exactly two choices');
end $$;
do $$ begin
  perform public.rewards_admin_quiz_save('manga', '[{"kind":"choice","prompt":"x","choices":["a","b"],"answer":5}]');
  raise exception 'answer out of range accepted';
exception when check_violation then perform tests.ok(true, 'the answer must be one of the choices');
end $$;
select public.rewards_admin_save_program('daily_quiz', 'quiz', true,
  '{"bank":"manga","questions":5,"mix":{"true_false":[2,2],"listen":[1,1]},"attempts_per_day":2,"avoid_days":30}');
select public.rewards_admin_add_rule('daily_quiz', 'coins', 10, 3);
select public.rewards_admin_add_rule('daily_quiz', 'coins', 50, 5);
select public.rewards_admin_save_event_type('quiz_finished', 'server', 100);
select public.rewards_admin_save_program('quiz_streak', 'streak', true, '{"event":"quiz_finished"}');
select public.rewards_admin_save_program('aces', 'milestone', true, '{"event":"quiz_finished","where":{"prop:score":{"gte":5}}}');
select public.rewards_admin_add_rule('aces', 'badge', 1, 1, 'once', '{"badge":"perfect_score"}');
reset role;

-- the kid plays through the public API
select tests.act_as('authenticated', pg_temp.uid('kid'));
select tests.ok((public.rewards_quiz_today('daily_quiz') ->> 'state') = 'not_started', 'not started');
do $$ begin
  perform public.rewards_quiz_question('daily_quiz');
  raise exception 'question without attempt';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: no_attempt', 'no question before Start');
end $$;
create temp table s1 as select public.rewards_quiz_start('daily_quiz') j;
reset role;
select tests.ok((select j ->> 'state' = 'in_progress' and (j ->> 'total')::int = 5 and (j ->> 'attempts_left')::int = 1 from s1),
                'started: 5 questions, one attempt left after this');
select tests.ok((select count(*) filter (where q.kind = 'true_false') = 2 and count(*) filter (where q.kind = 'listen') = 1
                 from rewards.quiz_attempts a, unnest(a.question_ids) x join rewards.quiz_questions q on q.id = x
                 where a.user_id = pg_temp.uid('kid')), 'the mix: exactly 2 true/false and 1 listen');

-- answer all five: question → answer (right except one timeout)
create temp table qs (i int, j jsonb);
grant select, insert on qs to authenticated;
create function pg_temp.play(n int, timeout_at int) returns jsonb language plpgsql as $$
declare
  q jsonb;
  a jsonb;
  right_ int;
begin
  for i in 0..n - 1 loop
    perform tests.act_as('authenticated', pg_temp.uid('kid'));
    q := public.rewards_quiz_question('daily_quiz');
    insert into qs values (i, q);
    reset role;
    if i = timeout_at then
      update rewards.quiz_attempts set served_at[i + 1] = now() - interval '1 minute' where user_id = pg_temp.uid('kid') and finished_at is null;
    end if;
    select answer into right_ from rewards.quiz_questions where id = (q #>> '{question,id}')::uuid;
    perform tests.act_as('authenticated', pg_temp.uid('kid'));
    a := public.rewards_quiz_answer('daily_quiz', i, right_);
    reset role;
  end loop;
  return a;
end $$;
create temp table r1 as select pg_temp.play(5, 2) j;
select tests.ok(not exists (select 1 from qs where j -> 'question' ? 'answer'), 'a question never carries its answer');
select tests.ok((select bool_and((j ->> 'ends_at')::timestamptz > (j ->> 'served_at')::timestamptz) from qs), 'each question has its own deadline');
select tests.ok((select (j ->> 'finished')::boolean and (j ->> 'score')::int = 4 from r1), 'finished with 4/5: the timed-out one counts wrong');
select tests.ok((select answers -> 2 @> '{"timed_out":true,"correct":false}' from rewards.quiz_attempts where user_id = pg_temp.uid('kid')),
                'the late answer is stored as timed out');
select tests.ok((select string_agg(amount::text, ',') from public.app_coins where user_id = pg_temp.uid('kid') and kind = 'coins') = '10',
                'score 4 pays the 3+ tier only (10), not the 5 tier');
select tests.ok((select current from rewards.streaks where user_id = pg_temp.uid('kid') and program_key = 'quiz_streak') = 1,
                'quiz_finished feeds the quiz streak');
select tests.ok(not exists (select 1 from rewards.badges where user_id = pg_temp.uid('kid')), 'no perfect-score badge at 4/5');

-- second attempt the same day: avoids the first attempt's questions while unseen ones remain
select tests.act_as('authenticated', pg_temp.uid('kid'));
select public.rewards_quiz_start('daily_quiz');
reset role;
select tests.ok((select count(*) from unnest((select question_ids from rewards.quiz_attempts where user_id = pg_temp.uid('kid') and attempt = 2)) x
                 where x = any(array(select unnest(question_ids) from rewards.quiz_attempts where user_id = pg_temp.uid('kid') and attempt = 1))) = 1,
                'second attempt reuses only the listen question (its kind ran out of unseen ones)');
create temp table r2 as select pg_temp.play(5, -1) j;
select tests.ok((select (j ->> 'score')::int = 5 from r2), 'perfect second attempt');
select tests.ok((select count(*) from public.app_coins where user_id = pg_temp.uid('kid') and amount = 50) = 1, 'the 5 tier pays 50');
select tests.ok(exists (select 1 from rewards.badges where user_id = pg_temp.uid('kid') and badge = 'perfect_score'),
                'a filtered milestone on quiz_finished gives the perfect-score badge');
select tests.act_as('authenticated', pg_temp.uid('kid'));
do $$ begin
  perform public.rewards_quiz_start('daily_quiz');
  raise exception 'third attempt allowed';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: no_attempts_left', 'attempts_per_day enforced');
end $$;
create temp table t3 as select public.rewards_quiz_today('daily_quiz') j;
reset role;
select tests.ok((select j ->> 'state' = 'finished' and (j -> 'last_result' ->> 'score')::int = 5
                 and jsonb_array_length(j -> 'last_result' -> 'grants') >= 1 from t3), 'today shows the last result and its grants');

-- order and serving rules
select tests.act_as('authenticated', pg_temp.uid('two'));
select public.rewards_quiz_start('daily_quiz');
do $$ begin
  perform public.rewards_quiz_answer('daily_quiz', 0, 1);
  raise exception 'answer before serving';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: not_served', 'no answer before the question was sent');
end $$;
select public.rewards_quiz_question('daily_quiz');
do $$ begin
  perform public.rewards_quiz_answer('daily_quiz', 3, 1);
  raise exception 'skipping ahead';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: wrong_question', 'questions are answered in order');
end $$;
create temp table nochoice as select public.rewards_quiz_answer('daily_quiz', 0, -1) j;
select tests.ok((select (j ->> 'timed_out')::boolean and not (j ->> 'correct')::boolean from nochoice),
                'choice -1 (the app''s countdown ran out) is stored as timed out');
select public.rewards_quiz_question('daily_quiz');
-- resume: asking again returns the same question with the same deadline
select tests.ok((select (public.rewards_quiz_question('daily_quiz') ->> 'served_at') = (public.rewards_quiz_question('daily_quiz') ->> 'served_at')),
                'resuming keeps the first serving time (no new timer)');
reset role;

-- not enough questions
insert into rewards.programs (key, kind, config) values ('big_quiz', 'quiz', '{"bank":"manga","questions":40}');
select tests.act_as('authenticated', pg_temp.uid('two'));
do $$ begin
  perform public.rewards_quiz_start('big_quiz');
  raise exception 'started with too few questions';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: not_enough_questions', 'a bank smaller than the quiz is refused');
end $$;
reset role;

-- admin stats and list
select tests.act_as('authenticated', pg_temp.uid('admin'));
create temp table qst as select public.rewards_admin_quiz_stats('manga', 30) j;
select tests.ok((select sum((x ->> 'answered')::int) = 11 and sum((x ->> 'timed_out')::int) = 2 from qst, jsonb_array_elements(j) x),
                'stats: 11 answers, 2 timed out');
select tests.ok(jsonb_array_length(public.rewards_admin_quiz_list('manga')) = 13 and (public.rewards_admin_quiz_list('manga') -> 0 ? 'answer'),
                'admin list includes the answers');
reset role;
select tests.ok(not has_function_privilege('authenticated', 'rewards.quiz_answer(uuid,text,integer,integer)', 'EXECUTE'),
                'the inner quiz functions are not callable by users');

-- deletion
select rewards.delete_user(pg_temp.uid('kid'));
select tests.ok(not exists (select 1 from rewards.quiz_attempts where user_id = pg_temp.uid('kid')), 'quiz attempts deleted with the account');

rollback;
