# Go-live checklist for an app

Updated: 2026-11-14 (package 0.3.0)
The short list to take an app that already ships `referral_kit` from "Invites aren't available yet" to working
invites. Each step's detail is in the [integration guide](integration.md); proof before release is the
[test plan](test-plan.md); store answers are in [store review](store-review.md).

## What the app does before go-live

With package 0.2.0 or later an app can ship before the server side exists:

- Every `referral_*` call gets 404 / `PGRST202` from PostgREST → `ReferralUnavailableException(notDeployed)`.
  `client.availability()` returns `notDeployed`; the screens say "Invites aren't available yet." (no Retry) or show
  what the app's `unavailableBuilder` returns; a code typed in is kept and sent once the functions exist.
- The invite page (`web/invite`) makes no server calls, so a hosted page works before the database does. A code
  opened from it during that time is kept by the app, as above.
- The `referral_*` functions are granted to `authenticated` only. A call without a user token is refused by Postgres
  (PostgREST maps `42501` to 401/403), not 404, so it is never mistaken for "not deployed"; `ReferralHttpRpc` does
  not send it at all (`signedOut`).

## Checklist

Owner approval is needed for every step that changes a live system (migrations, function deploy, dashboard, DNS).

- [ ] **Secrets** (integration §2): Vault `referral_pepper_v1` and `referral_worker_secret`; function secrets
      `REVENUECAT_SECRET_KEY` (three scopes), `REVENUECAT_PROJECT_ID`, `REFERRAL_WEBHOOK_TOKEN`,
      `REVENUECAT_WEBHOOK_SIGNING_SECRET`, `REFERRAL_WORKER_SECRET`.
- [ ] **Grant probe before** (§3): run `supabase/probes/function_grants.sql` and keep its output, so you know what
      the app already exposes.
- [ ] **Migrations** (§3): the ten `supabase/migrations/2026111*_referral_*.sql` in order, after the app's own
      latest; tried in a rolled-back transaction first. Then `select * from referral.privacy_problems();` returns no
      rows. A project that already has the first nine (e.g. the first app, 2026-11-12) applies only
      `20261114000001_referral_grant_probe.sql`.
- [ ] **PostgREST sees the functions.** Supabase reloads its schema cache after DDL; if a call still gets
      `PGRST202`, run `notify pgrst, 'reload schema';`. Check from the app (`client.availability()` →
      `available`) or with a signed-in user's token:

      ```bash
      curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://<ref>.supabase.co/rest/v1/rpc/referral_terms" \
        -H "apikey: <anon key>" -H "Authorization: Bearer <user access token>" \
        -H 'Content-Type: application/json' -d '{"install_id":"go-live-check"}'
      # 200 = deployed; 404 = not deployed (wrong project, migration not applied, or stale schema cache)
      ```

- [ ] **App config** (§4): one migration from `supabase/app-config/template.sql`: `entitlement_id`, rule set 1,
      the three hooks in `referral_app` (grant idempotent on the reward id), revokes, activation and deletion
      triggers. Its self-check fails the migration if anything is exposed. `enabled` on; `paid_enabled` as decided.
- [ ] **Grant probe after**: `supabase/probes/function_grants.sql` shows the eight client RPCs as `expected`, no
      `kit_exposed` row, and nothing new under `app_definer_exposed`.
- [ ] **Edge Function** (§5): `supabase functions deploy referral --project-ref <ref> --no-verify-jwt`.
- [ ] **RevenueCat webhook** (§6) to `/functions/v1/referral/webhook` with the Authorization header.
- [ ] **Worker schedule** (§7): `cron.schedule('referral-worker', '*/15 * * * *', …)`.
- [ ] **Invite page** (§8, optional at first: without it Share sends the code and `storeLink`): host `web/invite` so `https://<site>/i/<CODE>` renders the page (server-rendered with
      `render.ts`, or `index.html` alone on a static host) and `https://<site>/terms` shows the terms exported from
      `referral_terms()`; re-export whenever the rules change.
- [ ] **App links**: serve `web/invite/well-known/apple-app-site-association` at
      `/.well-known/apple-app-site-association` (JSON, no extension, no redirect; your `TEAMID.bundle.id`) and
      `assetlinks.json` at `/.well-known/assetlinks.json` with the **Play app-signing** SHA-256. Add the domain to the
      iOS Associated Domains entitlement and the Android App Links intent filter.
- [ ] **The app's invite base URL** points at that site: `inviteLink: (code) => Uri.parse('https://<site>/i/$code')`,
      the same host as the app links, and the terms link opens `https://<site>/terms`. Until then `storeLink` is set.
- [ ] **Analytics** (§10): `ReferralClient(onEvent: …, eventStore: …)` forwards the funnel (`invite_screen_viewed`
      … `reward_granted`, `referral_feature_hidden`); `codeHashSalt` (or `codeHasher`) set; no parallel logging.
      After launch, `referral_feature_hidden` with `not_deployed` should drop to zero.
- [ ] **Proof** ([test plan](test-plan.md)): the database and function suites, then on real phones M1–M9 and one
      sandbox purchase with `allow_sandbox` on (then off again).
