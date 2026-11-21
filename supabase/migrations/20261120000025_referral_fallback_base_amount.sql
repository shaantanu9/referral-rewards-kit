-- referral-kit migration 25: a lifetime fallback reward (migration 17) kept the base_amount and boost_id that
-- migration 23 recorded for the original entitlement_days reward, so the admin funnel's boosted count and the
-- "base" amount were wrong for it. Body taken from migration 17 (the latest definition) with only the two columns added.
-- Grants are kept by create or replace.

create or replace function referral.fallback_reward(rid uuid, token uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  w referral.rewards;
  f jsonb;
begin
  select * into w from referral.rewards where id = rid and attempt_token = token and state = 'granting' for update;
  if w.id is null then
    return 'lost_lease';
  end if;
  f := w.params -> 'fallback';
  if w.kind <> 'entitlement_days' or not referral.valid_fallback(f) then
    return 'no_fallback';
  end if;
  update referral.rewards
     set kind = f ->> 'kind', amount = (f ->> 'amount')::numeric,
         -- Migration 25: the fallback is its own reward: base_amount follows amount, and it carries no boost.
         base_amount = (f ->> 'amount')::numeric, boost_id = null,
         params = coalesce(f -> 'params', '{}') || jsonb_build_object('fallback_from', jsonb_build_object(
                    'kind', w.kind, 'amount', w.amount, 'grant_key', w.grant_key, 'reason', 'lifetime')),
         grant_key = null, state = 'queued', attempts = 0, attempt_token = null, granting_started_at = null,
         target_expires_at = null, available_at = now(), last_error = 'lifetime: fallback', updated_at = now()
   where id = rid;
  return referral.grant_local(rid);
end $$;
