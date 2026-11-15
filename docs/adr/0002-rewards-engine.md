# ADR 0002: Rewards engine — streaks, milestones, social tags, timed offers and referrals in one ledger

Updated: 2026-11-14
Status: **Accepted for build, draft 2** (matches the SQL as built and tested; owner, 2026-11-14: "add all this missing part" after the kit-per-app pick).
What it is for: the design every part of the rewards engine is built from (SQL, Edge Function, Flutter package).
Related: [ADR 0001 referral kit](0001-referral-kit.md) · [rewards integration guide](../rewards-integration.md) ·
[ISSUES](../ISSUES.md) · [TODO](../TODO.md)

## 1. Intent

One engine every app installs into its own Supabase project and switches on per feature, "RevenueCat for rewards":

- the app turns on any mix of **programs**: daily streaks, milestones ("invite 3 friends", "read 10 chapters"),
  Instagram tag rewards, timed offers ("claim within 24 h"), and the existing referral flow;
- the engine grants every reward **exactly once**, through the same app hook the referral kit already uses, or
  RevenueCat days through the Edge Function;
- the Flutter package gives the app one state call, one track call and widgets with builders, so **the UI is the
  app's own** (colours, fonts, copy and layout can all be replaced).

## 2. Goals, non-goals, anti-goals

| Goals | Non-goals (0.1) | Anti-goals (failure even if it works) |
|---|---|---|
| Any program on or off per app, any number at once | A hosted multi-app dashboard | A countdown that resets or a "stock" that is not real (Apple 5.6) |
| One ledger, one grant key per (program, rule, user, cycle) | Leaderboards between users | A reward for a store rating or review (Apple 5.6.3, Play) |
| Real server deadlines for every timer | Push sending (the app's own push does it) | A client that can grant itself rewards by calling `track` |
| Instagram mentions verified by Meta's webhook, with a manual review fallback | Automatic TikTok / X verification | A reward that gates core app use (Apple 3.2.2(x)) |
| Referral events feed milestones | Rewriting the referral flow | One user's handle or posts shown to another user |

## 3. Approaches considered

| Approach | Trade-off | Picked |
|---|---|---|
| A. Generalise `referral.rewards` in place | One ledger, but rewrites the most-tested code (271 SQL tests) and its state machine | no |
| **B. New schema `rewards` next to `referral`, with a bridge trigger** | Two ledgers (referral keeps its own), but nothing referral-side changes and every new program is generic | **yes** |
| C. One hosted service for all apps | One dashboard, but hosting, and every app's user data in one place; each app already has its own Supabase and RevenueCat projects | no (owner picked kit per app) |

## 4. Concepts

- **Program**: one feature an app turns on. `key` (e.g. `daily`), `kind`, `enabled`, `starts_at`/`ends_at` (a real
  season window), `config` (kind-specific), `public` (display-only JSON passed to the app untouched, e.g. an icon
  name; never secrets).
- **Kinds**: `streak`, `milestone`, `social_tag`, `offer`. Referral is not a kind: the bridge (section 9) turns
  referral events into ordinary events that a `milestone` program can count.
- **Event type**: a named action, registered in `rewards.event_types` with `source` `client` (the app may send it)
  or `server` (only the service role or a trigger may), and `daily_limit` per user. Names containing `review` or
  `rating` are refused by a check (anti-goal).
- **Rule**: append-only `(program_key, version, threshold, repeat) → (kind, amount, params)`. Change a reward by
  inserting version 2 and deactivating version 1.
- **Grant**: one row in `rewards.grants`, unique `grant_key` = `program:t<threshold>:kind:user[:cycle suffix]`. The key
  always contains the user id, so the first app's bug (a fixed key that only the first user could ever earn) cannot happen;
  it never contains the rule id, so version 2 of the same reward never pays a user who got version 1.

## 5. Data model (schema `rewards`)

| Table | Key columns | Notes |
|---|---|---|
| `settings` | one row: `enabled`, `daily_grant_cap` 1000, `default_timezone` `'UTC'`, `max_attempts` 8, `lease_minutes` 15, `social_window_days` 7 | No secrets |
| `programs` | `key` PK (`^[a-z][a-z0-9_]{1,39}$`), `kind`, `enabled`, `starts_at`, `ends_at`, `config` jsonb, `public` jsonb | |
| `event_types` | `name` PK (same pattern), `source` (`client`/`server`), `daily_limit` (default 50) | |
| `rules` | `id` uuid, `program_key`, `version`, `threshold` int, `repeat` (`once`/`each_cycle`/`every`), `kind`, `amount` numeric, `params` jsonb, `active` | Append-only: only `active` may change (trigger) |
| `members` | `user_id` PK, `timezone`, `timezone_set_at` | Timezone validated against `pg_timezone_names`; changes at most once per 24 h |
| `events` | `id` bigint, `user_id`, `type`, `dedupe_key`, `occurred_at`, `local_day`, `props` jsonb; unique (`user_id`, `type`, `dedupe_key`) | `props` ≤ 2 KB; purged after 90 days except what counters need (counters are stored) |
| `streaks` | (`user_id`, `program_key`) PK, `current`, `longest`, `last_day`, `cycle`, `freezes` | |
| `counters` | (`user_id`, `program_key`) PK, `count` | Milestone progress |
| `offer_windows` | (`user_id`, `program_key`) PK, `started_at`, `ends_at`, `claimed_at` | Inserted once, never updated except `claimed_at`: the deadline cannot reset |
| `social_posts` | `id`, `user_id`, `program_key`, `cycle`, `platform`, `handle` (lower case, no `@`), `code` unique, `state` (`pending`/`verified`/`rejected`/`expired`), `media_id`, `verified_by` (`webhook`/`review`), `created_at`, `decided_at`; unique (`user_id`, `program_key`, `cycle`) | The handle is personal data: deleted with the account |
| `grants` | `id` uuid, `user_id` (null after deletion), `program_key`, `rule_id`, `grant_key` unique, `kind`, `amount`, `params`, `state` (`queued`/`granting`/`granted`/`failed_retryable`/`failed`/`cancelled`/`skipped_cap`), `attempt_token`, `attempts`, `last_error`, `created_at`, `granted_at`, `seen_at`, `target_expires_at` | |
| `badges` | (`user_id`, `badge`) PK, `program_key`, `grant_id`, `granted_at` | Kit-granted kind `badge` |

Kinds the kit grants itself: `badge` (row in `badges`, `params.badge`), `streak_freeze` (adds `amount` freezes to
`params.program` or the rule's own program, capped at `config.max_freezes`). `entitlement_days` stays `queued` for
the Edge Function (section 10). Every other kind calls the app hook
`rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric, params jsonb)`, which must be
idempotent on `grant_id` — the same contract as `referral_app.app_referral_grant`.

## 6. Programs

### 6.1 Streak (`kind = 'streak'`)

Config: `{"event": "<event type>", "max_freezes": 2, "auto_freeze": true}`.

- Each event of `config.event` counts for the member's **local day** (`members.timezone`, else
  `settings.default_timezone`). The same day twice does nothing.
- `last_day = today - 1` → `current + 1`. A gap of `g` missed days with `auto_freeze` and `freezes >= g` → spend
  `g` freezes, `current + 1`. Otherwise `cycle + 1`, `current = 1`. `longest = max(longest, current)`.
- Rules: `threshold = N`. `repeat once`: key `p:rule:user` (first time ever at day N). `each_cycle`: key
  `p:rule:user:c<cycle>` (every new run that reaches N). `every`: when `current % N = 0`, key `p:rule:user:c<cycle>:d<current>`.
- State shown (real times, section 8): `today_done`, `ends_today_at` (local midnight tonight; the streak is at risk
  after it when today is not done), `breaks_at` (when it really resets, counting freezes).

### 6.2 Milestone (`kind = 'milestone'`)

Config: `{"event": "<event type>"}`. Each new (deduplicated) event adds 1 to `counters.count`. Rules with
`threshold = N` grant at `count = N` (`once`) or at every multiple of N (`every`, key `p:rule:user:n<count>`).

### 6.3 Social tag (`kind = 'social_tag'`)

Config: `{"platform": "instagram", "account": "myapp", "code_prefix": "MYAPP", "repeat_days": null}`.

1. The user taps "Tag us": `rewards_social_start(program, handle)` stores the handle and returns a code such as
   `MYAPP-K7Q2HX` (6 random characters from the referral alphabet, no 0/O/1/I/L).
2. The user posts (post, reel or story) mentioning `@account` and puts the code in the caption when possible.
3. Meta calls the Edge Function `/instagram` (section 10.2). The function resolves the mentioning username and the
   caption, then calls `rewards.verify_social(platform, username, caption, media_id)`: a pending post matches by
   code in the caption first, else by handle. Match → `verified` → the program's rules (threshold ignored) grant.
4. No webhook match within `settings.social_window_days` → `expired`. The app's staff can decide any pending post
   with `rewards.review_social(post_id, approve)` (service role).
5. `repeat_days`: null = once ever; N = a new cycle is allowed N days after the last verified one.

Copy rule: the task text tells the user to mark the post as rewarded (e.g. "#ad" or "I got a reward"), because a
paid endorsement must say so in many countries [unconfirmed per country]. Meta's promotion rules forbid
encouraging inaccurate tags; tagging the app's own account on a post about the app is accurate [unconfirmed].

### 6.4 Offer (`kind = 'offer'`)

Config: `{"window_minutes": 1440, "start_on": "first_seen" | "<event type>", "stock": null | int}`.

- The window starts for a user the first time `rewards_state` runs while the program is live (`first_seen`) or on
  their first event of that type. `ends_at = least(started_at + window, program.ends_at)`. Never reset.
- `rewards_offer_claim(program)`: allowed while `now() < ends_at`, not claimed, and stock left
  (`stock - claimed count`, counted under a row lock on the program). Grants every active rule once (key `p:rule:user`).
- `stock` is real and global; `stock_left` is shown only when `config.show_stock` is true.

## 7. Grants

- One insert path: `rewards.queue(user, program, rule, key_suffix, source)` → `insert … on conflict (grant_key) do
  nothing`. A duplicate returns nothing.
- Daily cap: when `settings.daily_grant_cap` grants were created today (UTC), new ones are `skipped_cap`.
- Local kinds are granted at once in a sub-transaction: success → `granted`; an exception → `failed_retryable`
  (`attempts + 1`, `last_error`), retried by `rewards.retry_local()` (cron), `failed` after `max_attempts`.
- `entitlement_days`: `queued` until the Edge Function claims it (`rewards.claim_grants(batch)` sets `granting` +
  a new `attempt_token`, lease `lease_minutes`) and reports `rewards.finish_grant(id, token, ok, error,
  target_expires_at)`; compare-and-set on the token. Expired leases go back to `failed_retryable`.

## 8. Time and honesty

Every deadline the app shows comes from the server (`ends_at`, `ends_today_at`, `breaks_at`), and `rewards_state`
returns `server_time` so the package can correct the phone's clock skew. No deadline is ever computed on the phone
from "now + X". A `stock` count shown to the user is the real count.

## 9. Referral bridge

If schema `referral` exists, a trigger on `referral.referrals` inserts a server event for the **sharer** when a
referral reaches `joined` (`referral_joined`, dedupe key = referral id) or `paid` (`referral_paid`), and for the
**friend** on `joined` (`referral_welcomed`). These event types are created as `server`. A `milestone` program on
`referral_joined` gives "invite 3 friends" rewards. The bridge never blocks the referral update (errors become
warnings).

## 10. Edge Function `rewards`

### 10.1 `/worker` (pg_cron, every 15 min, `Authorization: Bearer <WORKER_SECRET>`)

Claims `entitlement_days` grants and grants them through RevenueCat API v2 (same client and target-expiry rule as
`supabase/functions/referral`, reused, not copied), then `finish_grant`. Also calls `rewards.retry_local()` and
`rewards.expire_social()`.

### 10.2 `/instagram` (Meta webhook)

- `GET`: `hub.mode=subscribe`, `hub.verify_token == INSTAGRAM_VERIFY_TOKEN` → echo `hub.challenge`, else 403.
- `POST`: verify `X-Hub-Signature-256` (`sha256=` HMAC-SHA256 of the raw body with `INSTAGRAM_APP_SECRET`,
  constant-time). Then for each entry: `changes[].field == "mentions"` (`value.media_id`, optional `comment_id`) and
  `messaging[].message.attachments[].type == "story_mention"`. Resolve username + caption through the Graph API
  (`INSTAGRAM_ACCESS_TOKEN`), call `rewards.verify_social`. Always answer 200 quickly after the signature check;
  failures are logged, never retried by us (Meta retries). Payload shapes are [unconfirmed] until a live test.

## 11. API (`public.rewards_*`, `authenticated` only, security definer, `search_path = ''`)

Errors: `raise exception 'rewards: <reason>' using errcode = '22023'` (bad input) or `'42501'` (not signed in);
reasons: `not_signed_in`, `disabled`, `unknown_program`, `unknown_event`, `server_only_event`, `daily_limit`,
`bad_handle`, `handle_taken`, `offer_not_started`, `offer_expired`, `offer_claimed`, `sold_out`, `already_posted`,
`too_soon`.

| Function | Returns |
|---|---|
| `rewards_state()` | the state object below |
| `rewards_track(type text, dedupe_key text default null, props jsonb default '{}', timezone text default null)` | `{"enabled": bool, "duplicate": bool, "grants": [grant], "streaks": [streak]}` (only the changed ones). An invalid timezone is ignored, never an error; a disabled engine returns `enabled: false` and stores nothing |
| `rewards_offer_claim(program text)` | `{"grants": [grant]}` |
| `rewards_social_start(program text, handle text)` | `{"code": "MYAPP-K7Q2HX", "account": "myapp", "expires_at": ts}` |
| `rewards_mark_seen(grant_ids uuid[])` | `int` (rows marked) |

`dedupe_key` null → one per local day (`'day:' || local_day`).

State object (all times ISO 8601 UTC):

```json
{
  "enabled": true,
  "server_time": "2026-11-14T10:00:00Z",
  "programs": [{"key": "daily", "kind": "streak", "starts_at": null, "ends_at": null, "public": {}}],
  "streaks": [{"program": "daily", "current": 3, "longest": 5, "today_done": false, "freezes": 1,
               "ends_today_at": "…", "breaks_at": "…",
               "next_reward": {"threshold": 7, "kind": "coins", "amount": 50, "params": {}}}],
  "milestones": [{"program": "invite3", "count": 1, "next_reward": {"threshold": 3, "kind": "badge", "amount": 1, "params": {"badge": "connector"}}}],
  "offers": [{"program": "welcome", "state": "active", "started_at": "…", "ends_at": "…", "stock_left": null,
              "rewards": [{"kind": "coins", "amount": 100, "params": {}}]}],
  "social": [{"program": "ig_tag", "platform": "instagram", "account": "myapp", "state": "pending",
              "code": "MYAPP-K7Q2HX", "expires_at": "…", "rewards": [{"kind": "coins", "amount": 200, "params": {}}]}],
  "inbox": [{"id": "uuid", "program": "daily", "kind": "coins", "amount": 50, "params": {}, "state": "granted",
             "created_at": "…"}],
  "badges": [{"badge": "connector", "program": "invite3", "granted_at": "…"}]
}
```

- Offer `state`: `not_started` / `active` / `claimed` / `expired` / `sold_out`. Social `state`: `none` / `pending` /
  `verified` / `rejected` / `expired` / `cooldown` (with `expires_at` = when a new one is allowed).
- `inbox`: grants not yet `seen_at`, states `granted` / `queued` / `granting` / `failed_retryable` (latest 50).
- `next_reward` is null when nothing is left to earn.

Service-role only (`public.rewards_svc_*`): `track(user_id, type, dedupe_key, props)`, `claim_grants(batch)`,
`set_target(grant_id, attempt_token, target_expires_at_ms)`, `finish_grant(grant_id, attempt_token, outcome, error,
target_expires_at_ms)` (outcome `granted`/`retry`/`failed`/`cancelled`; answers `{state}` or `{state: "lost_lease"}`),
`retry_local()`, `expire_social()` (also runs the events retention purge), `verify_social(platform, username, caption,
media_id)` (`{matched, post_id, grants}` or `{matched: false, reason}`), `review_social(post_id, approve)`,
`delete_user(user_id)`.

## 12. Deletion

`rewards.delete_user(uid)` (also from a trigger on `auth.users` delete, like the referral kit): deletes events,
streaks, counters, offer windows, badges, social posts (handle); cancels unfinished grants; keeps finished grants with
`user_id = null` so the daily cap and audit stay right.

## 13. Flutter package `rewards_kit`

- `RewardsClient(rpc)`: `state()`, `track(type, {dedupeKey, props})` (sends the phone's IANA timezone),
  `claimOffer`, `startSocial`, `markSeen`. Same `rpc` adapter shape as `referral_kit` (Supabase or HTTP).
- `RewardsController` (ChangeNotifier): holds the last state, the server clock offset, and a stream of new grants.
- Widgets, each with a `builder` that replaces the whole look and a `RewardsTheme` ThemeExtension for colours:
  `StreakCard`, `MilestoneProgress`, `OfferBanner` (live countdown from `ends_at` + clock offset; hides at expiry),
  `SocialTagTask` (code, copy button, `onOpenInstagram` callback, states), `RewardInbox` / `RewardToastListener`,
  `Countdown` (generic). Texts via `RewardsTexts` with English defaults, overridable per string.
- `onEvent` analytics callback with the same naming style as `referral_kit`.

## 14. Store and policy position

| Rule | How the engine complies |
|---|---|
| Apple 5.6: no fake urgency | Deadlines are server rows that never reset; stock is a real count |
| Apple 5.6.3, Play: no rewards for ratings/reviews | Event type names with `review`/`rating` refused by a check |
| Apple 3.2.2(x): never gate core use | Rewards are extras; the integration guide says so |
| Apple 3.1.1: purchased credits may not expire | Reward kinds are the app's promotional currency, kept apart from purchased credit in the app hook (as in the referral kit) |
| Apple 4.5.4: push opt-in for promotions | The engine sends no push; "streak at risk" pushes are the app's, opt-in only |
| Meta promotion rules, ad disclosure | Section 6.3 copy rule [unconfirmed] |

## 16. Events from the app's own tables (owner, 2026-11-14: "quiz is saved in the user db, we just link that")

The app already saves quiz attempts, lessons and chapters. `rewards.event_from_row(type, user_col, dedupe_col,
props_cols)` is a trigger function the app attaches to that table with a `when` clause (`score >= 0.8`). The event is
`server`-only (the phone cannot fake a pass), the dedupe column makes `insert or update` count once (`quiz_id` counts
each quiz once per user), and an error never blocks the app's write. No quiz tables in the kit.

## 17. Admin API and analytics (owner, 2026-11-14: "proper API so a simple frontend can be built to check and set up")

`public.rewards_admin_*`, callable by `authenticated` and `service_role`, each starting with `rewards.require_admin()`:
the service role (JWT role `service_role`) or a user in `rewards.admins`, else `rewards: not_admin`. Setup (settings,
event types, programs, rules as new versions, admins), checks (user view without side effects, test track, grant list,
retry, Instagram queue and review) and analytics (`rewards_admin_analytics(days)`: counts only, never a user id).
Every change goes to `rewards.admin_log` with the actor. Reference for the frontend: [rewards-api.md](../rewards-api.md).

## 18. Version 0.2 (owner, 2026-11-14: "build quiz module in kit and all engine options … ads … on/off … share
different app setup")

Source of the list: a research pass over the first app and common habit apps. Everything is per-app config;
nothing is on unless a program or setting turns it on.

### 18.1 Engine options

| Option | Where | Meaning |
|---|---|---|
| `where` | config of streak, milestone, comeback, friend_streak, quest task | Event filter. Keys: `local_hour`, `local_weekday` (1 = Monday), `prop:<name>`; ops `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`. `{"local_hour": {"in": [23,0,1,2,3]}}` = Night owl; `{"prop:score": {"gte": 9}}` |
| `count: "distinct:<prop>"` | milestone config | Counts different values of a prop ("10 different series"); table `distinct_seen` |
| `daily_goal` | streak config (default 1) | A day counts once this many matching events happened that local day |
| `weekly_free_freezes` | streak config (default 0) | Missed days forgiven for free, at most this many per ISO week, before earned freezes are spent |
| `complete_on` | offer config | The event inside an active window claims the offer by itself (welcome bonus "subscribe within 24 h") |
| `params.audience` | any rule | `all` (default), `free`, `paid`; decided by hook `rewards_app.app_is_paid(uid)` (default false) |
| kind `mystery` | rule | `params.table`: `[{"kind","amount","params","weight"}]`; one entry picked at grant time; the odds are shown in `next_reward.odds` before it is earned (free only, never sold) |
| kind `store_offer` | rule | Kit-granted: the grant carries `params` (`offer_code` or `promotional_offer_id`, `platform`); the app shows Redeem |
| `settings.ads_enabled` | settings (default false) | Master switch for rewarded ads |

### 18.2 New program kinds

| Kind | Config | Rules | State key |
|---|---|---|---|
| `quiz` | `bank`, `questions` (10), `mix` (`{"true_false":[2,3],…}` min/max per kind), `avoid_days` (30), `grace_s` (2), `attempts_per_day` (1) | `threshold` = minimum score; on finish only the **highest** tier reached pays (key `…:d<local day>:a<attempt>`) | `quizzes` |
| `quest_set` | `reset` (`daily` / `weekly` / `never`), `tasks`: `[{"key","event","count","where"}]` | `params.task` = a task's reward; no `params.task` = bonus for all tasks done | `quests` |
| `comeback` | `event`, `after_days` (7), `where` | Granted once per return after ≥ `after_days` without that event | — |
| `recharge` | `max` (3), `every_minutes` (240), `start_full` (true) | none: a unit is the perk; `rewards_recharge_use` spends one | `recharges` |
| `window` | `from` `"21:00"`, `to` `"22:00"`, `days` `[1..7]` (local time) | none: the app reads `active`; `rewards.in_window(uid, key)` for app SQL | `windows` |
| `friend_streak` | `event`, `max_friends` (5), `where` | `threshold` on the pair's streak; both friends paid (key `…:p<pair>:c<cycle>`) | `friends` |

`quiz_finished` (server event, props `program`, `score`, `total`) is emitted on every finish, so a streak, milestone
or quest can listen to it (`where: {"prop:score": {"gte": 9}}`).

### 18.3 New user RPCs

| RPC | Returns |
|---|---|
| `rewards_history(program text default null, weeks int default 15)` | `{"program","daily_goal","days":[{"day":"2026-11-14","count":2,"frozen":false}]}`: the streak's event per local day, oldest first, `weeks*7` days ending today |
| `rewards_recap(from_day date, to_day date)` | `{"days_active","events":[{"type","count"}],"grants":[{"kind","amount","count"}],"best_streak","badges":[…]}` |
| `rewards_recharge_use(program text, units int default 1)` | `{"program","units","max","next_at"}`; error `empty` |
| `rewards_friend_invite(program text)` | `{"code","expires_at"}` (7 days; code `F` + 7 chars) |
| `rewards_friend_accept(code text)` | `{"pair_id","program"}`; errors `bad_code`, `own_code`, `too_many_friends`, `already_friends` |
| `rewards_friend_remove(pair_id uuid)` | `true` |
| `rewards_social_submit_link(program text, url text)` | the social task; errors `bad_link`, `no_pending_post` |
| `rewards_quiz_today(program text)` | quiz state (below) |
| `rewards_quiz_start(program text)` | quiz state; errors `no_attempts_left`, `not_enough_questions` |
| `rewards_quiz_question(program text)` | `{"index","total","question":{"id","kind","prompt","choices":[…],"media":{}},"time_limit_s","served_at","ends_at"}` (never the answer); error `no_attempt` |
| `rewards_quiz_answer(program text, index int, choice int)` | `{"correct","answer","explanation","timed_out","score","finished","grants":[grant]}` |

Quiz state: `{"program","state":"not_started"|"in_progress"|"finished","day","ends_at","total","current","score","attempts_left","last_result":{"score","total","grants"}|null}`.

State additions: streak `daily_goal`, `today_count`, `weekly_free_freezes_left`; `next_reward.odds` for a mystery;
`quests: [{"program","period","ends_at","done","tasks":[{"key","event","count","progress","done","rewards":[spec]}],"bonus":[spec]}]`;
`recharges: [{"program","units","max","every_minutes","next_at"}]`; `windows: [{"program","active","starts_at","ends_at"}]`
(the current window, or the next one); `friends: [{"program","pair_id","friend_id","friend_name","current","longest","today_me","today_friend","breaks_at","next_reward"}]`;
`quizzes: [quiz state]`. Social posts gain `post_url`.

### 18.4 Admin and service

| RPC | Returns |
|---|---|
| `rewards_admin_export()` | `{"format":"rewards-config","version":1,"settings":{…},"event_types":[…],"programs":[…],"rules":[active rules without ids]}` |
| `rewards_admin_import(config jsonb, dry_run boolean default true)` | `{"applied":bool,"changes":[{"what","key","action"}]}`; merge only: creates or updates event types and programs, adds rules not already active (same program, threshold, repeat, kind, amount, params); never deletes; `kind` of an existing program never changes (`change` refused and listed) |
| `rewards_admin_quiz_save(bank text, questions jsonb)` | number saved: upsert by `id` (uuid) or insert new |
| `rewards_admin_quiz_list(bank text, active boolean default null)` | questions with answers |
| `rewards_admin_quiz_stats(bank text, days int default 30)` | `[{"id","prompt","served","answered","correct","correct_rate","timed_out"}]` |
| `rewards_svc_rc_event(user_id uuid, event_type text, event_id text, props jsonb)` | `{"tracked":bool,"reason"}`: a RevenueCat webhook event as engine event `rc_<event_type lower>` (dedupe = RevenueCat event id) when that event type is registered; `ignored_unregistered` otherwise; sandbox ignored unless `settings.rc_allow_sandbox` |
| `rewards_svc_ad_reward(user_id uuid, ad_transaction_id text, currency text, amount numeric, event_id text)` | `{"tracked":bool,"reason"}`: server event `ad_watched` (dedupe = ad transaction id, props `currency`, `amount`) only when `settings.ads_enabled`; `ads_off` otherwise |

### 18.5 RevenueCat link (owner, 2026-11-14: "RevenueCat has the ads setup … link that, we already use RevenueCat")

Sources (fetched 2026-11-14): [RevenueCat ad monetization](https://www.revenuecat.com/docs/ad-monetization),
[granting ad rewards](https://www.revenuecat.com/docs/ad-monetization/rewards),
[webhook event types](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields),
[API v2 in-app currency](https://www.revenuecat.com/docs/api-v2/virtual-currency).

- **Ads stay RevenueCat's.** The app shows rewarded ads with RevenueCat's AdMob adapter (`purchases_flutter` ≥
  10.10.1, `RevenueCatAdMob.loadAndTrackRewardedAd`, `enableRewardVerification`, `showWithRewardVerification`); AdMob's
  SSV goes to RevenueCat's callback, RevenueCat verifies and grants the ad unit's reward (in-app currency and/or a
  temporary entitlement ≥ 30 min). The kit never verifies AdMob itself.
- **The engine hears about it from RevenueCat's webhook**: a second webhook integration pointing at
  `POST /rewards/revenuecat` (`Authorization` = `REWARDS_RC_WEBHOOK_TOKEN`). `VIRTUAL_CURRENCY_TRANSACTION` with
  `source = ad_reward` → `rewards_svc_ad_reward` (`ad_transaction_id`, first adjustment's currency code and amount).
  Every other event → `rewards_svc_rc_event` (props: `product_id`, `store`, `environment`, `price`, `period_type`,
  `source`), so e.g. `rc_initial_purchase` can complete a welcome offer (`complete_on`) or count a milestone. Only events
  whose `app_user_id` is a uuid (the Supabase user id) are used.
- **Reward kind `rc_currency`** (`params.currency_code`, whole `amount`): granted by the worker through API v2
  `POST /projects/{project_id}/customers/{customer_id}/virtual_currencies/transactions` with
  `{"adjustments": {"<code>": amount}, "reference": "<grant_key>"}` and `Idempotency-Key: <grant id>` (key permission
  `customer_information:purchases:read_write`). Like `entitlement_days`, it waits for the worker.
- `settings.ads_enabled` (default false) switches ad rewards on; `settings.rc_allow_sandbox` (default false).
- The kit's earlier plan of its own AdMob SSV route is dropped: RevenueCat does it.

Presets: `supabase/app-config/presets/*.json` (reader, quiz, habit) importable with `rewards_admin_import`.

### 18.6 Surprise and the reveal (owner, 2026-11-14: "dopamine hit … unpredictable nature and reward", then "work on all")

Unexpected rewards keep their pull without wearing down the user's own motivation (expected tangible rewards do;
roadmap §2). Guardrails: free only, odds always shown, no fake near-misses, a daily cap.

| Option | Where | Meaning |
|---|---|---|
| `params.chance` | any rule (0 < chance ≤ 1) | When the rule would pay, it pays only with this probability. A miss pays nothing and is not retried, so use it with `every` rules, quests or quiz tiers. The grant carries `params.surprise = true` |
| `params.amount_range` | any rule except `mystery` | `[min, max]` whole numbers: the amount is drawn uniformly; the rule's `amount` must equal `max` (shown as the most you can get). The grant carries `params.range = [min, max]` |
| `settings.surprise_daily_cap` | settings (default 3, 0 = no surprises) | At most this many surprise grants per user in 24 h; over the cap the draw is skipped (nothing paid) |

State: top-level `surprises: [{"program","kind","amount","amount_range","chance","params"}]` for every active rule
with a `chance` in a live program, so the app can show "1 in 10 chance of 5–50 coins". `next_reward` and `odds`
carry `params.chance` / `params.amount_range` as they are. A grant to reveal (rather than toast) is one whose params
have `surprise`, `mystery` or `range`.

Flutter (rewards_kit 0.3.0): `RewardReveal` (closed → tap → open with a short animation and a haptic, respecting
reduced motion; builder), `showRewardReveal(context, grant)`, `RewardToastListener(revealSurprises: true)` shows the
reveal for those grants and a snackbar for the rest, `SurpriseOdds` lists the odds.

### 18.7 Follow-ups: bring people back (owner, 2026-11-14: "the reward engine should have that feature, so every app with the kit has it")

The rewards engine already knows each user's activity (`events`), real streak deadlines, waiting rewards and last
activity; follow-ups use them instead of a second system. Source of the rules and guardrails: an earlier app's retention design
(retention, follow-up and reporting).

**Program kind `followup`** (no rules; off until an app turns it on). Config:

```json
{ "channel": "notification" | "email",
  "trigger": { "type": "inactive_days", "days": 2 }
           | { "type": "streak_at_risk", "program": "daily", "hours_before": 4 }
           | { "type": "reward_waiting" }
           | { "type": "weekly_recap", "weekday": 7 }
           | { "type": "days_since_signup", "from": 2, "to": 3, "no_activity_since_signup": true, "quiet_days": 0 },
  "time": "19:00",              // local; notifications only; "reminder" = the user's own reminder time
  "group": "daily",             // one notification per local day per group
  "priority": 30,               // higher wins a day
  "title": "Acme", "body": "Your next step is still here.",   // placeholders {{name}} {{streak}} {{days}}
  "payload": "/app/home",       // where the notification opens
  "email": { "subject": "Your first take is still saved, {{name}}", "heading": "…", "body": "…", "button": "Open the app", "url": "https://…" } }
```

Guardrails, enforced by the engine for every app:
- notifications: at most one per local day per `group`; none inside quiet hours (`settings.quiet_from` 21:00 –
  `quiet_to` 08:00, moved to one minute before quiet hours start); none for users with `notifications_off`; the text
  never names content (apps keep `body` generic); planned 14 days ahead and replanned on every activity, so a nudge
  for "inactive 2 days" disappears the moment the user acts;
- emails: only with `settings.email_followups_enabled` (default **false**); never to admins or `emails_off` users;
  each email program at most once per user; at most `email_max_series` (3) follow-up emails per user ever and none
  within `email_cooldown_days` (4) of the last; every email carries a one-click unsubscribe (link + `List-Unsubscribe`
  + `List-Unsubscribe-Post`); the function is dry-run unless `REWARDS_EMAIL_DRY_RUN=false`.

**Hooks** (replace in the app's config; defaults read `auth.users`): `rewards_app.app_signed_up_at(user_id)`,
`rewards_app.app_email(user_id)`, `rewards_app.app_display_name(user_id)` (0.2).

**Tables:** `followup_prefs(user_id, notifications_off, emails_off, reminder_time, unsubscribe_token, updated_at)`,
`followup_sends(id, program_key, user_id, channel, state queued|sent|failed|skipped, provider_id, error, created_at,
sent_at)`, unique (`program_key`, `user_id`) for email.

**User RPCs:**
| RPC | Returns |
|---|---|
| `rewards_followups_plan(days int default 14)` | `{"server_time","plan":[{"id","program","at","title","body","payload","group"}]}` sorted by `at`; `id` is a stable 31-bit integer per (program, local day) for the phone's notification id |
| `rewards_followup_prefs(patch jsonb default '{}')` | `{"notifications_off","emails_off","reminder_time"}` after applying `patch` (only those three keys) |

Opening a notification: the app tracks `followup_opened` (client event, created by the migration) with
`dedupe_key = "<program>:<local day>"` and props `{"program"}`.

**Service RPCs:** `rewards_svc_followup_claim(dry_run boolean, max_rows int)` →
`[{"send_id","program","user_id","email","name","subject","heading","body","button","url","unsubscribe_token"}]`
(dry run: no rows written, `send_id` null); `rewards_svc_followup_finish(send_id, ok, provider_id, error)`;
`rewards_svc_followup_unsubscribe(token)` → `{"ok"}`.

**Edge Function:** `POST /rewards/followups` (worker bearer; daily cron) claims and sends through Resend
(`RESEND_API_KEY`, `REWARDS_EMAIL_FROM`, `REWARDS_APP_NAME`, `REWARDS_PUBLIC_URL`), `GET|POST /rewards/unsubscribe?t=…`
(GET shows a confirm page with a button; POST unsubscribes, also the one-click target).

**Admin:** `rewards_admin_followup_preview(program)` (who would get it now: count + up to 20 with masked emails),
`rewards_admin_followup_sends(max_rows)`, `rewards_admin_retention(weeks int default 8)` → per sign-up week:
`signups`, `activated_24h`, `returned_d1`, `active_3_of_7`, `notification_opens`, `opens_then_active_24h`,
`emails_sent`, `unsubscribed`. Settings gain `email_followups_enabled`, `email_cooldown_days`, `email_max_series`,
`quiet_from`, `quiet_to`, `default_reminder_time`.

**Flutter (rewards_kit 0.4.0):** `FollowupPlanItem` / `FollowupPlan`, `RewardsClient.followupsPlan()`,
`followupPrefs([patch])`, `RewardsController.followupOpened(program)`; `FollowupScheduler(controller, notifier)` with
an app-side `FollowupNotifier` (`cancel(ids)`, `schedule(id, at, title, body, payload)`) that replans after every
refresh/track (debounced) and cancels everything on `stop()` (sign-out); `FollowupSettings` widget (two switches and
the reminder time). No notification plugin in the package.

### 18.8 Follow-ups, the six gaps against an earlier app's own engagement code (owner, 2026-11-14: "add the missing 6 to the kit")

| Gap | In the kit |
|---|---|
| Plain daily reminder | Trigger `{"type": "daily"}`: every day at `time` (or the user's reminder time), skipped today when the user was already active today; replanning after activity drops today's |
| Core activity | Program config `activity_events: ["lesson_done", …]`: only these event types count as activity for that follow-up (inactive days, no activity since sign-up, quiet days, daily). Default: every event but `followup_opened` |
| Only people who did something | Trigger option `min_actions: N` (any follow-up): the user has at least N activity events ever |
| Leave out staff / testers | Hook `rewards_app.app_excluded_from_followups(user_id) returns boolean` (default false): true = no notifications, no emails (e.g. `profiles.role in ('admin','tester')`) |
| Branded emails | Table `email_templates(key, html)`; email config `"template": "<key>"`. Placeholders `{{heading}} {{body}} {{button}} {{url}} {{unsubscribe_url}} {{name}} {{app_name}}` (values HTML-escaped; `{{body}}` becomes paragraphs). A template must contain `{{unsubscribe_url}}`. Missing template → the built-in layout. Admin: `rewards_admin_email_template_save(key, html)` (null html deletes), `rewards_admin_email_templates()`. Templates travel in export / import |
| Per-type off switches | Prefs `muted_groups` (array of group names): notifications of those groups are not planned. `rewards_followup_prefs` returns `groups: [{"group","label","muted"}]` for live notification follow-ups (label = `public.group_label` of the first program in the group, else the group name) |

`rewards_svc_followup_claim` items gain `template_html` (null when none).

Built as (2026-11-14, migration 14): `daily` is notification-only; an error in the exclusion hook excludes (never
message someone by mistake); `{{subject}}` is also a placeholder and unknown placeholders render empty; the client
keeps `lastFollowupPrefs` and adds `setFollowupGroupMuted(group, muted)`. The same migration fixes importing an export
made without quiz questions (`"quiz_questions": null` was refused).

Flutter (rewards_kit 0.5.0): `FollowupPrefs.mutedGroups` and `groups`; `FollowupSettings` shows one switch per group
(under "Reminders"); the client sends `muted_groups` in the patch.

### 18.9 Score-scaled rewards, manual grants, privacy check (2026-11-14, migration 15)

**Score-scaled rewards.** A rule's `params.amount_from` names a prop of the event that triggered it; the grant pays
`min(floor(prop) × amount, amount_max)`.

| Decision | Choice and why |
|---|---|
| What `amount` means | The multiplier (coins per point). `amount_from: "correct"`, `amount: 2` = 2 coins per right answer |
| `amount_max` | **Required** with `amount_from` (whole number > 0): props of client events come from the phone, so an uncapped prop could mint any amount |
| A bad prop | Missing, not a number, zero, negative or below 1 after rounding down: **skipped** (no grant row, nothing paid), never clamped up to a minimum. A fraction is rounded down. A numeric string (`"5"`) counts |
| Grant key | Unchanged (`<program>:t<threshold>:<kind>:<user>:<cycle>`): a replayed event still pays once. The grant's params gain `scaled: {"from","value"}` |
| Which programs | Those paid by an event: streak, milestone, quest_set, comeback, friend_streak, quiz (a quiz tier's "event" is the finished attempt: `score`, `total`, `program`). Not offer or social_tag; not on `mystery`, `badge`, `store_offer`, nor with `amount_range` |
| How the props reach the grant | `rewards.track` puts the event's props in the transaction-local setting `rewards.event_props` before it runs the programs and restores the previous value when it returns (a grant hook that tracks a nested event does not wipe the outer one); `quiz_answer` sets `{"program","score","total"}` around its tier grants; `rewards.queue` reads it. No function signature changed |
| Order in `queue` | After the audience check, before the surprise draw: a skipped scaled grant never uses up a surprise |

Checked by trigger `check_rule_scaled` (a second trigger, like `check_rule_surprise`). A friend streak pays both friends
by the triggering friend's prop.

**Manual compensation grant.** `rewards_admin_grant(user_id uuid, kind text, amount int, params jsonb = '{}', note
text = null)` (admin; `require_admin`):
- `note` required (1–500 characters); goes to the audit log (`rewards.log('grant', {user_id, grant_id, kind, amount,
  params, note})`), not to the user;
- `amount` 1–1,000,000; `kind` any lower-case kind but `mystery`; the per-kind params of a rule (`entitlement_id`,
  `currency_code`, `offer_code`/`promotional_offer_id`; a `badge` also needs `params.program`; a `streak_freeze`
  needs `params.program`, a streak); `params.program` (optional) must exist and becomes the grant's program;
- the grant row has `rule_id = null` (and `program_key = null` unless `params.program`), key
  `admin/<user_id>/<request_id or a new uuid>`, `params.manual = true`. Columns `program_key` / `rule_id` became
  nullable, with check `grants_rule_or_manual`: a grant without a rule must have an `admin/` key. No program grant key
  can start with `admin/` (program keys are `[a-z0-9_]`);
- `params.request_id` (8–64 of `[A-Za-z0-9_-]`, optional, removed from the stored params): sending the same form twice
  returns the first grant with `duplicate: true` and logs nothing new. The admin page sends one per form;
- paid like any grant: local kinds at once through `rewards.grant_local` (badge, streak freeze, or the app's
  `app_reward_grant` hook), worker kinds (`entitlement_days`, `rc_currency`) by `/worker`. **Not** counted against
  `daily_grant_cap` (an admin decided). Returns the grant row (without `attempt_token`, `user_id`) plus `duplicate`.

**Privacy check.** `rewards.privacy_problems()` returns rows `(problem, role_name, object_name)`, expected none (same idea
as `referral.privacy_problems()`): `schema usage` (anon/authenticated on `rewards`/`rewards_app`), `internal function
executable` (PUBLIC/anon/authenticated on anything in those schemas, even while the schema is closed), `table access`
(anon/authenticated on a table or view in those schemas or `public.rewards_*`), `rpc not security definer`, `rpc
without search_path`, `rpc executable by PUBLIC`, `rpc executable by anon`, `service rpc executable by authenticated`,
`admin rpc without require_admin`. Executable by nobody but the owner (run it in the SQL editor). The probe
`supabase/probes/function_grants.sql` now covers the rewards schemas too: verdict `expected_rewards` for a
`public.rewards_*` RPC (not `_svc_`) callable by authenticated that is a definer with `search_path = ''`; anything
else of the kit's is `kit_exposed`.

**Edge Function story.** `scripts/test-rewards-function.sh` (CI job `rewards-function-integration`): unit tests, then
`supabase/functions/rewards/integration_story.ts` on a throwaway Postgres with every migration and a fake RevenueCat:
a score-scaled coins grant fails in the app hook, `/worker` retries it through the hook and grants `entitlement_days`
in RevenueCat, a manual `entitlement_days` goes through the next run on top, a third run does nothing.

### 18.10 Weekly leagues and the recap share card (roadmap #17 and #15)

Roadmap §4 #17 ("popular, unproven, can stress casual users") and #15 (the year-end share card). The owner's standing
rules shape every choice: **opt-in only, no fake urgency, no shame, small groups, nothing private shown, users can
leave.** Off until an app adds a `league` program.

**Program kind `league`** (rules allowed; config checked by trigger `check_league`):

```json
{ "event": "lesson_done",          // required, a registered event type
  "where": {"prop:score": {"gte": 8}},  // optional event filter (18.1)
  "score": "events" | "prop:xp",   // default events: 1 point per event; prop:<name> sums that numeric prop
  "max_points_per_event": 100,     // prop scores only: each event counts at most this (1-10000)
  "group_size": 20,                // 5-50: small groups, never one big board
  "week_start": 1,                 // ISO weekday the week starts (1 = Monday), at 00:00 in settings.default_timezone
  "tiers": ["Bronze", "Silver", "Gold"],  // optional, 1-10 names, lowest first; default one unnamed tier
  "promote": 3,                    // optional (default 0): top N move up a tier at the weekly close
  "demote": 0,                     // optional (default 0): bottom N move down; ties at the bottom never move down
  "min_score": 1 }                 // a member needs this many points to be ranked, rewarded or promoted
```

- **The week** is one boundary for everyone in the program: `week_start` at local midnight in the server's
  `default_timezone`, seven days long. The app shows `ends_at` from the server; nothing is computed on the phone.
- **Opt-in:** `rewards_league_join(program)` enrols the user (`league_members`) and places them in this week's group
  at once. Nobody is ever enrolled by the engine. `rewards_league_leave(program)` removes them from this week's
  group (they vanish from everyone's board) and stops future placement; their tier is kept, so joining again starts
  where they left. Deleting the account deletes all league rows.
- **Groups** (`league_groups`, one per program × week × tier, at most `group_size` entries): a member is placed when
  they join, when they open the board, or on their first `event` of the week (a trigger on `rewards.events`, so
  `rewards.track` is untouched). Each placement fills the oldest group of their tier with room, else opens a new one,
  under an advisory lock so a group never overfills. A member who does nothing all week is never placed: groups hold
  people who are taking part, not ghosts.
- **Score** = matching events from the moment of placement to the week's end (`events` count, or the sum of
  `least(prop, max_points_per_event)`), computed from `rewards.events` when read. Client events can be sent by the
  phone, so a league on a client event trusts the phone as much as a milestone does; use a `server` event (e.g. one
  from `rewards.event_from_row`) when the score must not be faked.
- **Rank** = `rank()` by score among members with `score >= min_score` (ties share a place); others have no rank.
- **Weekly close** (`rewards.league_close()`): every group whose week has ended is closed once (row lock, `skip
  locked`): final score and rank stored on the entry; rewards paid; tiers moved. It runs from the worker
  (`rewards_svc_expire_social`, already called every 15 minutes by `/worker`, now also closes leagues; an error there
  is a warning and never stops social expiry) and lazily when a member opens the board, so results never wait for
  the worker. `rewards_svc_league_close()` and `rewards_admin_league_close()` run it on demand.
- **Rewards** are ordinary rules: `threshold` = a place ("top N"), `repeat` `once`. A ranked member is paid the rules
  of the **best tier they reached** only (the smallest threshold ≥ their rank; every active rule with that threshold),
  grant key `…:w<week start>`, so each week pays once per member and version 2 of a rule never pays the same week twice.
  Audience, chance, mystery and amount ranges work as on any rule.
- **Tiers:** with `promote`, the top N ranked members move up (not above the top tier); with `demote`, the bottom N
  by rank move down (not below the first) and only when their rank is strictly inside the bottom N, so ties never move
  anyone down. Changes apply to the next placement.

**What a member sees** (`rewards_league(program)`): their own `joined`, `tier`, `tier_name`, `week`, `starts_at`,
`ends_at`, `server_time`, `rank`, `score`, `size`, `group_size`, `promote`, `demote`, `min_score` (the rules,
stated plainly), the place rewards, and the board: `members: [{"rank",
"name","score","me"}]`. `name` comes only from the hook `rewards_app.app_display_name(user_id)` (null when the app
does not supply one; an error in the hook is a null name). **No other user's id, handle, email or event is ever
returned.** The board is sorted by score, then by placement time. `last_week` gives only the member's own closed result
(`rank`, `score`, `tier_change` `up`/`same`/`down`, `grants`). Nothing marks a "demotion zone": the default widget shows
who moves up, never who moves down.

**Guardrails as built:** no league exists until an app adds one; joining is a tap by the user; no deadline other than
the real week end; no push, no "you are falling behind" text in the kit; groups of 5-50; leaving is one call and takes
effect at once; the board is visible only to a member of that group.

**Admin:** `rewards_admin_leagues(program default null, weeks default 4)` → per program and week: groups, members,
ranked, closed groups, top score, rewards paid, tier moves; plus the current week's groups with sizes. Counts only, no
names. `rewards_admin_league_close()` → groups closed now. Export / import carry league programs and their rules as any
other program.

**Recap share card (#15):** `rewards_recap(from_day, to_day)` already exists (18.3). rewards_kit 0.6.0 adds
`RewardsRecapCard`: a fixed-ratio card built from a `Recap` (no futures, builder, `RewardsTheme`, `RecapCardTexts`)
for a year ("Your 2026") or any range, plus `RecapShareKey`, a `GlobalKey` helper that wraps the card in a
`RepaintBoundary` and renders it to PNG bytes. Sharing is the app's own (`share_plus` or its own sheet); the package
adds no dependency. Caveat found while building: `rewards_recap` counts `days_active` and `events` from
`rewards.events`, which are purged after `events_retention_days` (90 by default), so a December "Your year" card shows
only the last ~90 days of activity; grants, badges and best streak are kept. An app that wants a true year card raises
the retention before the year (or keeps its own totals).

## 15. Left to the builder

Index choices, exact SQL file split, widget layout defaults, test names. Anything in this document marked
[unconfirmed] must be checked before go-live and is listed in `docs/TODO.md`.
