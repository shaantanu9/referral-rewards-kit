-- Worked example of supabase/app-config/rewards-template.sql for a quiz app that already saves attempts in
-- public.quiz_attempts and pays coins through public.coin_grant(user, coins, idempotency_key). Applied and tested by
-- supabase/tests/18_rewards_app_config.test.sql.

insert into rewards.event_types (name, source, daily_limit) values
  ('quiz_completed', 'server', 100),
  ('quiz_passed', 'server', 100),
  ('quiz_first_pass', 'server', 100),
  ('lesson_opened', 'client', 30);

insert into rewards.programs (key, kind, config, public, sort) values
  ('daily_quiz', 'streak', '{"event":"quiz_completed","max_freezes":2}', '{"title":"Daily quiz streak"}', 1),
  ('quiz_master', 'milestone', '{"event":"quiz_first_pass"}', '{"title":"Pass 10 different quizzes"}', 2),
  ('welcome', 'offer', '{"window_minutes":1440}', '{"title":"Welcome gift"}', 3),
  ('ig_tag', 'social_tag', '{"platform":"instagram","account":"quizzy.app","code_prefix":"QUIZ","repeat_days":30}', '{}', 4);

insert into rewards.rules (program_key, threshold, repeat, kind, amount, params) values
  ('daily_quiz', 3, 'each_cycle', 'coins', 20, '{}'),
  ('daily_quiz', 7, 'every', 'streak_freeze', 1, '{}'),
  ('daily_quiz', 30, 'once', 'entitlement_days', 7, '{"entitlement_id":"premium"}'),
  ('quiz_master', 10, 'once', 'badge', 1, '{"badge":"quiz_master"}'),
  ('quiz_master', 5, 'every', 'coins', 50, '{}'),
  ('welcome', null, 'once', 'coins', 100, '{}'),
  ('ig_tag', null, 'once', 'coins', 200, '{}');

create or replace function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if kind <> 'coins' then
    raise exception 'rewards: no reward kind % in this app', kind;
  end if;
  if amount <> trunc(amount) then
    raise exception 'rewards: coins must be whole, got %', amount;
  end if;
  perform public.coin_grant(app_reward_grant.user_id, amount::int, 'rewards:' || grant_id::text);
end $$;
revoke execute on function rewards_app.app_reward_grant(uuid, uuid, text, numeric, jsonb)
  from public, anon, authenticated, service_role;

create trigger rewards_quiz_completed after insert or update of completed_at on public.quiz_attempts
  for each row when (new.completed_at is not null)
  execute function rewards.event_from_row('quiz_completed', 'user_id', 'id', 'quiz_id,score');
create trigger rewards_quiz_passed after insert or update of completed_at on public.quiz_attempts
  for each row when (new.completed_at is not null and new.score >= 0.8)
  execute function rewards.event_from_row('quiz_passed', 'user_id', 'id');
create trigger rewards_quiz_first_pass after insert or update of completed_at on public.quiz_attempts
  for each row when (new.completed_at is not null and new.score >= 0.8)
  execute function rewards.event_from_row('quiz_first_pass', 'user_id', 'quiz_id');

create trigger rewards_delete_user before delete on auth.users
  for each row execute function rewards.on_auth_user_deleted();
