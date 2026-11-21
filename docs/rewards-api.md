# Rewards API reference

Updated: 2026-11-20
Every endpoint of the rewards engine, for building the user app and a small admin dashboard (setup, checks,
analytics). Design: [ADR 0002](adr/0002-rewards-engine.md) · setup: [rewards integration](rewards-integration.md) ·
Flutter client: [packages/rewards_kit](../packages/rewards_kit/README.md).

All endpoints are Postgres functions called through PostgREST: `POST https://<ref>.supabase.co/rest/v1/rpc/<name>`
with `apikey: <anon key>`, `Authorization: Bearer <user JWT>` and a JSON body of named arguments. From JavaScript:
`supabase.rpc('<name>', { ...args })`. From Flutter: `RewardsClient` (user side).

Errors come back as HTTP 400 (or 401/403) with `message: "rewards: <reason>"`. Times are ISO 8601 UTC.

| Who | Can call |
|---|---|
| Signed-in user | the 5 user endpoints |
| Admin (user listed in `rewards.admins`) | the user endpoints + every `rewards_admin_*` |
| Service role (your server, SQL editor) | every `rewards_admin_*` and `rewards_svc_*` |
| Anyone else | nothing |

## 1. User endpoints

### `rewards_state()`

Everything the app shows. Starts a `first_seen` offer's timer the first time it runs.

```json
{
  "enabled": true,
  "server_time": "2026-11-14T10:00:00Z",
  "programs": [{"key": "daily_quiz", "kind": "streak", "starts_at": null, "ends_at": null, "public": {"title": "Daily quiz streak"}}],
  "streaks": [{"program": "daily_quiz", "current": 3, "longest": 5, "today_done": false, "freezes": 1, "cycle": 1,
               "ends_today_at": "2026-11-14T18:30:00Z", "breaks_at": "2026-11-16T18:30:00Z",
               "next_reward": {"threshold": 7, "kind": "streak_freeze", "amount": 1, "params": {}}}],
  "milestones": [{"program": "quiz_master", "count": 4, "next_reward": {"threshold": 5, "kind": "coins", "amount": 50, "params": {}}}],
  "offers": [{"program": "welcome", "state": "active", "started_at": "…", "ends_at": "…", "stock_left": null,
              "rewards": [{"kind": "coins", "amount": 100, "params": {}}]}],
  "social": [{"program": "ig_tag", "platform": "instagram", "account": "quizzy.app", "state": "pending",
              "code": "QUIZ-K7Q2HX", "expires_at": "…", "rewards": [{"kind": "coins", "amount": 200, "params": {}}]}],
  "inbox": [{"id": "uuid", "program": "daily_quiz", "kind": "coins", "amount": 20, "params": {}, "state": "granted", "created_at": "…"}],
  "badges": [{"badge": "quiz_master", "program": "quiz_master", "granted_at": "…"}]
}
```

- Offer `state`: `not_started` · `active` · `claimed` · `expired` · `sold_out`.
- Social `state`: `none` · `pending` · `verified` · `rejected` · `expired` · `cooldown` (`expires_at` = when a new post is allowed).
- `inbox`: unseen grants (latest 50). `queued` / `granting` / `failed_retryable` = on its way (e.g. Premium days).
- Show countdowns against `server_time`, never the phone's clock.

### `rewards_track(type, dedupe_key?, props?, timezone?)`

Records one action the app is allowed to send (`client` event types). Prefer a database trigger for anything that
matters (quizzes, purchases): see [integration §4](rewards-integration.md#4-link-the-apps-own-tables-quizzes-lessons).

| Arg | Notes |
|---|---|
| `type` | a registered event type with `source = client` |
| `dedupe_key` | counts once per key (`quiz:42`); null = once per local day |
| `props` | object ≤ 2 KB, stored for analytics |
| `timezone` | IANA name (`Asia/Kolkata`); stored on first use, changes at most once per 24 h; invalid names ignored |

Returns `{"enabled": true, "duplicate": false, "grants": [grant], "streaks": [streak]}` (only what changed).
Errors: `unknown_event`, `server_only_event`, `daily_limit`.

### `rewards_offer_claim(program)` → `{"grants": [grant]}`

Errors: `unknown_program`, `offer_not_started`, `offer_claimed`, `offer_expired`, `sold_out`, `disabled`.

### `rewards_social_start(program, handle)` → `{"code": "QUIZ-K7Q2HX", "account": "quizzy.app", "expires_at": "…"}`

Starts (or returns the pending) Instagram task. Errors: `bad_handle`, `handle_taken`, `already_posted`, `too_soon`,
`unknown_program`.

### `rewards_mark_seen(grant_ids)` → number marked

Only `granted` items; pending ones stay in the inbox until they land.

## 2. Admin: setup

| Endpoint | Args | Returns |
|---|---|---|
| `rewards_admin_config()` | — | `{settings, event_types[], programs[]}`; each program has `live` and `rules[]` |
| `rewards_admin_save_settings(patch)` | any of `enabled`, `daily_grant_cap`, `default_timezone`, `max_attempts`, `lease_minutes`, `social_window_days`, `events_retention_days` | the settings; unknown key → `unknown_setting` |
| `rewards_admin_save_event_type(name, source, daily_limit)` | `source`: `client` / `server` | the event type (names with `review` / `rating` are refused) |
| `rewards_admin_save_program(key, kind, enabled, config, public, starts_at, ends_at, sort)` | create or update; `kind` never changes | the program |
| `rewards_admin_add_rule(program, kind, amount, threshold, repeat, params)` | next version is automatic | the rule |
| `rewards_admin_set_rule_active(rule_id, active)` | | the rule |
| `rewards_admin_set_admin(user_id, admin)` | add / remove an admin (not yourself) | `admin` |

Program `config` per kind:

```json
{"streak":     {"event": "quiz_completed", "max_freezes": 2, "auto_freeze": true},
 "milestone":  {"event": "quiz_first_pass"},
 "offer":      {"window_minutes": 1440, "start_on": "first_seen", "stock": 500, "show_stock": true},
 "social_tag": {"platform": "instagram", "account": "quizzy.app", "code_prefix": "QUIZ", "repeat_days": 30}}
```

Rule `repeat`: `once` (at `threshold`, once ever) · `each_cycle` (streaks: again on every new run) · `every` (each
multiple of `threshold`). Offer and social rules take no threshold.

## 3. Admin: checks and support

| Endpoint | Returns |
|---|---|
| `rewards_admin_user(user_id)` | `{state, timezone, grants[], events[{type,count,last_at}], social_posts[]}`; does not start their offers |
| `rewards_admin_track(user_id, type, dedupe_key?, props?)` | fires an event for a test account (any type) |
| `rewards_admin_grants(state?, program?, max_rows?)` | grants, newest first (≤ 500) |
| `rewards_admin_grant(user_id, kind, amount, params, note)` | a manual compensation grant (§11) |
| `rewards_admin_retry_grant(grant_id)` | resets attempts on a `failed` grant and retries; error `not_retryable` |
| `rewards_admin_social_queue(state = 'pending', max_rows?)` | posts to review |
| `rewards_admin_review_social(post_id, approve)` | `{state, grants}` |
| `rewards_admin_log(max_rows?)` | the audit log: who changed what, when |

## 4. Admin: analytics

`rewards_admin_analytics(days = 30)` (UTC days, counts only, never a user id):

```json
{
  "since": "…",
  "daily": [{"day": "2026-11-14", "events": 812, "active_users": 230, "grants": 95}],
  "events_by_type": [{"type": "quiz_completed", "events": 640, "users": 210}],
  "grants_by_program": [{"program": "daily_quiz", "kind": "coins", "state": "granted", "count": 61, "amount": 1220}],
  "streaks": [{"program": "daily_quiz", "bucket": "4-6", "users": 37}],
  "milestones": [{"program": "quiz_master", "users": 180, "avg_count": 3.4}],
  "offers": [{"program": "welcome", "started": 300, "claimed": 120, "expired_unclaimed": 150, "claim_rate": 0.4}],
  "social": [{"program": "ig_tag", "state": "verified", "verified_by": "webhook", "count": 12}],
  "open_problems": {"failed": 0, "retrying": 2, "skipped_cap_today": 0, "social_pending": 5}
}
```

Streak buckets: `1`, `2-3`, `4-6`, `7-13`, `14-29`, `30+`, counting only streaks still alive.

## 5. A small dashboard on this API

| Screen | Calls |
|---|---|
| Overview | `rewards_admin_analytics(30)`: daily line, grants by program, offer claim rate, open problems |
| Programs | `rewards_admin_config()`; edit with `save_program`, `add_rule`, `set_rule_active`; switch everything off with `save_settings({"enabled": false})` |
| User lookup | `rewards_admin_user(id)`; test with `rewards_admin_track` on a test account |
| Instagram queue | `rewards_admin_social_queue()` + `rewards_admin_review_social` |
| Problems | `rewards_admin_grants('failed')` + `rewards_admin_retry_grant` |
| Audit | `rewards_admin_log()` |

```js
// supabase-js, signed in as an admin
const { data: stats } = await supabase.rpc('rewards_admin_analytics', { days: 30 });
await supabase.rpc('rewards_admin_save_program', {
  key: 'daily_quiz', kind: 'streak', enabled: true,
  config: { event: 'quiz_completed', max_freezes: 2 }, public: { title: 'Daily quiz streak' },
});
await supabase.rpc('rewards_admin_add_rule', { program: 'daily_quiz', kind: 'coins', amount: 20, threshold: 3, repeat: 'each_cycle' });
```

## 6. Service role only (Edge Function and servers)

`rewards_svc_track`, `rewards_svc_claim_grants`, `rewards_svc_set_target`, `rewards_svc_finish_grant`,
`rewards_svc_retry_local`, `rewards_svc_expire_social`, `rewards_svc_verify_social`, `rewards_svc_review_social`,
`rewards_svc_delete_user`. Contract: [ADR 0002 §11](adr/0002-rewards-engine.md#11-api-publicrewards_-authenticated-only-security-definer-search_path--).

## 7. Added in 0.2

Contract: [ADR 0002 §18](adr/0002-rewards-engine.md#18-version-02-owner-2026-11-14-build-quiz-module-in-kit-and-all-engine-options--ads--onoff--share-different-app-setup).

### 7.1 State gains

`quests`, `recharges`, `windows`, `friends`, `quizzes`; each streak gains `daily_goal`, `today_count`,
`weekly_free_freezes_left`; a `mystery` reward's `next_reward` carries `odds` (show them); social tasks gain `post_url`.

### 7.2 User endpoints

| Endpoint | Returns / errors |
|---|---|
| `rewards_history(program?, weeks = 15)` | `{"program","daily_goal","days":[{"day","count","frozen"}]}`: for a heatmap |
| `rewards_recap(from_day, to_day)` | `{"days_active","events","grants","best_streak","badges"}`: "your month / your year" |
| `rewards_recharge_use(program, units = 1)` | `{"units","max","next_at"}`; `empty` |
| `rewards_friend_invite(program)` | `{"code":"F7K2Q9XW","expires_at"}` (share it with the app's share sheet) |
| `rewards_friend_accept(code)` | `{"pair_id","program"}`; `bad_code`, `own_code`, `too_many_friends`, `already_friends` |
| `rewards_friend_remove(pair_id)` | `true` |
| `rewards_social_submit_link(program, url)` | the social task with `post_url`; `bad_link`, `no_pending_post` |
| `rewards_quiz_today(program)` | `{"state","day","ends_at","total","current","score","attempts_left","last_result"}` |
| `rewards_quiz_start(program)` | quiz state (resumes an unfinished one); `no_attempts_left`, `not_enough_questions` |
| `rewards_quiz_question(program)` | `{"index","total","question":{"id","kind","prompt","choices","media"},"time_limit_s","served_at","ends_at"}`; never the answer |
| `rewards_quiz_answer(program, index, choice)` | `{"correct","answer","explanation","timed_out","score","finished","grants"}`; `wrong_question`, `not_served` |

Quiz flow: `today` → `start` → (`question` → show with a countdown to `ends_at` → `answer`) × total → result.

### 7.3 Admin

| Endpoint | Use |
|---|---|
| `rewards_admin_export(include_quiz = false)` | Download this app's setup as a JSON file |
| `rewards_admin_import(config, dry_run = true)` | Load another app's file or a preset: dry run shows `changes`, then `dry_run: false` applies; never deletes, never changes a kind |
| `rewards_admin_quiz_save(bank, questions)` | Add or edit questions (`id` to edit; `kind`, `prompt`, `choices`, `answer` index, `time_limit_s`, `media`, `explanation`, `tags`, `active`) |
| `rewards_admin_quiz_list(bank, active?)` | Questions with answers |
| `rewards_admin_quiz_stats(bank, days = 30)` | Per question: served, answered, correct rate, timed out: drop the ones nobody gets right |
| `rewards_admin_save_settings({"ads_enabled": true})` | The ads switch (also `rc_allow_sandbox` for testing) |

Presets ready to import: `supabase/app-config/presets/reader.json`, `quiz.json`, `habit.json`.

### 7.4 RevenueCat (service role, called by the Edge Function)

| Endpoint | When |
|---|---|
| `rewards_svc_rc_event(user_id, event_type, event_id, props)` | Every RevenueCat webhook event: tracked as `rc_<type>` (e.g. `rc_initial_purchase`) when the app registered that event type |
| `rewards_svc_ad_reward(user_id, ad_transaction_id, currency, amount, event_id)` | RevenueCat's `VIRTUAL_CURRENCY_TRANSACTION` with `source = ad_reward`: tracked as `ad_watched` when ads are on |

Dashboard additions for §5: **Settings** (ads switch), **Copy setup** (export / import with the dry-run list),
**Quiz bank** (list, edit, stats).

## 8. Added in 0.3: surprises

Contract: [ADR 0002 §18.6](adr/0002-rewards-engine.md).

| Where | What |
|---|---|
| Rule `params.chance` (0 < c ≤ 1) | The rule pays only with this probability; a miss pays nothing and is not retried (use with `every`, quests, quiz tiers). The grant gets `params.surprise = true` |
| Rule `params.amount_range` `[min, max]` | Whole-number amount drawn per grant; the rule's `amount` must be `max`. The grant gets `params.range` |
| `settings.surprise_daily_cap` (default 3) | At most this many surprise grants per user in 24 h; `0` turns surprises off (and hides their odds) |
| `rewards_state()` → `surprises` | `[{"program","kind","amount","amount_range","chance","params","odds"?}]` for live programs: show it ("1 in 10 chance of 5–30 min") |

Reveal a grant (instead of a toast) when its `params` has `surprise`, `mystery` or `range`.

```json
{"program": "chapter_surprise", "threshold": 1, "repeat": "every", "kind": "minutes", "amount": 30,
 "params": {"chance": 0.1, "amount_range": [5, 30], "audience": "free"}}
```

## 9. Added in 0.4: follow-ups

Contract: [ADR 0002 §18.7](adr/0002-rewards-engine.md).

| Endpoint | Who | Returns |
|---|---|---|
| `rewards_followups_plan(days = 14)` | user | `{"server_time","plan":[{"id","program","at","title","body","payload","group"}]}`: schedule these as local notifications, replan after every refresh |
| `rewards_followup_prefs(patch = {})` | user | `{"notifications_off","emails_off","reminder_time"}` after applying `patch` |
| `rewards_track('followup_opened', '<program>:<day>', {"program"})` | user | when a notification is opened |
| `rewards_admin_followup_preview(program)` | admin | email: `{"count","sample":[{"user_id","email"(masked)}]}`; notification: a note |
| `rewards_admin_followup_plan(user_id, days)` | admin | that user's plan |
| `rewards_admin_followup_sends(max_rows)` | admin | the email send log |
| `rewards_admin_retention(weeks = 8)` | admin | per sign-up week: signups, activated_24h, returned_d1, active_3_of_7, notification_opens, opens_then_active_24h, emails_sent, unsubscribed |
| `rewards_svc_followup_claim(dry_run, max_rows)` · `_finish(send_id, ok, provider_id, error)` · `_unsubscribe(token)` | service | used by `POST /rewards/followups` and `/rewards/unsubscribe` |

New settings: `email_followups_enabled` (false), `email_max_series` (3), `email_cooldown_days` (4), `quiet_from`
(21:00), `quiet_to` (08:00), `default_reminder_time` (19:00). Program kind `followup` (config in the ADR); preset
`supabase/app-config/presets/retention.json`.

## 10. Added in 0.5: follow-up options (ADR 0002 §18.8)

| Change | Where |
|---|---|
| Trigger `{"type": "daily"}` (notifications only): every day at `time` / the reminder time, skipped today once the user was active today | program config |
| `activity_events: ["lesson_done", …]`: only these event types count as activity for that follow-up (must be registered) | program config |
| `trigger.min_actions: N`: only users with at least N activity events | program config |
| `rewards_app.app_excluded_from_followups(user_id) returns boolean`: true = no notifications, no emails. An error in the hook excludes | app hook (default false) |
| `email.template: "<name>"` picks a saved layout; missing → the built-in one | program config |
| `rewards_followup_prefs(patch)` accepts `muted_groups: ["recap", …]` and returns `muted_groups` and `groups: [{"group","label","muted"}]` (label from `public.group_label`) | user |
| `rewards_admin_email_template_save(key, html)` (`html = null` deletes; must contain `{{unsubscribe_url}}`, else `template_needs_unsubscribe`) · `rewards_admin_email_templates()` | admin |
| `rewards_svc_followup_claim` items gain `template_html` (null when none) | service |
| Export / import carry `email_templates` | admin |

Template placeholders: `{{heading}} {{body}} {{button}} {{url}} {{name}} {{subject}} {{app_name}} {{unsubscribe_url}}`.
Values are HTML-escaped, `{{body}}` becomes `<p>` paragraphs, unknown names render empty.

## 11. Added in 0.6: scaled rewards, manual grants, privacy check (ADR 0002 §18.9)

| Change | Who | Details |
|---|---|---|
| Rule `params.amount_from: "<prop>"` + `params.amount_max` (required) | rules | Pays `min(floor(prop of the triggering event) × amount, amount_max)`; `amount` is the multiplier. A missing, non-numeric, zero or negative prop pays nothing. Programs paid by an event only (streak, milestone, quest_set, comeback, friend_streak, quiz: props `score`, `total`); not on mystery, badge, store_offer or with `amount_range`. The grant's params gain `scaled: {"from","value"}`. The app can show "2 per right answer, up to 30" from the rule's params |
| `rewards_admin_grant(user_id, kind, amount, params = {}, note)` | admin | A manual compensation. Returns the grant row + `duplicate`. Errors: `unknown_user`, `note_required`, `bad_amount` (1–1,000,000), `bad_kind` (no `mystery`), `bad_params (…)` (per-kind params; badge and streak_freeze need `params.program`), `unknown_program`. `params.request_id` (8–64 safe characters) makes a resend a duplicate. Key `admin/<user>/<request>`, `rule_id` null, `params.manual = true`; local kinds granted at once (hook), `entitlement_days` / `rc_currency` by `/worker`; logged with the note; not counted against `daily_grant_cap` |
| `rewards.privacy_problems()` | SQL editor (owner) | Rows `(problem, role_name, object_name)`; expected none |

```json
{"program": "lessons", "threshold": 1, "repeat": "every", "kind": "coins", "amount": 2,
 "params": {"amount_from": "correct", "amount_max": 30}}
```

```js
await supabase.rpc("rewards_admin_grant", {
  user_id: "<uuid>", kind: "entitlement_days", amount: 3,
  params: { entitlement_id: "premium", request_id: crypto.randomUUID() }, note: "Outage on 12 Nov",
});
```

## 12. Added in 0.6: weekly leagues (ADR 0002 §18.10)

Program kind `league` (opt-in only). Config: `event` (required), `where`, `score` (`events` | `prop:<name>`),
`max_points_per_event` (1–10000, default 100), `group_size` (5–50, default 20), `week_start` (ISO weekday 1–7,
default 1; the week starts at 00:00 in `settings.default_timezone`), `tiers` (1–10 names, lowest first), `promote`,
`demote` (default 0; need ≥ 2 tiers; `promote + demote < group_size`), `min_score` (default 1). Rules: `threshold` =
a place (1 = first, 3 = top 3), `repeat` `once`; a ranked member is paid only the rules of the best place they reached,
once per week (grant key `…:w<YYYYMMDD>`).

### User

| Endpoint | Returns |
|---|---|
| `rewards_league(program)` | the league object below. Also closes the program's ended weeks and places a joined member in this week's group |
| `rewards_league_join(program)` | the league object (joined). Errors `unknown_program` (missing, not a league, or not live), `disabled` |
| `rewards_league_leave(program)` | the league object (not joined). Off this week's board at once; the tier is kept |

```json
{"program": "weekly", "live": true, "joined": true, "tier": 0, "tier_name": "Bronze", "tiers": ["Bronze", "Silver"],
 "week": "2026-11-09", "starts_at": "…", "ends_at": "…", "server_time": "…",
 "group_size": 20, "promote": 3, "demote": 0, "min_score": 1,
 "rank": 2, "score": 7, "size": 14,
 "members": [{"rank": 1, "name": "Asha", "score": 9, "me": false}, {"rank": 2, "name": null, "score": 7, "me": true}],
 "rewards": [{"threshold": 1, "kind": "coins", "amount": 100, "params": {}}],
 "last_week": {"week": "2026-11-02", "rank": 1, "score": 12, "tier_change": "up", "grants": [grant]} }
```

- `members`: only when joined; `name` comes from `rewards_app.app_display_name(user_id)` (null when empty or when the
  hook fails); `rank` is null below `min_score`; ties share a place. **No member id, email or event is ever returned.**
- A member is placed in a group when they join, open the league, or on their first `event` of the week; their score
  counts events from that moment to `ends_at`.

### Admin and service

| Endpoint | Returns |
|---|---|
| `rewards_admin_leagues(program default null, weeks default 4)` | `[{"program","live","group_size","tiers","members","left","members_by_tier":[{"tier","members"}],"current_week","ends_at","weeks":[{"week","groups","closed_groups","entries","ranked","top_score","grants","promoted","demoted","group_sizes":[{"tier","size","closed"}]}]}]` (counts only) |
| `rewards_admin_league_close()` | `{"closed": n}`: closes every group whose week ended now (logged) |
| `rewards_svc_league_close()` (service role) | number of groups closed |

`rewards_svc_expire_social()` (called by `/worker` every 15 minutes) now also closes ended weeks; an error there is a
warning and never stops social expiry. Export / import carry league programs and rules like any program.
`rewards_recap(from_day, to_day)` (0.2) is unchanged; rewards_kit 0.6.0 adds `RewardsRecapCard` for it.

## Fair play and progress (0.7, migration `20261120000022`)

Why each option exists, with the papers and the EU Digital Fairness Act proposal:
the maintainers' research notes (sections 7–9, not in this repo).

### Choices a user can switch off

`rewards_followup_prefs(patch)` also takes and returns `streaks_off`, `surprises_off`, `timers_off` (booleans, default
false). `rewards_state()` returns them as `"choices": {"streaks_off", "surprises_off", "timers_off"}`.

| Choice | Server | App (rewards_kit 0.7) |
|---|---|---|
| `streaks_off` | Streaks keep counting (switching back is fair); each streak in the state has `"hidden": true`; no `streak_at_risk` follow-up is planned | Streak cards and reminders hidden |
| `surprises_off` | No `chance` bonus is drawn; a `mystery` gives its most likely entry; an `amount_range` gives its midpoint (rounded down); those grants carry `params.fixed: true`; `surprises` (odds) is `[]` | Odds and mystery reveal hidden |
| `timers_off` | Stored only | Countdowns and deadline chips hidden |

### Streak options

| Config | Meaning |
|---|---|
| `repair_days` (1–7, off when absent) | After a missed day nothing covered, the streak can be repaired on any of the next `repair_days` days |
| `repair_count` (2–10, default 2) | Matching events needed on one day to repair. Repair restores the lost length plus the days since, the old cycle (no reward paid twice) and `longest`; rewards the restored length passes are paid; the gap shows as covered in the history |

Each streak object adds:

```json
{"hidden": false, "repair": {"restores_to": 21, "needed": 2, "done": 1, "until": "…"}, "repaired_at": null,
 "best_day_count": 4, "record_today": false}
```

`repair` is null when nothing can be repaired. `best_day_count` is the most matching events on one local day (counted
from 0.7); `record_today` is true when today beat an earlier best (≥ 2 events; never on the first day).

### Milestone options

| Config | Meaning |
|---|---|
| `head_start` (≥ 1) | The count starts here (endowed progress). Give a reason in `public.head_start_label`. Thresholds at or below it never pay, so keep it under the lowest one |
| `count: "sum:<prop>"` | Adds the event's numeric prop (rounded; missing, non-number or below 1 adds nothing) instead of 1. Rules pay when a threshold is crossed |
| `sum_max` (default 1000) | The most one event can add |
| `levels` (1–50 rising whole numbers) | Level = how many are reached; names from `public.level_names` |

Each milestone object adds `"head_start": 2` and `"level": {"number": 1, "name": "Starter", "at": 20, "next_at": 60}`
(null without `levels`).

Not built on purpose: paid repair, points that drain each missed day, streak wagers with paid currency
(maintainers' research notes, section 8).
