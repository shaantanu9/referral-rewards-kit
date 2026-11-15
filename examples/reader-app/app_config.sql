-- Example app configuration for a comic-reader app (supabase/app-config/template.sql, filled in). Not part of the
-- kit (ADR 2: app seeds live in examples/): an app copies the template, not this file. It follows the first app's
-- real config (2026-11-12): rewards in chapters credited through the app's own credit function, Plus days
-- through RevenueCat. Tested: supabase/tests/12_app_config.test.sql applies it on top of every kit migration.
--
-- The app's own objects it relies on (adjust to the app's schema):
--   public.reading_days(user_id uuid, words_heard int)    one row per user and day of listening
--   public.credit_grant(user_id uuid, credits int, bucket text, idempotency_key text, source text) returns text
--                                                          the app's ledger; a repeated key is a no-op
--   public.app_settings(credits_per_chapter int)           one row

-- 1. Settings: "paid" means a purchase of the `plus` entitlement.
update referral.settings set entitlement_id = 'plus';

-- 2. Rules: 4 chapters for both when a friend starts listening; 5 days of Plus for the sharer when the friend subscribes.
insert into referral.rules (version, event, who, kind, amount, params) values
  (1, 'joined', 'sharer', 'chapters', 4, '{}'),
  (1, 'joined', 'friend', 'chapters', 4, '{}'),
  (1, 'paid',   'sharer', 'entitlement_days', 5, '{"entitlement_id":"plus"}');

-- 3. Hooks.
-- Active = the friend has heard words read aloud on some day.
create or replace function referral_app.app_referral_is_active(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reading_days d
                 where d.user_id = app_referral_is_active.user_id and d.words_heard > 0)
$$;

-- Chapters into the reader's kept balance. Bucket 'purchased' (never expires, not reset by a monthly refill); the
-- reward id is the idempotency key, so a retried grant is a no-op.
create or replace function referral_app.app_referral_grant(reward_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  per int;
begin
  if kind <> 'chapters' then
    raise exception 'referral: no reward kind % in this app', kind;
  end if;
  if amount is null or amount <= 0 or amount <> trunc(amount) then
    raise exception 'referral: chapters must be a whole positive number, got %', amount;
  end if;
  select s.credits_per_chapter into per from public.app_settings s;
  perform public.credit_grant(app_referral_grant.user_id, (amount * coalesce(per, 33))::int, 'purchased',
                              'referral:' || reward_id::text, 'referral');
end $$;

-- The app asks no age; the stores' age ratings apply.
create or replace function referral_app.app_referral_age_ok(user_id uuid, minimum_age int) returns boolean
language sql stable security definer set search_path = '' as $$ select true $$;

revoke execute on function referral_app.app_referral_is_active(uuid),
  referral_app.app_referral_grant(uuid, uuid, text, numeric, jsonb),
  referral_app.app_referral_age_ok(uuid, int) from public, anon, authenticated, service_role;

-- 4. Triggers.
drop trigger if exists referral_activation on public.reading_days;
create trigger referral_activation after insert or update of words_heard on public.reading_days
  for each row execute function referral.activation_trigger('user_id');

drop trigger if exists referral_delete_user on auth.users;
create trigger referral_delete_user before delete on auth.users
  for each row execute function referral.on_auth_user_deleted();

-- 5. Self-check: fails (and rolls back) if anything is exposed or missing.
do $$
declare
  problems text;
begin
  select string_agg(problem || ' ' || coalesce(role_name, '') || ' ' || object_name, '; ') into problems
  from referral.privacy_problems();
  if problems is not null then raise exception 'referral config: privacy problems: %', problems; end if;
  if referral.current_rule_set() is null then raise exception 'referral config: no active rule set'; end if;
  if exists (select 1 from referral.rules where active and event = 'paid')
     and (select entitlement_id from referral.settings) is null then
    raise exception 'referral config: a paid rule needs referral.settings.entitlement_id';
  end if;
end $$;
