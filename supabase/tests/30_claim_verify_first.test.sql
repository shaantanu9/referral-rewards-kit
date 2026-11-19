-- A friend who has not verified their email yet can retry a kept code as often as the app resumes (migration 19);
-- `not_verified` is answered before the 5-per-hour attempt limit counts the call. Rolled back at the end.
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u values ('sharer', gen_random_uuid()), ('friend', gen_random_uuid()), ('guesser', gen_random_uuid());
insert into auth.users (id, email, email_confirmed_at) select id, name || '@example.test', now() - interval '1 hour' from u where name <> 'friend';
insert into auth.users (id, email, email_confirmed_at) select id, 'friend@example.test', null from u where name = 'friend';
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
insert into referral.rules (version, event, who, kind, amount) values (1, 'joined', 'sharer', 'minutes', 30);
create temp table c as select referral.my_code(pg_temp.uid('sharer'), 'sharer-phone-0001') ->> 'code' as code;

select tests.ok(bool_and(referral.claim(pg_temp.uid('friend'), (select code from c), 'friend-phone-0001') ->> 'reason' = 'not_verified'),
                'eight retries before verifying all answer not_verified, never rate_limited')
from generate_series(1, 8);
select tests.ok(not exists (select 1 from referral.claim_attempts a where a.user_id = pg_temp.uid('friend')),
                'not_verified calls are not counted as attempts');

update auth.users set email_confirmed_at = now() where id = pg_temp.uid('friend');
select tests.ok(referral.claim(pg_temp.uid('friend'), (select code from c), 'friend-phone-0001') ->> 'reason' = 'ok',
                'after verifying, the kept code is claimed');

-- a verified account guessing codes is still limited
select tests.ok((select count(*) from generate_series(1, 7) g
                 where referral.claim(pg_temp.uid('guesser'), 'ZZZZ' || lpad(g::text, 4, 'Q'), 'guess-phone-0001') ->> 'reason' = 'rate_limited') = 2,
                'a verified account is still limited to 5 attempts an hour');

rollback;
