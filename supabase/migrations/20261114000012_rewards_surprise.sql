-- rewards engine 0.3: surprise bonus (params.chance), random amounts (params.amount_range), a daily surprise cap per
-- user, and the odds in the state (ADR 0002 section 18.6). Free only, odds always shown, no near-miss, capped.

alter table rewards.settings add column surprise_daily_cap int not null default 3 check (surprise_daily_cap between 0 and 100);

-- Rule checks for the two options (a second trigger, so the 0.2 check stays as it is).
create function rewards.check_rule_surprise() returns trigger
language plpgsql set search_path = '' as $$
declare
  c numeric;
  mn numeric;
  mx numeric;
begin
  if new.params ? 'chance' then
    c := rewards.to_num(new.params -> 'chance');
    if c is null or c <= 0 or c > 1 then
      raise exception 'rewards: params.chance must be a number above 0 and at most 1' using errcode = '22023';
    end if;
  end if;
  if new.params ? 'amount_range' then
    if new.kind = 'mystery' or jsonb_typeof(new.params -> 'amount_range') <> 'array'
       or jsonb_array_length(new.params -> 'amount_range') <> 2 then
      raise exception 'rewards: params.amount_range must be [min, max] (not on a mystery)' using errcode = '22023';
    end if;
    mn := rewards.to_num(new.params -> 'amount_range' -> 0);
    mx := rewards.to_num(new.params -> 'amount_range' -> 1);
    if mn is null or mx is null or mn <= 0 or mn <> trunc(mn) or mx <> trunc(mx) or mn > mx or new.amount <> mx then
      raise exception 'rewards: amount_range needs whole numbers 0 < min <= max, and the rule amount = max' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
create trigger check_rule_surprise before insert on rewards.rules
  for each row execute function rewards.check_rule_surprise();

-- The one insert path for grants (replaces 0.2): audience, surprise draw with the daily cap, mystery pick, random amount.
create or replace function rewards.queue(uid uuid, r rewards.rules, suffix text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  s rewards.settings := rewards.settings();
  today_start timestamptz := ((now() at time zone 'UTC')::date)::timestamp at time zone 'UTC';
  st text := 'queued';
  gid uuid;
  aud text := coalesce(r.params ->> 'audience', 'all');
  paid boolean;
  k text := r.kind;
  amt numeric := r.amount;
  prm jsonb := r.params;
  e jsonb;
  total numeric;
  pick numeric;
  mn int;
  mx int;
begin
  if aud <> 'all' then
    begin
      paid := coalesce(rewards_app.app_is_paid(uid), false);
    exception when others then
      raise warning 'rewards: app_is_paid failed: %', sqlerrm;
      paid := false;
    end;
    if (aud = 'paid') <> paid then return null; end if;
  end if;
  if r.params ? 'chance' then
    -- the cap first (no draw over it), then the draw; a miss pays nothing and is not retried
    if (select count(*) from rewards.grants g
         where g.user_id = uid and g.created_at > now() - interval '24 hours' and g.params ->> 'surprise' = 'true')
       >= s.surprise_daily_cap then
      return null;
    end if;
    if random() >= rewards.to_num(r.params -> 'chance') then return null; end if;
    prm := prm || jsonb_build_object('surprise', true);
  end if;
  if (select count(*) from rewards.grants g where g.created_at >= today_start) >= s.daily_grant_cap then
    st := 'skipped_cap';
  end if;
  if r.kind = 'mystery' then
    select sum(rewards.to_num(x -> 'weight')) into total from jsonb_array_elements(r.params -> 'table') x;
    pick := random() * total;
    for e in select * from jsonb_array_elements(r.params -> 'table') loop
      pick := pick - rewards.to_num(e -> 'weight');
      if pick <= 0 then exit; end if;
    end loop;
    k := e ->> 'kind';
    amt := rewards.to_num(e -> 'amount');
    prm := coalesce(e -> 'params', '{}') || jsonb_build_object('mystery', true)
           || case when prm ? 'surprise' then jsonb_build_object('surprise', true) else '{}' end;
  elsif r.params ? 'amount_range' then
    mn := rewards.to_num(r.params -> 'amount_range' -> 0)::int;
    mx := rewards.to_num(r.params -> 'amount_range' -> 1)::int;
    amt := mn + floor(random() * (mx - mn + 1))::int;
    prm := prm || jsonb_build_object('range', jsonb_build_array(mn, mx));
  end if;
  insert into rewards.grants (user_id, program_key, rule_id, grant_key, kind, amount, params, state)
  values (uid, r.program_key, r.id, rewards.grant_key(r.program_key, r.threshold, r.kind, uid, suffix), k, amt, prm, st)
  on conflict (grant_key) do nothing
  returning id into gid;
  if gid is not null and st = 'queued' and not rewards.is_worker_kind(k) then
    perform rewards.grant_local(gid);
  end if;
  return gid;
end $$;

-- The odds of every surprise in a live program, for the app to show ("1 in 10 chance of 5-50 coins").
create function rewards.surprises_json() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(rewards.spec(r, r.threshold) || jsonb_build_object('program', r.program_key,
           'chance', rewards.to_num(r.params -> 'chance'), 'amount_range', r.params -> 'amount_range')
           order by p.sort, p.key, r.created_at), '[]')
    from rewards.rules r join rewards.programs p on p.key = r.program_key
   where r.active and r.params ? 'chance' and rewards.is_live(p)
     and (select s.surprise_daily_cap > 0 and s.enabled from rewards.settings s where s.id)
$$;

create or replace function public.rewards_state() returns jsonb
language sql volatile security definer set search_path = '' as $$
  select rewards.state(auth.uid(), true) || jsonb_build_object('surprises', rewards.surprises_json())
$$;

-- The settings key is accepted by the admin API and by imports: patch the deployed definitions (never retyped).
do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.rewards_admin_save_settings(jsonb)'::regprocedure);
  n := replace(d, '''ads_enabled'', ''rc_allow_sandbox'') limit 1', '''ads_enabled'', ''rc_allow_sandbox'', ''surprise_daily_cap'') limit 1');
  n := replace(n, 'rc_allow_sandbox = coalesce((patch ->> ''rc_allow_sandbox'')::boolean, s.rc_allow_sandbox)',
               'rc_allow_sandbox = coalesce((patch ->> ''rc_allow_sandbox'')::boolean, s.rc_allow_sandbox),
    surprise_daily_cap = coalesce((patch ->> ''surprise_daily_cap'')::int, s.surprise_daily_cap)');
  if n = d or (length(n) - length(replace(n, 'surprise_daily_cap', ''))) / length('surprise_daily_cap') <> 4 then
    raise exception 'rewards: could not patch rewards_admin_save_settings';
  end if;
  execute n;
  d := pg_get_functiondef('rewards.import_config(jsonb,boolean)'::regprocedure);
  n := replace(d, '''ads_enabled'', ''rc_allow_sandbox''];', '''ads_enabled'', ''rc_allow_sandbox'', ''surprise_daily_cap''];');
  if n = d then raise exception 'rewards: could not patch import_config'; end if;
  execute n;
end $$;

revoke all on all tables in schema rewards from public, anon, authenticated, service_role;
revoke execute on all functions in schema rewards from public, anon, authenticated, service_role;
revoke all on function public.rewards_state() from public, anon, authenticated, service_role;
grant execute on function public.rewards_state() to authenticated;
