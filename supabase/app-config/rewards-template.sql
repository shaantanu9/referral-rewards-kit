-- rewards engine: the app's own configuration. Copy into the APP's supabase/migrations/ right after the kit's rewards
-- migrations (e.g. <timestamp>_rewards_<app>.sql), replace every <<...>>, delete what you do not use.
-- Worked, tested example: examples/quiz-app/rewards_config.sql (supabase/tests/18_rewards_app_config.test.sql).
-- Guide: docs/rewards-integration.md. Every program and rule can also be set later from the admin API.
--
-- BEFORE APPLYING (the deployed database is the truth, not the repo):
--   * read the live definition of every app function the hook calls: select pg_get_functiondef('public.<<fn>>'::regproc);
--   * try the whole file in a transaction you roll back.

-- 1. Event types: what can count. `client` = the app may send it with rewards_track; `server` = only a trigger, the
--    service role or an admin. Prefer `server` + a trigger on the app's own table: a client can be faked.
insert into rewards.event_types (name, source, daily_limit) values
  ('<<quiz_completed>>', 'server', 100),
  ('<<quiz_passed>>', 'server', 100),
  ('<<quiz_first_pass>>', 'server', 100);

-- 2. Programs: turn on any mix. Keys are lower case; `public` is display JSON the app receives untouched.
insert into rewards.programs (key, kind, config, public, sort) values
  ('<<daily_quiz>>', 'streak', '{"event":"<<quiz_completed>>","max_freezes":2}', '{"title":"<<Daily quiz streak>>"}', 1),
  ('<<quiz_master>>', 'milestone', '{"event":"<<quiz_first_pass>>"}', '{"title":"<<Pass 10 different quizzes>>"}', 2);
-- Timed welcome offer (deadline per user, never resets), Instagram tag reward:
-- insert into rewards.programs (key, kind, config) values
--   ('welcome', 'offer', '{"window_minutes":1440}'),
--   ('ig_tag', 'social_tag', '{"platform":"instagram","account":"<<your_account>>","code_prefix":"<<APP>>","repeat_days":30}');

-- 3. Rules (append-only; change by adding version 2 and deactivating version 1). Kinds: entitlement_days (RevenueCat,
--    params.entitlement_id), badge (params.badge), streak_freeze, or any kind your hook below grants.
insert into rewards.rules (program_key, threshold, repeat, kind, amount, params) values
  ('<<daily_quiz>>', 3, 'each_cycle', '<<coins>>', 20, '{}'),
  ('<<daily_quiz>>', 7, 'every', 'streak_freeze', 1, '{}'),
  ('<<quiz_master>>', 10, 'once', 'badge', 1, '{"badge":"<<quiz_master>>"}');

-- 4. The grant hook for the app's own kinds. MUST be idempotent on grant_id (it may run twice): pass it as the
--    credit function's idempotency key. Keep reward credit apart from bought credit.
create or replace function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if kind <> '<<coins>>' then
    raise exception 'rewards: no reward kind % in this app', kind;
  end if;
  perform public.<<credit_fn>>(app_reward_grant.user_id, amount::int, 'rewards:' || grant_id::text);
end $$;
revoke execute on function rewards_app.app_reward_grant(uuid, uuid, text, numeric, jsonb)
  from public, anon, authenticated, service_role;

-- 5. Link the app's own tables (the quiz results the app already saves). The dedupe column makes each row count once,
--    so `insert or update` is safe; `quiz_id` as the dedupe column counts each quiz once per user.
create trigger rewards_quiz_completed after insert or update of <<completed_at>> on public.<<quiz_attempts>>
  for each row when (new.<<completed_at>> is not null)
  execute function rewards.event_from_row('<<quiz_completed>>', 'user_id', 'id', 'quiz_id,score');
create trigger rewards_quiz_passed after insert or update of <<completed_at>> on public.<<quiz_attempts>>
  for each row when (new.<<completed_at>> is not null and new.score >= <<0.8>>)
  execute function rewards.event_from_row('<<quiz_passed>>', 'user_id', 'id');
create trigger rewards_quiz_first_pass after insert or update of <<completed_at>> on public.<<quiz_attempts>>
  for each row when (new.<<completed_at>> is not null and new.score >= <<0.8>>)
  execute function rewards.event_from_row('<<quiz_first_pass>>', 'user_id', 'quiz_id');

-- 6. Account deletion: never miss it.
create trigger rewards_delete_user before delete on auth.users
  for each row execute function rewards.on_auth_user_deleted();

-- 7. The first admin (then add others from the dashboard with rewards_admin_set_admin).
insert into rewards.admins (user_id) values ('<<owner auth user id>>');

-- 8. Worker (only for entitlement_days and Instagram expiry; local kinds are granted at once). pg_cron + pg_net:
-- select cron.schedule('rewards-worker', '*/15 * * * *', $$ select net.http_post(
--   url := '<<https://REF.supabase.co>>/functions/v1/rewards/worker',
--   headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
--                                                             where name = 'rewards_worker_secret'))) $$);
-- 9. Follow-up emails (only if you use email follow-ups): once a day, e.g. 04:30 UTC.
-- select cron.schedule('rewards-followups', '30 4 * * *', $$ select net.http_post(
--   url := '<<https://REF.supabase.co>>/functions/v1/rewards/followups',
--   headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
--                                                             where name = 'rewards_worker_secret'))) $$);
