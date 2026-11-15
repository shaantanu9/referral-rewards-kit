-- rewards engine migration 3: grants as the app sees them, timed offers and social tag posts (ADR 0002 6.3, 6.4, 11).

create function rewards.grants_json(uid uuid, ids uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'program', g.program_key, 'kind', g.kind, 'amount', g.amount,
                  'params', g.params, 'state', g.state, 'created_at', g.created_at) order by g.created_at, g.id), '[]')
    from rewards.grants g where g.user_id = uid and g.id = any(coalesce(ids, '{}'))
$$;

create function rewards.rule_specs(program text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'amount', r.amount, 'params', r.params)
                  order by r.created_at), '[]')
    from rewards.rules r where r.program_key = program and r.active
$$;

-- Real global stock left (section 6.4), or null when the offer has no stock.
create function rewards.stock_left(p rewards.programs) returns int
language sql stable security definer set search_path = '' as $$
  select case when p.config ? 'stock' and jsonb_typeof(p.config -> 'stock') = 'number' then
    greatest((p.config ->> 'stock')::int
             - (select count(*) from rewards.offer_windows w where w.program_key = p.key and w.claimed_at is not null)::int, 0)
  end
$$;

create function rewards.offer_json(uid uuid, p rewards.programs) returns jsonb
language sql stable security definer set search_path = '' as $$
  with w as (select * from rewards.offer_windows x where x.user_id = uid and x.program_key = p.key),
  left_ as (select rewards.stock_left(p) n)
  select jsonb_build_object('program', p.key,
    'state', case when (select claimed_at from w) is not null then 'claimed'
                  when not exists (select 1 from w) then 'not_started'
                  when (select ends_at from w) <= now() or not p.enabled then 'expired'
                  when (select n from left_) = 0 then 'sold_out'
                  else 'active' end,
    'started_at', (select started_at from w), 'ends_at', (select ends_at from w),
    'stock_left', case when coalesce((p.config ->> 'show_stock')::boolean, false) then (select n from left_) end,
    'rewards', rewards.rule_specs(p.key))
$$;

create function rewards.offer_claim(uid uuid, program text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p rewards.programs;
  w rewards.offer_windows;
  r rewards.rules;
  ids uuid[] := '{}';
  gid uuid;
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  if not (rewards.settings()).enabled then raise exception 'rewards: disabled' using errcode = '22023'; end if;
  -- the program row lock serialises claims, so the stock count is exact
  select * into p from rewards.programs x where x.key = program and x.kind = 'offer' for update;
  if p.key is null then raise exception 'rewards: unknown_program' using errcode = '22023'; end if;
  select * into w from rewards.offer_windows x where x.user_id = uid and x.program_key = p.key for update;
  if w.user_id is null then raise exception 'rewards: offer_not_started' using errcode = '22023'; end if;
  if w.claimed_at is not null then raise exception 'rewards: offer_claimed' using errcode = '22023'; end if;
  if w.ends_at <= now() or not p.enabled then raise exception 'rewards: offer_expired' using errcode = '22023'; end if;
  if rewards.stock_left(p) = 0 then raise exception 'rewards: sold_out' using errcode = '22023'; end if;
  update rewards.offer_windows x set claimed_at = now() where x.user_id = uid and x.program_key = p.key;
  for r in select * from rewards.rules x where x.program_key = p.key and x.active order by x.created_at loop
    gid := rewards.queue(uid, r, null);
    if gid is not null then ids := ids || gid; end if;
  end loop;
  return jsonb_build_object('grants', rewards.grants_json(uid, ids));
end $$;

-- Social tag (section 6.3) ------------------------------------------------------------------------------------------

create function rewards.new_social_code(prefix text) returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea;
  c text;
begin
  for attempt in 1..8 loop
    b := extensions.gen_random_bytes(6);
    c := prefix || '-';
    for i in 0..5 loop
      c := c || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
    end loop;
    if not exists (select 1 from rewards.social_posts s where s.code = c) then return c; end if;
  end loop;
  raise exception 'rewards: could not make a unique code';
end $$;

-- What the user sees for one social program. `cooldown` carries when a new post is allowed in expires_at.
create function rewards.social_json(uid uuid, p rewards.programs) returns jsonb
language sql stable security definer set search_path = '' as $$
  with last as (select * from rewards.social_posts x where x.user_id = uid and x.program_key = p.key
                 order by x.cycle desc limit 1),
  rep as (select case when jsonb_typeof(p.config -> 'repeat_days') = 'number' then (p.config ->> 'repeat_days')::int end d),
  st as (select case
      when not exists (select 1 from last) then 'none'
      when (select state from last) = 'verified' and (select d from rep) is null then 'verified'
      when (select state from last) = 'verified'
           and (select decided_at from last) + make_interval(days => (select d from rep)) > now() then 'cooldown'
      when (select state from last) = 'verified' then 'none'
      when (select state from last) = 'pending'
           and (select created_at from last) + make_interval(days => (select s.social_window_days from rewards.settings s where s.id)) <= now()
        then 'expired'
      else (select state from last) end v)
  select jsonb_build_object('program', p.key, 'platform', p.config ->> 'platform', 'account', p.config ->> 'account',
    'state', st.v,
    'code', case when st.v in ('pending', 'rejected', 'expired', 'verified', 'cooldown') then (select code from last) end,
    'expires_at', case
      when st.v = 'pending' then (select created_at from last)
                                  + make_interval(days => (select s.social_window_days from rewards.settings s where s.id))
      when st.v = 'cooldown' then (select decided_at from last) + make_interval(days => (select d from rep)) end,
    'rewards', rewards.rule_specs(p.key))
  from st
$$;

create function rewards.social_start(uid uuid, program text, handle text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p rewards.programs;
  h text := lower(regexp_replace(btrim(coalesce(handle, '')), '^@', ''));
  cur jsonb;
  last rewards.social_posts;
  post rewards.social_posts;
begin
  if uid is null then raise exception 'rewards: not_signed_in' using errcode = '42501'; end if;
  if not (rewards.settings()).enabled then raise exception 'rewards: disabled' using errcode = '22023'; end if;
  select * into p from rewards.programs x where x.key = program and x.kind = 'social_tag';
  if p.key is null or not rewards.is_live(p) then raise exception 'rewards: unknown_program' using errcode = '22023'; end if;
  if h !~ '^[a-z0-9._]{1,30}$' then raise exception 'rewards: bad_handle' using errcode = '22023'; end if;
  -- someone else already holds this handle in this program
  if exists (select 1 from rewards.social_posts s where s.program_key = p.key and s.platform = p.config ->> 'platform'
               and s.handle = h and s.user_id <> uid and s.state in ('pending', 'verified')) then
    raise exception 'rewards: handle_taken' using errcode = '22023';
  end if;
  cur := rewards.social_json(uid, p);
  select * into last from rewards.social_posts x where x.user_id = uid and x.program_key = p.key
   order by x.cycle desc limit 1 for update;
  if cur ->> 'state' = 'verified' then raise exception 'rewards: already_posted' using errcode = '22023'; end if;
  if cur ->> 'state' = 'cooldown' then raise exception 'rewards: too_soon' using errcode = '22023'; end if;
  if cur ->> 'state' = 'pending' then
    update rewards.social_posts x set handle = h where x.id = last.id returning * into post;
  else
    if last.id is not null and last.state = 'pending' then
      update rewards.social_posts x set state = 'expired', decided_at = now() where x.id = last.id;
    end if;
    insert into rewards.social_posts (user_id, program_key, cycle, platform, handle, code)
    values (uid, p.key, coalesce(last.cycle, 0) + 1, p.config ->> 'platform', h, rewards.new_social_code(p.config ->> 'code_prefix'))
    returning * into post;
  end if;
  return jsonb_build_object('code', post.code, 'account', p.config ->> 'account',
    'expires_at', post.created_at + make_interval(days => (rewards.settings()).social_window_days));
end $$;

create function rewards.grant_social(post rewards.social_posts) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  r rewards.rules;
  n int := 0;
begin
  for r in select * from rewards.rules x where x.program_key = post.program_key and x.active order by x.created_at loop
    if rewards.queue(post.user_id, r, 'c' || post.cycle) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Called by the Edge Function for each Instagram mention (section 10.2). A pending post matches by its code in the
-- caption (and the same handle), else by handle when exactly one pending post has it. One media verifies one post.
create function rewards.verify_social(platform text, username text, caption text, media_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  h text := lower(regexp_replace(btrim(coalesce(username, '')), '^@', ''));
  codes text[];
  post rewards.social_posts;
  n int;
  win int := (rewards.settings()).social_window_days;
begin
  if h = '' then return jsonb_build_object('matched', false, 'reason', 'no_username'); end if;
  if media_id is not null and exists (select 1 from rewards.social_posts s where s.platform = verify_social.platform
                                        and s.media_id = verify_social.media_id) then
    return jsonb_build_object('matched', false, 'reason', 'media_used');
  end if;
  select array_agg(m[1]) into codes
    from regexp_matches(upper(coalesce(caption, '')), '([A-Z]{2,8}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6})', 'g') m;
  select s.* into post from rewards.social_posts s join rewards.programs p on p.key = s.program_key and p.enabled
   where s.platform = verify_social.platform and s.state = 'pending' and s.handle = h
     and s.created_at > now() - make_interval(days => win) and s.code = any(coalesce(codes, '{}'))
   limit 1 for update of s;
  if post.id is null then
    select count(*) into n from rewards.social_posts s join rewards.programs p on p.key = s.program_key and p.enabled
     where s.platform = verify_social.platform and s.state = 'pending' and s.handle = h
       and s.created_at > now() - make_interval(days => win);
    if n <> 1 then
      return jsonb_build_object('matched', false, 'reason', case when n = 0 then 'no_pending_post' else 'ambiguous' end);
    end if;
    select s.* into post from rewards.social_posts s join rewards.programs p on p.key = s.program_key and p.enabled
     where s.platform = verify_social.platform and s.state = 'pending' and s.handle = h
       and s.created_at > now() - make_interval(days => win)
     for update of s;
  end if;
  update rewards.social_posts s set state = 'verified', verified_by = 'webhook', media_id = verify_social.media_id,
                                    decided_at = now()
   where s.id = post.id returning * into post;
  return jsonb_build_object('matched', true, 'post_id', post.id, 'grants', rewards.grant_social(post));
end $$;

-- Staff decision on a post the webhook did not match (pending, expired or rejected).
create function rewards.review_social(post_id uuid, approve boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  post rewards.social_posts;
begin
  select * into post from rewards.social_posts s where s.id = post_id for update;
  if post.id is null then raise exception 'rewards: unknown post' using errcode = '22023'; end if;
  if post.state = 'verified' then
    return jsonb_build_object('state', 'verified', 'grants', 0);
  end if;
  update rewards.social_posts s set state = case when approve then 'verified' else 'rejected' end,
         verified_by = case when approve then 'review' end, decided_at = now()
   where s.id = post_id returning * into post;
  return jsonb_build_object('state', post.state, 'grants', case when approve then rewards.grant_social(post) else 0 end);
end $$;

create function rewards.expire_social() returns int
language sql volatile security definer set search_path = '' as $$
  with x as (update rewards.social_posts s set state = 'expired', decided_at = now()
              where s.state = 'pending'
                and s.created_at <= now() - make_interval(days => (select t.social_window_days from rewards.settings t where t.id))
             returning 1)
  select count(*)::int from x
$$;
