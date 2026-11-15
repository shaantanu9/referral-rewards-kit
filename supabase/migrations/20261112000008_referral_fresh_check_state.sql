-- referral-kit migration 8: when the worker cancels a held paid reward (fresh check found no subscription, or the
-- transaction was refunded, ADR 6.5), the referral follows: `paid_cancelled` with its cause. Before this, the reward
-- was cancelled but the referral stayed `paid` (found while building part 7, docs/ISSUES.md).

alter table referral.referrals drop constraint referrals_paid_cancel_cause_check;
alter table referral.referrals add constraint referrals_paid_cancel_cause_check
  check (paid_cancel_cause in ('refund', 'transfer', 'fresh_check'));

alter function referral.finish_reward(uuid, uuid, text, text, int) rename to finish_reward_core;

create function referral.finish_reward(rid uuid, token uuid, outcome text, error text default null,
                                       retry_after_seconds int default null) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  w referral.rewards;
  result text;
  cause text;
begin
  select * into w from referral.rewards where id = rid;
  result := referral.finish_reward_core(rid, token, outcome, error, retry_after_seconds);
  if result = 'cancelled' and w.event = 'paid' and w.who = 'sharer' then
    cause := case when error = 'refund' then 'refund' when error like 'fresh check%' then 'fresh_check' end;
    if cause is not null then
      -- a refund cancel keeps last_error = 'refund', so a later REFUND_REVERSED can restore it (apply_event)
      update referral.referrals set state = 'paid_cancelled', paid_cancel_cause = cause
       where id = w.referral_id and state = 'paid';
    end if;
  end if;
  return result;
end $$;

revoke execute on all functions in schema referral from public, anon, authenticated, service_role;
