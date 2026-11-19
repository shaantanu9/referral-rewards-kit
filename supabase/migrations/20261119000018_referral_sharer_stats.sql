-- referral-kit migration 18: the sharer sees the friends who used their code.
--
-- Before: `joined_count` was null until stats_floor (3) friends had joined, and a friend who claimed the code but had
-- not yet started (the app's activation hook still false) was not counted anywhere. A sharer whose first friend
-- signed up with the code saw nothing at all on the invite screen or on home.
-- Now:
--   claimed_count  friends who used the code and have not started yet (claim still inside activate_window_days)
--   joined_count   friends who started, from the first one
--   paid_count     unchanged: only from stats_floor joined friends, because it would reveal one friend's purchase
--                  (ADR 0001 finding 18). A joined friend is already shown to the sharer by the joined reward card.
-- Only `referral.stats` changes; `public.referral_stats` calls it and keeps its grants.

create or replace function referral.stats(uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with s as (select * from referral.settings x where x.id),
  mine as (select * from referral.rewards w where w.user_id = uid),
  joined as (select count(*) n from referral.referrals r where r.sharer_id = uid and r.joined_at is not null),
  claimed as (select count(*) n from referral.referrals r, s
               where r.sharer_id = uid and r.state = 'claimed' and r.joined_at is null
                 and r.claimed_at + make_interval(days => s.activate_window_days) >= now()),
  paid as (select count(*) n from referral.referrals r where r.sharer_id = uid and r.paid_at is not null)
  select jsonb_build_object(
    'rewards_granted', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'who', who, 'event', event, 'kind', kind,
                                 'amount', amount, 'at', updated_at) order by updated_at desc)
                                 from mine where state = 'granted'), '[]'),
    'pending', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'event', event, 'kind', kind, 'amount', amount,
                         'available_at', available_at) order by available_at)
                         from mine where state in ('queued', 'granting', 'failed_retryable')), '[]'),
    'banked', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'amount', amount)) from mine
                        where state = 'banked'), '[]'),
    'skipped_cap', (select count(*) from mine where state = 'skipped_cap'),
    'claimed_count', (select n from claimed),
    'joined_count', (select n from joined),
    'paid_count', case when (select n from joined) >= (select stats_floor from s) then (select n from paid) end)
$$;

revoke execute on function referral.stats(uuid) from public, anon, authenticated, service_role;
