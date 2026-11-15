# Build plan: mergeable parts

Updated: 2026-11-12
The order the kit is built in, as small branches that each merge into `main` on their own. Design:
[ADR 0001](adr/0001-referral-kit.md) (draft 5, accepted). Related: [TODO](TODO.md) · [ISSUES](ISSUES.md)

## Rules for every part

- One branch per part.
- **Merges alone:** the part's tests pass on its own branch with only the parts it depends on already in `main`.
  Nothing half-built is exposed: a part that adds RPCs adds their privilege tests in the same branch.
- `docs/ISSUES.md` and `docs/TODO.md` updated in the same branch.

## Parts

| # | Branch | Contents | Depends on | Tests |
|---|---|---|---|---|
| 0 ✅ | `chore/scaffold` | Licence, `.env.example`, `.gitignore`, README, this plan, ISSUES/TODO, CI secret scan | — | gitleaks in CI |
| 1 ✅ | `feat/db-schema` | Migration 1: schemas `referral` / `referral_app`, all tables (ADR 5), settings row, revokes and default privileges, pepper and HMAC helpers; local test harness (Postgres with Supabase stubs) and the privilege test | 0 | `scripts/test-db.sh`: schema loads, privilege test, constraints |
| 2 ✅ | `feat/db-codes-claim` | Migration 2: codes (generate, rotate, normalise), installs, members/`eligible_from`, `referral_claim` with every reason, rate limit, `referral_my_code`, `referral_rotate_code`, `referral_terms` | 1 | SQL tests for each claim reason |
| 3 ✅ | `feat/db-joined` | Migration 3: activation (`referral_check_activation`, `referral.activation_trigger()`, worker sweep hook), `joined` rewards from the claim's rule set, caps, `skipped_cap`, the app-hook call for non-RevenueCat kinds, `referral_stats`, `referral_pending`, `referral_ack` | 2 | SQL tests: activation, caps, per-install friend reward, ack per device |
| 4 ✅ | `feat/paid-logic` | `supabase/functions/referral/logic.ts`: the 6.3 decision table, cancel table, store normalisation, signature check, as pure functions | 0 | `deno test` over recorded webhook payloads (49 tests) |
| 5 ✅ | `feat/db-paid` | Migration 4: `events`, `transactions`, `abuse_marks`, `referral_svc_ingest_event` / `_process_event` / `_fill_start`, paid queueing with the hold, refunds, transfers, REFUND_REVERSED | 1, 4 (rules mirrored in SQL tests) | SQL tests: out-of-order events, early refund, transfer, trial before claim |
| 6 ✅ | `feat/db-grant-queue` | Migration 5: `referral_svc_claim_reward`, `_set_target`, `_finish_reward`, `_sweep` (leases, backoff, banked release, expiries, retention), daily cap, `admin_retry_reward` | 5 | SQL tests: one unfinished grant per user, lease, stale writer, daily cap |
| 7 ✅ | `feat/edge-function` | `supabase/functions/referral/index.ts`: `/webhook` (token + HMAC, ingest, `waitUntil` processing), `/worker` (secret, sweep, fresh check, grant 3 steps), RevenueCat client; migration 7 (worker support) | 4, 6 | `deno test` with a fake RevenueCat; `scripts/test-function.sh` story on a local database |
| 8 ✅ | `feat/db-delete-user` | Migration 6: `referral.delete_user(uid)` for sharer and friend, tombstones | 3, 5 | SQL tests for both cases |
| 9 ✅ | `feat/flutter-package` | `packages/referral_kit`: client over an `rpc` function, install id store, invite screen, code entry, reward card, paste control, install referrer, ARB en/hi/id | 2, 3 (API only) | `flutter test`, RTL test locale |
| 10 ✅ | `feat/invite-page` | `web/invite`: page, terms page, AASA and assetlinks templates | 2 (terms export) | HTML size and no-JS check |
| 11 ✅ | `docs/guides` | `docs/integration.md`, `docs/store-review.md`, `docs/privacy.md`, `docs/test-plan.md`, `examples/` app seeds | all | link check |

Parts 1, 4 and 9's UI can start in parallel; everything after follows the "Depends on" column.

## Proof before calling the kit done

1. All SQL, Deno and Flutter tests green locally.
2. A real sandbox purchase on a test app (with `allow_sandbox` on) grants the sharer 5 days, visible in RevenueCat.
3. A second account's claim gives both rewards on a phone; self-invite and an 11th join in 30 days are refused.
