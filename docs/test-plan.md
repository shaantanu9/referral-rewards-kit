# Test plan

Updated: 2026-11-12
Every automated suite, what it proves, and the checks that need real phones and a real RevenueCat sandbox.
Related: [build plan](build-plan.md) · [integration](integration.md) · [ISSUES](ISSUES.md)

## 1. Automated (run locally; CI runs the same on every push)

| Suite | Command | Count (2026-11-14) | Proves |
|---|---|---|---|
| SQL | `scripts/test-db.sh` | 271 | Schema, privileges and `privacy_problems` (incl. PUBLIC execute and the grant probe), the per-app config example, every claim reason, activation and caps, paid path with fingerprinted apply, grant queue (leases, stale writers, cap, banked, review), deletion, code cleanup |
| SQL, C locale | `PGTEST_LOCALE=C scripts/test-db.sh` | 271 | Code cleanup does not depend on the database locale |
| Function and logic | `cd supabase/functions/referral && deno test --no-prompt .` | 113 | Decision tables, signature, trimming, decide, grant flow against a fake RevenueCat, routes and auth |
| Full story | `scripts/test-function.sh` | 1 | Claim → activation → signed webhook → hold → worker grant (customer created on 404) → late refund, on a real local Postgres with service-role privileges |
| Invite page | `cd web/invite && deno test --no-prompt --allow-read=. .` | 11 | Size, no-JS code, noindex, no tracking, referrer link, escaping, normalisation, terms |
| Flutter | `cd packages/referral_kit && flutter analyze && flutter test` | 268 | Client JSON against the SQL shapes, normalisation, messages, copy variants, prompt policy, retry queue, widgets at 2.0 text scale on 320 dp, RTL, InviteHub states, the event funnel |
| Starter app | `cd examples/starter_app && flutter analyze && flutter test` | 2 | The whole flow an app gets, on a fake server: hidden until available, share without an invite page, friend's code to almost yours, gift on Home, events in order |

## 2. Manual, on real phones (not done yet)

| # | Check | Pass when |
|---|---|---|
| M1 | iPhone: reinstall the app | Same install id (Keychain, this device only) |
| M2 | Android with Google backup on: reinstall | Same install id (Block Store); without Play services the id is new |
| M3 | iPhone: invite page → App Store button → install → Paste button | Code pasted, no "Allow Paste" prompt (iOS 16+) |
| M4 | Android: invite link → Play → install → first run | Code prefilled from the install referrer, one tap to confirm |
| M5 | Second account on the sharer's phone claims | `same_install` message |
| M6 | Friend claims, then starts using the app | Both reward cards appear once per device |
| M7 | Screen reader on the invite screen | Code read letter by letter; "Code copied" announced |
| M8 | 200 % text, small phone | Nothing cut off; code not shrunk |
| M9 | Hindi and Indonesian | Native speaker approves the wording (app and invite page) |

## 3. Sandbox proof (RevenueCat, before calling the kit done)

1. Set `allow_sandbox = true`. Sharer A shares; friend B (sandbox Apple ID on TestFlight) claims and activates.
2. B buys Premium (sandbox). Within minutes the webhook is `processed`; A's paid reward is `queued` with the hold.
3. Set A's reward `available_at = now()` (or a short `hold_hours` on a test project); the worker grants it.
4. RevenueCat dashboard shows A with a promotional Premium grant 5 days long; the app shows the card.
5. Refund B's sandbox purchase (or send a test `CANCELLATION` from the dashboard): A's referral turns
   `refunded_late` and one abuse mark is added; nothing is clawed back.
6. Set `allow_sandbox = false` again.

Record the dates and results in `docs/ISSUES.md` (🟡 → ✅ rows) and `WORKLOG.md`.
