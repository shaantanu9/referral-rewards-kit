-- Codes, installs, members and every claim reason (ADR 6.2, 6.8, 7, 8, 11.7). Rolled back at the end.
\set ON_ERROR_STOP 1
begin;

-- fixtures: users ---------------------------------------------------------------------------------------------------
create temp table u (name text primary key, id uuid not null);
insert into u values ('sharer', gen_random_uuid()), ('friend', gen_random_uuid()), ('friend2', gen_random_uuid()),
  ('unverified', gen_random_uuid()), ('anon', gen_random_uuid()), ('oauth', gen_random_uuid()),
  ('old', gen_random_uuid()), ('kid', gen_random_uuid()), ('spammer', gen_random_uuid()), ('sametel', gen_random_uuid());
insert into auth.users (id, email, email_confirmed_at, is_anonymous)
select id, name || '@example.test',
       case name when 'unverified' then null when 'anon' then null when 'oauth' then null
                 when 'old' then now() - interval '8 days' else now() - interval '1 hour' end,
       name = 'anon'
from u;
insert into auth.identities (user_id, provider, created_at) select id, 'google', now() - interval '2 hours' from u where name = 'oauth';
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
insert into referral.rules (version, event, who, kind, amount) values (1, 'joined', 'sharer', 'minutes', 30), (1, 'joined', 'friend', 'minutes', 30);
insert into referral.rules (version, event, who, kind, amount, params)
  values (1, 'paid', 'sharer', 'entitlement_days', 5, '{"entitlement_id":"premium"}');

-- normalisation -----------------------------------------------------------------------------------------------------
select tests.ok(referral.normalise_code(' abcd-efgh ') = 'ABCDEFGH', 'normalise: trims, removes dash, upper-cases');
select tests.ok(referral.normalise_code(E'⁦ABCD-EFGH⁩') = 'ABCDEFGH', 'normalise: removes bidi isolates from share text');
select tests.ok(referral.normalise_code(E'AB​CD EF‑GH') = 'ABCDEFGH', 'normalise: removes zero-width space and non-breaking hyphen');
select tests.ok(referral.normalise_code('ＡＢＣＤ２３４５') = 'ABCD2345', 'normalise: folds full-width letters and digits');
select tests.ok(referral.normalise_code('ABCD२३४५') = 'ABCD2345', 'normalise: Devanagari digits');
select tests.ok(referral.normalise_code('ABCD٢٣٤٥') = 'ABCD2345', 'normalise: Arabic-Indic digits');

-- code generation ---------------------------------------------------------------------------------------------------
select tests.ok(bool_and(c ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$') and count(distinct c) = 200, 'new_code: 200 codes, valid alphabet, no repeats')
from (select referral.new_code() c from generate_series(1, 200)) g;

-- my_code -----------------------------------------------------------------------------------------------------------
create temp table sharer_code as select referral.my_code(pg_temp.uid('sharer'), 'sharer-phone-0001') ->> 'code' as code;
select tests.ok((select code from sharer_code) ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$', 'my_code creates a code');
select tests.ok(referral.my_code(pg_temp.uid('sharer'), 'sharer-phone-0001') ->> 'code' = (select code from sharer_code), 'my_code returns the same code again');
select tests.ok(referral.my_code(pg_temp.uid('anon'), 'anon-phone-00001') ->> 'reason' = 'anonymous_user', 'my_code refuses anonymous users');
select tests.ok(exists (select 1 from referral.installs i where i.user_id = pg_temp.uid('sharer')), 'my_code records the install');

-- rotation ----------------------------------------------------------------------------------------------------------
select tests.ok(referral.rotate_code(pg_temp.uid('sharer'), 'sharer-phone-0001') ->> 'reason' = 'too_soon', 'rotate refused within 30 days');
update referral.codes set created_at = now() - interval '31 days' where user_id = pg_temp.uid('friend2');
do $$
declare first text; second text;
begin
  first := referral.my_code(pg_temp.uid('friend2'), 'friend2-phone-01') ->> 'code';
  update referral.codes set created_at = now() - interval '31 days' where code = first;
  second := referral.rotate_code(pg_temp.uid('friend2'), 'friend2-phone-01') ->> 'code';
  perform tests.ok(second is not null and second <> first, 'rotate issues a new code after 30 days');
  perform tests.ok(exists (select 1 from referral.retired_codes r where r.code = first), 'rotated code is retired');
  perform tests.ok(referral.claim(pg_temp.uid('friend'), first, 'friend-phone-001') ->> 'reason' = 'unknown_code', 'a rotated code is unknown');
  delete from referral.claim_attempts;
end $$;

-- claim reasons -----------------------------------------------------------------------------------------------------
select tests.ok(referral.claim(pg_temp.uid('anon'), (select code from sharer_code), 'anon-phone-00001') ->> 'reason' = 'anonymous_user', 'claim: anonymous_user');
select tests.ok(referral.claim(pg_temp.uid('unverified'), (select code from sharer_code), 'unver-phone-0001') ->> 'reason' = 'not_verified', 'claim: not_verified');
select tests.ok(referral.claim(pg_temp.uid('old'), (select code from sharer_code), 'old-phone-000001') ->> 'reason' = 'window_closed', 'claim: window_closed after 7 days');
select tests.ok(referral.claim(pg_temp.uid('friend'), 'ZZZZZZZZ', 'friend-phone-001') ->> 'reason' = 'unknown_code', 'claim: unknown_code');
select tests.ok(referral.claim(pg_temp.uid('sharer'), (select code from sharer_code), 'sharer-phone-0001') ->> 'reason' = 'own_code', 'claim: own_code');
select tests.ok(referral.claim(pg_temp.uid('sametel'), (select code from sharer_code), 'sharer-phone-0001') ->> 'reason' = 'same_install', 'claim: same_install on the sharer''s phone');

-- age hook replaced by the app (create or replace keeps the owner, postgres, so it needs to read the fixture)
grant select on u to postgres;
create or replace function referral_app.app_referral_age_ok(user_id uuid, minimum_age int) returns boolean
language sql stable security definer set search_path = '' as $$ select user_id <> (select id from pg_temp.u where name = 'kid') $$;
select tests.ok(referral.claim(pg_temp.uid('kid'), (select code from sharer_code), 'kid-phone-000001') ->> 'reason' = 'under_age', 'claim: under_age from the app hook');

-- success, formatted the way a person types it
do $$
declare r jsonb;
begin
  r := referral.claim(pg_temp.uid('friend'), E'⁦' || lower(substr((select code from sharer_code), 1, 4)) || '-' || substr((select code from sharer_code), 5) || E'⁩', 'friend-phone-001');
  perform tests.ok(r ->> 'reason' = 'ok' and (r ->> 'days_left')::int = 30, 'claim: ok with a pasted, lower-case, dashed code; 30 days to activate');
  perform tests.ok((select count(*) from referral.referrals x where x.friend_id = pg_temp.uid('friend')
                    and x.sharer_id = pg_temp.uid('sharer') and x.state = 'claimed' and x.rule_set_version = 1
                    and x.claim_install_hash is not null) = 1, 'claim stores the referral with rule set and install');
end $$;
select tests.ok(referral.claim(pg_temp.uid('friend'), (select code from sharer_code), 'friend-phone-001') ->> 'reason' = 'already_referred', 'claim: already_referred');
select tests.ok(referral.claim(pg_temp.uid('oauth'), (select code from sharer_code), 'friend-phone-001') ->> 'reason' = 'same_install', 'claim: another account on a phone that already claimed');
select tests.ok(referral.claim(pg_temp.uid('oauth'), (select code from sharer_code), 'oauth-phone-0001') ->> 'reason' = 'ok', 'claim: an OAuth identity counts as verified');

-- tombstoned install (a deleted friend's phone)
insert into referral.tombstones (kind, value_hash, pepper_version) values ('install', referral.hmac('ghost-phone-0001', 1), 1);
select tests.ok(referral.claim(pg_temp.uid('friend2'), (select code from sharer_code), 'ghost-phone-0001') ->> 'reason' = 'same_install', 'claim: tombstoned install refused');

-- rate limit: 6th attempt within an hour
do $$
declare r jsonb; i int;
begin
  for i in 1 .. 5 loop
    perform referral.claim(pg_temp.uid('spammer'), 'WRONGCD' || i, 'spam-phone-00001');
  end loop;
  r := referral.claim(pg_temp.uid('spammer'), (select code from sharer_code), 'spam-phone-00001');
  perform tests.ok(r ->> 'reason' = 'rate_limited' and (r ->> 'retry_after_seconds')::int between 3000 and 3600, 'claim: rate_limited with retry_after_seconds');
  r := referral.claim(pg_temp.uid('friend2'), (select code from sharer_code), 'spam-phone-00001');
  perform tests.ok(r ->> 'reason' = 'rate_limited', 'claim: the limit also holds per install, across accounts');
end $$;

-- abuse-disabled code is unknown, and my_code does not silently replace it
update referral.codes set disabled_at = now(), disabled_reason = 'abuse' where code = (select code from sharer_code);
select tests.ok(referral.my_code(pg_temp.uid('sharer'), 'sharer-phone-0001') ->> 'reason' = 'code_disabled', 'my_code: code_disabled after abuse review');
delete from referral.claim_attempts;
select tests.ok(referral.claim(pg_temp.uid('friend2'), (select code from sharer_code), 'friend2-phone-01') ->> 'reason' = 'unknown_code', 'claim: disabled code reads as unknown');

-- program paused
update referral.settings set enabled = false;
select tests.ok(referral.claim(pg_temp.uid('friend2'), 'ABCDEFGH', 'friend2-phone-01') ->> 'reason' = 'program_paused', 'claim: program_paused');
update referral.settings set enabled = true;

-- terms
select tests.ok((referral.terms() -> 'rules') @> '[{"event":"paid","who":"sharer","kind":"entitlement_days","amount":5}]'
                and (referral.terms() ->> 'claim_window_days')::int = 7, 'terms: current rules and windows');

-- install id validation
do $$ begin
  perform referral.claim(pg_temp.uid('friend2'), 'ABCDEFGH', 'bad id; drop');
  raise exception 'bad install id accepted';
exception when invalid_parameter_value then perform tests.ok(true, 'install_id with odd characters refused');
end $$;

-- wrappers: signed-in user only, through auth.uid()
do $$
declare r jsonb;
begin
  perform tests.act_as('authenticated', pg_temp.uid('friend2'));
  r := public.referral_my_code('friend2-phone-01');
  reset role;
  perform tests.ok(r ->> 'reason' = 'ok', 'wrapper: authenticated user gets their code');
end $$;
do $$ begin
  perform tests.act_as('authenticated', null);
  perform public.referral_my_code('friend2-phone-01');
  raise exception 'call without a user accepted';
exception when insufficient_privilege then
  reset role;
  perform tests.ok(true, 'wrapper: refused without auth.uid()');
end $$;
do $$ begin
  perform tests.act_as('anon', null);
  perform public.referral_claim('ABCDEFGH', 'friend2-phone-01');
  raise exception 'anon called claim';
exception when insufficient_privilege then
  reset role;
  perform tests.ok(true, 'wrapper: anon cannot call referral_claim');
end $$;

rollback;
