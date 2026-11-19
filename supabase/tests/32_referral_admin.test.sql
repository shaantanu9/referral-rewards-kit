-- Admin functions for the Referrals section (migration 21): only admins (rewards.admins via the hook) or the service
-- role; what an admin sees; retry and re-check actions are logged; privacy_problems() stays empty. Rolled back.
\set ON_ERROR_STOP 1
begin;

create temp table u (name text primary key, id uuid not null);
insert into u values ('admin', gen_random_uuid()), ('sharer', gen_random_uuid()), ('f1', gen_random_uuid()),
  ('f2', gen_random_uuid()), ('nobody', gen_random_uuid());
insert into auth.users (id, email, email_confirmed_at) select id, name || '@example.test', now() - interval '1 hour' from u;
create function pg_temp.uid(n text) returns uuid language sql as $$ select id from u where name = n $$;
grant select on u to postgres, authenticated;
insert into rewards.admins (user_id) values (pg_temp.uid('admin'));

insert into referral.rules (version, event, who, kind, amount) values (1, 'joined', 'sharer', 'minutes', 30), (1, 'joined', 'friend', 'minutes', 30);
create table public.app_progress (user_id uuid not null);
grant select on public.app_progress to postgres;
create table public.grant_switch (fail boolean not null);
insert into public.grant_switch values (true);
grant select on public.grant_switch to postgres;
create or replace function referral_app.app_referral_is_active(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_progress p where p.user_id = app_referral_is_active.user_id) $$;
create or replace function referral_app.app_referral_grant(reward_id uuid, user_id uuid, kind text, amount numeric, params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select fail from public.grant_switch) then raise exception 'app ledger down'; end if;
end $$;
revoke execute on function referral_app.app_referral_is_active(uuid), referral_app.app_referral_grant(uuid, uuid, text, numeric, jsonb)
  from public, anon, authenticated, service_role;

create temp table c as select referral.my_code(pg_temp.uid('sharer'), 'sharer-phone-0001') ->> 'code' as code;
grant select on c to authenticated;
select tests.ok(referral.claim(pg_temp.uid('f1'), (select code from c), 'friend-phone-0001') ->> 'reason' = 'ok', 'f1 claims');
select tests.ok(referral.claim(pg_temp.uid('f2'), (select code from c), 'friend-phone-0002') ->> 'reason' = 'ok', 'f2 claims');
insert into public.app_progress values (pg_temp.uid('f1'));
select tests.ok(referral.check_activation(pg_temp.uid('f1')) = 'joined', 'f1 joins; the grant hook fails');
select tests.ok((select count(*) from referral.rewards where state = 'failed_retryable') = 2, 'both rewards failed_retryable');

-- not an admin: refused, every function
do $$
declare fns text[] := array['select public.referral_admin_overview()', 'select public.referral_admin_referrals()',
  'select public.referral_admin_user(''x'')', 'select public.referral_admin_rewards()', 'select public.referral_admin_log()',
  'select public.referral_admin_retry_reward(gen_random_uuid())', 'select public.referral_admin_check_activation(gen_random_uuid())'];
  f text;
begin
  foreach f in array fns loop
    begin
      perform tests.act_as('authenticated', pg_temp.uid('nobody'));
      execute f;
      reset role;
      perform tests.ok(false, 'refused for a non-admin: ' || f);
    exception when insufficient_privilege then
      reset role;
      perform tests.ok(sqlerrm = 'referral: not_admin', 'refused for a non-admin: ' || f);
    end;
  end loop;
end $$;
do $$ begin
  perform tests.act_as('anon');
  perform public.referral_admin_overview();
  reset role;
  perform tests.ok(false, 'anon cannot call admin functions');
exception when insufficient_privilege then
  reset role;
  perform tests.ok(true, 'anon cannot call admin functions');
end $$;

-- admin: overview, list, user, rewards
create temp table o (j jsonb);
create temp table l (j jsonb);
create temp table us (j jsonb);
create temp table rw (j jsonb);
grant all on o, l, us, rw to authenticated;
do $$ begin
  perform tests.act_as('authenticated', pg_temp.uid('admin'));
  insert into o select public.referral_admin_overview(7);
  insert into l select public.referral_admin_referrals();
  insert into us select public.referral_admin_user('sharer@example.test');
  insert into rw select public.referral_admin_rewards();
  reset role;
end $$;
select tests.ok((select (j -> 'referrals_by_state' ->> 'claimed')::int = 1 and (j -> 'referrals_by_state' ->> 'joined')::int = 1 from o),
                'overview: one claimed, one joined');
select tests.ok((select (j -> 'totals' ->> 'problem_rewards')::int = 2 and jsonb_array_length(j -> 'daily') = 7 from o),
                'overview: problem rewards and 7 days');
select tests.ok((select j -> 'top_sharers' -> 0 -> 'sharer' ->> 'email' = 'sharer@example.test'
                    and (j -> 'top_sharers' -> 0 ->> 'total')::int = 2 and (j -> 'top_sharers' -> 0 ->> 'waiting')::int = 1 from o),
                'overview: top sharer with email, total and waiting');
select tests.ok((select (j ->> 'privacy_problems')::int = 0 from o), 'overview: no privacy problems');
select tests.ok((select jsonb_array_length(j -> 'rows') = 2 from l), 'list: both referrals');
select tests.ok((select bool_and(x -> 'sharer' ->> 'email' = 'sharer@example.test') from l, jsonb_array_elements(j -> 'rows') x),
                'list: sharer email on every row');
select tests.ok((select count(*) = 1 from l, jsonb_array_elements(j -> 'rows') x
                  where x ->> 'state' = 'claimed' and x ->> 'activate_by' is not null and x -> 'friend' ->> 'email' = 'f2@example.test'),
                'list: the waiting friend with email and activate_by');
select tests.ok((select jsonb_array_length(x -> 'rewards') = 2 and x -> 'rewards' -> 0 ->> 'last_error' like '%app ledger down%'
                 from l, jsonb_array_elements(j -> 'rows') x where x ->> 'state' = 'joined'),
                'list: rewards with last error on the joined referral');
select tests.ok((select j ->> 'found' = 'true' and jsonb_array_length(j -> 'invited') = 2 and jsonb_array_length(j -> 'codes') = 1
                    and (j -> 'stats' ->> 'claimed_count')::int = 1 from us),
                'user by email: codes, invited, stats');
select tests.ok(public.referral_admin_user((select code from c)) -> 'user' ->> 'email' = 'sharer@example.test', 'user by code (service role)');
select tests.ok(public.referral_admin_user(pg_temp.uid('f1')::text) -> 'invited_by' -> 'sharer' ->> 'email' = 'sharer@example.test',
                'user by id: invited_by');
select tests.ok(public.referral_admin_user('missing@example.test') ->> 'found' = 'false', 'unknown user: found false');
select tests.ok((select jsonb_array_length(j) = 2 from rw), 'rewards: the two failed ones');
select tests.ok(public.referral_admin_referrals(search => 'f2@') -> 'rows' -> 0 -> 'friend' ->> 'email' = 'f2@example.test'
                and jsonb_array_length(public.referral_admin_referrals(search => 'f2@') -> 'rows') = 1, 'search by email');
select tests.ok(jsonb_array_length(public.referral_admin_referrals(state => 'joined') -> 'rows') = 1, 'filter by state');
select tests.ok(public.referral_admin_referrals(max_rows => 1) ->> 'next_before' is not null
                and (select (p1 -> 'rows' -> 0 ->> 'id') <> (p2 -> 'rows' -> 0 ->> 'id') and jsonb_array_length(p2 -> 'rows') = 1
                     from (select public.referral_admin_referrals(max_rows => 1) p1) x,
                          lateral (select public.referral_admin_referrals(max_rows => 1,
                                     before => (x.p1 ->> 'next_before')::timestamptz,
                                     before_id => (x.p1 ->> 'next_before_id')::uuid) p2) y),
                'paging with next_before / next_before_id reaches the second row claimed at the same time');

-- actions
update public.grant_switch set fail = false;
create temp table a (j jsonb);
create temp table sr as select id from referral.rewards where who = 'sharer';
grant all on a, sr to authenticated;
do $$ begin
  perform tests.act_as('authenticated', pg_temp.uid('admin'));
  insert into a select public.referral_admin_retry_reward((select id from sr));
  insert into a select public.referral_admin_check_activation(pg_temp.uid('f2'));
  reset role;
end $$;
select tests.ok((select count(*) = 1 from a where j ->> 'result' = 'granted' and j -> 'reward' ->> 'state' = 'granted'),
                'retry: the sharer reward is granted now');
select tests.ok((select count(*) = 1 from a where j ->> 'state' = 'claimed'), 'check activation: f2 still claimed');
select tests.ok(public.referral_admin_retry_reward((select id from referral.rewards where who = 'sharer')) ->> 'reason' = 'not_failed',
                'retry refuses a reward that is not failed');
select tests.ok((select count(*) = 2 and bool_and(admin_id = pg_temp.uid('admin')) from referral.admin_log), 'both actions logged with the admin');
select tests.ok(jsonb_array_length(public.referral_admin_log()) = 2, 'admin log readable');

-- privacy: empty, and an admin function without the check is reported
select tests.ok(not exists (select 1 from referral.privacy_problems()), 'privacy_problems() empty with admin functions');
create function public.referral_admin_leak() returns int language sql security definer set search_path = '' as $$ select 1 $$;
revoke all on function public.referral_admin_leak() from public, anon;
grant execute on function public.referral_admin_leak() to authenticated;
select tests.ok(exists (select 1 from referral.privacy_problems() where problem = 'admin function without check'),
                'an admin function without require_admin is reported');

rollback;
