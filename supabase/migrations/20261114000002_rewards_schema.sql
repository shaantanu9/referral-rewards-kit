-- rewards engine migration 1: schema, tables, checks and the app hook (ADR 0002 sections 4, 5).
-- Separate from schema `referral`: nothing in the referral flow changes. One settings row per Supabase project.

create schema rewards;
create schema rewards_app;
revoke all on schema rewards, rewards_app from public;

-- Valid IANA name (or UTC). Used by checks and by the timezone the app sends.
create function rewards.valid_timezone(tz text) returns boolean
language sql stable set search_path = '' as $$
  select tz is not null and length(tz) <= 64 and exists (select 1 from pg_catalog.pg_timezone_names n where n.name = tz)
$$;

create table rewards.settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  daily_grant_cap int not null default 1000 check (daily_grant_cap >= 0),
  default_timezone text not null default 'UTC' check (rewards.valid_timezone(default_timezone)),
  max_attempts int not null default 8 check (max_attempts between 1 and 50),
  lease_minutes int not null default 15 check (lease_minutes between 1 and 120),
  social_window_days int not null default 7 check (social_window_days between 1 and 90),
  events_retention_days int not null default 90 check (events_retention_days between 1 and 3650)
);
insert into rewards.settings default values;

-- Event types: `client` ones the app may send with rewards_track, `server` ones only the service role or a trigger.
-- No reward may ever be tied to a store rating or review (Apple 5.6.3, Play), so such names are refused.
create table rewards.event_types (
  name text primary key check (name ~ '^[a-z][a-z0-9_]{1,39}$' and name !~ '(review|rating)'),
  source text not null check (source in ('client', 'server')),
  daily_limit int not null default 50 check (daily_limit between 1 and 10000)
);

create table rewards.programs (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  kind text not null check (kind in ('streak', 'milestone', 'social_tag', 'offer')),
  enabled boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  public jsonb not null default '{}' check (jsonb_typeof(public) = 'object'),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);

-- Per-kind config checks, and the kind never changes once a program exists.
create function rewards.check_program() returns trigger
language plpgsql set search_path = '' as $$
declare
  c jsonb := new.config;
begin
  if tg_op = 'UPDATE' and new.kind <> old.kind then
    raise exception 'rewards: a program''s kind cannot change (%)', new.key using errcode = '22023';
  end if;
  if new.kind in ('streak', 'milestone') then
    if not exists (select 1 from rewards.event_types t where t.name = c ->> 'event') then
      raise exception 'rewards: program % needs config.event naming a registered event type', new.key using errcode = '22023';
    end if;
    if new.kind = 'streak' and (coalesce(c ->> 'max_freezes', '0') !~ '^[0-9]{1,2}$'
                                or coalesce(c ->> 'auto_freeze', 'true') not in ('true', 'false')) then
      raise exception 'rewards: streak % needs max_freezes 0-99 and auto_freeze true/false', new.key using errcode = '22023';
    end if;
  elsif new.kind = 'offer' then
    if c ? 'window_minutes' and (c ->> 'window_minutes') !~ '^[1-9][0-9]{0,6}$' then
      raise exception 'rewards: offer % window_minutes must be a positive whole number', new.key using errcode = '22023';
    end if;
    if not c ? 'window_minutes' and new.ends_at is null then
      raise exception 'rewards: offer % needs window_minutes or an ends_at', new.key using errcode = '22023';
    end if;
    if coalesce(c ->> 'start_on', 'first_seen') <> 'first_seen'
       and not exists (select 1 from rewards.event_types t where t.name = c ->> 'start_on') then
      raise exception 'rewards: offer % start_on must be first_seen or a registered event type', new.key using errcode = '22023';
    end if;
    if c ? 'stock' and jsonb_typeof(c -> 'stock') <> 'null' and (c ->> 'stock') !~ '^[0-9]{1,9}$' then
      raise exception 'rewards: offer % stock must be null or a whole number', new.key using errcode = '22023';
    end if;
  elsif new.kind = 'social_tag' then
    if coalesce(c ->> 'platform', '') <> 'instagram' then
      raise exception 'rewards: social program % supports platform instagram only', new.key using errcode = '22023';
    end if;
    if coalesce(c ->> 'account', '') !~ '^[a-z0-9._]{1,30}$' then
      raise exception 'rewards: social program % needs config.account (lower case, no @)', new.key using errcode = '22023';
    end if;
    if coalesce(c ->> 'code_prefix', '') !~ '^[A-Z]{2,8}$' then
      raise exception 'rewards: social program % needs config.code_prefix of 2-8 capital letters', new.key using errcode = '22023';
    end if;
    if c ? 'repeat_days' and jsonb_typeof(c -> 'repeat_days') <> 'null' and (c ->> 'repeat_days') !~ '^[1-9][0-9]{0,3}$' then
      raise exception 'rewards: social program % repeat_days must be null or 1-9999', new.key using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
create trigger check_program before insert or update on rewards.programs
  for each row execute function rewards.check_program();

-- Rules are append-only: only `active` may change. To change a reward, insert version 2 and deactivate version 1.
-- The grant key is built from (program, threshold, kind, user, cycle), not the rule id, so a new version of the same
-- reward never pays a user twice (section 7).
create table rewards.rules (
  id uuid primary key default gen_random_uuid(),
  program_key text not null references rewards.programs (key),
  version int not null default 1 check (version >= 1),
  threshold int check (threshold is null or threshold >= 1),
  repeat text not null default 'once' check (repeat in ('once', 'each_cycle', 'every')),
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{1,39}$'),
  amount numeric not null check (amount > 0),
  params jsonb not null default '{}' check (jsonb_typeof(params) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index rules_program on rewards.rules (program_key) where active;

create function rewards.check_rule() returns trigger
language plpgsql set search_path = '' as $$
declare
  pk text;
begin
  if tg_op = 'DELETE' then
    raise exception 'rewards: rules are append-only; set active = false instead' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'active') <> (to_jsonb(old) - 'active') then
      raise exception 'rewards: rules are append-only; only active may change' using errcode = '22023';
    end if;
    return new;
  end if;
  select p.kind into pk from rewards.programs p where p.key = new.program_key;
  if pk in ('streak', 'milestone') and new.threshold is null then
    raise exception 'rewards: % rules need a threshold', pk using errcode = '22023';
  end if;
  if pk in ('offer', 'social_tag') and (new.threshold is not null or new.repeat <> 'once') then
    raise exception 'rewards: % rules take no threshold and repeat once', pk using errcode = '22023';
  end if;
  if new.repeat = 'each_cycle' and pk <> 'streak' then
    raise exception 'rewards: repeat each_cycle is for streaks only' using errcode = '22023';
  end if;
  if new.kind in ('entitlement_days', 'streak_freeze') and new.amount <> trunc(new.amount) then
    raise exception 'rewards: % amount must be a whole number', new.kind using errcode = '22023';
  end if;
  if new.kind = 'entitlement_days' and coalesce(new.params ->> 'entitlement_id', '') = '' then
    raise exception 'rewards: entitlement_days needs params.entitlement_id' using errcode = '22023';
  end if;
  if new.kind = 'badge' and coalesce(new.params ->> 'badge', '') !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'rewards: badge needs params.badge (lower case name)' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger check_rule before insert or update or delete on rewards.rules
  for each row execute function rewards.check_rule();

create table rewards.members (
  user_id uuid primary key,
  timezone text not null check (rewards.valid_timezone(timezone)),
  timezone_set_at timestamptz not null default now()
);

create table rewards.events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  type text not null references rewards.event_types (name),
  dedupe_key text not null check (length(dedupe_key) between 1 and 128),
  occurred_at timestamptz not null default now(),
  local_day date not null,
  props jsonb not null default '{}' check (jsonb_typeof(props) = 'object' and length(props::text) <= 2048),
  unique (user_id, type, dedupe_key)
);
create index events_user_type_time on rewards.events (user_id, type, occurred_at);
create index events_time on rewards.events (occurred_at);

create table rewards.streaks (
  user_id uuid not null,
  program_key text not null references rewards.programs (key),
  current int not null default 0 check (current >= 0),
  longest int not null default 0 check (longest >= 0),
  last_day date,
  cycle int not null default 1 check (cycle >= 1),
  freezes int not null default 0 check (freezes >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, program_key)
);

create table rewards.counters (
  user_id uuid not null,
  program_key text not null references rewards.programs (key),
  count int not null default 0 check (count >= 0),
  primary key (user_id, program_key)
);

-- A user's offer deadline is written once and never moves (section 6.4, 8).
create table rewards.offer_windows (
  user_id uuid not null,
  program_key text not null references rewards.programs (key),
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  claimed_at timestamptz,
  primary key (user_id, program_key),
  check (ends_at > started_at)
);
create index offer_windows_claimed on rewards.offer_windows (program_key) where claimed_at is not null;

create function rewards.check_offer_window() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.started_at <> old.started_at or new.ends_at <> old.ends_at or new.user_id <> old.user_id
     or new.program_key <> old.program_key then
    raise exception 'rewards: an offer deadline never changes' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger check_offer_window before update on rewards.offer_windows
  for each row execute function rewards.check_offer_window();

create table rewards.social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  program_key text not null references rewards.programs (key),
  cycle int not null check (cycle >= 1),
  platform text not null check (platform in ('instagram')),
  handle text not null check (handle ~ '^[a-z0-9._]{1,30}$'),
  code text not null unique check (code ~ '^[A-Z]{2,8}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$'),
  state text not null default 'pending' check (state in ('pending', 'verified', 'rejected', 'expired')),
  media_id text check (media_id is null or length(media_id) <= 64),
  verified_by text check (verified_by in ('webhook', 'review')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (user_id, program_key, cycle)
);
create index social_posts_pending on rewards.social_posts (platform, handle) where state = 'pending';
create unique index social_posts_media on rewards.social_posts (platform, media_id) where media_id is not null;

create table rewards.grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  program_key text not null references rewards.programs (key),
  rule_id uuid not null references rewards.rules (id),
  grant_key text not null unique,
  kind text not null,
  amount numeric not null,
  params jsonb not null default '{}',
  state text not null default 'queued'
    check (state in ('queued', 'granting', 'granted', 'failed_retryable', 'failed', 'cancelled', 'skipped_cap')),
  attempt_token uuid,
  attempts int not null default 0,
  last_error text,
  target_expires_at_ms bigint,
  granting_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  granted_at timestamptz,
  seen_at timestamptz
);
create index grants_user on rewards.grants (user_id, created_at desc);
create index grants_open on rewards.grants (state, created_at) where state in ('queued', 'granting', 'failed_retryable');
create index grants_created on rewards.grants (created_at);

create table rewards.badges (
  user_id uuid not null,
  badge text not null,
  program_key text not null references rewards.programs (key),
  grant_id uuid references rewards.grants (id),
  granted_at timestamptz not null default now(),
  primary key (user_id, badge)
);

-- The app hook for every reward kind the kit does not grant itself (section 5). Replace it in the app's config
-- migration with `create or replace`. MUST be idempotent on grant_id: it may run twice.
create function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'rewards: app_reward_grant is not implemented for kind %', kind;
end $$;

revoke all on all tables in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards_app from public, anon, authenticated, service_role;
