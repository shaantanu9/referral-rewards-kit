-- referral-kit migration 7: what the Edge Function's worker (part 7) needs from the database.
--   1. pending_events: each `need_start` entry also carries the waiting events' ids, their raw transaction ids
--      (API v2 `store_subscription_identifier` is the latest transaction, so it is matched against these), store and
--      environment, so the worker can find the subscription whose `starts_at` fills the start (ADR 6.3).
--   2. worker_plan: the batch size and time budget from settings, and whether the daily banked check is due (ADR 6.4).
--      The first run of each day takes the check; a crashed run skips that day's check (the EXPIRATION webhook and
--      the next day's run still release banked days).

create or replace function referral.pending_events(max_rows int default 50) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'run', coalesce((select jsonb_agg(x.event_id order by x.received_at) from (
              select e.event_id, e.received_at from referral.events e, referral.settings s
               where s.id and (e.state = 'received' or (e.state = 'failed' and e.attempts < s.max_attempts))
               order by e.received_at limit max_rows) x), '[]'),
    'need_start', coalesce((select jsonb_agg(jsonb_build_object(
                     'original_transaction_id', w.otid,
                     'app_user_ids', w.users,
                     'event_ids', w.event_ids,
                     'transaction_ids', w.tids,
                     'store', w.store,
                     'environment', w.environment) order by w.otid)
                   from (select e.fields ->> 'original_transaction_id' otid,
                                coalesce(jsonb_agg(distinct u) filter (where u is not null), '[]') users,
                                jsonb_agg(distinct e.event_id) event_ids,
                                coalesce(jsonb_agg(distinct e.fields ->> 'transaction_id')
                                           filter (where coalesce(e.fields ->> 'transaction_id', '') <> ''), '[]') tids,
                                min(lower(e.fields ->> 'store')) store,
                                min(lower(e.fields ->> 'environment')) environment
                           from referral.events e
                           left join lateral unnest(referral.event_users(e.type, e.fields)) u on true
                          where e.state = 'waiting' and coalesce(e.fields ->> 'original_transaction_id', '') <> ''
                          group by e.fields ->> 'original_transaction_id'
                          limit max_rows) w), '[]'),
    'failed_for_owner', (select count(*) from referral.events e, referral.settings s
                          where s.id and e.state = 'failed' and e.attempts >= s.max_attempts))
$$;

create table referral.worker_state (
  id boolean primary key default true check (id),
  last_banked_check_at timestamptz
);
insert into referral.worker_state (id) values (true);

create function referral.worker_plan() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  s referral.settings := referral.settings();
  due boolean;
begin
  update referral.worker_state set last_banked_check_at = now()
   where id and (last_banked_check_at is null or last_banked_check_at < now() - interval '1 day');
  due := found;
  return jsonb_build_object('worker_batch', s.worker_batch, 'worker_time_budget_seconds', s.worker_time_budget_seconds,
                            'entitlement_id', s.entitlement_id, 'banked_check_due', due);
end $$;

create function public.referral_svc_worker_plan() returns jsonb
language sql volatile security definer set search_path = '' as $$ select referral.worker_plan() $$;
revoke all on function public.referral_svc_worker_plan() from public, anon, authenticated;
grant execute on function public.referral_svc_worker_plan() to service_role;

revoke all on all tables in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral from public, anon, authenticated, service_role;
revoke execute on all functions in schema referral_app from public, anon, authenticated, service_role;
