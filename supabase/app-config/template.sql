-- referral-kit: the app's own configuration. Copy this file into the APP's supabase/migrations/ as the migration
-- right after the kit's (e.g. <timestamp>_referral_<app>.sql), replace every <<...>> and delete the parts you do not
-- use. It is the only SQL an app writes; the kit's migrations are copied unchanged.
-- Worked, tested example: examples/reader-app/app_config.sql (supabase/tests/12_app_config.test.sql applies it).
-- Guide: docs/integration.md, step 4.
--
-- BEFORE APPLYING (the deployed database is the truth, not the repo):
--   * read the live definition of every app function a hook calls, e.g.
--       select pg_get_functiondef('public.<<credit_fn>>(<<arg types>>)'::regprocedure);
--   * run supabase/probes/function_grants.sql and fix every 'kit_exposed' row first;
--   * try the whole file in a transaction you roll back.

-- 1. Settings ---------------------------------------------------------------------------------------------------------
-- entitlement_id: the RevenueCat entitlement whose purchase counts as "paid" (its lookup key, e.g. 'premium').
-- Leave the other settings at the ADR defaults unless the owner decided otherwise (integration guide, step 4).
update referral.settings set entitlement_id = '<<entitlement lookup key>>';
-- update referral.settings set claim_window_days = 7, hold_hours = 72, paid_enabled = true;

-- 2. Rules (append-only: to change a reward later, insert version 2 and deactivate version 1) ------------------------
-- kind: 'entitlement_days' (granted through RevenueCat by the Edge Function) or any kind your grant hook handles.
-- Delete the friend row for "sharer only"; delete the paid row if the app has no subscription.
insert into referral.rules (version, event, who, kind, amount, params) values
  (1, 'joined', 'sharer', '<<kind>>', <<amount>>, '{}'),
  (1, 'joined', 'friend', '<<kind>>', <<amount>>, '{}'),
  (1, 'paid',   'sharer', 'entitlement_days', <<days>>, '{"entitlement_id":"<<entitlement lookup key>>"}');

-- 3. The three hooks (schema referral_app, never public: a function in public is callable by every signed-in user) --
-- In PL/pgSQL a column named like a parameter (user_id, reward_id) is ambiguous: qualify it with the function name.

-- When has the friend really started using the app? Read the app's own table.
create or replace function referral_app.app_referral_is_active(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.<<activity table>> a where a.user_id = app_referral_is_active.user_id)
$$;

-- Every reward kind except entitlement_days. MUST be idempotent on reward_id (it may run twice): pass the reward id
-- as the credit function's idempotency key, or insert with `on conflict do nothing`. Keep referral credit apart from
-- bought credit if the app's refill/expiry logic treats buckets differently.
create or replace function referral_app.app_referral_grant(reward_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if kind <> '<<kind>>' then
    raise exception 'referral: no reward kind % in this app', kind;
  end if;
  if amount is null or amount <= 0 or amount <> trunc(amount) then
    raise exception 'referral: % must be a whole positive number, got %', kind, amount;
  end if;
  perform public.<<credit_fn>>(app_referral_grant.user_id, amount::int, 'referral:' || reward_id::text);
end $$;

-- false below minimum_age, from the app's own declared age or age range. `select true` when the app asks no age
-- (the stores' age ratings apply): keep it explicit so the choice is visible.
create or replace function referral_app.app_referral_age_ok(user_id uuid, minimum_age int) returns boolean
language sql stable security definer set search_path = '' as $$ select true $$;

-- Postgres gives PUBLIC EXECUTE to every new function; create or replace keeps the kit's revokes, but revoke by name
-- anyway so this file is safe on its own.
revoke execute on function referral_app.app_referral_is_active(uuid),
  referral_app.app_referral_grant(uuid, uuid, text, numeric, jsonb),
  referral_app.app_referral_age_ok(uuid, int) from public, anon, authenticated, service_role;

-- 4. Triggers -----------------------------------------------------------------------------------------------------------
-- Join the moment the friend becomes active (otherwise the worker checks every 15 minutes).
drop trigger if exists referral_activation on public.<<activity table>>;
create trigger referral_activation after insert on public.<<activity table>>
  for each row execute function referral.activation_trigger('user_id');

-- Account deletion (ADR 9): the referral rows become pseudonymous tombstones. Or call referral.delete_user(uid)
-- from the app's own deletion path instead.
drop trigger if exists referral_delete_user on auth.users;
create trigger referral_delete_user before delete on auth.users
  for each row execute function referral.on_auth_user_deleted();

-- 5. Self-check: the migration fails (and rolls back) if anything is exposed or missing --------------------------------
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
