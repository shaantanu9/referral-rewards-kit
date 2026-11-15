-- The rewards per-app configuration (supabase/app-config/rewards-template.sql) through its worked example
-- examples/quiz-app/rewards_config.sql: applies on top of every migration, the app's quiz saves earn rewards, the coin
-- hook is idempotent, nothing is exposed.
\set ON_ERROR_STOP 1
begin;

-- The app's own objects, as the app has them.
set local role postgres;
create table public.quiz_attempts (id uuid primary key default gen_random_uuid(), user_id uuid not null,
                                   quiz_id text not null, score numeric not null, completed_at timestamptz);
create table public.coin_ledger (idempotency_key text primary key, user_id uuid not null, coins int not null);
create function public.coin_grant(user_id uuid, coins int, idempotency_key text) returns void
language sql security definer set search_path = '' as $$
  insert into public.coin_ledger values (idempotency_key, user_id, coins) on conflict do nothing
$$;
revoke execute on function public.coin_grant(uuid, int, text) from public, anon, authenticated;
grant select, insert, update on public.quiz_attempts to authenticated;
reset role;

-- on Supabase the migration role may put triggers on auth.users (apps do it for new-user hooks); the stub may not
grant trigger on auth.users to postgres;
set local role postgres;
\ir ../../examples/quiz-app/rewards_config.sql
reset role;

create temp table u as select gen_random_uuid() id;
grant select on u to authenticated;
insert into auth.users (id, email) select id, 'q@example.test' from u;

select tests.ok((select count(*) from rewards.programs) = 4, 'four programs configured');
select tests.ok(exists (select 1 from pg_trigger where tgname = 'rewards_delete_user'), 'deletion trigger attached');

-- ten different quizzes passed by the user through the app's own insert
select tests.act_as('authenticated', (select id from u));
insert into public.quiz_attempts (user_id, quiz_id, score, completed_at)
select (select id from u), 'quiz-' || g, 0.9, now() from generate_series(1, 10) g;
create temp table st as select public.rewards_state() j;
reset role;

select tests.ok((select count from rewards.counters where program_key = 'quiz_master') = 10, 'ten first passes counted');
select tests.ok(exists (select 1 from rewards.badges where badge = 'quiz_master'), 'quiz master badge at 10');
select tests.ok((select sum(coins) from public.coin_ledger) = 100, 'every-5 rule paid 50 coins twice through the app hook');
select tests.ok((select current from rewards.streaks where program_key = 'daily_quiz') = 1, 'ten quizzes in one day: streak 1');
select tests.ok((select j -> 'offers' -> 0 ->> 'state' = 'active' from st), 'welcome offer started on first state call');
select tests.ok((select j -> 'social' -> 0 ->> 'account' = 'quizzy.app' from st), 'Instagram task shown with the account');

-- hook idempotent on grant id
select rewards_app.app_reward_grant(id, user_id, kind, amount, params) from rewards.grants where kind = 'coins' limit 1;
select tests.ok((select sum(coins) from public.coin_ledger) = 100, 'running the hook again pays nothing twice');
do $$ begin
  perform rewards_app.app_reward_grant(gen_random_uuid(), gen_random_uuid(), 'gems', 1, '{}');
  raise exception 'unknown kind accepted';
exception when others then perform tests.ok(sqlerrm like 'rewards: no reward kind gems%', 'unknown kind raises');
end $$;

-- nothing exposed by the config
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('rewards', 'rewards_app')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  'no rewards or rewards_app function callable by anon or authenticated after the config');

-- deleting the account removes the user's rewards data
delete from auth.users where id = (select id from u);
select tests.ok(not exists (select 1 from rewards.events where user_id = (select id from u)), 'account deletion clears rewards events');

rollback;
