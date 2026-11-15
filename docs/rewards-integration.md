# Rewards integration guide

Updated: 2026-11-14
Add the rewards engine (streaks, quiz and other milestones, Instagram tags, timed offers) to any Flutter + Supabase
app, from zero to live. API: [rewards-api.md](rewards-api.md) · design: [ADR 0002](adr/0002-rewards-engine.md) ·
referral flow (separate, optional): [integration.md](integration.md).

Status: **0.2 tested locally (594 SQL, 49 function tests; Flutter see the package); not yet run on a live project, a phone, RevenueCat or Meta.**

## 1. What you get

| Piece | Path |
|---|---|
| SQL (schema `rewards`, user + admin API) | `supabase/migrations/20261114000002..6_rewards_*.sql` |
| Per-app config | `supabase/app-config/rewards-template.sql` (example `examples/quiz-app/rewards_config.sql`) |
| Edge Function `rewards` (`/worker`, `/instagram`) | `supabase/functions/rewards` (+ `supabase/functions/referral`, it reuses its RevenueCat code) |
| Flutter package | `packages/rewards_kit` |

You need the Edge Function only for `entitlement_days` rewards and Instagram verification. Coins, minutes, badges
and streak freezes are granted inside the database at once.

## 2. Database

1. Copy the five `*_rewards_*` migrations into the app's `supabase/migrations/` unchanged (after the referral ones if
   the app has them: the bridge then turns referral joins into `referral_joined` events).
2. Copy `rewards-template.sql` as the next migration and fill it (§3, §4).
3. Try it in a transaction you roll back, then apply (owner's go-ahead for a live project).

## 3. Choose programs and rewards

| You want | Program | Rule |
|---|---|---|
| "Do a quiz every day" | `streak` on `quiz_completed` | `threshold 3, each_cycle, coins 20`; `threshold 7, every, streak_freeze 1` |
| "Pass 10 different quizzes" | `milestone` on `quiz_first_pass` | `threshold 10, once, badge quiz_master` |
| "Every 5 quizzes passed" | `milestone` on `quiz_passed` | `threshold 5, every, coins 50` |
| "Invite 3 friends" | `milestone` on `referral_joined` | `threshold 3, once, entitlement_days 7` |
| "Welcome gift, 24 h" | `offer`, `window_minutes 1440` | `coins 100` |
| "Tag us on Instagram" | `social_tag` | `coins 200` |

Reward streaks on real practice (a quiz finished), not on app opens.

## 4. Link the app's own tables (quizzes, lessons)

The quiz results already live in the app's table. Attach a trigger; nothing else in the app changes:

```sql
create trigger rewards_quiz_completed after insert or update of completed_at on public.quiz_attempts
  for each row when (new.completed_at is not null)
  execute function rewards.event_from_row('quiz_completed', 'user_id', 'id', 'quiz_id,score');
create trigger rewards_quiz_passed after insert or update of completed_at on public.quiz_attempts
  for each row when (new.completed_at is not null and new.score >= 0.8)
  execute function rewards.event_from_row('quiz_passed', 'user_id', 'id');
create trigger rewards_quiz_first_pass after insert or update of completed_at on public.quiz_attempts
  for each row when (new.completed_at is not null and new.score >= 0.8)
  execute function rewards.event_from_row('quiz_first_pass', 'user_id', 'quiz_id');
```

- Arguments: event type, user column, dedupe column (`id` = each attempt once; `quiz_id` = each quiz once per user),
  columns copied into `props`.
- The dedupe key makes `insert or update` safe, and a rewards error never blocks the app's own write.
- Register these event types as `server`, so the phone cannot fake a pass.
- Rows saved before the trigger existed are not counted. To count them, run once:
  `select rewards.track(user_id, 'quiz_first_pass', 'quiz_attempts:' || quiz_id, '{}', null, true) from (select distinct user_id, quiz_id from public.quiz_attempts where score >= 0.8) x;`

## 5. The grant hook

`rewards_app.app_reward_grant(grant_id, user_id, kind, amount, params)` pays your own kinds (coins, minutes). It
must be idempotent on `grant_id`: pass `'rewards:' || grant_id` as your credit function's idempotency key.

```sql
perform public.coin_grant(app_reward_grant.user_id, amount::int, 'rewards:' || grant_id::text);
```

A failing hook never loses a reward: the grant stays `failed_retryable` and the worker (or an admin) retries it.

## 6. Edge Function (only for Premium days or Instagram)

```bash
supabase secrets set REWARDS_WORKER_SECRET=… REVENUECAT_SECRET_KEY=… REVENUECAT_PROJECT_ID=… \
  INSTAGRAM_VERIFY_TOKEN=… INSTAGRAM_APP_SECRET=… INSTAGRAM_ACCESS_TOKEN=…
supabase functions deploy rewards --no-verify-jwt
```

Schedule `/rewards/worker` every 15 minutes (pg_cron snippet at the end of the template). Instagram: in the Meta app,
subscribe the Instagram professional account's webhook to `mentions` (and messaging `story_mention` if you want
stories) with callback `https://<ref>.supabase.co/functions/v1/rewards/instagram` and your verify token. The payload
shapes and Graph paths are **[unconfirmed]** until the first live test (TODO).

## 7. Flutter

```dart
final rewards = RewardsController(client: RewardsClient(
  rpc: (fn, p) => Supabase.instance.client.rpc(fn, params: p),
  timezone: () async => (await FlutterTimezone.getLocalTimezone()).identifier, // flutter_timezone 5.x
  onEvent: (e) => analytics.log(e.name.wire, e.props),
));

RewardToastListener(controller: rewards, child: RewardsHub(controller: rewards, onOpenInstagram: openInstagram));
```

After a quiz the app does nothing (the trigger counts it); call `rewards.refresh()` to update the screen. Every
widget has a `builder` for the app's own look: see the [package README](../packages/rewards_kit/README.md).

## 8. Admin and analytics

Ready-made page: [`web/rewards-admin`](../web/rewards-admin/README.md) (try `?demo` first).

Add the first admin in the config (`insert into rewards.admins …`), then build the small dashboard from
[rewards-api.md §5](rewards-api.md#5-a-small-dashboard-on-this-api): overview, programs, user lookup, Instagram
queue, problems, audit log. Every admin change is logged with who did it.

## 9. Go-live checks

- [ ] Check what the API roles can call, on the live project (SQL editor): `select * from rewards.privacy_problems();`
      must return **no rows** (0.6; it checks schema usage, internal functions, tables, definer + `search_path` on
      every `public.rewards_*`, service and admin RPCs). Then run `supabase/probes/function_grants.sql`: every row it
      lists needs a look. Re-run both after every migration of the app's own (a config migration that replaces a hook
      without the revoke shows up here).
- [ ] A test account: finish a quiz, see the event in `rewards_admin_user`, see the grant land in the app.
- [ ] Every timer the app shows comes from the state, never "now + X" on the phone.
- [ ] Reward copy states its condition; Instagram copy asks for a rewarded-post label (#ad).
- [ ] Account deletion trigger attached (`rewards_delete_user`).

## Gotchas

| Symptom | Cause | Fix |
|---|---|---|
| Only the first user ever gets a streak reward | A hand-made grant key without the user id (first app, 2026-11-13) | Use the engine: its key always holds the user id |
| A rule change pays everyone again | Rule id in the key | The engine keys by (program, threshold, kind, user, cycle), so a new version never pays twice |
| Hook runs but nothing is credited, `permission denied` in `last_error` | The hook's owner cannot reach the app's table | Create the hook as the role that owns the app's tables (the migration role) |
| Quiz finished, no event | Trigger `when` not met, or event type missing | `rewards_admin_user` shows event counts; check the `when` clause and `event_types` |
| `rewards: not_admin` from the dashboard | User not in `rewards.admins` | `rewards_admin_set_admin` as the service role |

## 10. Added in 0.2

### Start from a preset or another app's setup

1. Apply migrations `20261114000007..11` after the 0.1 ones.
2. As an admin: `rewards_admin_import(<preset or exported file>, true)` → read the change list →
   `rewards_admin_import(<same>, false)`. Presets: `supabase/app-config/presets/reader.json` (reader-app style),
   `quiz.json`, `habit.json`. To copy app A to app B: `rewards_admin_export(true)` on A, import on B.
3. Rename the reward kinds to the app's own (`chapters`, `minutes`, `coins`…) in the file before importing, and
   make `rewards_app.app_reward_grant` pay them.

### Daily quiz

Load questions with `rewards_admin_quiz_save('default', [...])` (or include `quiz_questions` in an import), add a
`quiz` program and rules whose `threshold` is the minimum score (only the best tier reached pays). A streak or
milestone on `quiz_finished` (`where: {"prop:score": {"gte": 9}}`) adds quiz streaks and perfect-score badges.
Check `rewards_admin_quiz_stats` weekly: questions with a very low correct rate are usually unclear.

### Rewarded ads through RevenueCat (owner, 2026-11-14)

1. RevenueCat: Ad monetization on, AdMob linked; in AdMob turn on impression-level revenue and point the rewarded ad
   unit's server-side verification at RevenueCat's callback
   (`https://api.revenuecat.com/v1/incoming-webhooks/admob-ssv-rewarded`); set each ad unit's reward (in-app
   currency and/or a temporary entitlement ≥ 30 min) in the RevenueCat dashboard.
   [Docs](https://www.revenuecat.com/docs/ad-monetization/rewards). Google's test ad unit ids cannot use SSV.
2. RevenueCat → Integrations → add a **second webhook**: URL `https://<ref>.supabase.co/functions/v1/rewards/revenuecat`,
   Authorization = `REWARDS_RC_WEBHOOK_TOKEN` (`supabase secrets set …`).
3. The app identifies RevenueCat users with the **Supabase user id** (`Purchases.logIn(uid)`), or the engine cannot
   tell whose ad it was.
4. Flutter: copy `examples/rewards_ads_check/lib/revenuecat_rewarded_ad.dart` (compiled against `purchases_flutter`
   11.0.2, `purchases_admob_flutter` 11.0.2, `google_mobile_ads` 8.0.0) and use
   `RewardedAdButton(onShowAd: RevenueCatRewardedAd(adUnitId: …).show)`. To prove the whole flow on a phone first, run
   [`examples/rewards_ads_check`](../examples/rewards_ads_check/README.md).
5. Turn it on: `rewards_admin_save_settings({"ads_enabled": true})`. Off again any time; ad rewards from RevenueCat
   still land, the engine just stops counting them.
6. Use `ad_watched` in programs: a milestone ("watch 5 ads → badge"), a quest task, or a recharge refill rule in the
   app. The ad's own reward stays RevenueCat's.

### Purchases as events

Register `rc_initial_purchase` (and any other `rc_<type>`) as a `server` event type: a welcome offer with
`complete_on: "rc_initial_purchase"` then pays when the user subscribes inside the window. Sandbox events count
only with `rc_allow_sandbox`.

### Rewards in RevenueCat in-app currency

Rule kind `rc_currency` with `params.currency_code` (e.g. `GEMS`): the worker adds it to the user's RevenueCat
balance with the grant id as `Idempotency-Key`. The RevenueCat secret key needs
`customer_information:purchases:read_write`. Use it when the app already sells or spends that currency.

### Gotchas (0.2)

| Symptom | Cause | Fix |
|---|---|---|
| Ads watched but `ad_watched` never appears | `ads_enabled` off, or RevenueCat user id is not the Supabase uuid | Turn the switch on; `Purchases.logIn(supabaseUserId)` |
| `rc_initial_purchase` ignored | Event type not registered, or a sandbox purchase | Register it as `server`; `rc_allow_sandbox` while testing |
| Quiz start says `not_enough_questions` | Bank smaller than `questions`, or all inactive | Add questions or lower `questions` |
| A daily-goal streak never moves | `daily_goal` higher than the events the app sends a day | Check `today_count` in the state |
| An import says `refused_kind_change` | Same key, different kind in the file | Rename the key in the file |

## 11. Surprise rewards (0.3)

The pull of not knowing, kept honest (ADR 0002 §18.6):

1. Add a rule with `params.chance` (and optionally `amount_range`) on something people already do: every finished
   chapter, every quiz with a perfect score, a quest. The admin page's Programs section takes the JSON; the reader
   and quiz presets include one.
2. Keep `surprise_daily_cap` low (default 3). Set it to 0 to switch every surprise off at once.
3. In Flutter (rewards_kit 0.3.0): `RewardToastListener(revealSurprises: true)` opens the reveal for surprise, mystery
   and ranged grants; `SurpriseOdds` shows the odds from the state. Show the odds somewhere the user can find them.

Never: paid surprises, hidden odds, "you almost won" screens, surprises for ratings, reviews, tracking or push.

## 12. Follow-ups: bring people back (0.4)

Every app with the kit has them; nothing is sent until you turn it on (ADR 0002 §18.7).

1. **Rules:** import `presets/retention.json` (comeback +2/+5/+12 days, Sunday recap, emails on days 2, 7 and 21) or
   add programs of kind `followup` on the admin page. The reader, quiz and habit presets carry lighter sets
   (streak at risk, comeback, reward waiting). Replace `App` and the email URL with yours.
2. **Phone notifications:** rewards_kit 0.4.0 `FollowupScheduler(controller, notifier).start()` after sign-in,
   `.stop()` on sign-out; `notifier` wraps the app's own plugin (example in the package README). The server plans,
   so the guardrails hold everywhere: one a day per group, quiet hours, nothing in the past, cancelled by activity.
   Track opens with `controller.followupOpened(program)` from the notification tap.
3. **Settings screen:** `FollowupSettings` (reminders on/off, emails on/off, reminder time).
4. **Emails** (optional): Resend domain verified, then
   `supabase secrets set RESEND_API_KEY=… REWARDS_EMAIL_FROM="App <hello@your.domain>" REWARDS_APP_NAME=App
   REWARDS_PUBLIC_URL=https://<ref>.supabase.co/functions/v1/rewards`, schedule `POST /rewards/followups` daily (cron
   line in the config template), check the admin page's Follow-ups → "Who now?" and the function's dry-run answer, then
   `email_followups_enabled` on and `REWARDS_EMAIL_DRY_RUN=false`. Every email has a one-click unsubscribe.
5. **Read it weekly:** admin page → Retention (3 of first 7 days is the north star).

Copy rules that stay true in every app: the text points at something real, no guilt or fake urgency, nothing private
on the lock screen, easy off.

## 13. Follow-up options (0.5)

- **Daily reminder:** a notification program with `"trigger": {"type": "daily"}` and `"activity_events": ["<your core
  event>"]`. It is skipped on days the user already did the thing. Put it in its own `group` so people can switch it
  off alone.
- **Count only the core action:** `activity_events` on any follow-up (app opens then do not reset "inactive").
- **Only people who started:** `"min_actions": 1` in the trigger.
- **Leave out staff and testers:** replace the hook in your config migration:

```sql
create or replace function rewards_app.app_excluded_from_followups(user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = user_id and p.role in ('admin', 'tester'))
$$;
```

- **Branded emails:** admin page → Follow-ups → Email templates (live preview), then `"template": "<name>"` in the
  email program's `email` settings. The template must contain `{{unsubscribe_url}}`.
- **Per-type switches:** give each group a label with `public.group_label` on its first program;
  rewards_kit 0.5.0 `FollowupSettings` shows one switch per group, or call `client.setFollowupGroupMuted(group, true)`.

## 14. Scaled rewards, manual grants, privacy check (0.6)

- **Pay by the score:** track the event with the number in its props (`rewards_track('lesson_done', …, {"correct": 7})`)
  and give the rule `"params": {"amount_from": "correct", "amount_max": 30}`; `amount` is per point (2 → 14 coins).
  For the daily quiz use `"amount_from": "score"` on a tier rule. Props of client events come from the phone: keep
  `amount_max` low and the event's `daily_limit` real. A missing or bad prop pays nothing.
- **Compensate someone:** admin page → Users → look up → *Give a reward* (kind, amount, params, a note for the audit
  log), or `rewards_admin_grant` from a server. Coins and other app kinds go through your `app_reward_grant` hook at
  once, Premium days on the next `/worker` run. Your hook must already be idempotent on `grant_id`; nothing else
  changes. Manual grants have `program_key` null unless you pass `params.program`, so code that reads
  `rewards.grants.program_key` must allow null.
- **Before go-live and after each migration:** `select * from rewards.privacy_problems();` → no rows.
- **Test the function locally:** `scripts/test-rewards-function.sh` (unit tests + a story on a throwaway Postgres).

## 15. Weekly leagues and the year recap card (0.6)

**Leagues** are opt-in weekly groups (ADR 0002 §18.10). Only add one when the app has enough daily users to fill
groups (roadmap §6); with few users a group of 3 is fine, but think about it.

1. Make sure `rewards_app.app_display_name(user_id)` returns the name you want others to see (a chosen nickname, not
   an email or a legal name). Without it, everyone shows as "A member".

```sql
create or replace function rewards_app.app_display_name(user_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select p.nickname from public.profiles p where p.id = user_id
$$;
```

2. Add the program and its place rewards (admin page → Programs, kind `league`, or SQL):

```sql
insert into rewards.programs (key, kind, config, public) values ('weekly', 'league',
  '{"event":"chapter_finished","group_size":20,"tiers":["Bronze","Silver","Gold"],"promote":3}',
  '{"title":"Reading league"}');
insert into rewards.rules (program_key, threshold, repeat, kind, amount) values
  ('weekly', 1, 'once', 'coins', 100), ('weekly', 3, 'once', 'coins', 30);
```

3. Flutter: `LeagueBoard(controller: rewards, program: 'weekly')` (Join → board → Leave), or your own look through
   `builder` with `controller.joinLeague / leaveLeague / loadLeague`. `RewardsHub` shows it by itself.
4. Nothing to deploy for the close: the existing worker cron calls `rewards_svc_expire_social`, which now closes ended
   weeks, and opening the league closes them too.

Gotchas:
- A league on a **client** event trusts the phone (a client can send events up to `daily_limit`). Use a server event
  (`rewards.event_from_row` on your own table) when the score must not be faked; for `prop:` scores keep
  `max_points_per_event` low.
- Changing `settings.default_timezone` moves the week boundary; do it between weeks.
- Keep the copy calm: the kit never says "you are falling behind" and never marks who moves down; don't add it.

**Year recap card:** load the totals and render the card; sharing stays the app's.

```dart
final (from, to) = recapYear(2026);
await rewards.loadRecap(from, to);
final shareKey = RecapShareKey();
RewardsRecapCard(recap: rewards.recap(from, to)!, subtitle: 'MyApp', shareKey: shareKey);
// on the app's Share button:
final png = await shareKey.toPngBytes();   // share_plus: Share.shareXFiles([XFile.fromData(png!, mimeType: 'image/png', name: 'recap.png')])
```

`rewards_recap` allows at most 366 days per call; events older than the retention (`events_retention_days`, 90 by
default) are gone, so a December recap of the whole year counts only what is still stored. Raise the retention before
the year if the year card matters, or keep your own totals.
