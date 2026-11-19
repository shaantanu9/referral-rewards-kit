-- The sharer sees friends who used their code (migration 18): `claimed_count` (used the code, not started yet)
-- and `joined_count` from the first friend. `paid_count` still needs stats_floor (3) joined friends, because it
-- would reveal one friend's purchase (ADR finding 18). Rolled back at the end.
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u select 'sharer', gen_random_uuid();
insert into u select 'f' || g, gen_random_uuid() from generate_series(1, 3) g;
insert into auth.users (id, email, email_confirmed_at) select id, name || '@example.test', now() - interval '1 hour' from u;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
insert into referral.rules (version, event, who, kind, amount) values (1, 'joined', 'sharer', 'minutes', 30);

create table public.app_progress (user_id uuid not null);
grant select on public.app_progress to postgres;
grant select on u to postgres, authenticated;
create or replace function referral_app.app_referral_is_active(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_progress p where p.user_id = app_referral_is_active.user_id) $$;
create or replace function referral_app.app_referral_grant(reward_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$ begin end $$;

create temp table c as select referral.my_code(pg_temp.uid('sharer'), 'sharer-phone-0001') ->> 'code' as code;

-- nobody used the code yet
select tests.ok((referral.stats(pg_temp.uid('sharer')) ->> 'claimed_count')::int = 0
                and (referral.stats(pg_temp.uid('sharer')) ->> 'joined_count')::int = 0, 'no friends: both counts 0');

-- one friend uses the code and has not started
select tests.ok(referral.claim(pg_temp.uid('f1'), (select code from c), 'friend-phone-0001') ->> 'reason' = 'ok', 'f1 claims');
select tests.ok((referral.stats(pg_temp.uid('sharer')) ->> 'claimed_count')::int = 1,
                'the sharer sees one friend who used the code right after the claim');
select tests.ok((referral.stats(pg_temp.uid('sharer')) ->> 'joined_count')::int = 0, 'not joined yet');

-- the friend starts: joined from the first friend, below the floor
insert into public.app_progress values (pg_temp.uid('f1'));
select tests.ok(referral.check_activation(pg_temp.uid('f1')) = 'joined', 'f1 joins');
select tests.ok((referral.stats(pg_temp.uid('sharer')) ->> 'joined_count')::int = 1, 'one joined friend is shown');
select tests.ok((referral.stats(pg_temp.uid('sharer')) ->> 'claimed_count')::int = 0, 'a joined friend is no longer waiting');
select tests.ok(referral.stats(pg_temp.uid('sharer')) -> 'paid_count' = 'null'::jsonb, 'paid count still hidden below the floor');

-- an expired claim is not waiting any more
select tests.ok(referral.claim(pg_temp.uid('f2'), (select code from c), 'friend-phone-0002') ->> 'reason' = 'ok', 'f2 claims');
update referral.referrals set claimed_at = now() - interval '31 days' where friend_id = pg_temp.uid('f2');
select tests.ok((referral.stats(pg_temp.uid('sharer')) ->> 'claimed_count')::int = 0, 'a claim past the activation window is not counted');

-- the wrapper returns the same
do $$
declare r jsonb;
begin
  perform tests.act_as('authenticated', pg_temp.uid('sharer'));
  r := public.referral_stats('sharer-phone-0001');
  reset role;
  perform tests.ok((r ->> 'joined_count')::int = 1 and (r ->> 'claimed_count')::int = 0, 'wrapper: referral_stats');
end $$;

rollback;
