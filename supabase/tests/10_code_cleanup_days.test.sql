-- Migration 9: code cleanup independent of the database locale, days_left from the claim, claim_days_left.
\set ON_ERROR_STOP 1
begin;

-- The cleanup must not depend on the locale: run it under the C collation as well as the default.
select tests.ok(referral.normalise_code(E'ABCD EFGH') = 'ABCDEFGH', 'non-breaking space removed');
select tests.ok(referral.normalise_code(E'ABCD　EFGH') = 'ABCDEFGH', 'ideographic space removed');
select tests.ok(referral.normalise_code(E'ABCD EFGH') = 'ABCDEFGH', 'narrow no-break space removed');
select tests.ok(referral.normalise_code('ABCD－EFGH') = 'ABCDEFGH', 'full-width hyphen removed (NFKC first)');
select tests.ok(referral.normalise_code(E'⁦abcd‑efgh⁩') = 'ABCDEFGH', 'isolates and non-breaking hyphen still removed');
select tests.ok(referral.normalise_code('ＡＢＣＤ２３４５') = 'ABCD2345' and referral.normalise_code('ABCD२३४५') = 'ABCD2345'
                and referral.normalise_code('ABCD۲۳۴۵') = 'ABCD2345', 'full-width, Devanagari and Extended Arabic-Indic digits');
select tests.ok(referral.normalise_code(E'AB\u0085CD') = E'AB\u0085CD', 'U+0085 is kept (same list as the Dart and web code)');
select tests.ok(referral.normalise_code(E'ABCD EFGH' collate "C") = 'ABCDEFGH', 'same result under the C collation');

-- days_left and claim_days_left
create temp table u (name text primary key, id uuid not null);
insert into u values ('sharer', gen_random_uuid()), ('friend', gen_random_uuid()), ('late', gen_random_uuid());
insert into auth.users (id, email, email_confirmed_at) select id, name || '@example.test',
  case name when 'late' then now() - interval '5 days' else now() - interval '1 hour' end from u;
grant select on u to postgres, authenticated;
insert into referral.rules (version, event, who, kind, amount) values (1, 'joined', 'friend', 'minutes', 30);
create temp table c as select referral.my_code((select id from u where name = 'sharer'), 'sharer-phone-0001') ->> 'code' as code;
grant select on c to postgres;

select referral.touch_member((select id from u where name = 'late'));
select tests.ok(referral.claim_days_left((select id from u where name = 'late')) = 2, 'claim_days_left: 2 of 7 days left after 5 days');
select tests.ok((referral.claim((select id from u where name = 'late'), (select code from c), 'late-phone-00001') ->> 'days_left')::int = 30,
                'days_left after a claim is the 30-day activation window, not counted from verification');
select tests.ok(referral.claim_days_left((select id from u where name = 'late')) is null, 'claim_days_left is null once referred');

do $$
declare t jsonb;
begin
  perform tests.act_as('authenticated', (select id from u where name = 'friend'));
  t := public.referral_terms('friend-phone-001');
  reset role;
  perform tests.ok((t ->> 'claim_days_left')::int = 7 and t ? 'rules', 'referral_terms carries claim_days_left for the caller');
end $$;

rollback;
