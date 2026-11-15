-- rewards engine 0.6: opt-in weekly leagues (ADR 0002 section 18.10, roadmap #17). A `league` program puts members
-- who joined into small weekly groups, ranks them by a score from their own events, pays the best place they reached
-- through ordinary rules and moves tiers at the weekly close. Opt-in only, no shame, nothing private shown: other
-- members appear only by the app's display name hook, never by id.

-- The kind: added to the existing list (read from the live constraint, so kinds added by other migrations are kept).
do $$
declare
  d text;
  kinds text[];
begin
  select pg_get_constraintdef(c.oid) into d from pg_constraint c
   where c.conrelid = 'rewards.programs'::regclass and c.conname = 'programs_kind_check';
  kinds := array(select m[1] from regexp_matches(coalesce(d, ''), '''([a-z_]+)''', 'g') m);
  if cardinality(kinds) = 0 then raise exception 'rewards: could not read programs_kind_check'; end if;
  if 'league' = any(kinds) then return; end if;
  alter table rewards.programs drop constraint programs_kind_check;
  execute format('alter table rewards.programs add constraint programs_kind_check check (kind in (%s))',
                 (select string_agg(quote_literal(k), ', ') from unnest(kinds || array['league']) k));
end $$;

-- Tables -------------------------------------------------------------------------------------------------------------

-- Who opted in. Leaving sets left_at (the tier is kept for a later join); deletion removes the row.
create table rewards.league_members (
  program_key text not null references rewards.programs (key),
  user_id uuid not null,
  tier int not null default 0 check (tier between 0 and 9),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (program_key, user_id)
);
create index league_members_user on rewards.league_members (user_id);

-- One small group of one tier for one week (week = the local start day in settings.default_timezone).
create table rewards.league_groups (
  id uuid primary key default gen_random_uuid(),
  program_key text not null references rewards.programs (key),
  week date not null,
  tier int not null default 0 check (tier between 0 and 9),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index league_groups_open on rewards.league_groups (program_key, week, tier, created_at) where closed_at is null;
create index league_groups_week on rewards.league_groups (program_key, week);

-- A member's place in one week's group; the final_* columns are written once, at the weekly close.
create table rewards.league_entries (
  group_id uuid not null references rewards.league_groups (id) on delete cascade,
  program_key text not null references rewards.programs (key),
  week date not null,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  final_score int,
  final_rank int,
  tier_change smallint check (tier_change between -1 and 1),
  grant_ids uuid[] not null default '{}',
  primary key (program_key, week, user_id)
);
create index league_entries_group on rewards.league_entries (group_id);
create index league_entries_user on rewards.league_entries (user_id);

-- Config checks ----------------------------------------------------------------------------------------------------

create function rewards.check_league() returns trigger
language plpgsql set search_path = '' as $$
declare
  c jsonb := new.config;
  promote int;
  demote int;
begin
  if new.kind <> 'league' then return new; end if;
  if not exists (select 1 from rewards.event_types x where x.name = c ->> 'event') then
    raise exception 'rewards: league % needs config.event naming a registered event type', new.key using errcode = '22023';
  end if;
  if coalesce(c ->> 'score', 'events') !~ '^(events|prop:[a-z_][a-z0-9_]{0,39})$'
     or coalesce(c ->> 'max_points_per_event', '100') !~ '^([1-9][0-9]{0,3}|10000)$'
     or coalesce(c ->> 'group_size', '20') !~ '^([5-9]|[1-4][0-9]|50)$'
     or coalesce(c ->> 'week_start', '1') !~ '^[1-7]$'
     or coalesce(c ->> 'promote', '0') !~ '^[0-9]{1,2}$'
     or coalesce(c ->> 'demote', '0') !~ '^[0-9]{1,2}$'
     or coalesce(c ->> 'min_score', '1') !~ '^[1-9][0-9]{0,5}$' then
    raise exception 'rewards: league % config: score events or prop:<name>, max_points_per_event 1-10000, group_size 5-50, week_start 1-7, promote, demote, min_score >= 1', new.key
      using errcode = '22023';
  end if;
  if c ? 'tiers' and (jsonb_typeof(c -> 'tiers') <> 'array' or jsonb_array_length(c -> 'tiers') not between 1 and 10
     or exists (select 1 from jsonb_array_elements(c -> 'tiers') t
                 where jsonb_typeof(t) <> 'string' or length(btrim(t #>> '{}')) not between 1 and 30)) then
    raise exception 'rewards: league % tiers must be 1-10 names (1-30 characters), lowest first', new.key using errcode = '22023';
  end if;
  promote := coalesce((c ->> 'promote')::int, 0);
  demote := coalesce((c ->> 'demote')::int, 0);
  if promote + demote >= coalesce((c ->> 'group_size')::int, 20) then
    raise exception 'rewards: league % promote + demote must be smaller than group_size', new.key using errcode = '22023';
  end if;
  if (promote > 0 or demote > 0) and coalesce(jsonb_array_length(c -> 'tiers'), 1) < 2 then
    raise exception 'rewards: league % moves members between tiers, so it needs at least two tiers', new.key using errcode = '22023';
  end if;
  return new;
end $$;
create trigger check_league before insert or update on rewards.programs
  for each row execute function rewards.check_league();

create function rewards.check_rule_league() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from rewards.programs p where p.key = new.program_key and p.kind = 'league')
     and (new.threshold is null or new.threshold < 1 or new.repeat <> 'once') then
    raise exception 'rewards: league rules need a threshold (a place: 1 = first, 3 = top 3) and repeat once' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger check_rule_league before insert on rewards.rules
  for each row execute function rewards.check_rule_league();

-- Helpers ----------------------------------------------------------------------------------------------------------

-- The week a moment falls in: its start day, at local midnight in settings.default_timezone, on config.week_start.
create function rewards.league_week(p rewards.programs, at timestamptz) returns date
language sql stable security definer set search_path = '' as $$
  select x.d - ((extract(isodow from x.d)::int - coalesce((p.config ->> 'week_start')::int, 1) + 7) % 7)
    from (select (at at time zone (select s.default_timezone from rewards.settings s where s.id))::date d) x
$$;

create function rewards.league_start(wk date) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select wk::timestamp at time zone (select s.default_timezone from rewards.settings s where s.id)
$$;

create function rewards.league_tiers(p rewards.programs) returns int
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p.config -> 'tiers') = 'array' then jsonb_array_length(p.config -> 'tiers') else 1 end
$$;

create function rewards.league_program(program text) returns rewards.programs
language plpgsql stable security definer set search_path = '' as $$
declare
  p rewards.programs;
begin
  select * into p from rewards.programs x where x.key = program and x.kind = 'league';
  if p.key is null then raise exception 'rewards: unknown_program' using errcode = '22023'; end if;
  return p;
end $$;

-- A member's display name from the app's hook; an error or an empty name is null (the app shows its own word).
create function rewards.league_name(uid uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  n text;
begin
  n := nullif(btrim(rewards_app.app_display_name(uid)), '');
  return left(n, 40);
exception when others then
  raise warning 'rewards: app_display_name failed: %', sqlerrm;
  return null;
end $$;

-- A member's score between two moments: matching events (1 each), or the sum of a numeric prop capped per event.
create function rewards.league_score(p rewards.programs, uid uuid, from_ts timestamptz, to_ts timestamptz) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(floor(sum(
           case when coalesce(p.config ->> 'score', 'events') = 'events' then 1
                else least(greatest(coalesce(rewards.to_num(e.props -> substr(p.config ->> 'score', 6)), 0), 0),
                           coalesce((p.config ->> 'max_points_per_event')::numeric, 100)) end)), 0)::int
    from rewards.events e
   where e.user_id = uid and e.type = p.config ->> 'event' and e.occurred_at >= from_ts and e.occurred_at < to_ts
     and rewards.matches(p.config -> 'where', e.props, e.occurred_at, rewards.member_tz(uid))
$$;

-- One group's board: score from each member's placement to the week's end; `place` ranks everyone, `rank` only those
-- with at least min_score (ties share a place).
create function rewards.league_board(p rewards.programs, gid uuid)
returns table (user_id uuid, joined_at timestamptz, score int, place int, rank int)
language sql stable security definer set search_path = '' as $$
  with s as (
    select e.user_id, e.joined_at,
           rewards.league_score(p, e.user_id, e.joined_at, rewards.league_start(e.week + 7)) score
      from rewards.league_entries e where e.group_id = gid)
  select s.user_id, s.joined_at, s.score,
         (rank() over (order by s.score desc))::int,
         case when s.score >= coalesce((p.config ->> 'min_score')::int, 1) then (rank() over (order by s.score desc))::int end
    from s
$$;

-- Places a member in a group of their tier for week `wk` (or returns the one they are in): the oldest group with
-- room, else a new one. An advisory lock per program and week keeps a group from overfilling.
create function rewards.league_place(uid uuid, p rewards.programs, wk date) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  g uuid;
  t int;
  size int := coalesce((p.config ->> 'group_size')::int, 20);
begin
  select e.group_id into g from rewards.league_entries e where e.program_key = p.key and e.week = wk and e.user_id = uid;
  if g is not null then return g; end if;
  perform pg_advisory_xact_lock(hashtext('rewards.league:' || p.key || ':' || wk::text));
  select e.group_id into g from rewards.league_entries e where e.program_key = p.key and e.week = wk and e.user_id = uid;
  if g is not null then return g; end if;
  select least(m.tier, rewards.league_tiers(p) - 1) into t from rewards.league_members m
   where m.program_key = p.key and m.user_id = uid;
  t := coalesce(t, 0);
  select x.id into g from rewards.league_groups x
   where x.program_key = p.key and x.week = wk and x.tier = t and x.closed_at is null
     and (select count(*) from rewards.league_entries e where e.group_id = x.id) < size
   order by x.created_at, x.id limit 1;
  if g is null then
    insert into rewards.league_groups (program_key, week, tier) values (p.key, wk, t) returning id into g;
  end if;
  insert into rewards.league_entries (group_id, program_key, week, user_id) values (g, p.key, wk, uid);
  return g;
end $$;

-- Placement on a member's first matching event of the week (a trigger, so rewards.track is unchanged). An error is a
-- warning: tracking never fails because of a league.
create function rewards.league_on_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p rewards.programs;
begin
  for p in select * from rewards.programs x where x.kind = 'league' and x.config ->> 'event' = new.type loop
    if not rewards.is_live(p) then continue; end if;
    if not exists (select 1 from rewards.league_members m
                    where m.program_key = p.key and m.user_id = new.user_id and m.left_at is null) then
      continue;
    end if;
    if not rewards.matches(p.config -> 'where', new.props, new.occurred_at, rewards.member_tz(new.user_id)) then continue; end if;
    perform rewards.league_place(new.user_id, p, rewards.league_week(p, new.occurred_at));
  end loop;
  return null;
exception when others then
  raise warning 'rewards: league placement failed: %', sqlerrm;
  return null;
end $$;
create trigger league_on_event after insert on rewards.events
  for each row execute function rewards.league_on_event();

-- The weekly close --------------------------------------------------------------------------------------------------

-- Closes one ended group: final scores and ranks, the best tier of rewards each ranked member reached, tier moves.
create function rewards.league_close_group(p rewards.programs, g rewards.league_groups) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  b record;
  n int;
  promote int := coalesce((p.config ->> 'promote')::int, 0);
  demote int := coalesce((p.config ->> 'demote')::int, 0);
  top int := rewards.league_tiers(p) - 1;
  cur int;
  nxt int;
  best int;
  r rewards.rules;
  gid uuid;
  ids uuid[];
begin
  select count(*) into n from rewards.league_entries e where e.group_id = g.id;
  for b in select * from rewards.league_board(p, g.id) loop
    ids := '{}';
    select coalesce(m.tier, 0) into cur from rewards.league_members m where m.program_key = p.key and m.user_id = b.user_id;
    cur := least(coalesce(cur, 0), top);
    nxt := cur;
    if b.rank is not null and b.rank <= promote then
      nxt := least(cur + 1, top);
    elsif demote > 0 and b.place > greatest(n - demote, promote) then
      nxt := greatest(cur - 1, 0);
    end if;
    if b.rank is not null and p.enabled then
      -- only the best tier of rewards reached pays: the smallest threshold that is not below the rank
      select min(x.threshold) into best from rewards.rules x where x.program_key = p.key and x.active and x.threshold >= b.rank;
      if best is not null then
        for r in select * from rewards.rules x where x.program_key = p.key and x.active and x.threshold = best order by x.created_at loop
          gid := rewards.queue(b.user_id, r, 'w' || to_char(g.week, 'YYYYMMDD'));
          if gid is not null then ids := ids || gid; end if;
        end loop;
      end if;
    end if;
    update rewards.league_entries e set final_score = b.score, final_rank = b.rank, tier_change = sign(nxt - cur)::smallint,
           grant_ids = ids
     where e.group_id = g.id and e.user_id = b.user_id;
    update rewards.league_members m set tier = nxt where m.program_key = p.key and m.user_id = b.user_id;
  end loop;
  update rewards.league_groups x set closed_at = now() where x.id = g.id;
end $$;

-- Closes every group whose week has ended (one program, or all); returns how many. Runs from the worker and lazily
-- when a member opens the board. Nothing closes while the engine is switched off.
create function rewards.league_close(program text default null) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  g rewards.league_groups;
  p rewards.programs;
  n int := 0;
begin
  if not (rewards.settings()).enabled then return 0; end if;
  for g in select x.* from rewards.league_groups x
            where x.closed_at is null and (program is null or x.program_key = program)
              and rewards.league_start(x.week + 7) <= now()
            order by x.week, x.created_at
            for update skip locked loop
    select * into p from rewards.programs x where x.key = g.program_key;
    perform rewards.league_close_group(p, g);
    n := n + 1;
  end loop;
  return n;
end $$;

-- What a member sees ------------------------------------------------------------------------------------------------

create function rewards.league_json(uid uuid, program text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p rewards.programs := rewards.league_program(program);
  live boolean := rewards.is_live(p);
  wk date;
  m rewards.league_members;
  joined boolean;
  t int;
  g uuid;
  board jsonb := '[]';
  my_rank int;
  my_score int;
  n int := 0;
  lw rewards.league_entries;
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  perform rewards.league_close(p.key);
  wk := rewards.league_week(p, now());
  select * into m from rewards.league_members x where x.program_key = p.key and x.user_id = uid;
  joined := m.user_id is not null and m.left_at is null;
  if joined and live and (rewards.settings()).enabled then
    g := rewards.league_place(uid, p, wk);
  end if;
  if g is not null then
    select coalesce(jsonb_agg(jsonb_build_object('rank', b.rank, 'name', rewards.league_name(b.user_id), 'score', b.score,
                                                 'me', b.user_id = uid) order by b.score desc, b.joined_at), '[]'),
           max(b.rank) filter (where b.user_id = uid), max(b.score) filter (where b.user_id = uid), count(*)
      into board, my_rank, my_score, n
      from rewards.league_board(p, g) b;
  end if;
  t := least(coalesce(m.tier, 0), rewards.league_tiers(p) - 1);
  select * into lw from rewards.league_entries e
   where e.program_key = p.key and e.user_id = uid and e.week < wk and e.final_score is not null
   order by e.week desc limit 1;
  return jsonb_build_object(
    'program', p.key, 'live', live, 'joined', joined, 'tier', t, 'tier_name', p.config -> 'tiers' ->> t,
    'tiers', coalesce(p.config -> 'tiers', '[]'), 'week', wk, 'starts_at', rewards.league_start(wk),
    'ends_at', rewards.league_start(wk + 7), 'server_time', now(),
    'group_size', coalesce((p.config ->> 'group_size')::int, 20), 'promote', coalesce((p.config ->> 'promote')::int, 0),
    'demote', coalesce((p.config ->> 'demote')::int, 0), 'min_score', coalesce((p.config ->> 'min_score')::int, 1),
    'rank', my_rank, 'score', coalesce(my_score, 0), 'size', n, 'members', board,
    'rewards', coalesce((select jsonb_agg(rewards.spec(r, r.threshold) order by r.threshold, r.created_at)
                           from rewards.rules r where r.program_key = p.key and r.active), '[]'),
    'last_week', case when lw.user_id is null then null else jsonb_build_object(
      'week', lw.week, 'rank', lw.final_rank, 'score', lw.final_score,
      'tier_change', case lw.tier_change when 1 then 'up' when -1 then 'down' else 'same' end,
      'grants', rewards.grants_json(uid, lw.grant_ids)) end);
end $$;

create function rewards.league_join(uid uuid, program text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p rewards.programs := rewards.league_program(program);
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  if not (rewards.settings()).enabled then raise exception 'rewards: disabled' using errcode = '22023'; end if;
  if not rewards.is_live(p) then raise exception 'rewards: unknown_program' using errcode = '22023'; end if;
  insert into rewards.league_members as m (program_key, user_id) values (p.key, uid)
  on conflict (program_key, user_id) do update set left_at = null, joined_at = case when m.left_at is null then m.joined_at else now() end;
  return rewards.league_json(uid, p.key);
end $$;

-- Leaving takes effect at once: off this week's board (unless the week already closed), no more placement.
create function rewards.league_leave(uid uuid, program text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p rewards.programs := rewards.league_program(program);
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  update rewards.league_members m set left_at = now() where m.program_key = p.key and m.user_id = uid and m.left_at is null;
  delete from rewards.league_entries e using rewards.league_groups g
   where e.program_key = p.key and e.user_id = uid and g.id = e.group_id and g.closed_at is null;
  return rewards.league_json(uid, p.key);
end $$;

-- Admin overview: counts only, never a user ----------------------------------------------------------------------------

create function rewards.league_overview(program text, weeks int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'program', p.key, 'live', rewards.is_live(p), 'group_size', coalesce((p.config ->> 'group_size')::int, 20),
    'tiers', coalesce(p.config -> 'tiers', '[]'),
    'members', (select count(*) from rewards.league_members m where m.program_key = p.key and m.left_at is null),
    'left', (select count(*) from rewards.league_members m where m.program_key = p.key and m.left_at is not null),
    'members_by_tier', coalesce((select jsonb_agg(jsonb_build_object('tier', x.tier, 'members', x.n) order by x.tier)
                                   from (select m.tier, count(*) n from rewards.league_members m
                                          where m.program_key = p.key and m.left_at is null group by 1) x), '[]'),
    'current_week', rewards.league_week(p, now()), 'ends_at', rewards.league_start(rewards.league_week(p, now()) + 7),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object(
               'week', w.week, 'groups', w.groups, 'closed_groups', w.closed, 'entries', w.entries, 'ranked', w.ranked,
               'top_score', w.top_score, 'grants', w.grants, 'promoted', w.promoted, 'demoted', w.demoted,
               'group_sizes', w.sizes) order by w.week desc)
             from (select g.week, count(distinct g.id) groups, count(distinct g.id) filter (where g.closed_at is not null) closed,
                          count(e.user_id) entries, count(e.final_rank) ranked, max(e.final_score) top_score,
                          coalesce(sum(cardinality(e.grant_ids)), 0) grants,
                          count(*) filter (where e.tier_change = 1) promoted, count(*) filter (where e.tier_change = -1) demoted,
                          (select jsonb_agg(jsonb_build_object('tier', gs.tier, 'size', gs.n, 'closed', gs.closed_at is not null)
                                            order by gs.tier, gs.created_at)
                             from (select g2.tier, g2.created_at, g2.closed_at,
                                          (select count(*) from rewards.league_entries e2 where e2.group_id = g2.id) n
                                     from rewards.league_groups g2 where g2.program_key = p.key and g2.week = g.week) gs) sizes
                     from rewards.league_groups g left join rewards.league_entries e on e.group_id = g.id
                    where g.program_key = p.key
                      and g.week > rewards.league_week(p, now()) - 7 * least(greatest(coalesce(weeks, 4), 1), 52)
                    group by g.week) w), '[]')) order by p.sort, p.key), '[]')
    from rewards.programs p where p.kind = 'league' and (program is null or p.key = program)
$$;

-- Public wrappers --------------------------------------------------------------------------------------------------

create function public.rewards_league(program text) returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.league_json(auth.uid(), program) $$;
create function public.rewards_league_join(program text) returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.league_join(auth.uid(), program) $$;
create function public.rewards_league_leave(program text) returns jsonb
language sql volatile security definer set search_path = '' as $$ select rewards.league_leave(auth.uid(), program) $$;

create function public.rewards_svc_league_close() returns int
language sql volatile security definer set search_path = '' as $$ select rewards.league_close(null) $$;

create function public.rewards_admin_leagues(program text default null, weeks int default 4) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform rewards.require_admin();
  return rewards.league_overview(program, weeks);
end $$;

create function public.rewards_admin_league_close() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  n int;
begin
  perform rewards.require_admin();
  n := rewards.league_close(null);
  perform rewards.log('league_close', jsonb_build_object('closed', n));
  return jsonb_build_object('closed', n);
end $$;

-- The worker's 15-minute call also closes leagues; deletion covers the league rows (patched from the deployed
-- definitions, checked).
do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.rewards_svc_expire_social()'::regprocedure);
  n := replace(d, '  perform rewards.purge_events();',
    '  perform rewards.purge_events();
  begin
    perform rewards.league_close(null);
  exception when others then
    raise warning ''rewards: league close failed: %'', sqlerrm;
  end;');
  if n = d then raise exception 'rewards: could not patch rewards_svc_expire_social'; end if;
  execute n;
  d := pg_get_functiondef('rewards.delete_user(uuid)'::regprocedure);
  n := replace(d, '  delete from rewards.events e where e.user_id = uid;',
    '  delete from rewards.league_entries x where x.user_id = uid;
  delete from rewards.league_members x where x.user_id = uid;
  delete from rewards.events e where e.user_id = uid;');
  if n = d then raise exception 'rewards: could not patch delete_user'; end if;
  execute n;
end $$;

revoke all on all tables in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards_app from public, anon, authenticated, service_role;
revoke all on function public.rewards_league(text), public.rewards_league_join(text), public.rewards_league_leave(text),
  public.rewards_svc_league_close() from public, anon, authenticated, service_role;
grant execute on function public.rewards_league(text), public.rewards_league_join(text), public.rewards_league_leave(text)
  to authenticated;
grant execute on function public.rewards_svc_league_close() to service_role;
do $$
declare
  f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'rewards\_admin\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
