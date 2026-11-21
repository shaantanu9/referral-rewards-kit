-- Rewards 0.2: RevenueCat events and ad rewards (ads switch), config export / import between apps, the three presets.
\set ON_ERROR_STOP 1
\set preset_reader `cat supabase/app-config/presets/reader.json`
\set preset_quiz `cat supabase/app-config/presets/quiz.json`
\set preset_habit `cat supabase/app-config/presets/habit.json`
\set preset_retention `cat supabase/app-config/presets/retention.json`
\set preset_referral `cat supabase/app-config/presets/referral.json`
begin;

create temp table u (name text primary key, id uuid not null);
insert into u values ('admin', gen_random_uuid()), ('buyer', gen_random_uuid()), ('viewer', gen_random_uuid());
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to authenticated, service_role;
create table public.app_coins (grant_id uuid primary key, user_id uuid, kind text, amount numeric);
grant select, insert on public.app_coins to postgres;
create or replace function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_coins values (grant_id, user_id, kind, amount) on conflict do nothing;
end $$;
insert into rewards.admins (user_id) values (pg_temp.uid('admin'));

-- presets import cleanly (dry run first, then applied) ---------------------------------------------------------------
select tests.act_as('authenticated', pg_temp.uid('admin'));
create temp table d1 as select public.rewards_admin_import(:'preset_reader'::jsonb, true) j;
select tests.ok((select not (j ->> 'applied')::boolean and jsonb_array_length(j -> 'changes') > 10 from d1), 'reader preset dry run lists the changes');
reset role;
select tests.ok(not exists (select 1 from rewards.programs where key = 'reading_streak'), 'a dry run changes nothing');
select tests.act_as('authenticated', pg_temp.uid('admin'));
select tests.ok((public.rewards_admin_import(:'preset_reader'::jsonb, false) ->> 'applied')::boolean, 'reader preset applied');
select tests.ok((public.rewards_admin_import(:'preset_quiz'::jsonb, false) ->> 'applied')::boolean, 'quiz preset applied');
select tests.ok((public.rewards_admin_import(:'preset_habit'::jsonb, false) ->> 'applied')::boolean, 'habit preset applied');
select tests.ok((public.rewards_admin_import(:'preset_retention'::jsonb, false) ->> 'applied')::boolean, 'retention preset applied');
select tests.ok((public.rewards_admin_import(:'preset_referral'::jsonb, false) ->> 'applied')::boolean, 'referral ladder preset applied');
select tests.ok(jsonb_array_length(public.rewards_admin_import(:'preset_reader'::jsonb, true) -> 'changes') = 0,
                'importing the same preset again changes nothing');
reset role;
select tests.ok((select count(*) from rewards.programs) = 37 and (select count(*) from rewards.rules where active) = 30,
                'all programs and rules of the five presets exist');
select tests.ok((select config ->> 'event' = 'referral_joined' and not config ? 'head_start' from rewards.programs where key = 'referral_ladder')
                and (select array_agg(r.threshold order by r.threshold) = '{1,3,10}' from rewards.rules r
                      where r.program_key = 'referral_ladder' and r.active), 'referral ladder: referral_joined at 1, 3 and 10, no head start');

-- export round trip -----------------------------------------------------------------------------------------------------
select tests.act_as('authenticated', pg_temp.uid('admin'));
select public.rewards_admin_quiz_save('default', '[{"prompt":"2+2?","choices":["3","4"],"answer":1}]');
create temp table ex as select public.rewards_admin_export(true) j;
select tests.ok((select j ->> 'format' = 'rewards-config' and jsonb_array_length(j -> 'quiz_questions') = 1
                 and not (j -> 'rules' -> 0 ? 'id') from ex), 'export carries programs, rules without ids, quiz questions');
select tests.ok(jsonb_array_length(public.rewards_admin_import((select j from ex), true) -> 'changes') = 1,
                'importing our own export: only the quiz question shows (it is upserted by id)');
-- another app's version of the config: a changed program, a new program, a kind change, a new rule
create temp table other as select jsonb_set(jsonb_set(j, '{programs}', (j -> 'programs')
    || '[{"key":"new_one","kind":"milestone","config":{"event":"chapter_finished"}},{"key":"hearts","kind":"streak","config":{"event":"quiz_finished"}}]'),
  '{rules}', (j -> 'rules') || '[{"program":"new_one","threshold":2,"repeat":"once","kind":"badge","amount":1,"params":{"badge":"newbie"}}]') j from ex;
update other set j = jsonb_set(j, '{programs}', (select jsonb_agg(case when p ->> 'key' = 'happy_hour'
  then jsonb_set(p, '{config,to}', '"23:00"') else p end) from jsonb_array_elements(j -> 'programs') p));
create temp table d2 as select public.rewards_admin_import((select j from other), false) j;
select tests.ok((select j -> 'changes' @> '[{"what":"program","key":"new_one","action":"create"},
                                         {"what":"program","key":"hearts","action":"refused_kind_change"},
                                         {"what":"program","key":"happy_hour","action":"update"},
                                         {"what":"rule","action":"add"}]' from d2), 'import lists create, update, refused kind change, new rule');
reset role;
select tests.ok((select config ->> 'to' = '23:00' from rewards.programs where key = 'happy_hour'), 'the changed window applied');
select tests.ok((select kind = 'recharge' from rewards.programs where key = 'hearts'), 'a kind is never changed by an import');
select tests.ok(exists (select 1 from rewards.rules where program_key = 'new_one'), 'the new rule added');
select tests.ok(exists (select 1 from rewards.admin_log where action = 'import'), 'an applied import is in the audit log');
do $$ begin
  perform tests.act_as('authenticated', pg_temp.uid('admin'));
  perform public.rewards_admin_import('{"format":"something"}', true);
  raise exception 'bad format accepted';
exception when sqlstate '22023' then perform tests.ok(sqlerrm like 'rewards: bad_config%', 'a foreign file is refused');
end $$;
reset role;
do $$ begin
  perform tests.act_as('authenticated', pg_temp.uid('buyer'));
  perform public.rewards_admin_export(false);
  raise exception 'non-admin export';
exception when sqlstate '42501' then perform tests.ok(true, 'only admins export');
end $$;
reset role;

-- RevenueCat events ---------------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select tests.ok((public.rewards_svc_rc_event(pg_temp.uid('buyer'), 'RENEWAL', 'evt-1', '{"environment":"PRODUCTION"}') ->> 'reason')
                = 'ignored_unregistered', 'an unregistered RevenueCat event type is ignored');
select tests.ok((public.rewards_svc_rc_event(pg_temp.uid('buyer'), 'INITIAL_PURCHASE', 'evt-2', '{"environment":"SANDBOX"}') ->> 'reason')
                = 'sandbox', 'sandbox purchases are ignored by default');
reset role;
-- the reader preset: the welcome offer starts on the first chapter and completes on the purchase
select rewards.track(pg_temp.uid('buyer'), 'chapter_finished', 'ch1', '{"series":"a"}', null, true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select tests.ok((public.rewards_svc_rc_event(pg_temp.uid('buyer'), 'INITIAL_PURCHASE', 'evt-3',
                  '{"environment":"PRODUCTION","product_id":"plus_monthly"}') ->> 'tracked')::boolean,
                'INITIAL_PURCHASE becomes rc_initial_purchase');
select tests.ok((public.rewards_svc_rc_event(pg_temp.uid('buyer'), 'INITIAL_PURCHASE', 'evt-3', '{}') -> 'result' ->> 'duplicate')::boolean,
                'the same RevenueCat event twice counts once');
reset role;
select tests.ok(exists (select 1 from public.app_coins where user_id = pg_temp.uid('buyer') and kind = 'chapters' and amount = 3),
                'the purchase completed the welcome offer: 3 chapters');

-- ads: off by default, on through settings ------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select tests.ok((public.rewards_svc_ad_reward(pg_temp.uid('viewer'), 'ad-1', 'GEMS', 5, 'evt-a1') ->> 'reason') = 'ads_off',
                'ads switched off: nothing counted');
select public.rewards_admin_save_settings('{"ads_enabled": true}');
select tests.ok((public.rewards_svc_ad_reward(pg_temp.uid('viewer'), 'ad-' || g, 'GEMS', 5, 'evt-a' || g) ->> 'tracked')::boolean,
                'ad ' || g || ' counted') from generate_series(1, 5) g;
select tests.ok((public.rewards_svc_ad_reward(pg_temp.uid('viewer'), 'ad-5', 'GEMS', 5, 'evt-a5') -> 'result' ->> 'duplicate')::boolean,
                'the same ad transaction counts once');
reset role;
select tests.ok(exists (select 1 from rewards.badges where user_id = pg_temp.uid('viewer') and badge = 'ad_fan'), 'five ads: the ad_fan badge');
update rewards.event_types set daily_limit = 5 where name = 'ad_watched';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select tests.ok((public.rewards_svc_ad_reward(pg_temp.uid('viewer'), 'ad-99', 'GEMS', 5, 'evt-a99') ->> 'reason') = 'daily_limit',
                'over the daily ad limit: refused quietly');
reset role;
select tests.ok(not has_function_privilege('authenticated', 'public.rewards_svc_ad_reward(uuid,text,text,numeric,text)', 'EXECUTE')
                and not has_function_privilege('authenticated', 'public.rewards_svc_rc_event(uuid,text,text,jsonb)', 'EXECUTE'),
                'users cannot report ads or RevenueCat events themselves');

rollback;
