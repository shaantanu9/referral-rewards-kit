-- Worker cancels of a held paid reward move the referral to paid_cancelled with the cause (migration 8).
\set ON_ERROR_STOP 1
begin;

insert into referral.rules (version, event, who, kind, amount, params) values (1, 'paid', 'sharer', 'entitlement_days', 5, '{"entitlement_id":"premium"}');
create temp table ids as select gen_random_uuid() sharer, gen_random_uuid() f1, gen_random_uuid() f2, gen_random_uuid() f3;
grant select on ids to postgres;

create function pg_temp.paid_reward(friend uuid) returns uuid language plpgsql as $$
declare ref uuid; rid uuid;
begin
  insert into referral.referrals (code, sharer_id, friend_id, rule_set_version, state, paid_at)
    values ('ABCDEFGH', (select sharer from ids), friend, 1, 'paid', now()) returning id into ref;
  insert into referral.rewards (referral_id, user_id, who, event, rule_id, kind, amount, params, grant_key, available_at)
    select ref, (select sharer from ids), 'sharer', 'paid', r.id, 'entitlement_days', 5, r.params, 'entitlement:premium', now() - interval '1 minute'
    from referral.rules r where r.event = 'paid' returning id into rid;
  return rid;
end $$;

create function pg_temp.claim_and_cancel(friend uuid, error text) returns text language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp.paid_reward(friend);
  j := public.referral_svc_claim_reward();
  return public.referral_svc_finish_reward((j ->> 'reward_id')::uuid, (j ->> 'attempt_token')::uuid, 'cancelled', error);
end $$;

select tests.ok(pg_temp.claim_and_cancel((select f1 from ids), 'fresh check: no matching active subscription') = 'cancelled', 'fresh check cancel recorded');
select tests.ok((select state = 'paid_cancelled' and paid_cancel_cause = 'fresh_check' from referral.referrals where friend_id = (select f1 from ids)),
                'referral follows: paid_cancelled, cause fresh_check');
select tests.ok(pg_temp.claim_and_cancel((select f2 from ids), 'refund') = 'cancelled', 'refund cancel recorded');
select tests.ok((select state = 'paid_cancelled' and paid_cancel_cause = 'refund' from referral.referrals where friend_id = (select f2 from ids))
                and (select last_error from referral.rewards w join referral.referrals r on r.id = w.referral_id where r.friend_id = (select f2 from ids)) = 'refund',
                'refund cancel keeps last_error refund so a reversal can restore it');
select tests.ok(pg_temp.claim_and_cancel((select f3 from ids), 'lifetime') = 'cancelled', 'lifetime cancel recorded');
select tests.ok((select state from referral.referrals where friend_id = (select f3 from ids)) = 'paid',
                'a cancel about the sharer (lifetime) leaves the friend''s referral paid');
select tests.ok(not exists (select 1 from referral.privacy_problems()), 'no privacy problems after migration 8');

rollback;
