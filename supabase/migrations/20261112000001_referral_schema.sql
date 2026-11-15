-- referral-kit migration 1: schemas, tables, settings, privileges and hashing helpers.
-- Design: docs/adr/0001-referral-kit.md (section 5 data model, 9 pepper, 13 security).
-- Runs as the database owner role (`postgres` on Supabase). Creates no function callable by the API roles: the RPC
-- wrappers come in later migrations, each with its own grants and privilege tests.

create schema if not exists referral;
create schema if not exists referral_app; -- the app's hooks (ADR 13); never exposed through PostgREST

-- No API role may use either schema. Without USAGE, a function inside is unreachable even if a revoke is missed.
revoke all on schema referral, referral_app from public;
revoke all on schema referral, referral_app from anon, authenticated, service_role;

-- Note: Postgres gives PUBLIC EXECUTE on every new function, and a per-schema `alter default privileges ... revoke`
-- cannot remove that (per-schema defaults only add to the global ones; checked on Postgres 17). Changing the global
-- default would change the whole app's database, so the kit does not. Protection is instead:
--   1. no API role has USAGE on `referral` or `referral_app`, so nothing inside is reachable even with EXECUTE;
--   2. every kit migration ends with an explicit revoke of everything it created;
--   3. the integration guide's hook template revokes EXECUTE by name;
--   4. referral.privacy_problems() (below) reports any exposure, the worker sweep alerts on it, and CI asserts it is empty.

-- settings ---------------------------------------------------------------------------------------------------------
create table referral.settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  paid_enabled boolean not null default true,
  hold_hours int not null default 72 check (hold_hours >= 0),
  claim_window_days int not null default 7 check (claim_window_days > 0),
  activate_window_days int not null default 30 check (activate_window_days > 0),
  paid_window_days int not null default 90 check (paid_window_days > 0),
  joined_delay_hours int not null default 0 check (joined_delay_hours >= 0),
  max_attempts int not null default 8 check (max_attempts > 0),
  granting_lease_minutes int not null default 15 check (granting_lease_minutes > 0),
  worker_batch int not null default 20 check (worker_batch > 0),
  worker_time_budget_seconds int not null default 100 check (worker_time_budget_seconds > 0),
  sharer_joins_per_30d int not null default 10 check (sharer_joins_per_30d >= 0),
  sharer_paid_per_365d int not null default 6 check (sharer_paid_per_365d >= 0),
  daily_grant_cap int not null default 500 check (daily_grant_cap >= 0),
  abuse_threshold int not null default 3 check (abuse_threshold > 0),
  pepper_version int not null default 1,
  pepper_versions_active int[] not null default '{1}',
  events_retention_days int not null default 30 check (events_retention_days > 0),
  stats_floor int not null default 3 check (stats_floor >= 1),
  minimum_age int not null default 13 check (minimum_age between 0 and 21),
  allow_sandbox boolean not null default false,
  entitlement_id text, -- the entitlement whose purchase counts as `paid`; set by the app's seed
  updated_at timestamptz not null default now(),
  constraint pepper_version_is_active check (pepper_version = any (pepper_versions_active))
);
insert into referral.settings default values;
comment on table referral.settings is 'One row per project (ADR 5). No secrets: RevenueCat ids and keys live in the function environment.';

-- codes ------------------------------------------------------------------------------------------------------------
-- Alphabet without O, 0, I, 1, L (ADR 11.7): 23 letters + 8 digits.
create table referral.codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  code text not null unique check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$'),
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);
create unique index codes_one_active_per_user on referral.codes (user_id) where disabled_at is null;

create table referral.retired_codes (
  code text primary key,
  retired_at timestamptz not null default now()
);

-- members, abuse ---------------------------------------------------------------------------------------------------
create table referral.members (
  user_id uuid primary key,
  eligible_from timestamptz,
  deleted_at timestamptz
);

create table referral.abuse_marks (
  user_id uuid not null,
  event_id text not null,
  cause text not null check (cause in ('late_refund', 'intro_refund', 'transfer_in')),
  points int not null default 1 check (points > 0),
  created_at timestamptz not null default now(),
  primary key (user_id, event_id, cause)
);

-- store subscriptions seen in webhooks -----------------------------------------------------------------------------
create table referral.transactions (
  original_transaction_id_hash bytea primary key,
  pepper_version int not null,
  first_purchased_at_ms bigint,
  started_at_source text check (started_at_source in ('initial_purchase', 'api_starts_at')),
  transaction_ids_seen bytea[] not null default '{}',
  product_id text,
  store text,
  environment text,
  refunded_at timestamptz,
  refund_state_ms bigint,
  created_at timestamptz not null default now(),
  constraint start_known_with_source check ((first_purchased_at_ms is null) = (started_at_source is null))
);

-- installs ---------------------------------------------------------------------------------------------------------
create table referral.installs (
  install_id_hash bytea not null,
  pepper_version int not null,
  user_id uuid not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (install_id_hash, user_id)
);
create index installs_by_user on referral.installs (user_id);

-- rules (append-only) ----------------------------------------------------------------------------------------------
create table referral.rules (
  id uuid primary key default gen_random_uuid(),
  version int not null check (version > 0), -- the rule set; a referral is paid by the set current at its claim
  event text not null check (event in ('joined', 'paid')),
  who text not null check (who in ('sharer', 'friend')),
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  amount numeric not null check (amount > 0),
  params jsonb not null default '{}' check (jsonb_typeof(params) = 'object'),
  active boolean not null default true,
  valid_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint entitlement_days_are_whole check (kind <> 'entitlement_days' or amount = trunc(amount))
);
create index rules_by_version on referral.rules (version);

create function referral.rules_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'referral.rules is append-only: deactivate a rule instead of deleting it';
  end if;
  if (new.id, new.version, new.event, new.who, new.kind, new.amount, new.params, new.valid_from, new.created_at)
     is distinct from
     (old.id, old.version, old.event, old.who, old.kind, old.amount, old.params, old.valid_from, old.created_at) then
    raise exception 'referral.rules is append-only: only `active` may change; add a new rule set version instead';
  end if;
  return new;
end $$;
create trigger rules_append_only before update or delete on referral.rules
  for each row execute function referral.rules_append_only();

-- referrals --------------------------------------------------------------------------------------------------------
create table referral.referrals (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  sharer_id uuid,
  friend_id uuid unique, -- null after the friend deletes their account (ADR 9); many nulls allowed
  state text not null default 'claimed' check (state in
    ('claimed', 'joined', 'paid', 'paid_cancelled', 'expired', 'refunded_late', 'void')),
  rule_set_version int not null,
  claim_install_hash bytea,
  pepper_version int,
  claimed_at timestamptz not null default now(),
  joined_at timestamptz,
  paid_at timestamptz,
  original_transaction_id_hash bytea unique references referral.transactions (original_transaction_id_hash),
  friend_deleted_at timestamptz,
  constraint not_self check (sharer_id is distinct from friend_id or sharer_id is null),
  constraint install_hash_versioned check ((claim_install_hash is null) = (pepper_version is null))
);
create index referrals_by_sharer on referral.referrals (sharer_id);
create index referrals_by_claim_install on referral.referrals (claim_install_hash);

-- rewards ----------------------------------------------------------------------------------------------------------
create table referral.rewards (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references referral.referrals (id),
  user_id uuid, -- null after the recipient deletes their account
  who text not null check (who in ('sharer', 'friend')),
  event text not null check (event in ('joined', 'paid')),
  rule_id uuid not null references referral.rules (id),
  kind text not null,
  amount numeric not null check (amount > 0),
  params jsonb not null default '{}',
  grant_key text, -- e.g. entitlement:premium; null for kinds granted by the app hook
  state text not null default 'queued' check (state in
    ('queued', 'granting', 'granted', 'banked', 'cancelled', 'skipped_cap', 'void_fraud', 'failed_retryable', 'failed')),
  available_at timestamptz not null default now(),
  target_expires_at timestamptz,
  granting_started_at timestamptz,
  attempt_token uuid,
  attempts int not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (referral_id, who, event, rule_id),
  constraint granting_has_lease check (
    state <> 'granting' or (attempt_token is not null and granting_started_at is not null)),
  constraint entitlement_has_key check (kind <> 'entitlement_days' or grant_key is not null)
);
-- One unfinished grant per user and entitlement at a time (ADR 6.4).
create unique index rewards_one_unfinished_grant on referral.rewards (user_id, grant_key)
  where state in ('granting', 'failed_retryable') and grant_key is not null;
create index rewards_due on referral.rewards (available_at) where state in ('queued', 'failed_retryable');
create index rewards_by_user on referral.rewards (user_id, event, created_at);

create table referral.reward_seen (
  reward_id uuid not null references referral.rewards (id) on delete cascade,
  install_id_hash bytea not null,
  pepper_version int not null,
  seen_at timestamptz not null default now(),
  primary key (reward_id, install_id_hash)
);

-- webhook events ---------------------------------------------------------------------------------------------------
create table referral.events (
  event_id text primary key,
  type text not null,
  state text not null default 'received' check (state in ('received', 'processed', 'ignored', 'failed')),
  fields jsonb not null check (jsonb_typeof(fields) = 'object' and not (fields ? 'subscriber_attributes')),
  event_timestamp_ms bigint not null,
  attempts int not null default 0,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index events_pending on referral.events (received_at) where state in ('received', 'failed');

-- tombstones -------------------------------------------------------------------------------------------------------
create table referral.tombstones (
  kind text not null check (kind in ('install', 'transaction')),
  value_hash bytea not null,
  pepper_version int not null,
  created_at timestamptz not null default now(),
  primary key (kind, value_hash)
);

-- Defence in depth: RLS on with no policies, so even a mistaken grant exposes no row to an API role.
alter table referral.settings enable row level security;
alter table referral.codes enable row level security;
alter table referral.retired_codes enable row level security;
alter table referral.members enable row level security;
alter table referral.abuse_marks enable row level security;
alter table referral.transactions enable row level security;
alter table referral.installs enable row level security;
alter table referral.rules enable row level security;
alter table referral.referrals enable row level security;
alter table referral.rewards enable row level security;
alter table referral.reward_seen enable row level security;
alter table referral.events enable row level security;
alter table referral.tombstones enable row level security;

-- helpers ----------------------------------------------------------------------------------------------------------
create function referral.settings() returns referral.settings
language sql stable security definer set search_path = '' as $$
  select s from referral.settings s where s.id
$$;

-- Pepper by version from Vault (`referral_pepper_v<N>`, ADR 9). Raises when missing, so nothing is ever hashed
-- with an empty key.
create function referral.pepper(version int) returns bytea
language plpgsql stable security definer set search_path = '' as $$
declare
  p text;
begin
  select ds.decrypted_secret into p from vault.decrypted_secrets ds where ds.name = 'referral_pepper_v' || version;
  if p is null or length(p) < 16 then
    raise exception 'referral: Vault secret referral_pepper_v% is missing or shorter than 16 characters', version;
  end if;
  return convert_to(p, 'UTF8');
end $$;

create function referral.hmac(value text, version int) returns bytea
language sql stable security definer set search_path = '' as $$
  select extensions.hmac(convert_to(value, 'UTF8'), referral.pepper(version), 'sha256')
$$;

-- Hash for a new row: (hash, version) under settings.pepper_version.
create function referral.hash_new(value text, out value_hash bytea, out pepper_version int)
language sql stable security definer set search_path = '' as $$
  select referral.hmac(value, s.pepper_version), s.pepper_version from referral.settings s where s.id
$$;

-- Every hash the value can have under the active pepper versions, for lookups.
create function referral.hashes_active(value text) returns bytea[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(referral.hmac(value, v) order by v), '{}')
  from referral.settings s, unnest(s.pepper_versions_active) v
  where s.id
$$;

-- The rule set a new claim is promised: the highest version that still has an active rule.
create function referral.current_rule_set() returns int
language sql stable security definer set search_path = '' as $$
  select max(r.version) from referral.rules r where r.active and r.valid_from <= now()
$$;

-- Every way an API role could reach kit data or hooks, as rows (empty = private). Read by the worker sweep (alert)
-- and by CI. A role reaches a function only with both USAGE on its schema and EXECUTE on it.
create function referral.privacy_problems() returns table (problem text, role_name text, object_name text)
language sql stable security definer set search_path = '' as $$
  with api(r) as (values ('anon'), ('authenticated'), ('service_role'))
  select 'schema usage', api.r, s.nspname::text
  from api, pg_catalog.pg_namespace s
  where s.nspname in ('referral', 'referral_app') and pg_catalog.has_schema_privilege(api.r, s.oid, 'USAGE')
  union all
  select 'table access', api.r, t.schemaname || '.' || t.tablename
  from api, pg_catalog.pg_tables t
  where t.schemaname = 'referral'
    and pg_catalog.has_table_privilege(api.r, (t.schemaname || '.' || t.tablename)::regclass,
                                       'SELECT,INSERT,UPDATE,DELETE')
  union all
  select 'function reachable', api.r, n.nspname || '.' || p.proname
  from api, pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('referral', 'referral_app')
    and pg_catalog.has_schema_privilege(api.r, n.oid, 'USAGE')
    and pg_catalog.has_function_privilege(api.r, p.oid, 'EXECUTE')
  union all
  select 'definer without search_path', null, n.nspname || '.' || p.proname
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('referral', 'referral_app') and p.prosecdef
    and not coalesce(p.proconfig @> array['search_path=""'], false)
$$;

-- Explicit revokes for everything this migration created (defaults cannot do it, see the note at the top).
revoke all on all tables in schema referral from public, anon, authenticated, service_role;
revoke all on all sequences in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral from public, anon, authenticated, service_role;
