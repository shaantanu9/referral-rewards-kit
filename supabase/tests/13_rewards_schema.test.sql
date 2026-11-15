-- Rewards engine: schema checks and privileges (ADR 0002 sections 4, 5, 11, 14). Rolled back at the end.
\set ON_ERROR_STOP 1
begin;

select tests.ok((select count(*) from rewards.settings) = 1, 'rewards settings has one row');
select tests.ok((select enabled and daily_grant_cap = 1000 and default_timezone = 'UTC' and social_window_days = 7
                 from rewards.settings), 'rewards settings defaults match ADR 0002');

do $$ begin
  update rewards.settings set default_timezone = 'Mars/Olympus';
  raise exception 'bad timezone accepted';
exception when check_violation then perform tests.ok(true, 'default_timezone must be a real IANA name');
end $$;

-- no reward for store ratings or reviews
do $$ begin
  insert into rewards.event_types (name, source) values ('app_store_review', 'client');
  raise exception 'review event accepted';
exception when check_violation then perform tests.ok(true, 'event type named *review* refused');
end $$;
do $$ begin
  insert into rewards.event_types (name, source) values ('rating_given', 'client');
  raise exception 'rating event accepted';
exception when check_violation then perform tests.ok(true, 'event type named *rating* refused');
end $$;

insert into rewards.event_types (name, source) values ('chapter_read', 'client');

-- program config checks
do $$ begin
  insert into rewards.programs (key, kind, config) values ('daily', 'streak', '{"event":"nope"}');
  raise exception 'streak with unknown event accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'streak needs a registered event');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('flash', 'offer', '{}');
  raise exception 'offer without window accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'offer needs window_minutes or ends_at');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('flash', 'offer', '{"window_minutes":60,"stock":-1}');
  raise exception 'negative stock accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'offer stock must be a whole number');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('ig', 'social_tag', '{"platform":"tiktok","account":"x","code_prefix":"AB"}');
  raise exception 'tiktok accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'social platform is instagram only');
end $$;
do $$ begin
  insert into rewards.programs (key, kind, config) values ('ig', 'social_tag', '{"platform":"instagram","account":"@MyApp","code_prefix":"AB"}');
  raise exception 'bad account accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'social account is lower case without @');
end $$;
do $$ begin
  insert into rewards.programs (key, kind) values ('Bad-Key', 'streak');
  raise exception 'bad key accepted';
exception when check_violation or sqlstate '22023' then perform tests.ok(true, 'program key pattern enforced');
end $$;

insert into rewards.programs (key, kind, config) values ('daily', 'streak', '{"event":"chapter_read","max_freezes":2}');
do $$ begin
  update rewards.programs set kind = 'milestone' where key = 'daily';
  raise exception 'kind change accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'program kind never changes');
end $$;

-- rule checks and append-only
do $$ begin
  insert into rewards.rules (program_key, kind, amount) values ('daily', 'coins', 10);
  raise exception 'streak rule without threshold accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'streak rule needs a threshold');
end $$;
do $$ begin
  insert into rewards.rules (program_key, threshold, kind, amount) values ('daily', 3, 'entitlement_days', 3);
  raise exception 'entitlement_days without entitlement accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'entitlement_days needs params.entitlement_id');
end $$;
do $$ begin
  insert into rewards.rules (program_key, threshold, kind, amount) values ('daily', 3, 'badge', 1);
  raise exception 'badge without name accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'badge needs params.badge');
end $$;
do $$ begin
  insert into rewards.rules (program_key, threshold, kind, amount) values ('daily', 3, 'coins', 0);
  raise exception 'zero amount accepted';
exception when check_violation then perform tests.ok(true, 'amount must be positive');
end $$;

insert into rewards.rules (program_key, threshold, kind, amount) values ('daily', 3, 'coins', 10);
do $$ begin
  update rewards.rules set amount = 99 where program_key = 'daily';
  raise exception 'rule edit accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'rules are append-only (amount cannot change)');
end $$;
do $$ begin
  delete from rewards.rules where program_key = 'daily';
  raise exception 'rule delete accepted';
exception when sqlstate '22023' then perform tests.ok(true, 'rules cannot be deleted');
end $$;
update rewards.rules set active = false where program_key = 'daily';
select tests.ok(not (select active from rewards.rules where program_key = 'daily'), 'a rule can be deactivated');

-- privileges ------------------------------------------------------------------------------------------------------
create temp table priv as
select r.role_name, f.sig, has_function_privilege(r.role_name, f.sig, 'EXECUTE') as can
from (values ('anon'), ('authenticated'), ('service_role')) r(role_name),
     (values ('public.rewards_state()'), ('public.rewards_track(text,text,jsonb,text)'), ('public.rewards_offer_claim(text)'),
             ('public.rewards_social_start(text,text)'), ('public.rewards_mark_seen(uuid[])'),
             ('public.rewards_svc_track(uuid,text,text,jsonb)'), ('public.rewards_svc_claim_grants(integer)'),
             ('public.rewards_svc_finish_grant(uuid,uuid,text,text,bigint)'), ('public.rewards_svc_verify_social(text,text,text,text)'),
             ('public.rewards_svc_delete_user(uuid)'), ('public.rewards_svc_review_social(uuid,boolean)')) f(sig);
select tests.ok(not exists (select 1 from priv where role_name = 'anon' and can), 'anon can call no rewards function');
select tests.ok((select bool_and(can) from priv where role_name = 'authenticated' and sig not like '%svc%'),
                'authenticated can call the five client RPCs');
select tests.ok(not exists (select 1 from priv where role_name = 'authenticated' and sig like '%svc%' and can),
                'authenticated cannot call any rewards_svc function');
select tests.ok((select bool_and(can) from priv where role_name = 'service_role' and sig like '%svc%'),
                'service_role can call the rewards_svc functions');
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('rewards', 'rewards_app')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or has_function_privilege('service_role', p.oid, 'EXECUTE'))), 'no API role can execute anything in rewards / rewards_app');
select tests.ok(not exists (
  select 1 from pg_tables t where t.schemaname = 'rewards'
     and (has_table_privilege('authenticated', t.schemaname || '.' || t.tablename, 'SELECT')
          or has_table_privilege('anon', t.schemaname || '.' || t.tablename, 'SELECT'))), 'no API role can read rewards tables');

-- signed out
do $$ begin
  perform tests.act_as('authenticated', null);
  perform public.rewards_state();
  raise exception 'signed-out state accepted';
exception when sqlstate '42501' then perform tests.ok(true, 'rewards_state needs a signed-in user');
end $$;
reset role;

rollback;
