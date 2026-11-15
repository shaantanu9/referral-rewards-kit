-- The per-app configuration step (supabase/app-config/template.sql), through its worked example
-- examples/reader-app/app_config.sql: applies on top of every kit migration, leaves nothing exposed, grants are
-- idempotent on the reward id, and an unknown reward kind raises.
\set ON_ERROR_STOP 1
begin;

-- The app's own objects, as an app would have them (its helpers revoked from the API roles).
set local role postgres;
create table public.reading_days (user_id uuid not null, day date not null default current_date, words_heard int not null default 0,
                                  primary key (user_id, day));
create table public.app_settings (credits_per_chapter int not null);
insert into public.app_settings values (33);
create table public.credit_ledger (idempotency_key text primary key, user_id uuid not null, credits int not null,
                                   bucket text not null, source text not null);
create function public.credit_grant(user_id uuid, credits int, bucket text, idempotency_key text, source text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.credit_ledger values (credit_grant.idempotency_key, credit_grant.user_id, credit_grant.credits,
                                           credit_grant.bucket, credit_grant.source)
  on conflict on constraint credit_ledger_pkey do nothing;
  return case when found then 'granted' else 'duplicate' end;
end $$;
revoke execute on function public.credit_grant(uuid, int, text, text, text) from public, anon, authenticated;
reset role;

\ir ../../examples/reader-app/app_config.sql

select tests.ok((select entitlement_id from referral.settings) = 'plus', 'entitlement id set');
select tests.ok((select count(*) from referral.rules where active and version = 1) = 3, 'three rules in set 1');
select tests.ok(referral.current_rule_set() = 1, 'rule set 1 is current');
select tests.ok(not exists (select 1 from referral.privacy_problems()), 'nothing exposed after the app config');
select tests.ok(not has_function_privilege('authenticated', 'referral_app.app_referral_grant(uuid,uuid,text,numeric,jsonb)', 'EXECUTE'),
  'authenticated cannot execute the grant hook');
select tests.ok(exists (select 1 from pg_trigger where tgname = 'referral_activation' and tgrelid = 'public.reading_days'::regclass),
  'activation trigger on the activity table');
select tests.ok(exists (select 1 from pg_trigger where tgname = 'referral_delete_user' and tgrelid = 'auth.users'::regclass),
  'account deletion trigger on auth.users');

-- The activity hook reads the app's table.
do $$
declare uid uuid := gen_random_uuid();
begin
  perform tests.ok(not referral_app.app_referral_is_active(uid), 'not active before listening');
  insert into public.reading_days (user_id, words_heard) values (uid, 0);
  perform tests.ok(not referral_app.app_referral_is_active(uid), 'a row with no words heard is not active');
  update public.reading_days set words_heard = 120 where user_id = uid;
  perform tests.ok(referral_app.app_referral_is_active(uid), 'active once words are heard');
end $$;

-- The grant hook credits chapters once per reward id.
do $$
declare rid uuid := gen_random_uuid(); uid uuid := gen_random_uuid();
begin
  perform referral_app.app_referral_grant(rid, uid, 'chapters', 4, '{}');
  perform referral_app.app_referral_grant(rid, uid, 'chapters', 4, '{}');
  perform tests.ok((select count(*) from public.credit_ledger where user_id = uid) = 1, 'a repeated grant is a no-op');
  perform tests.ok((select credits from public.credit_ledger where user_id = uid) = 132, '4 chapters x 33 credits');
  perform tests.ok((select idempotency_key from public.credit_ledger where user_id = uid) = 'referral:' || rid,
    'the reward id is the idempotency key');
  begin
    perform referral_app.app_referral_grant(gen_random_uuid(), uid, 'minutes', 30, '{}');
    perform tests.ok(false, 'an unknown kind must raise');
  exception when raise_exception then
    perform tests.ok(true, 'an unknown kind raises (the reward goes to failed, not silently granted)');
  end;
end $$;

rollback;
