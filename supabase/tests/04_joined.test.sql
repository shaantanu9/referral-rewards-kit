-- Activation, joined rewards, caps, local grants, stats / pending / ack (ADR 6.2, 7, 8). Rolled back at the end.
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u select 'sharer', gen_random_uuid();
insert into u select 'f' || g, gen_random_uuid() from generate_series(1, 12) g;
insert into auth.users (id, email, email_confirmed_at) select id, name || '@example.test', now() - interval '1 hour' from u;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
insert into referral.rules (version, event, who, kind, amount) values (1, 'joined', 'sharer', 'minutes', 30), (1, 'joined', 'friend', 'minutes', 30);
insert into referral.rules (version, event, who, kind, amount, params) values (1, 'paid', 'sharer', 'entitlement_days', 5, '{"entitlement_id":"premium"}');

-- the app's activity table, hooks and a ledger the grant hook writes to
create table public.app_progress (user_id uuid not null, page int not null);
create table public.app_ledger (reward_id uuid primary key, user_id uuid, kind text, amount numeric);
grant select, insert on public.app_progress, public.app_ledger to postgres;
grant select on u to postgres, authenticated;
create or replace function referral_app.app_referral_is_active(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_progress p where p.user_id = app_referral_is_active.user_id) $$;
create or replace function referral_app.app_referral_grant(reward_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if kind <> 'minutes' then raise exception 'unknown kind %', kind; end if;
  insert into public.app_ledger values (reward_id, user_id, kind, amount) on conflict on constraint app_ledger_pkey do nothing;
end $$;
create trigger app_progress_activation after insert on public.app_progress
  for each row execute function referral.activation_trigger('user_id');
grant insert on public.app_progress to authenticated;

create temp table c as select referral.my_code(pg_temp.uid('sharer'), 'sharer-phone-0001') ->> 'code' as code;
grant select on c to postgres;
select tests.ok(referral.claim(pg_temp.uid('f' || g), (select code from c), 'friend-phone-' || lpad(g::text, 4, '0')) ->> 'reason' = 'ok',
                'claim ok for friend ' || g)
from generate_series(1, 12) g;
delete from referral.claim_attempts;

-- not active yet
select tests.ok(referral.check_activation(pg_temp.uid('f1')) = 'claimed', 'no activity: still claimed');
select tests.ok(not exists (select 1 from referral.rewards), 'no rewards before activation');

-- activation through the app's trigger, as the signed-in friend
do $$ begin
  perform tests.act_as('authenticated', pg_temp.uid('f1'));
  insert into public.app_progress values (pg_temp.uid('f1'), 1);
  reset role;
end $$;
select tests.ok((select state from referral.referrals where friend_id = pg_temp.uid('f1')) = 'joined', 'trigger activated the friend (insert ran as authenticated)');
select tests.ok((select count(*) from referral.rewards w join referral.referrals r on r.id = w.referral_id
                 where r.friend_id = pg_temp.uid('f1') and w.event = 'joined' and w.state = 'granted') = 2,
                'both joined rewards granted at once (delay 0)');
select tests.ok((select count(*) from public.app_ledger) = 2 and (select sum(amount) from public.app_ledger) = 60,
                'the app hook received 30 + 30 minutes');
select tests.ok(not exists (select 1 from referral.rewards where event = 'paid'), 'no paid reward from activation');
select tests.ok(referral.check_activation(pg_temp.uid('f1')) = 'joined', 'activation is idempotent');
select tests.ok((select count(*) from public.app_ledger) = 2, 'no second grant on a second check');

-- sharer cap: 10 rewarded joins per 30 days; friends 2..11 join
insert into public.app_progress select pg_temp.uid('f' || g), 1 from generate_series(2, 11) g;
select tests.ok((select count(*) from referral.rewards where who = 'sharer' and event = 'joined' and state = 'granted') = 10,
                'sharer rewarded for 10 joins');
select tests.ok((select count(*) from referral.rewards where who = 'sharer' and event = 'joined' and state = 'skipped_cap') = 1,
                'the 11th join is skipped_cap for the sharer');
select tests.ok((select count(*) from referral.rewards where who = 'friend' and event = 'joined' and state = 'granted') = 11,
                'every friend still gets their own reward when the sharer is capped');

-- a hook failure is retried later, never aborts activation
create or replace function referral_app.app_referral_grant(reward_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$ begin raise exception 'ledger down'; end $$;
insert into public.app_progress values (pg_temp.uid('f12'), 1);
select tests.ok((select state from referral.referrals where friend_id = pg_temp.uid('f12')) = 'joined', 'activation survives a failing hook');
select tests.ok((select bool_and(w.state in ('failed_retryable', 'skipped_cap') and (w.state = 'skipped_cap' or (w.attempts = 1 and w.last_error like '%ledger down%' and w.available_at > now())))
                 from referral.rewards w join referral.referrals r on r.id = w.referral_id where r.friend_id = pg_temp.uid('f12')),
                'failed grant is failed_retryable with backoff and the error kept');
update referral.rewards set available_at = now() - interval '1 second' where state = 'failed_retryable';
update referral.settings set max_attempts = 2;
select referral.grant_local_due();
select tests.ok((select count(*) from referral.rewards where state = 'failed' and attempts = 2) = 1, 'after max_attempts the reward is failed');

-- expiry
update referral.referrals set state = 'claimed', claimed_at = now() - interval '31 days', joined_at = null
 where friend_id = pg_temp.uid('f12');
delete from referral.rewards w using referral.referrals r where r.id = w.referral_id and r.friend_id = pg_temp.uid('f12');
select tests.ok(referral.activation_sweep() = 1, 'sweep handles the one claimed referral');
select tests.ok((select state from referral.referrals where friend_id = pg_temp.uid('f12')) = 'expired',
                'sweep expires a claim not activated in 30 days, even with activity');

-- stats: counts shown only from stats_floor (3) joined friends
select tests.ok((referral.stats(pg_temp.uid('sharer')) ->> 'joined_count')::int = 11 and
                jsonb_array_length(referral.stats(pg_temp.uid('sharer')) -> 'rewards_granted') = 10 and
                (referral.stats(pg_temp.uid('sharer')) ->> 'skipped_cap')::int = 1, 'stats for the sharer');
select tests.ok(referral.stats(pg_temp.uid('f1')) -> 'joined_count' = 'null'::jsonb, 'no counts below the floor');

-- pending / ack per device
select tests.ok(jsonb_array_length(referral.pending(pg_temp.uid('f1'), 'f1-phone-0000001')) = 1, 'friend has one card to show on a phone');
select tests.ok(referral.ack(pg_temp.uid('f1'), array(select (x ->> 'id')::uuid from jsonb_array_elements(referral.pending(pg_temp.uid('f1'), 'f1-phone-0000001')) x), 'f1-phone-0000001') = 1, 'ack on that phone');
select tests.ok(jsonb_array_length(referral.pending(pg_temp.uid('f1'), 'f1-phone-0000001')) = 0, 'card not shown again on the same phone');
select tests.ok(jsonb_array_length(referral.pending(pg_temp.uid('f1'), 'f1-tablet-000001')) = 1, 'card still shown once on another device');
select tests.ok(referral.ack(pg_temp.uid('f2'), array(select w.id from referral.rewards w where w.user_id = pg_temp.uid('f1')), 'f2-phone-0000001') = 0,
                'nobody can acknowledge another user''s reward');

-- wrappers
do $$
declare r jsonb;
begin
  perform tests.act_as('authenticated', pg_temp.uid('sharer'));
  r := public.referral_stats('sharer-phone-0001');
  reset role;
  perform tests.ok((r ->> 'joined_count')::int = 11, 'wrapper: referral_stats');
end $$;

rollback;
