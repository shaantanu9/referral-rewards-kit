-- activation_sweep checks the least recently checked claims first (migration 20), so more inactive claims than one
-- batch no longer hide a newer friend who has started. Rolled back at the end.
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u select 'sharer', gen_random_uuid();
insert into u select 'f' || g, gen_random_uuid() from generate_series(1, 4) g;
insert into auth.users (id, email, email_confirmed_at) select id, name || '@example.test', now() - interval '1 hour' from u;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
insert into referral.rules (version, event, who, kind, amount) values (1, 'joined', 'sharer', 'minutes', 30);
create table public.app_progress (user_id uuid not null);
grant select on public.app_progress to postgres;
grant select on u to postgres;
create or replace function referral_app.app_referral_is_active(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_progress p where p.user_id = app_referral_is_active.user_id) $$;
create or replace function referral_app.app_referral_grant(reward_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$ begin end $$;

create temp table c as select referral.my_code(pg_temp.uid('sharer'), 'sharer-phone-0001') ->> 'code' as code;
select tests.ok(bool_and(referral.claim(pg_temp.uid('f' || g), (select code from c), 'friend-phone-000' || g) ->> 'reason' = 'ok'), 'four claims')
from generate_series(1, 4) g;
-- f1..f3 claimed first and never start; f4 is the newest and starts (no app trigger here, only the sweep)
update referral.referrals set claimed_at = now() - make_interval(days => 10 - g)
  from u join generate_series(1, 4) g on u.name = 'f' || g where friend_id = u.id;
insert into public.app_progress values (pg_temp.uid('f4'));

select referral.activation_sweep(2);
select tests.ok((select state from referral.referrals where friend_id = pg_temp.uid('f4')) = 'claimed', 'first batch of 2: the two oldest');
select referral.activation_sweep(2);
select tests.ok((select state from referral.referrals where friend_id = pg_temp.uid('f4')) = 'joined',
                'second batch reaches the newer friends instead of the same two oldest again');

rollback;
