-- Schema shape and constraints (ADR 5, 9). Runs as the test admin inside a rolled-back transaction.
\set ON_ERROR_STOP 1
begin;

select tests.ok((select count(*) from referral.settings) = 1, 'settings has exactly one row');
select tests.ok((select hold_hours = 72 and claim_window_days = 7 and paid_window_days = 90 and daily_grant_cap = 500
                 and abuse_threshold = 3 and not allow_sandbox from referral.settings()), 'settings defaults match ADR 5');

-- one settings row only
do $$ begin
  insert into referral.settings (id) values (false);
  raise exception 'second settings row was accepted';
exception when check_violation then perform tests.ok(true, 'second settings row refused');
end $$;

-- pepper version must be active
do $$ begin
  update referral.settings set pepper_version = 2;
  raise exception 'inactive pepper version accepted';
exception when check_violation then perform tests.ok(true, 'pepper_version must be in pepper_versions_active');
end $$;

-- code alphabet
do $$ begin
  insert into referral.codes (user_id, code) values (gen_random_uuid(), 'ABCDEFG0');
  raise exception 'code with 0 accepted';
exception when check_violation then perform tests.ok(true, 'code alphabet refuses 0');
end $$;
do $$ begin
  insert into referral.codes (user_id, code) values (gen_random_uuid(), 'abcdefgh');
  raise exception 'lower-case code accepted';
exception when check_violation then perform tests.ok(true, 'code alphabet refuses lower case');
end $$;

-- one active code per user, rotation allowed
do $$
declare u uuid := gen_random_uuid();
begin
  insert into referral.codes (user_id, code) values (u, 'ABCDEFGH');
  begin
    insert into referral.codes (user_id, code) values (u, 'ABCDEFGJ');
    raise exception 'second active code accepted';
  exception when unique_violation then perform tests.ok(true, 'one active code per user');
  end;
  -- disabled_reason exists from migration 2 on; set it when the column is there
  if exists (select 1 from information_schema.columns where table_schema = 'referral' and table_name = 'codes'
             and column_name = 'disabled_reason') then
    execute 'update referral.codes set disabled_at = now(), disabled_reason = ''rotated'' where user_id = $1' using u;
  else
    update referral.codes set disabled_at = now() where user_id = u;
  end if;
  insert into referral.codes (user_id, code) values (u, 'ABCDEFGJ');
  perform tests.ok(true, 'a new code after the old one is disabled');
end $$;

-- rules append-only
do $$
declare r uuid;
begin
  insert into referral.rules (version, event, who, kind, amount) values (1, 'joined', 'sharer', 'minutes', 30)
    returning id into r;
  update referral.rules set active = false where id = r;
  perform tests.ok(true, 'rule can be deactivated');
  begin
    update referral.rules set amount = 60 where id = r;
    raise exception 'rule amount edited';
  exception when raise_exception then
    perform tests.ok(sqlerrm like 'referral.rules is append-only%', 'rule edits refused');
  end;
  begin
    delete from referral.rules where id = r;
    raise exception 'rule deleted';
  exception when raise_exception then
    perform tests.ok(sqlerrm like 'referral.rules is append-only%', 'rule delete refused');
  end;
end $$;

-- current rule set ignores deactivated sets
do $$ begin
  insert into referral.rules (version, event, who, kind, amount) values (1, 'joined', 'friend', 'minutes', 30);
  insert into referral.rules (version, event, who, kind, amount, active) values (2, 'joined', 'friend', 'minutes', 60, false);
  perform tests.ok(referral.current_rule_set() = 1, 'current rule set is the highest with an active rule');
end $$;

-- rewards: one unfinished grant per user and entitlement
do $$
declare u uuid := gen_random_uuid(); ref1 uuid; ref2 uuid; rule uuid;
begin
  insert into referral.rules (version, event, who, kind, amount, params)
    values (1, 'paid', 'sharer', 'entitlement_days', 5, '{"entitlement_id":"premium"}') returning id into rule;
  insert into referral.referrals (code, sharer_id, friend_id, rule_set_version) values ('ABCDEFGH', u, gen_random_uuid(), 1)
    returning id into ref1;
  insert into referral.referrals (code, sharer_id, friend_id, rule_set_version) values ('ABCDEFGH', u, gen_random_uuid(), 1)
    returning id into ref2;
  insert into referral.rewards (referral_id, user_id, who, event, rule_id, kind, amount, grant_key, state)
    values (ref1, u, 'sharer', 'paid', rule, 'entitlement_days', 5, 'entitlement:premium', 'failed_retryable');
  begin
    insert into referral.rewards (referral_id, user_id, who, event, rule_id, kind, amount, grant_key, state,
                                  attempt_token, granting_started_at)
      values (ref2, u, 'sharer', 'paid', rule, 'entitlement_days', 5, 'entitlement:premium', 'granting',
              gen_random_uuid(), now());
    raise exception 'second unfinished grant accepted';
  exception when unique_violation then perform tests.ok(true, 'second unfinished grant for the same user refused');
  end;
  insert into referral.rewards (referral_id, user_id, who, event, rule_id, kind, amount, grant_key, state)
    values (ref2, u, 'sharer', 'paid', rule, 'entitlement_days', 5, 'entitlement:premium', 'queued');
  perform tests.ok(true, 'a queued reward may wait behind an unfinished one');
  begin
    insert into referral.rewards (referral_id, user_id, who, event, rule_id, kind, amount, grant_key, state)
      values (ref1, u, 'sharer', 'paid', rule, 'entitlement_days', 5, 'entitlement:premium', 'queued');
    raise exception 'duplicate reward for the same referral and rule accepted';
  exception when unique_violation then perform tests.ok(true, 'one reward per referral, recipient, event and rule');
  end;
  begin
    update referral.rewards set state = 'granting' where referral_id = ref2;
    raise exception 'granting without lease accepted';
  exception when check_violation then perform tests.ok(true, 'granting needs attempt_token and granting_started_at');
  end;
end $$;

-- self-referral impossible at row level
do $$
declare u uuid := gen_random_uuid();
begin
  insert into referral.referrals (code, sharer_id, friend_id, rule_set_version) values ('ABCDEFGH', u, u, 1);
  raise exception 'self referral row accepted';
exception when check_violation then perform tests.ok(true, 'sharer and friend must differ');
end $$;

-- events never keep subscriber attributes
do $$ begin
  insert into referral.events (event_id, type, fields, event_timestamp_ms)
    values ('e1', 'INITIAL_PURCHASE', '{"subscriber_attributes":{"$email":"x"}}', 1);
  raise exception 'subscriber_attributes stored';
exception when check_violation then perform tests.ok(true, 'events refuse subscriber_attributes');
end $$;

-- hashing
do $$
declare h record; hs bytea[];
begin
  select * into h from referral.hash_new('install-123');
  perform tests.ok(h.pepper_version = 1 and length(h.value_hash) = 32, 'hash_new gives a 32-byte HMAC with version 1');
  perform tests.ok(h.value_hash <> extensions.digest('install-123', 'sha256'), 'HMAC differs from plain sha256');
  perform tests.ok(referral.hmac('install-123', 1) = h.value_hash, 'HMAC is deterministic');
  update referral.settings set pepper_versions_active = '{1,2}', pepper_version = 2;
  hs := referral.hashes_active('install-123');
  perform tests.ok(array_length(hs, 1) = 2 and h.value_hash = any (hs), 'lookups still match version-1 rows after rotation');
  perform tests.ok((select pepper_version from referral.hash_new('x')) = 2, 'new rows use the new pepper');
  begin
    perform referral.hmac('x', 3);
    raise exception 'missing pepper accepted';
  exception when raise_exception then
    perform tests.ok(sqlerrm like '%referral_pepper_v3 is missing%', 'a missing pepper raises instead of hashing');
  end;
end $$;

rollback;
