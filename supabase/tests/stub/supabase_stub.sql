-- Minimal stand-in for the parts of a Supabase database the kit relies on, so the migrations and tests run on a
-- plain local Postgres (scripts/test-db.sh). Never applied to a real project.
-- Mirrors: roles anon / authenticated / service_role / postgres (non-superuser owner), schemas auth / extensions /
-- vault, auth.uid() and auth.jwt() from request settings, pgcrypto in `extensions`, and Supabase's default grants on
-- new functions in `public` (the reason the kit revokes by name, ADR 13).

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role postgres login nosuperuser createrole;
grant anon, authenticated, service_role to postgres;
grant create, connect on database referral_test to postgres;
grant usage, create on schema public to postgres;

create schema extensions;
create extension pgcrypto with schema extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

-- auth ------------------------------------------------------------------------------------------------------------
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  phone_confirmed_at timestamptz,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant usage on schema auth to postgres, anon, authenticated, service_role;
grant execute on all functions in schema auth to postgres, anon, authenticated, service_role;
grant select on auth.users, auth.identities to postgres;

-- vault -----------------------------------------------------------------------------------------------------------
create schema vault;
create table vault.secrets (name text primary key, secret text not null);
create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
grant usage on schema vault to postgres;
grant select on vault.decrypted_secrets to postgres;
insert into vault.secrets values
  ('referral_pepper_v1', 'test-pepper-one-not-a-secret'),
  ('referral_pepper_v2', 'test-pepper-two-not-a-secret');

-- Supabase's default: new functions and tables in `public` are granted to the API roles. -----------------------------
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;

-- test helpers (not part of the kit) ------------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to public;
create function tests.ok(passed boolean, name text) returns void language plpgsql as $$
begin
  if passed is distinct from true then
    raise exception 'FAIL - %', name;
  end if;
  raise notice 'ok - %', name;
end $$;
create function tests.act_as(role_name text, user_id uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(user_id::text, ''), true);
  perform set_config('request.jwt.claims',
    case when user_id is null then '{}' else json_build_object('sub', user_id, 'role', role_name)::text end, true);
  execute format('set local role %I', role_name);
end $$;
grant execute on all functions in schema tests to public;
