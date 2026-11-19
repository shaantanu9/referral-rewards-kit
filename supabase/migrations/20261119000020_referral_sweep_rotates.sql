-- referral-kit migration 20: activation_sweep checks the least recently checked claims first.
--
-- It took the oldest `max_rows` claimed referrals every run, so with more inactive claims than one batch a newer
-- friend who had started was not reached by the sweep until older claims expired (30 days). Apps that attach
-- referral.activation_trigger are not affected; this is the fallback path. Body otherwise as migration 3.

alter table referral.referrals add column if not exists activation_checked_at timestamptz;
create index if not exists referrals_claimed_check_idx on referral.referrals (activation_checked_at nulls first)
  where state = 'claimed';

create or replace function referral.activation_sweep(max_rows int default 200) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  f uuid;
  n int := 0;
begin
  for f in select r.friend_id from referral.referrals r
            where r.state = 'claimed' and r.friend_id is not null
            order by r.activation_checked_at nulls first, r.claimed_at limit max_rows loop
    update referral.referrals set activation_checked_at = now() where friend_id = f;
    if referral.check_activation(f) in ('joined', 'expired') then n := n + 1; end if;
  end loop;
  return n;
end $$;

revoke execute on function referral.activation_sweep(int) from public, anon, authenticated, service_role;
revoke all on table referral.referrals from public, anon, authenticated, service_role;
