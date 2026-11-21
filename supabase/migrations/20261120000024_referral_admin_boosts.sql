-- referral-kit migration 24: admin functions for boosts (design spec G8, migration 23's referral.boosts).
--
-- The admin page lists boosts, schedules one and ends one. The rules stay where migration 23 put them, in the table's
-- constraints and its guard trigger (no start in the past, no overlap, at most 31 days, multiplier above 1 and at most
-- 5, a started boost never extended or deleted). These functions only turn those refusals into answers the page can
-- show: {"ok": false, "reason": "<reason>"} instead of an error. Every call checks the admin first
-- (referral.require_admin()) and every change is written to referral.admin_log.
--
-- Reasons: missing, starts_in_past, ends_before_start, too_long, bad_multiplier, bad_events, bad_who, bad_budget,
-- overlap (create); not_found, already_ended, just_started (end).

-- One boost as the admin page shows it. status: scheduled (not started), running, ended. boosted_rewards counts the
-- rewards it has applied to (cancelled and voided ones give their slot back, as for the budget).
create function referral.admin_boost_row(b referral.boosts) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', b.id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'multiplier', b.multiplier,
    'events', to_jsonb(b.events), 'who', to_jsonb(b.who), 'budget', b.budget, 'created_at', b.created_at,
    'status', case when now() < b.starts_at then 'scheduled' when now() < b.ends_at then 'running' else 'ended' end,
    'boosted_rewards', u.used,
    'budget_left', case when b.budget is null then null else greatest(b.budget - u.used, 0) end)
  from (select referral.boost_used(b.id) as used) u
$$;

-- Every boost, newest start first (scheduled, then running, then ended).
create function public.referral_admin_boosts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform referral.require_admin();
  return coalesce((select jsonb_agg(referral.admin_boost_row(b) order by b.starts_at desc, b.created_at desc)
                   from referral.boosts b), '[]');
end $$;

-- Schedule a boost. A start a few minutes in the past (the time it took to fill in the form) means "now": claims made
-- before this call are still never boosted.
create function public.referral_admin_boost_create(starts_at timestamptz, ends_at timestamptz, multiplier numeric,
  events text[] default '{joined}', who text[] default '{sharer,friend}', budget int default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s timestamptz := referral_admin_boost_create.starts_at;
  e timestamptz := referral_admin_boost_create.ends_at;
  b referral.boosts;
  cname text;
  msg text;
begin
  perform referral.require_admin();
  if s is null or e is null or referral_admin_boost_create.multiplier is null then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;
  if s < now() and s >= now() - interval '5 minutes' then
    s := now();
  end if;
  begin
    insert into referral.boosts (starts_at, ends_at, multiplier, events, who, budget)
    values (s, e, referral_admin_boost_create.multiplier,
            coalesce(referral_admin_boost_create.events, '{joined}'),
            coalesce(referral_admin_boost_create.who, '{sharer,friend}'),
            referral_admin_boost_create.budget)
    returning * into b;
  exception
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'reason', 'overlap');
    when check_violation then
      get stacked diagnostics cname = constraint_name;
      return jsonb_build_object('ok', false, 'reason', case cname
        when 'boost_length' then case when e <= s then 'ends_before_start' else 'too_long' end
        when 'boosts_multiplier_check' then 'bad_multiplier'
        when 'boosts_events_check' then 'bad_events'
        when 'boosts_who_check' then 'bad_who'
        when 'boosts_budget_check' then 'bad_budget'
        else 'invalid' end);
    when sqlstate '22023' then
      get stacked diagnostics msg = message_text;
      if msg like '%cannot start in the past%' then
        return jsonb_build_object('ok', false, 'reason', 'starts_in_past');
      end if;
      raise;
  end;
  perform referral.admin_log_add('boost_create', jsonb_build_object('boost_id', b.id, 'starts_at', b.starts_at,
    'ends_at', b.ends_at, 'multiplier', b.multiplier, 'events', to_jsonb(b.events), 'who', to_jsonb(b.who),
    'budget', b.budget));
  return jsonb_build_object('ok', true, 'boost', referral.admin_boost_row(b));
end $$;

-- End a boost: a running one stops now (ends_at = now(); claims from now on are not boosted, rewards already boosted
-- stay); one not started yet is deleted (nobody has seen it).
create function public.referral_admin_boost_end(boost_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  b referral.boosts;
begin
  perform referral.require_admin();
  select * into b from referral.boosts x where x.id = referral_admin_boost_end.boost_id for update;
  if b.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if b.starts_at > now() then
    delete from referral.boosts x where x.id = b.id;
    perform referral.admin_log_add('boost_end', jsonb_build_object('boost_id', b.id, 'result', 'deleted',
      'starts_at', b.starts_at, 'ends_at', b.ends_at, 'multiplier', b.multiplier));
    return jsonb_build_object('ok', true, 'result', 'deleted', 'boost', null);
  end if;
  if b.ends_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'already_ended');
  end if;
  if b.starts_at >= now() then -- started this very instant: ends_at would equal starts_at
    return jsonb_build_object('ok', false, 'reason', 'just_started');
  end if;
  update referral.boosts x set ends_at = now() where x.id = b.id returning * into b;
  perform referral.admin_log_add('boost_end', jsonb_build_object('boost_id', b.id, 'result', 'ended',
    'starts_at', b.starts_at, 'ends_at', b.ends_at, 'multiplier', b.multiplier));
  return jsonb_build_object('ok', true, 'result', 'ended', 'boost', referral.admin_boost_row(b));
end $$;

-- Grants: like the other admin functions (signed-in users, each checks the admin itself; the service role); never anon.
revoke all on function public.referral_admin_boosts(), public.referral_admin_boost_create(timestamptz, timestamptz,
  numeric, text[], text[], int), public.referral_admin_boost_end(uuid) from public, anon;
grant execute on function public.referral_admin_boosts(), public.referral_admin_boost_create(timestamptz, timestamptz,
  numeric, text[], text[], int), public.referral_admin_boost_end(uuid) to authenticated, service_role;

revoke execute on all functions in schema referral from public, anon, authenticated, service_role;
