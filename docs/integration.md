# Integration guide: referral-kit in a new Flutter + Supabase app

Updated: 2026-11-14 (package 0.3.0)
From zero to working invites in a new app, in order. About one day per app, most of it owner steps (secrets,
dashboards, store forms). Built from the first app's integration (2026-11-12/13); every gotcha it hit is
in [Gotchas](#gotchas).
Related: [ADR 0001](adr/0001-referral-kit.md) · [go-live checklist](go-live.md) · [store review](store-review.md) ·
[privacy text](privacy.md) · [test plan](test-plan.md) · [Flutter package](../packages/referral_kit/README.md) ·
[invite page](../web/invite/README.md) · [per-app SQL template](../supabase/app-config/template.sql) ·
[worked example](../examples/reader-app/app_config.sql) · [starter app](../examples/starter_app)

Requirements: Flutter 3.38+ (Dart 3.8+), iOS 15+, Android API 24+; Supabase (Postgres 15+, `pg_cron`, `pg_net`,
Vault). RevenueCat only if you give subscription days (`entitlement_days`); in-app rewards alone need no RevenueCat.

| Step | Who | Needed for |
|---|---|---|
| 1 Dependency · 9 App wiring · 10 Analytics | developer | everything |
| 3 Database · 4 App config | developer writes, owner approves the apply | everything |
| 2 Secrets · 6 Webhook · 5 Function deploy · 7 Worker | owner (dashboards, deploy approval) | paid rewards, queued grants |
| 8 Invite page + app links | developer + owner (DNS, Play app-signing SHA) | invite links (optional: Share works without) |
| 11 Privacy · 12 Store review · 13 Go-live | owner | release |

## 1. Add the dependency

Pin a release tag (never a branch in a release build). Until the repo is public, `url` can be a local clone's path.

```yaml
dependencies:
  referral_kit:
    git:
      url: https://github.com/<owner>/referral-kit.git
      ref: referral_kit-v0.3.0
      path: packages/referral_kit
```

While developing the kit next to the app, a path dependency instead:

```yaml
dependencies:
  referral_kit:
    path: ../referral-kit/packages/referral_kit
```

Then `flutter pub get`. Add `referralKitLocalizationsDelegate` to `MaterialApp.localizationsDelegates` (en, hi, id;
English for any other locale). The fastest start: copy `examples/starter_app/lib/referral_setup.dart` and its two
entry points, run it against the fake server, then point it at your project.

## 2. Identity and secrets

RevenueCat (paid rewards only): call `Purchases.logIn(supabaseUserId)` **at sign-in and on every app start while
signed in**, not only before the paywall; webhooks and grants are matched on that id (ADR 6.1).

Secrets never go in the app, the repo or a table. In a Flutter app the bundled `.env` is public: none of these go
there. Generate random values (32+ characters) for the token, worker secret and pepper.

| Name | Where | What |
|---|---|---|
| `REVENUECAT_SECRET_KEY` | Function env | RevenueCat API v2 key with only `customer_information:customers:read_write`, `customer_information:subscriptions:read`, `project_configuration:entitlements:read` |
| `REVENUECAT_PROJECT_ID` | Function env | `proj…` |
| `REFERRAL_WEBHOOK_TOKEN` | Function env + RevenueCat dashboard (Authorization header) | Random |
| `REVENUECAT_WEBHOOK_SIGNING_SECRET` | Function env | From RevenueCat's webhook settings |
| `REFERRAL_WORKER_SECRET` | Function env **and** Vault `referral_worker_secret` | Random, same value in both |
| `referral_pepper_v1` | Vault only | Random; never changes unless leaked (ADR 9 rotation) |

```sql
select vault.create_secret('<random-pepper-32-chars-or-more>', 'referral_pepper_v1');
select vault.create_secret('<same value as REFERRAL_WORKER_SECRET>', 'referral_worker_secret');
```

```bash
supabase secrets set --project-ref <ref> REVENUECAT_SECRET_KEY=... REVENUECAT_PROJECT_ID=... \
  REFERRAL_WEBHOOK_TOKEN=... REVENUECAT_WEBHOOK_SIGNING_SECRET=... REFERRAL_WORKER_SECRET=...
```

## 3. Database: the kit's migrations

Copy every `supabase/migrations/2026111*_referral_*.sql` (ten files in 0.3.0) into the app's `supabase/migrations/`
in order, renumbered after the app's own latest migration if needed (never reordered, never edited). Before applying
to a live project: read `supabase_migrations.schema_migrations` for the next free version, run
[`supabase/probes/function_grants.sql`](../supabase/probes/function_grants.sql) to see what the app already exposes,
and try the files in a transaction you roll back. Locally, `scripts/test-db.sh` in the kit runs them all with every
test.

After applying, both must be clean:

```sql
select * from referral.privacy_problems();     -- no rows
```

```sql
-- supabase/probes/function_grants.sql: no 'kit_exposed' rows; review every 'app_definer_exposed' row
```

`privacy_problems()` reports schema usage, table access, reachable functions, EXECUTE left to PUBLIC on any kit
function, any `public.referral_*` callable by anon, anything authenticated can call beyond the eight client RPCs, a
`referral_svc_*` function callable by authenticated, and security definer functions without `search_path`. The worker
alerts on it every run.

The only functions an API role can call: `referral_my_code`, `referral_rotate_code`, `referral_claim`,
`referral_terms`, `referral_check_activation`, `referral_stats`, `referral_pending`, `referral_ack` (authenticated),
and `referral_svc_*` (service_role, for the Edge Function).

## 4. Database: the app's own configuration (one migration)

Copy [`supabase/app-config/template.sql`](../supabase/app-config/template.sql) into the app's migrations right after
the kit's (e.g. `<timestamp>_referral_<app>.sql`) and fill in every `<<…>>`. It is the only SQL an app writes:

1. **Settings**: `entitlement_id` (the RevenueCat entitlement lookup key whose purchase counts as paid). Defaults
   (ADR): `hold_hours` 72, `claim_window_days` 7, `activate_window_days` 30, `paid_window_days` 90, caps 10 joins /
   30 days and 6 paid / 365 days, `daily_grant_cap` 500, `abuse_threshold` 3, `minimum_age` 13. `enabled` and
   `paid_enabled` are the kill switches (no app update needed).
2. **Rules** (append-only: change a reward later with rule set 2 and deactivate 1). `entitlement_days` is granted
   through RevenueCat by the Edge Function; any other kind goes to your grant hook.
3. **Hooks** in schema `referral_app` (never `public`):
   - `app_referral_is_active(user_id)`: when has the friend really started? Read your own table.
   - `app_referral_grant(reward_id, user_id, kind, amount, params)`: credit your own balance. **Idempotent on
     `reward_id`**: pass it as your credit function's idempotency key (`'referral:' || reward_id`) or insert with
     `on conflict do nothing`. Put referral credit in a bucket your refill/expiry logic never resets (the first app
     used its "purchased" bucket, because a monthly refill expires the "included" one).
   - `app_referral_age_ok(user_id, minimum_age)`: `select true` when the app asks no age (keep it explicit).
4. **Revokes** by name for the three hooks.
5. **Triggers**: activation on your activity table (otherwise the worker checks every 15 minutes) and account
   deletion on `auth.users` (or call `referral.delete_user(uid)` from your own deletion path).
6. **Self-check** (already in the template): the migration fails and rolls back if `privacy_problems()` is not empty,
   no rule set is active, or a paid rule has no `entitlement_id`.

Before applying, read the live definition of every app function a hook calls
(`select pg_get_functiondef('public.<fn>(<types>)'::regprocedure);`): the deployed database is the truth, not the
repo. The worked, tested example (chapters credited through a ledger function, Plus days through RevenueCat) is
[`examples/reader-app/app_config.sql`](../examples/reader-app/app_config.sql); `supabase/tests/12_app_config.test.sql`
applies it on top of every kit migration.

## 5. Edge Function

Copy `supabase/functions/referral/` (all `.ts` files except `*_test.ts`, `test_*.ts`, `integration_story.ts` and
`fixtures/`). Each route authenticates itself (webhook: Authorization token + RevenueCat signature; worker:
`X-Referral-Worker-Secret`), so deploy without the gateway's JWT check:

```bash
supabase functions deploy referral --project-ref <ref> --no-verify-jwt
```

## 6. RevenueCat webhook (paid rewards only)

Dashboard → Integrations → Webhooks: URL `https://<ref>.supabase.co/functions/v1/referral/webhook`, Authorization
header value = `REFERRAL_WEBHOOK_TOKEN`, all events, production and sandbox (sandbox events are ignored unless
`allow_sandbox` is on). Copy the signing secret into `REVENUECAT_WEBHOOK_SIGNING_SECRET`.

## 7. Worker schedule

```sql
select cron.schedule('referral-worker', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/referral/worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Referral-Worker-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'referral_worker_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000)
$$);
```

The worker logs one JSON line of alerts per run (`failed_rewards`, `failed_events`, `sharers_under_review`,
`privacy_problems`, `daily_cap_reached`, `starts_given_up` once when events stop waiting for a start; `starts.not_found`
stays in the response, not as an alert). Route the function logs to wherever the owner looks.

## 8. Invite page and app links (optional at first)

Host `web/invite` so `https://<site>/i/<CODE>` renders (server-rendered with `render.ts`, or `index.html` alone on a
static host) and `https://<site>/terms` shows the terms exported from `referral_terms()` (re-export whenever the
rules change). Serve `web/invite/well-known/apple-app-site-association` at `/.well-known/apple-app-site-association`
(JSON, no extension, no redirect; your `TEAMID.bundle.id`) and `assetlinks.json` at `/.well-known/assetlinks.json`
with the **Play app-signing** SHA-256. Add the domain to the iOS Associated Domains entitlement and the Android App
Links intent filter.

Without an invite page the app still works: leave `inviteLink` null and give `storeLink`; Share sends the code and
the store link, and the screen says the friend types the code in (`referral_feature_hidden` reports `no_invite_url`
once a day, so you can see how many users share that way).

## 9. App wiring

```dart
final store = SharedPreferencesKeyValueStore();
final referrals = ReferralClient(
  rpc: (fn, params) => Supabase.instance.client.rpc(fn, params: params), // or ReferralHttpRpc(...).call
  installIds: DefaultInstallIdStore(),
  onEvent: forwardToAnalytics,  // step 10
  codeHashSalt: '<your-app>',
  eventStore: store,
);
final queue = PendingClaimQueue(client: referrals, store: store);
final retrier = PendingClaimRetrier(queue: queue, signInChanges: ..., tokenRefreshes: ..., reconnects: ...);
```

- **Hide entry points until it works**: `if ((await referrals.availability()).isAvailable) showInviteRow();` (an app
  can ship before the server side exists; `notDeployed` until the migrations are applied).
- **One invite screen**: `InviteHub` from every entry point, with `from:` (`you`, `settings`, `home`, `deeplink`) and
  `initialSection: InviteHubSection.enterCode` from code entry points (a "Got a code from a friend?" row, a Home
  nudge, an invite link). Pass `initialCode` from the link (`/i/<CODE>` → your route's `?code=`) or from
  `InstallReferrerCodeReader` (Android).
- **Invite base URL**: `inviteLink: (code) => Uri.parse('https://<site>/i/$code')`, the same host as the app links;
  `storeLink` for the time before the page exists; `onOpenTerms` opens `https://<site>/terms`.
- **Your words**: `labels` / `labelsBuilder` name your reward kinds ("4 free chapters"); `texts: ReferralTexts(...)`
  for your voice (`activationStep: 'Hear your first page read aloud'`) or a language the package lacks.
- **Your look**: colours come from your `ThemeData`; art goes in `header`, `entryHeader`, `entryLeading`;
  `scrollable: false` puts the hub inside your own scroll view.
- **After a code**: `onClaimed` (refresh your balance and terms), `onAlmostAction` (go to the first real use).
- **Rewards**: `ReferralRewardCard` on Home (`actionLabel: 'Invite friends'` as the next loop; `onShown` to refresh
  the balance).
- **When to ask**: `ReferralPromptPolicy` after a moment of value (never in the first session, at most every 14
  days, never around a purchase).
- **iOS paste**: the package's Paste button is `UIPasteControl` (no "Allow Paste" prompt); never add your own
  `Clipboard.getData` on iOS.

## 10. Analytics: forward `onEvent`, log nothing else

```dart
void forwardToAnalytics(ReferralEvent e) => analytics.logEvent(name: e.wireName, parameters: e.props);
```

The client reports the whole funnel (table and every prop: [package README](../packages/referral_kit/README.md#analytics-events)):
`invite_screen_viewed` → `invite_code_copied` / `invite_shared` → (friend) `invite_link_opened` →
`code_entry_started` → `code_submitted` → `code_claim_result` → `reward_granted` → `reward_shown` /
`reward_acknowledged`, plus `referral_feature_hidden` once a day per reason. Do not log these yourself as well: every
step would count twice. If the app already sent its own code hashes, pass `codeHasher:` so they keep joining up.
Switch on `code_claim_result.result` with a default branch (`other` is a server outcome this version does not know).

## 11. Privacy

Paste [privacy.md](privacy.md) into the privacy policy (replace the `<…>` parts). Store forms:
[store review §4–5](store-review.md). If you forward the funnel events to an analytics service, add "Usage Data →
Product Interaction (Analytics)" to the Apple label and "App interactions (Analytics)" to Play Data safety, and say so
in the policy; the events carry no code, user id or install id.

## 12. Store review

Paste the App Review and Play notes from [store review §2–3](store-review.md), with two demo accounts (sharer and
friend) and where to find Invite friends. Rewards are for real use, never for installs, ratings or reviews; codes are
free, never required and have no cash value (Apple 5.6.3 answer in §6).

## 13. Go-live checklist with probes

Work through [go-live.md](go-live.md): secrets, migrations + app config with `privacy_problems()` and the grant probe
clean, PostgREST sees the functions (`curl` → 200), function deployed, webhook, worker, invite page + app links, the
app's invite base URL, analytics, then the [test plan](test-plan.md) on real phones and one sandbox purchase.

## Design rules (from the first app)

- **Every number comes from the server's terms.** No terms (offline, old server): name no number at all.
- **The deadline is the server's `claim_days_left`.** Never a timer of your own, never one that resets.
- **Loss framing only when true**: "A gift is waiting for you" only when the friend rule gives something;
  "you both get" only when both rules exist and are equal.
- **Say each thing once per screen**: the chip shows the days left, so the entry's own window line is hidden.
- **The second step is the real unlock**: "Almost yours, 1 of 2 done" points at the activation your hook checks.
- Refused on purpose: invented counts, resetting timers, guilt copy, contact upload, auto-invite.

## Gotchas

| Symptom (exact text where known) | Cause | Fix |
|---|---|---|
| Every `referral_*` call: HTTP 404, `PGRST202` "Could not find the function public.referral_terms(install_id) in the schema cache" | Migrations not applied to this project, wrong project, or PostgREST's schema cache is stale | Apply step 3; `notify pgrst, 'reload schema';`. The package shows "not available yet" (`ReferralUnavailableException(notDeployed)`), not offline |
| A helper you added is callable by any signed-in user (`POST /rest/v1/rpc/<name>` works) | Postgres grants EXECUTE on every new function to PUBLIC; Supabase also grants new `public` functions to anon / authenticated / service_role. A per-schema `alter default privileges … revoke` does not remove PUBLIC | `revoke execute on function <sig> from public, anon, authenticated;` for every helper; keep hooks in `referral_app`; run `supabase/probes/function_grants.sql` after every migration. `privacy_problems()` reports `public execute` on kit functions |
| A call that should be refused gets `42501` "permission denied for function …" | Working as intended: the function is revoked from that role | Only the eight client RPCs (authenticated) and `referral_svc_*` (service_role) are callable |
| `column reference "user_id" is ambiguous` (42702) in a hook | A PL/pgSQL parameter and a column share a name | Qualify with the function name (`app_referral_grant.user_id`) or use `on conflict on constraint …` |
| RevenueCat webhook gets 401 from the Supabase gateway ("Missing authorization header" / "Invalid JWT") | The function was deployed with JWT verification on | Deploy with `--no-verify-jwt`; each route checks its own secret (webhook token + signature, worker header) — never deploy a `--no-verify-jwt` route without one |
| A TRANSFER event credits or cancels the wrong person | RevenueCat sends TRANSFER only to the destination; `aliases` are not the parties | Match on `transferred_from` / `transferred_to` (the kit's `logic.ts` does) |
| A paid reward granted twice, or a grant lost when RevenueCat is slow | A grant needs a RevenueCat read (current expiry), which cannot sit inside one database transaction | The kit's order: claim the reward row (lease) → compute and store the target expiry → grant → record; one unfinished grant per user via the partial unique index `rewards_one_unfinished_grant` |
| Store transaction ids hashed with plain SHA-256 can be reversed | Numeric transaction ids are short: a plain hash is brute-forced | HMAC with the Vault pepper (`referral.hmac(value, version)`), as the kit does for transaction and install ids |
| iOS shows "<App> would like to paste from <Other app>" with "Don't Allow Paste" / "Allow Paste" | `Clipboard.getData` on iOS 16+ | Use the package's Paste button (`UIPasteControl`, no prompt); never call `Clipboard.getData` on iOS |
| App Links open the browser on Play installs | `assetlinks.json` has the upload key's SHA-256 | Use the **Play app-signing** SHA-256 (Play Console → App integrity) |
| Universal links do nothing | AASA served with a redirect, an extension, or not as JSON | Serve `/.well-known/apple-app-site-association` directly, `application/json`, no redirect |
| `drop function if exists f(...)` "succeeds" but the old function stays | It matches on argument types and silently does nothing when they differ | Drop by exact identity arguments; count the overloads afterwards |
| A widget test hangs when the client is built in `setUp` (before 0.3.0's fix) | A future created in another zone never resumed in the test's fake zone | Fixed in 0.3.0; build test clients inside the test if you pin an older version |
| `flutter build ios --simulator` on Xcode 27.1: "Flutter.framework does not contain architectures arm64 x86_64" | Flutter 3.41 tool check vs Xcode 27 (environment) | `xcodebuild -workspace ios/Runner.xcworkspace -scheme Runner -sdk iphonesimulator -arch arm64` |
| Share sheet's `channel` is always `unknown` on some Android versions | Android names the chosen app only on some versions | Expected; `status` still says whether the user shared |

## Owner actions (no API for these)

- [ ] RevenueCat dashboard: the v2 key with the three scopes; the webhook (step 6).
- [ ] Supabase: Vault secrets and function secrets (step 2); approve the migrations, the app config and the function
      deploy.
- [ ] DNS / hosting for the invite page; Play app-signing SHA-256 for `assetlinks.json` (step 8).
- [ ] App Store Connect / Play Console: review notes and privacy answers (steps 11–12).
- [ ] A sandbox purchase on a real phone with `allow_sandbox` on, then switch it off again.
