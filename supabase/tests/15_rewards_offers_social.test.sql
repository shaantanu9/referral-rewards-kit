-- Rewards engine: timed offers (real deadlines, real stock) and Instagram tag posts (ADR 0002 6.3, 6.4, 8).
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u select 'u' || g, gen_random_uuid() from generate_series(1, 5) g;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
create table public.app_coins (grant_id uuid primary key, user_id uuid, amount numeric);
grant select, insert on public.app_coins to postgres;
create or replace function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_coins values (grant_id, user_id, amount) on conflict do nothing;
end $$;

insert into rewards.event_types (name, source) values ('signed_up', 'client');
insert into rewards.programs (key, kind, config, ends_at) values
  ('welcome', 'offer', '{"window_minutes":1440}', null),
  ('flash', 'offer', '{"window_minutes":60,"stock":2,"show_stock":true}', null),
  ('season', 'offer', '{"start_on":"signed_up"}', now() + interval '3 days');
insert into rewards.rules (program_key, kind, amount) values ('welcome', 'coins', 100), ('flash', 'coins', 10), ('season', 'coins', 7);

-- first_seen: the state call starts the window once, and it never moves
create temp table s1 as select rewards.state(pg_temp.uid('u1')) j;
select tests.ok((select o ->> 'state' = 'active' from s1, jsonb_array_elements(j -> 'offers') o where o ->> 'program' = 'welcome'),
                'welcome offer active after the first state call');
create temp table w1 as select ends_at from rewards.offer_windows where user_id = pg_temp.uid('u1') and program_key = 'welcome';
select tests.ok((select ends_at from w1) between now() + interval '1439 minutes' and now() + interval '1441 minutes',
                'deadline = start + window');
select rewards.state(pg_temp.uid('u1'));
select tests.ok((select ends_at from rewards.offer_windows where user_id = pg_temp.uid('u1') and program_key = 'welcome')
                = (select ends_at from w1), 'a second state call does not reset the deadline');
do $$ begin
  update rewards.offer_windows set ends_at = ends_at + interval '1 day' where program_key = 'welcome';
  raise exception 'deadline moved';
exception when sqlstate '22023' then perform tests.ok(true, 'an offer deadline can never be changed');
end $$;

-- start_on an event: not started until the event, ends at the program's end
select tests.ok((select o ->> 'state' = 'not_started' from s1, jsonb_array_elements(j -> 'offers') o where o ->> 'program' = 'season'),
                'event-started offer is not_started before the event');
select rewards.track(pg_temp.uid('u1'), 'signed_up', 'once', '{}', null, false);
select tests.ok((select ends_at = (select ends_at from rewards.programs where key = 'season')
                 from rewards.offer_windows where user_id = pg_temp.uid('u1') and program_key = 'season'),
                'offer without window_minutes ends with the program');

-- claim
create temp table c1 as select rewards.offer_claim(pg_temp.uid('u1'), 'welcome') j;
select tests.ok((select (j -> 'grants' -> 0 ->> 'amount')::numeric = 100 and j -> 'grants' -> 0 ->> 'state' = 'granted' from c1),
                'claim grants the offer reward');
do $$ begin
  perform rewards.offer_claim(pg_temp.uid('u1'), 'welcome');
  raise exception 'double claim';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: offer_claimed', 'second claim refused');
end $$;
do $$ begin
  perform rewards.offer_claim(pg_temp.uid('u2'), 'welcome');
  raise exception 'claim before start';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: offer_not_started', 'claim before the window starts refused');
end $$;
do $$ begin
  perform rewards.offer_claim(pg_temp.uid('u1'), 'nope');
  raise exception 'unknown program';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: unknown_program', 'unknown offer refused');
end $$;

-- expired: a window that already ended (inserted directly, as if started yesterday)
insert into rewards.offer_windows (user_id, program_key, started_at, ends_at)
values (pg_temp.uid('u3'), 'welcome', now() - interval '2 days', now() - interval '1 day');
do $$ begin
  perform rewards.offer_claim(pg_temp.uid('u3'), 'welcome');
  raise exception 'expired claim';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: offer_expired', 'claim after the deadline refused');
end $$;
select tests.ok((select o ->> 'state' = 'expired' from jsonb_array_elements(rewards.state(pg_temp.uid('u3')) -> 'offers') o
                 where o ->> 'program' = 'welcome'), 'state shows expired, not a fresh window');

-- real stock
select rewards.state(pg_temp.uid(n)) from unnest(array['u1', 'u2', 'u4']) n;
select tests.ok((select (o ->> 'stock_left')::int = 2 from jsonb_array_elements(rewards.state(pg_temp.uid('u2')) -> 'offers') o
                 where o ->> 'program' = 'flash'), 'stock_left shown when show_stock is on');
select rewards.offer_claim(pg_temp.uid('u1'), 'flash');
select rewards.offer_claim(pg_temp.uid('u2'), 'flash');
do $$ begin
  perform rewards.offer_claim(pg_temp.uid('u4'), 'flash');
  raise exception 'sold out claim';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: sold_out', 'claim after stock runs out refused');
end $$;
select tests.ok((select o ->> 'state' = 'sold_out' from jsonb_array_elements(rewards.state(pg_temp.uid('u4')) -> 'offers') o
                 where o ->> 'program' = 'flash'), 'state shows sold_out');
select tests.ok((select (o ->> 'stock_left') is null from jsonb_array_elements(rewards.state(pg_temp.uid('u4')) -> 'offers') o
                 where o ->> 'program' = 'welcome'), 'no stock shown for an offer without stock');

-- an ended season never starts for a new user
update rewards.programs set starts_at = now() - interval '10 days', ends_at = now() - interval '1 day' where key = 'season';
select rewards.track(pg_temp.uid('u5'), 'signed_up', 'once', '{}', null, false);
select tests.ok(not exists (select 1 from rewards.offer_windows where user_id = pg_temp.uid('u5') and program_key = 'season'),
                'an ended offer never starts');

-- social tag ------------------------------------------------------------------------------------------------------
insert into rewards.programs (key, kind, config) values
  ('ig', 'social_tag', '{"platform":"instagram","account":"myapp","code_prefix":"MYAPP"}'),
  ('ig_monthly', 'social_tag', '{"platform":"instagram","account":"myapp","code_prefix":"MONTH","repeat_days":30}');
insert into rewards.rules (program_key, kind, amount) values ('ig', 'coins', 200), ('ig_monthly', 'coins', 50);

select tests.ok((select s ->> 'state' = 'none' from jsonb_array_elements(rewards.state(pg_temp.uid('u1')) -> 'social') s
                 where s ->> 'program' = 'ig'), 'social task starts as none');
create temp table st1 as select rewards.social_start(pg_temp.uid('u1'), 'ig', '@Reader.One') j;
select tests.ok((select j ->> 'code' ~ '^MYAPP-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$' and j ->> 'account' = 'myapp' from st1),
                'start returns a MYAPP-XXXXXX code and the account');
select tests.ok((select handle from rewards.social_posts where user_id = pg_temp.uid('u1')) = 'reader.one', 'handle stored lower case without @');
select tests.ok((rewards.social_start(pg_temp.uid('u1'), 'ig', 'reader.one') ->> 'code') = (select j ->> 'code' from st1),
                'starting again while pending returns the same code');
do $$ begin
  perform rewards.social_start(pg_temp.uid('u2'), 'ig', 'reader.one');
  raise exception 'handle taken';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: handle_taken', 'another user cannot use a pending handle');
end $$;
do $$ begin
  perform rewards.social_start(pg_temp.uid('u2'), 'ig', 'bad handle!');
  raise exception 'bad handle';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: bad_handle', 'invalid handle refused');
end $$;

-- webhook: wrong handle with the right code does not match; right handle + code matches
select tests.ok(not (rewards.verify_social('instagram', 'someone_else', 'love it ' || (select j ->> 'code' from st1), 'm0') ->> 'matched')::boolean,
                'code posted by another account does not match');
create temp table v1 as select rewards.verify_social('instagram', '@Reader.One', 'love @myapp ' || lower((select j ->> 'code' from st1)) || ' #ad', 'm1') j;
select tests.ok((select (j ->> 'matched')::boolean and (j ->> 'grants')::int = 1 from v1), 'mention with code verifies and grants');
select tests.ok((select count(*) from public.app_coins where user_id = pg_temp.uid('u1') and amount = 200) = 1, 'reward in the app ledger');
select tests.ok((rewards.verify_social('instagram', 'reader.one', 'again', 'm1') ->> 'reason') = 'media_used', 'one media verifies one post');
do $$ begin
  perform rewards.social_start(pg_temp.uid('u1'), 'ig', 'reader.one');
  raise exception 'second once-ever post';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: already_posted', 'once-ever program refuses a second post');
end $$;

-- by handle only, and ambiguity
select rewards.social_start(pg_temp.uid('u2'), 'ig', 'two');
select tests.ok((rewards.verify_social('instagram', 'two', 'no code here', 'm2') ->> 'matched')::boolean, 'single pending post matches by handle');
select rewards.social_start(pg_temp.uid('u3'), 'ig', 'three');
select rewards.social_start(pg_temp.uid('u3'), 'ig_monthly', 'three');
select tests.ok((rewards.verify_social('instagram', 'three', 'no code', 'm3') ->> 'reason') = 'ambiguous',
                'two pending posts with the same handle and no code: not matched');
select tests.ok((rewards.verify_social('instagram', 'three', 'code ' || (select code from rewards.social_posts where user_id = pg_temp.uid('u3') and program_key = 'ig_monthly'), 'm3') ->> 'matched')::boolean,
                'the code picks the right program');
select tests.ok((rewards.verify_social('instagram', 'nobody', 'x', 'm4') ->> 'reason') = 'no_pending_post', 'unknown handle: no match');

-- repeat_days: cooldown, then a new cycle
select tests.ok((select s ->> 'state' = 'cooldown' and (s ->> 'expires_at')::timestamptz > now() + interval '29 days'
                 from jsonb_array_elements(rewards.state(pg_temp.uid('u3')) -> 'social') s where s ->> 'program' = 'ig_monthly'),
                'verified monthly post: cooldown until 30 days later');
do $$ begin
  perform rewards.social_start(pg_temp.uid('u3'), 'ig_monthly', 'three');
  raise exception 'too soon';
exception when sqlstate '22023' then perform tests.ok(sqlerrm = 'rewards: too_soon', 'new post during cooldown refused');
end $$;
update rewards.social_posts set decided_at = now() - interval '31 days' where user_id = pg_temp.uid('u3') and program_key = 'ig_monthly';
select rewards.social_start(pg_temp.uid('u3'), 'ig_monthly', 'three');
update rewards.social_posts set state = 'expired' where user_id = pg_temp.uid('u3') and program_key = 'ig';
select rewards.verify_social('instagram', 'three', 'again', 'm5');
select tests.ok((select count(*) from rewards.grants where user_id = pg_temp.uid('u3') and program_key = 'ig_monthly' and state = 'granted') = 2,
                'after the cooldown a second cycle is rewarded again');

-- review and expiry
select rewards.social_start(pg_temp.uid('u4'), 'ig', 'four');
select tests.ok((rewards.review_social((select id from rewards.social_posts where user_id = pg_temp.uid('u4')), false) ->> 'state') = 'rejected',
                'staff can reject');
select tests.ok((select s ->> 'state' = 'rejected' from jsonb_array_elements(rewards.state(pg_temp.uid('u4')) -> 'social') s
                 where s ->> 'program' = 'ig'), 'state shows rejected');
select tests.ok((rewards.review_social((select id from rewards.social_posts where user_id = pg_temp.uid('u4')), true) ->> 'grants')::int = 1,
                'staff can approve a rejected post and it grants');
select rewards.social_start(pg_temp.uid('u5'), 'ig', 'five');
update rewards.social_posts set created_at = now() - interval '8 days' where user_id = pg_temp.uid('u5');
select tests.ok(rewards.expire_social() = 1, 'stale pending post expires');
select tests.ok((rewards.social_start(pg_temp.uid('u5'), 'ig', 'five') ->> 'code') is not null, 'a new attempt is allowed after expiry');

-- through the public API
select tests.act_as('authenticated', pg_temp.uid('u2'));
select tests.ok(jsonb_typeof(public.rewards_state() -> 'social') = 'array', 'rewards_state works for a signed-in user');
select tests.ok(public.rewards_mark_seen(array(select (g ->> 'id')::uuid from jsonb_array_elements(public.rewards_state() -> 'inbox') g)) >= 1,
                'rewards_mark_seen marks granted inbox items');
select tests.ok(jsonb_array_length(public.rewards_state() -> 'inbox') = 0, 'inbox empty after mark seen');
reset role;

rollback;
