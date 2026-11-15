-- Account deletion (ADR 9): friend and sharer cases, tombstones block a comeback, no personal rows left.
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u select n, gen_random_uuid() from unnest(array['sharer', 'friend', 'again', 'other']) n;
insert into auth.users (id, email, email_confirmed_at) select id, name || '@example.test', now() - interval '1 hour' from u;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to postgres;
insert into referral.rules (version, event, who, kind, amount) values (1, 'joined', 'sharer', 'minutes', 30);
insert into referral.rules (version, event, who, kind, amount, params) values (1, 'paid', 'sharer', 'entitlement_days', 5, '{"entitlement_id":"premium"}');

create temp table c as select referral.my_code(pg_temp.uid('sharer'), 'sharer-phone-0001') ->> 'code' as code;
grant select on c to postgres;
select tests.ok(referral.claim(pg_temp.uid('friend'), (select code from c), 'friend-phone-001') ->> 'reason' = 'ok', 'friend claims');
select referral.touch_install(pg_temp.uid('friend'), 'friend-tablet-01');
-- friend paid; the sharer's paid reward is still in its hold; the transaction is known
insert into referral.transactions (original_transaction_id_hash, pepper_version) values (referral.hmac('otid-1', 1), 1);
update referral.referrals set state = 'paid', joined_at = now(), paid_at = now(), original_transaction_id_hash = referral.hmac('otid-1', 1)
 where friend_id = pg_temp.uid('friend');
select referral.queue_rewards((select id from referral.referrals where friend_id = pg_temp.uid('friend')), 'paid');
insert into referral.events (event_id, type, fields, event_timestamp_ms)
  values ('e1', 'INITIAL_PURCHASE', jsonb_build_object('app_user_id', pg_temp.uid('friend')::text), 1),
         ('e2', 'TRANSFER', jsonb_build_object('transferred_to', jsonb_build_array(pg_temp.uid('friend')::text)), 2),
         ('e3', 'INITIAL_PURCHASE', jsonb_build_object('app_user_id', pg_temp.uid('other')::text), 3);

-- friend deletes their account ---------------------------------------------------------------------------------------
do $$
declare x jsonb := referral.delete_user(pg_temp.uid('friend'));
begin
  perform tests.ok((x ->> 'was_friend')::boolean and (x ->> 'tombstones')::int = 3, 'friend: tombstones for both installs and the transaction');
  perform tests.ok((x ->> 'events_deleted')::int = 2, 'friend: events naming them deleted (incl. transfer lists)');
end $$;
select tests.ok((select friend_id is null and friend_deleted_at is not null and sharer_id = pg_temp.uid('sharer') from referral.referrals),
                'referral kept pseudonymous, still linked to the sharer');
select tests.ok((select state = 'cancelled' and last_error = 'friend deleted' from referral.rewards where event = 'paid'),
                'the sharer''s held paid reward is cancelled');
select tests.ok(not exists (select 1 from referral.installs where user_id = pg_temp.uid('friend'))
                and exists (select 1 from referral.events where event_id = 'e3'), 'friend''s installs gone, other users'' events kept');
select tests.ok((select deleted_at is not null and eligible_from is null from referral.members where user_id = pg_temp.uid('friend')),
                'members keeps only deleted_at');

-- coming back on the same phone with a new account earns nothing -----------------------------------------------------
select tests.ok(referral.claim(pg_temp.uid('again'), (select code from c), 'friend-tablet-01') ->> 'reason' = 'same_install',
                'a new account on the deleted friend''s tablet is refused');

-- sharer deletes their account -----------------------------------------------------------------------------------------
create temp table sharer_rewards as select id from referral.rewards where user_id = pg_temp.uid('sharer');
grant select on sharer_rewards to postgres;
select tests.ok((referral.delete_user(pg_temp.uid('sharer')) ->> 'codes_retired')::int = 1, 'sharer: code retired');
select tests.ok(exists (select 1 from referral.retired_codes where code = (select code from c))
                and not exists (select 1 from referral.codes where code = (select code from c)), 'the code can never be issued again');
select tests.ok(referral.claim(pg_temp.uid('other'), (select code from c), 'other-phone-0001') ->> 'reason' = 'unknown_code', 'old links stop working');
select tests.ok(not exists (select 1 from referral.rewards where user_id = pg_temp.uid('sharer'))
                and (select count(*) from referral.rewards where id in (select id from sharer_rewards)) = (select count(*) from sharer_rewards),
                'reward rows kept without the user id');
select tests.ok(not exists (select 1 from referral.referrals where sharer_id = pg_temp.uid('sharer')), 'referrals unlinked from the sharer');
select tests.ok(referral.my_code(pg_temp.uid('sharer'), 'sharer-phone-0001') ->> 'reason' = 'account_deleted', 'a deleted account gets no new code');

-- the worker never recreates a deleted user: their rewards are not claimable
select tests.ok(public.referral_svc_claim_reward() is null, 'nothing left to grant for deleted users');

-- auth trigger
create trigger referral_delete_user before delete on auth.users for each row execute function referral.on_auth_user_deleted();
select referral.touch_install(pg_temp.uid('other'), 'other-phone-0001');
delete from auth.users where id = pg_temp.uid('other');
select tests.ok(not exists (select 1 from referral.installs where user_id = pg_temp.uid('other'))
                and (select deleted_at is not null from referral.members where user_id = pg_temp.uid('other')),
                'deleting from auth.users runs delete_user through the trigger');

-- tombstones expire after 12 months
update referral.tombstones set created_at = now() - interval '13 months';
select tests.ok((public.referral_svc_sweep() ->> 'tombstones_purged')::int = 3, 'sweep removes tombstones older than 12 months');

-- privileges
do $$ begin
  perform tests.act_as('authenticated', pg_temp.uid('again'));
  perform public.referral_svc_delete_user(pg_temp.uid('again'));
  raise exception 'authenticated deleted a user';
exception when insufficient_privilege then reset role; perform tests.ok(true, 'only the service role can call referral_svc_delete_user');
end $$;

rollback;
