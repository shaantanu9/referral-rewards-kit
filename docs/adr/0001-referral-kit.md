# ADR 0001: Referral kit — invite friends, earn rewards (Supabase + RevenueCat + Flutter)

Updated: 2026-11-11
Status: **Accepted for build, draft 5** (owner, 2026-11-12: "make all correct and start working on it"; the section
16 defaults are taken). Four independent strict reviews (store, flow, security, UX):
- draft 1 rejected: 52 findings, 13 blockers;
- draft 2 "approve with changes": 21 new findings, 6 blockers;
- draft 3 "not yet": 58 of 73 earlier fixes confirmed, 15 partly done or wrong, 14 new findings, 4 blockers;
- draft 4 "build can start, with changes": 14 findings (1 blocker) and 10 behaviours that needed a rule.
Draft 5 closes all of them; section 17 maps every finding to its fix.
Decides how an app lets a user share it and earn rewards when friends join and pay, as an open-source kit any
Flutter + Supabase + RevenueCat app can add.
Related: [store review guide](../store-review.md) (to write) · [integration guide](../integration.md) (to write) ·
[test plan](../test-plan.md) (to write)

Sources fetched 2026-11-11: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) ·
[RevenueCat webhook events and fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields) ·
[RevenueCat webhooks](https://www.revenuecat.com/docs/integrations/webhooks) ·
[RevenueCat API v2 customers](https://www.revenuecat.com/docs/api-v2/customer) ·
[Play: Ratings, Reviews and Installs](https://support.google.com/googleplay/android-developer/answer/9898684) ·
[Play: Payments](https://support.google.com/googleplay/android-developer/answer/9858738) ·
[Play: account deletion](https://support.google.com/googleplay/android-developer/answer/13327111).
Anything marked **[unconfirmed]** was not checked against a fetched page.

## 1. Context

- Goal: a user shares the app; when a friend joins, both get a small in-app reward; when the friend becomes a paying
  subscriber, the sharer gets free subscription days. Reusable across apps and open source (the code, not any app).
- Target stack: Flutter, Supabase (Postgres, RLS, Edge Functions, pg_cron), RevenueCat for store billing.
- RevenueCat has no referral feature. It can grant an entitlement until a set time (API v2 grant entitlement,
  `expires_at` in ms) and sends webhooks for purchase events. A grant is ignored when another grant for the same
  entitlement expires within two hours of the requested `expires_at`; there is no idempotency key.
- No open-source package covers the whole flow (pub.dev and web search 2026-11-11). Hosted SaaS exists (WinWinKit,
  GoMarketMe, ReferralHero, broughtby); `deeplinking` is self-hosted attribution, not a reward ledger.

## 2. Decision

Build **referral-kit**, MIT-licensed, four parts usable together or alone:

1. `supabase/` — one SQL migration (schema `referral`, thin `public.referral_*` RPC wrappers) and one Edge Function
   `referral` with two routes: `/webhook` (RevenueCat) and `/worker` (scheduled grants).
2. `packages/referral_kit/` — Flutter package: client, screens, link and install-referrer readers, ARB strings.
3. `web/invite/` — static invite page template plus `apple-app-site-association` and `assetlinks.json` templates.
4. `docs/` — this ADR, store-review guide (with App Review note text), integration guide, test plan, privacy text.

Rewards are **rules in a table**: `(event, who) → (kind, amount, params)`. The kit implements `entitlement_days`
(RevenueCat) itself; every other kind goes to one app-written SQL hook. Example rules (an example app, not shipped
as defaults; app seeds live in `examples/`):

| Event | Who | Reward |
|---|---|---|
| `joined` | sharer | `minutes` 30 |
| `joined` | friend | `minutes` 30 (owner decision D-R1) |
| `paid` | sharer | `entitlement_days` 5 on entitlement `premium` |

## 3. Store policy position (why this passes review)

| Rule | Text relied on | How the kit complies |
|---|---|---|
| Apple 3.2.2(x) | Apps must not force users to "download other apps … in order to access functionality"; "Apps may otherwise incentivize users to take specific actions within apps" | The reward is extra and never gates the core app; rewards come from the friend's activation inside this app, never from an install alone; entering a code is never required |
| Apple 5.6.3 | "Manipulating any element of the App Store customer experience such as charts, search, reviews, or referrals to your app … is not permitted" | Abuse controls (section 8) are the compliance answer: activation-based rewards, caps, install checks, kill switch. Never a reward for ratings or reviews |
| Play: Ratings, Reviews and Installs | No "inflating … install counts by illegitimate means"; no "incentivizing users to install other apps as the app's main functionality"; "Don't offer rewards or incentives for ratings or reviews" | Same app, rewards on activation not install, capped, never for reviews. The page says nothing about referral rewards for installing your own app, so this is a judgement [unconfirmed]; rewarding activation, not the install, is the safer side |
| Apple 3.1.1 | No "own mechanisms to unlock content or functionality, such as license keys … QR codes"; vouchers and coupons "can only be sold in your app using in-app purchase"; purchased credits "may not expire" | Codes are free, cannot be bought or sold, have no cash value, and give only promotional time; the subscription is always buyable by IAP; referral minutes are tagged `source = referral`, kept apart from purchased credits, spent first, and any expiry is shown in the copy |
| Apple 3.1.2(a) | Subscription "available across all of the user's devices" | RevenueCat entitlements follow the account on every device |
| Play Payments | No rule found either way on free promotional access [unconfirmed] | Same position as Apple: promotional time, never sold, IAP remains the way to buy |
| Apple 5.1.1(iii), 5.1.2(v) | Use "a share sheet rather than requesting full access to … Contacts"; no "Select All" | The kit never asks for Contacts; it uses the system share sheet only, and the preview shows the exact message |
| Apple 5.1.2(i) | Must not require system functions such as push "to … receive monetary or other compensation, including … codes" | Rewards are always shown in-app; push is optional |
| Apple 4.5.4 | Push "should not be used for promotions or direct marketing purposes unless customers have explicitly opted in" | The reward push only states what happened ("You got 5 days of Premium"), only for users who opted in to that notification type, with a setting to turn it off; never "invite more friends" |
| Apple 5.6 | Never "trick" users or "engage in any other manipulative practices" | Reward wording states its conditions in the same sentence (section 11); a sharer who already pays is told exactly what they get (section 6.4) |
| Apple 1.3, 5.1.4 | Kids Category: no links out except behind a parental gate; care with persistent identifiers from minors | The kit is not supported in Kids Category apps: do not install it in a Kids Category app's backend (settings are one row per Supabase project, so there is no per-build switch). Per user, the app's hook `app_referral_age_ok(user_id, minimum_age)` (6.2) turns it off below `settings.minimum_age` (D-R9: 13 or the local age of digital consent, or 18) |
| Apple 5.1.1(v) | Apps that support account creation must let users start account deletion in the app | Section 9 (`referral.delete_user`) is called from the app's in-app deletion |
| Play account deletion | Delete "the user data associated with that app account"; some data may be kept for legitimate reasons such as fraud prevention if disclosed | Section 9 retention, stated in the privacy text |

The store-review guide carries the App Review note text and the Data safety / privacy label answers. Neither store's
text names referral programs explicitly [unconfirmed].

## 4. Flows

### 4.1 Sharer

1. Opens **Invite friends** from the profile page, from one prompt after a moment of value (policy in 11.4), or from a
   secondary line on the paywall that carries its condition ("Or get 5 days of Premium free when a friend you invite
   subscribes"), built from the active rules (11.1).
2. Sees: their code in large monospaced type (`ABCD-EFGH`), **Share** (system share sheet, link + code + the reward
   line built from the active rules), **Copy code**, the rules in two sentences with their conditions, the caps ("Up to
   10 friends a month count"), rewards earned, pending rewards with an approximate date, and the program terms link.
3. Gets an in-app card when a reward lands (and a push only if opted in, 4.5.4).

### 4.2 Friend

1. Taps the link → invite page `/i/CODE` (section 12). App installed → universal link / App Link opens it with the code.
2. Not installed → store. **Android:** the page links Play with `&referrer=code%3DABCDEFGH`; the package reads it once
   through the Play Install Referrer API and prefills the code (no MMP, no tracking disclosure). **iOS:** after install
   the code is offered by a native **Paste** button: `UIPasteControl` in a Flutter platform view (iOS 16+), which reads
   the clipboard without the "Allow Paste" prompt. On older iOS, the text field's own paste menu. The package never calls
   `Clipboard.getData` on iOS, because that shows the system prompt. Paste only helps if the code was copied, so the
   invite page's App Store button **copies the code in the same tap** and says so ("Code copied. Paste it in the app
   after installing.").
3. Code entry: offered once in first run after sign-in, then in Settings with a countdown ("You can add an invite code
   for 5 more days"). After the window: the row stays and says "Invite codes can only be added in your first 7 days".
   A prefilled code needs one tap to confirm.
4. On claim the friend sees, before confirming, a sentence built from the claim's rules (11.1). With both rules on:
   "Your inviter gets a reward when you start using the app, and another if you subscribe, so they'll know when that
   happens. They never see your email or what you bought." With one rule on, only that event is named. (The reward
   itself reveals the event when the sharer invited one person; the kit says so instead of hiding it.)
5. When the app's activation condition is met (server-side, 6.2), both `joined` rewards are queued; the friend sees
   "Welcome bonus: 30 min, thanks to your invite."

### 4.3 Paid

1. RevenueCat webhook → `/webhook` → decision table (6.3). A qualifying event queues the sharer's `paid` reward with
   `available_at = now + hold` (default 72 h), linking the referral to its `transactions` row (hashed `original_transaction_id`).
2. `/worker` (pg_cron, every 15 min) re-checks the friend's subscription with RevenueCat before granting (6.5).
3. Grant: `entitlement_days` via RevenueCat with a stored `target_expires_at` (6.4); other kinds via the app hook.

## 5. Data model (schema `referral`)

| Table | Columns (key ones) | Notes |
|---|---|---|
| `codes` | `id` PK, `user_id`, `code` unique, `created_at`, `disabled_at` | Partial unique index `(user_id) where disabled_at is null`, so a leaked code can be rotated |
| `retired_codes` | `code` PK, `retired_at` | Codes never reissued after rotation or account deletion |
| `members` | `user_id` PK, `eligible_from`, `deleted_at` | When the account became verified (6.8). Kept with only `deleted_at` after deletion, so the worker never recreates a deleted user in RevenueCat (9) |
| `abuse_marks` | `user_id`, `event_id`, `cause` (`late_refund`, `intro_refund`, `transfer_in`), `points`, `created_at`; unique (`user_id`, `event_id`, `cause`) | One mark per cause, so replays and parallel runs never double-count; the score is the sum over 365 days (8) |
| `transactions` | `original_transaction_id_hash` PK, `pepper_version`, `first_purchased_at_ms`, `started_at_source` (`initial_purchase` / `api_starts_at` / null = unknown yet), `transaction_ids_seen` (HMACs), `product_id` (store product id), `store`, `environment`, `refunded_at`, `refund_state_ms` (timestamp of the event that last set or cleared the refund) | One row per store subscription, written by the first event that mentions it, **before** any referral holds it. Holds refunds that arrive early, and when the subscription really began (6.3, 6.7) |
| `installs` | `install_id_hash`, `pepper_version`, `user_id`, `first_seen`, `last_seen` | Written by **every** RPC (all take `install_id`, 7); HMAC only (pepper: 9) |
| `referrals` | `id`, `code`, `sharer_id` (nullable), `friend_id` unique (nullable after deletion; Postgres allows many nulls), `state` (`claimed`, `joined`, `paid`, `paid_cancelled` (refund or transfer in the hold), `expired` (not activated in time), `refunded_late`, `void` (code disabled after review)), `rule_set_version` (rules promised at claim time), `claim_install_hash` + `pepper_version` (the install the code was claimed on; "friend rewards 1 per install ever" counts from it), `claimed_at`, `joined_at`, `paid_at`, `original_transaction_id_hash` unique (→ `transactions`), `friend_deleted_at` | One referral per friend ever; kept pseudonymous after the friend deletes their account (9) |
| `rules` | `id`, `version`, `event`, `who`, `kind`, `amount`, `params`, `active`, `valid_from` | Append-only: rows are added or deactivated, never edited. A referral is paid by the rules of its `rule_set_version`, so a change after the claim never breaks what the friend and sharer were told |
| `rewards` | `id`, `referral_id`, `user_id` (null after the recipient deletes their account), `who` (`sharer`/`friend`), `event`, `rule_id`, `kind`, `amount`, `params`, `grant_key` (e.g. `entitlement:premium`), `state`, `available_at`, `target_expires_at`, `granting_started_at`, `attempt_token` (uuid, new on every claim; every later write is compare-and-set on it, 6.4), `attempts`, `last_error`; unique (`referral_id`, `who`, `event`, `rule_id`); partial unique (`user_id`, `grant_key`) where `state in ('granting', 'failed_retryable')` | States: `queued`, `granting`, `granted`, `banked`, `cancelled`, `skipped_cap`, `void_fraud` (sharer's code disabled after review, 8), `failed_retryable`, `failed`. Final states: `granted`, `cancelled`, `skipped_cap`, `void_fraud`, `failed`. Caps are counted from this table, so deleting a friend never frees a cap slot |
| `reward_seen` | `reward_id`, `install_id_hash`, `pepper_version`, `seen_at`; PK (`reward_id`, `install_id_hash`) | Which device has shown which reward card |
| `events` | `event_id` unique, `type`, `state` (`received`, `processed`, `ignored`, `failed`), `fields` jsonb, `event_timestamp_ms`, `attempts`, `received_at`, `processed_at` | `fields` holds only what 6.3 needs: user ids, `aliases`, `transferred_from`/`transferred_to`, `original_transaction_id`, `transaction_id`, `product_id`, `entitlement_ids`, `period_type`, `price`, `store`, `environment`, `is_family_share`, `is_trial_conversion`, `cancel_reason`, `purchased_at_ms`. Never `subscriber_attributes` (may hold email or name). `processed`/`ignored` rows are purged after `events_retention_days` (30); `failed` rows are kept and alerted until handled. A resend after the purge is harmless: effects are idempotent (6.7) |
| `tombstones` | `kind` (`install` / `transaction`), `value_hash`, `pepper_version`, `created_at` | One row per install the deleted friend ever used and one per transaction. HMAC with the pepper, not plain sha256 (Apple transaction ids are numeric and guessable). Kept 12 months after a friend deletes their account (fraud prevention). **Read by** `referral_claim` (`same_install`) and by the paid check (6.3 "never rewarded any referral") |
| `settings` | one row: `enabled`, `paid_enabled`, `hold_hours` 72, `claim_window_days` 7, `activate_window_days` 30, `paid_window_days` 90, `joined_delay_hours` 0, `max_attempts` 8, `granting_lease_minutes` 15, `worker_batch` 20, `worker_time_budget_seconds` 100, caps (`sharer_joins_per_30d` 10, `sharer_paid_per_365d` 6), `daily_grant_cap` 500, `abuse_threshold` 3, `pepper_version` 1 (for new rows), `pepper_versions_active` `{1}` (checked on lookups), `events_retention_days` 30, `stats_floor` 3, `minimum_age` 13, `allow_sandbox` false, `entitlement_id` (the entitlement whose purchase counts as `paid`) | No secrets. The RevenueCat project id lives only in the function's environment (`REVENUECAT_PROJECT_ID`). One row per Supabase project, so one app per project |

## 6. Rules of the flow

### 6.1 Identity

- Integration requirement: RevenueCat app user ID = Supabase `auth.uid()`; `Purchases.logIn(uid)` runs **at sign-in**
  (and on every app start while signed in), not just before a paywall.
- The webhook matches users on `app_user_id`, `original_app_user_id` and every entry in `aliases`. **`TRANSFER` is the
  exception:** RevenueCat sends it only to the destination, with the old owners in `transferred_from` and the new in
  `transferred_to`, so transfers are matched on those two lists (6.3).
- RevenueCat 404 (customer not found) in the worker → create the customer (API v2 create customer, id = the user id),
  then grant, **unless `members.deleted_at` is set**, in which case the reward is `cancelled`. A sharer who never opened
  a paywall still gets their days; a deleted user is never recreated.

### 6.2 Joined

- `referral_claim` requires a verified account: email confirmed, phone confirmed, or an OAuth identity. Anonymous
  Supabase users (`auth.jwt()->>'is_anonymous' = 'true'`) are refused.
- Activation is decided **on the server**: a hook `app_referral_is_active(user_id) returns boolean` written by the
  app over its own tables (example: the user has a reading-progress row). It is evaluated by `referral_check_activation`
  (the client asks "check me now"), by the worker for every `claimed` referral each run, and optionally by a trigger:
  the kit ships `referral.activation_trigger()` (security definer, so it works when the triggering insert runs as
  `authenticated`) that the app attaches to its own table. The client can never assert activation.
- Age: a second app hook `app_referral_age_ok(user_id, minimum_age) returns boolean`; the kit passes
  `settings.minimum_age`, and the app answers from its own declared age or age-range data (the default implementation
  returns true and the integration guide says so). `false` → `under_age`. The kit stores
  no age itself [unconfirmed: new age-assurance laws may require a declared age range from the store].
- `joined` rewards are queued with an optional delay (`joined_delay_hours`, default 0; 24 recommended for open apps).
- A claim not activated within `activate_window_days` (30) becomes `expired` (worker sweep); no rewards are queued.

### 6.3 Paid decision table (`logic.ts`, unit-tested)

Every qualifying row also needs: the entitlement is the one in `settings.entitlement_id`;
`transactions.first_purchased_at_ms` (when the subscription **began**, trial included) is after `claimed_at`, so a trial
started before the claim that converts after it never counts. That start is known only from an `INITIAL_PURCHASE`
event or from API v2 `starts_at`: if the first event seen for a transaction is anything else (its `INITIAL_PURCHASE`
was lost), the paid decision waits and the worker fills `first_purchased_at_ms` from the friend's API v2 subscription
`starts_at` (`started_at_source = api_starts_at`) before deciding (built as, migration 17: a waiting event received
more than `paid_window_days` ago is `given_up` with `last_error = 'start not found: gave up <n> days (paid_window_days)
after the event was received'`, alerted once as `starts_given_up`; counted from the event's `received_at`, which is
never earlier than the claim's own window end because the window is checked before the start); the qualifying event is within `paid_window_days` (90)
of the claim; and the transaction has no `refunded_at`, never rewarded any referral, and has no tombstone (HMAC
comparison, since stored ids are hashed).

| Webhook | Counts as `paid`? |
|---|---|
| `INITIAL_PURCHASE`, `period_type` NORMAL or PREPAID, `price > 0` | yes |
| `INITIAL_PURCHASE`, `period_type` TRIAL | no, wait for conversion |
| `INITIAL_PURCHASE`, `period_type` INTRO | D-R8; default yes only if `price > 0`; a refund of a rewarded INTRO purchase adds an abuse mark (cheap farm-then-refund, 8) |
| `RENEWAL` with `is_trial_conversion = true` | yes |
| `RENEWAL` after a lapse | only if this referral never reached `paid` |
| `PRODUCT_CHANGE` | never by itself (an existing subscriber changing plan; the later `RENEWAL` decides) |
| `NON_RENEWING_PURCHASE` | never by default; a rule may opt in with `params.count_one_time = true` |
| `UNCANCELLATION`, `SUBSCRIPTION_EXTENDED`, `BILLING_ISSUE`, `EXPIRATION` | no effect on `paid` |
| `store = PROMOTIONAL` (including the kit's own grants) | never |
| `TRANSFER`, `TEMPORARY_ENTITLEMENT_GRANT` | never |
| `is_family_share = true` | never |
| `environment = SANDBOX` | never, unless `allow_sandbox` (off; TestFlight purchases are sandbox) |
| Any event type not in this table | `ignored` (stored, no effect) |

Cancelling a held `paid` reward:

| Webhook | Effect |
|---|---|
| `CANCELLATION` with `cancel_reason = CUSTOMER_SUPPORT`, or `price < 0` (refund; RevenueCat has no standalone refund event) | set `transactions.refunded_at` (even if no referral holds it yet); cancel; referral → `paid_cancelled` |
| `TRANSFER` whose `transferred_from` contains the friend | cancel (the subscription left the friend); referral → `paid_cancelled` |
| `TRANSFER` whose `transferred_to` is a friend in the paid window | never counts; abuse mark for the sharer |
| `REFUND_REVERSED` (App Store only) | clear `refunded_at`; un-cancel if still inside the paid window, even if the sharer's cap has filled since (it was within the cap when queued); delete the `intro_refund` abuse mark of that event's refund |
| `CANCELLATION` with `cancel_reason = UNSUBSCRIBE` (auto-renew off) | no effect: the friend paid |

### 6.4 Granting `entitlement_days` exactly once

A RevenueCat call cannot run inside a database transaction, so a grant is three short steps:

1. **Claim (transaction A, one row per call).** The claim function takes **one** reward with
   `FOR UPDATE SKIP LOCKED` among `queued` / `failed_retryable` rows whose `available_at` has passed **and whose user
   has no other row in `granting` or `failed_retryable` for the same `grant_key`** (`not exists`), sets
   `state = 'granting'`, `granting_started_at = now()`, a fresh `attempt_token`, `attempts = attempts + 1`, and returns
   the row. The partial unique index on (`user_id`, `grant_key`) where `state in ('granting', 'failed_retryable')` is
   the backstop: **only one unfinished grant per user and entitlement exists at a time**, so a second reward for the
   same sharer can never land inside the first one's two-hour window. If the index still fires (a race), that one call
   returns nothing; no batch is aborted. The worker repeats the claim up to `worker_batch` (20) times or until
   `worker_time_budget_seconds` (100) is used, so a run always ends inside the Edge Function's time limit.
   - **Lease:** every run first moves `granting` rows older than `granting_lease_minutes` (15) to `failed_retryable`
     with `available_at = now() + backoff(attempts)` (2^attempts minutes, at most 6 h); at `max_attempts` (8) to
     `failed`, owner alerted. A crash, timeout or cut-off request therefore never leaves a reward stuck, and a reward
     that always crashes the function cannot hold the slot forever.
   - **Stale writers:** every write after the claim is
     `update … where id = $1 and attempt_token = $2 and state = 'granting'`; a worker whose lease was swept writes
     nothing (zero rows) and stops. The stored target makes the second worker's resend safe.
2. **Decide the target (outside a transaction, then transaction B).** If `target_expires_at` is still null: re-check
   `members.deleted_at`; then list the sharer's **subscriptions** from RevenueCat (API v2; the customer's
   `active_entitlements` cannot tell a store purchase from a promotional grant). Create the customer on 404 (6.1).
   - A subscription with `gives_access = true` and `store ≠ promotional` for the entitlement → `banked` (below).
   - A non-expiring store entitlement (lifetime purchase, `expires_at` null) → the reward is `cancelled` with
     `last_error = 'lifetime'`, (corrected during the build: in API v2 a lifetime purchase is not a subscription, and a
     subscription's null `ends_at` means paused; the worker reads it from the customer's `active_entitlements` item
     with `expires_at` null) unless the rule's `params.fallback` names another reward kind, which is queued instead;
     the card says "You already have lifetime Premium".
   - Otherwise `target = max(now, latest active expiry of the entitlement) + days`, and at least 2 h + 1 min past any
     existing grant's expiry. Store it with `update … where attempt_token = $2 and target_expires_at is null`. Commit.
     A stored target is never recomputed.
3. **Grant, verify, then record (transaction C).** Send the grant with the stored `target_expires_at`. The grant
   returns 201 with the customer; that response is the verify read when it carries `active_entitlements`, otherwise
   the worker reads the customer (corrected during the build: API v2 documents `active_entitlements` only on GET
   customer). After a timeout, where RevenueCat's read-after-write may lag, the customer is read once after 30 s. The entitlement's expiry at or past
   the target → `granted`. Short of the target → `failed`, owner alerted (never silently `granted`). Timeout or 5xx →
   `failed_retryable` with backoff; the retry resends the same target, which the two-hour rule turns into a no-op if
   the first call landed. 429 → back off with `Retry-After`. After `max_attempts` → `failed`, owner alerted.
   - **Known limit:** if the app itself grants the same entitlement to or past the target between steps 2 and 3, an
     ignored kit grant still verifies as `granted`. Apps that make their own promotional grants of this entitlement
     must route them through the kit's queue (integration guide); otherwise this overlap is accepted.
   - **Owner action on `failed`:** `referral.admin_retry_reward(reward_id, recompute boolean)`: `recompute = false`
     resends the stored target; `true` clears the target so step 2 runs again, only after the owner has checked the
     customer in the RevenueCat dashboard.
   - The entitlement granted is the rule's `params.entitlement_id` (it also forms `grant_key`); when a rule omits it,
     `settings.entitlement_id`. This is the lookup key the app and webhooks use (`premium`); the grant call takes
     RevenueCat's internal entitlement id (`entl…`), so the worker maps one to the other with API v2 list entitlements
     once per run (corrected during the build).

**Daily cap:** when `daily_grant_cap` is reached, remaining rewards stay `queued` with `available_at` moved to the next
day and the owner is alerted. Nothing is dropped.

**Sharer already subscribed** to the same entitlement (D-R6, default (a)): the reward becomes `banked`; the copy says "5
days of Premium, added when your current plan ends". Release:
- an `EXPIRATION` webhook for that user with `store ≠ PROMOTIONAL` and the entitlement in `entitlement_ids` moves it
  back to `queued` (a promotional grant expiring never releases banked days);
- a daily worker sweep re-reads each banked sharer from RevenueCat and releases the rewards of anyone with no active
  store subscription, so a missed webhook never banks days forever;
- step 2 runs again at release, so a sharer who resubscribed in between is banked again instead of wasting the days.

Built as (migration 17, 2026-11-14): release is per entitlement, whichever entitlement the rule granted
(`params.entitlement_id` or settings): the EXPIRATION releases banked rewards for each entitlement it names, and the
daily check reads each (sharer, entitlement) pair from the sweep's `banked` list. "Holds the entitlement" reads every
page of the subscription's `entitlements` list (`next_page` → GET `…/subscriptions/{id}/entitlements`, page cap
`maxPages`); a subscription without the list is read again once, and if it is still missing nothing is assumed: the
grant retries, the daily check keeps the days banked. Lifetime: `params.fallback` = `{"kind", "amount" > 0,
"params"?}` (any kind except `entitlement_days`, checked by the `referral.rules` constraint `fallback_is_valid`); the
claimed reward becomes that kind, granted at once through `referral_app.app_referral_grant`, original kept in
`params.fallback_from`. Without `params.fallback`, `cancelled` / `lifetime` as before.

Alternatives: (b) a store renewal-date extension [unconfirmed: Apple limits extensions and intends them for service
issues], (c) a different reward kind.

### 6.5 Fresh check before a paid grant

Webhooks are best effort (about 5 retries over about 80 minutes; cancellations can take about 2 hours). Before
granting, the worker reads the friend's subscriptions from RevenueCat (API v2 list subscriptions). API v2's
`store_subscription_identifier` is the **latest** transaction (Apple) or order (Play), not the original, so the match
is: its HMAC is in `transactions.transaction_ids_seen` for this referral's transaction, or, failing that (the latest
renewal's webhook was missed), a subscription whose `starts_at` equals `transactions.first_purchased_at_ms` (within one
minute), whose store matches after normalising (API v2 `app_store` / `play_store` ↔ webhook `APP_STORE` /
`PLAY_STORE`), in the same environment, with `ownership = purchased` and `gives_access = true`. API v2 `product_id` is
RevenueCat's own product id, not the store's, so it is never compared with the webhook's. The API v2 subscription
has no refund field, so refunds are known only from the webhook (`transactions.refunded_at`, already checked in 6.3).
No matching active subscription owned by the friend → `cancelled`, referral → `paid_cancelled`.

### 6.6 Refund after the hold

No clawback (RevenueCat revoke removes **all** promotional grants for the entitlement). The referral becomes
`refunded_late` and adds an abuse mark (8). D-R7 may
instead count `paid` only at the first renewal after the paid period.

### 6.7 Webhook processing

- Verify both the `Authorization` token and `X-RevenueCat-Webhook-Signature` (`t=…,v1=` HMAC-SHA256 of
  `"<t>.<raw body>"`) over the raw bytes, constant-time, rejecting `t` more than 10 minutes off. Deployed with
  `--no-verify-jwt` (RevenueCat cannot send a Supabase JWT).
- **Two transactions.** (1) Insert the trimmed event (5, `events.fields`) as `received` and commit; then return 200.
  Replays hit `event_id` unique and return 200. (2) Process it in its own transaction (same request when time allows,
  well under RevenueCat's 60 s timeout): success → `processed` or `ignored`; an error rolls back only the effects and
  marks the event `failed` with `attempts + 1`. The worker retries `received` and `failed` events until `max_attempts`,
  then alerts the owner. So no event is lost and a failure always leaves a row. Processing after the response uses
  `EdgeRuntime.waitUntil`.
- **Decide in one place, apply under a fingerprint (build, part 5).** The decision tables run only in `logic.ts`.
  The function reads the facts with `referral_svc_event_context` (event, settings, transaction, matching referrals)
  plus an md5 fingerprint of them, decides, and calls `referral_svc_apply_event(event_id, fingerprint, decision)`.
  That call locks the event, the transaction and the referrals, recomputes the facts and applies the decision only if
  the fingerprint still matches; otherwise it returns `retry` and nothing changes. It also re-checks the hard
  preconditions itself (a transaction pays one referral once, never after a refund; only a refund cancel can be
  undone), so even a wrong decision cannot pay twice. A friend who pays before the activity hook fires counts as
  joined first (joined rewards, then paid).
- **One processor per event.** Both the request and the worker take the event with
  `select … for update skip locked where state in ('received', 'failed')`, so the same event is never processed twice
  at once. Every effect is idempotent: reward rows have unique keys, abuse marks are unique per (`user_id`, `event_id`,
  `cause`).
- **Order.** Webhooks can arrive in any order, so events are **never skipped for being old**. The first event
  mentioning a store subscription creates its `transactions` row. Purchase events (`INITIAL_PURCHASE`, `RENEWAL`) are
  always evaluated against 6.3; their effects are idempotent, so a late one is harmless and is never lost behind a
  newer `CANCELLATION`. Only the refund flag is ordered: a refund or `REFUND_REVERSED` changes `refunded_at` only if
  its `event_timestamp_ms` is newer than `transactions.refund_state_ms`, so a late refund cannot undo a newer reversal
  and the reverse. A refund stored before any referral holds the transaction still blocks the reward when its
  `INITIAL_PURCHASE` arrives later.

### 6.8 Time

All windows and caps use server `now()`, `timestamptz` and rolling windows; never the device clock. The claim window
counts from `members.eligible_from` = the moment the account first became verified and non-anonymous
(earliest of `email_confirmed_at`, `phone_confirmed_at`, first OAuth identity), not `auth.users.created_at`, which is
the anonymous start when an app upgrades anonymous users. The kit records it on the first RPC call after that moment.

## 7. API (`public.referral_*` wrappers, `authenticated` only)

Every user RPC takes `install_id` and records it in `installs`, so a sharer who only shares is still known on their
phone (8).

| RPC | Does |
|---|---|
| `referral_my_code(install_id)` | Returns (creates once) the caller's active code |
| `referral_rotate_code(install_id)` | Retires the current code, issues a new one (max once per 30 days) |
| `referral_claim(code, install_id)` | Records the claim if allowed; returns `{reason}` |
| `referral_check_activation(install_id)` | Asks the server to evaluate `app_referral_is_active` for the caller now |
| `referral_stats(install_id)` | `{rewards_granted[], pending[{kind, amount, available_at}], banked[], skipped_cap, joined_count?, paid_count?}`; counts only when at least `stats_floor` (3) friends joined |
| `referral_pending(install_id)` | Read-only list of granted or banked rewards not yet in `reward_seen` for this install |
| `referral_ack(reward_ids uuid[], install_id)` | Inserts into `reward_seen`, so each device shows the card once and none misses it |
| `referral_terms(install_id)` | The active rules, caps and windows, so the app and invite page build copy from the real numbers (11.1). The invite page uses a static export of it, not the RPC |

**Server RPCs (`service_role` only).** The Edge Function reaches the database through supabase-js with the service
role key, which can only call functions exposed through PostgREST, so it gets its own wrappers in `public`, granted to
`service_role` only (revoked from `public`, `anon`, `authenticated` by name): `referral_svc_ingest_event`,
`referral_svc_process_event`, `referral_svc_claim_reward`, `referral_svc_set_target`, `referral_svc_finish_reward`,
`referral_svc_sweep` (leases, expiries, banked release, event retries, retention purge), `referral_svc_fill_start`
(6.3), `referral_svc_pending_checks` (what the worker must read from RevenueCat). The CI privilege test (13) covers
both groups.

`referral_claim` returns `{reason, retry_after_seconds?, days_left?}`. Claim reasons (versioned enum; unknown reasons
map to a generic message): `ok`, `own_code`, `already_referred`, `unknown_code` (also used for disabled codes, so nothing
is revealed), `window_closed`, `rate_limited` (with `retry_after_seconds`), `not_verified`, `anonymous_user`,
`same_install`, `program_paused`, `under_age`.

## 8. Abuse rules

- Self-referral: same account; or the install was ever used by the sharer or by any account that already claimed
  (`installs`). The install id is a random UUID that survives a reinstall; never IDFA or the advertising id.
  iOS: Keychain item with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` and not synchronizable (no iCloud
  Keychain). Android: Block Store with cloud backup off; Block Store may still carry it to a new phone during
  device-to-device setup, so a person's new phone counts as their old install. That is acceptable: it can only block a
  friend claiming on a phone the sharer set up. It is advisory only; Play Integrity / App Attest are optional extras.
- Claim limit: 5 attempts per hour per account **and** per install.
- Caps, counted from `rewards` (so deleted friends still count): sharer 10 rewarded joins per 30 days, 6 paid rewards
  per 365 days; friend rewards 1 per install ever (counted from `referrals.claim_install_hash`); `daily_grant_cap` (500) for the whole app as a circuit breaker (6.4).
  When the sharer is capped, the friend still gets theirs; the sharer's reward is `skipped_cap` and shown as such. Caps
  are disclosed on the invite screen and terms page (11.1).
- Abuse score per sharer = the sum of `abuse_marks` over 365 days: 1 point each for a late refund (`late_refund`,
  6.6), a refunded rewarded INTRO purchase (`intro_refund`) and a transfer into a friend (`transfer_in`, 6.3); one
  event can carry two causes. One friend's refund is something the friend did, so it
  never disables a code alone: at `abuse_threshold` (3) the sharer's code is disabled for owner review, their
  unfinished rewards wait, and the owner either restores the code or voids them (`void_fraud`, referrals `void`).
- Multi-account farming: rewards need real activity (6.2) and optionally a 24 h delay. Private-relay emails (Sign in
  with Apple) are never blocked; Gmail dots and `+` are normalised only for scoring.
- Codes leaking to coupon sites: invite page is `noindex`; owners can rotate codes; late refunds disable codes.
- Kill switches: `settings.enabled`, `settings.paid_enabled` — stop a new exploit without an app update.
- Open source means these rules are public; they must hold without secrecy, and the kill switches are the backstop.

## 9. Account deletion and retention

- **Sharer deletes their account:** every code moved to `retired_codes` (never reissued, so old links never point to
  a new person) and the `codes` rows deleted; `sharer_id` set to null on their referrals; **every unfinished reward**
  (`queued`, `banked`, `granting`, `failed_retryable`) cancelled, and the worker re-checks `members.deleted_at` before
  any RevenueCat call, so an in-flight grant stops and a deleted customer is never recreated (6.1); `rewards.user_id`
  set to null; `members` keeps only `deleted_at` (upserted if the user never had a row); `abuse_marks` deleted. Friends
  keep rewards already granted.
- **Friend deletes their account:** the referral row is **kept pseudonymous**: `friend_id` set to null,
  `friend_deleted_at` set (the transaction was only ever stored as an HMAC). The sharer's rewards stay linked, so the
  books balance and caps (counted from `rewards`) are not freed. The sharer's granted rewards stay; an unfinished
  `paid` reward is `cancelled` (the purchase can no longer be checked). The friend's own rewards rows keep only
  `user_id = null`.
  Tombstones keep only HMACs and the date, one row for every install the friend used (from `installs`, before those
  rows are deleted) and one for the transaction, for 12 months, so delete-and-sign-up-again cannot earn `joined` again.
- **Both cases:** the user's rows in `installs` and `reward_seen` are deleted, and `events` rows whose `fields` name
  the user in any user-id field (`app_user_id`, `original_app_user_id`, `aliases`, `transferred_from`,
  `transferred_to`) are deleted.
- **Pepper rotation:** the HMAC is computed **in SQL** (`extensions.hmac` from pgcrypto, inside security definer
  functions) with peppers kept in Vault as `referral_pepper_v1`, `referral_pepper_v2`, … Every hashed column carries
  `pepper_version`. The raw values are never stored, so old rows cannot be re-hashed. Therefore a pepper version is
  **kept for as long as any row uses it**: to rotate, add `referral_pepper_v2`, set `settings.pepper_version = 2` (new
  rows) and add 2 to `settings.pepper_versions_active`; every lookup (same install, never-rewarded transaction,
  tombstones) hashes the input under every active version. A version is removed from Vault and from
  `pepper_versions_active` only when a query shows no row in any table still uses it (`referrals` and `transactions`
  rows never age out, so in practice old versions stay). Rotation is for a suspected leak, to stop new rows using the
  old pepper.
- The privacy text in `docs/privacy.md` states this retention and its fraud-prevention purpose (Apple 5.1.1(i),
  Play account deletion policy).
- The kit ships `referral.delete_user(uid)`; the app calls it from its existing account-deletion path. The integration
  guide also tells the app to call RevenueCat's API v2 delete customer from its server deletion path (it removes the
  RevenueCat customer and its attributes) [unconfirmed: effect on store-side records].

## 10. Privacy disclosures

Declared as linked to the user, for app functionality and fraud prevention [unconfirmed: exact form wording]:

| Data | Apple privacy label | Play Data safety |
|---|---|---|
| Install id | Identifiers (Device ID or User ID) | Device or other IDs — fraud prevention, security and compliance |
| Who referred whom | Other data | Other app activity |
| Friend's purchase status used to reward the sharer | Purchases | Purchase history |

The privacy policy adds: "If you use an invite code, the person who invited you gets a reward when you start using the
app and another if you subscribe, so they can tell those things happened. They never see your email, your name or
which plan you bought." The same sentence is shown to the friend before they confirm the code (4.2). Stats counts
appear only from `stats_floor` (3) joined friends (section 7), but a reward card can still reveal one friend's event,
which is why the friend is told.

## 11. UX

### 11.1 Copy (defaults, ARB, conditions in the same sentence)

**All copy is built from `referral_terms()`**, never hard-coded: amounts, the feature's name (each reward kind has an
app-supplied label, e.g. "30 min of natural voice"), whether the friend gets anything (D-R1), caps and windows. If the
active rules give the friend nothing, every "you both / we both" variant is replaced by the sharer-only one. Defaults,
shown for the example rules:

- Sharer: "You and your friend each get 30 min of <feature> when they sign up and start using the app." "You get 5 days
  of Premium when a friend you invited subscribes (after any free trial). Up to 10 friends a month count."
- Sharer-only variant (D-R1 = no): "You get 30 min of <feature> when a friend you invited signs up and starts using
  the app."
- Paywall line: "Or get 5 days of Premium free when a friend you invite subscribes."
- Paying sharer: "5 days of Premium, added when your current plan ends."
- Friend on claim: the sentence in 4.2 step 4.
- Friend on reward: "Welcome bonus: 30 min of <feature>, thanks to your invite."
- Share text (sharer's language): "I'm using <App>. Join with my code ABCD-EFGH and we both get 30 min of <feature>:
  <link>" (sharer-only variant: "… and I get a bonus"). Naming the reward discloses it (FTC Endorsement Guides, India
  ASCI influencer rules [unconfirmed]).
- Empty: "No invites yet. Share your code: you each get 30 min of <feature> when a friend starts using the app."
  Paused: "Invites are paused right now. Rewards you've earned are safe."
- **Terms page** (`web/invite/terms`, linked from the invite screen and page): every rule, the caps, the claim,
  activation and paid windows, the hold, banking for paying sharers, no cash value, codes can't be sold, and that the
  program can change or end without affecting rewards already queued. Generated from `referral_terms()`.

### 11.2 Error messages per reason (neutral, never accusing)

| Reason | Message |
|---|---|
| `own_code` | That's your own code. Share it with a friend instead. |
| `already_referred` | You've already used an invite code. |
| `unknown_code` | We couldn't find that code. Codes have 8 letters or numbers and never contain O, 0, I, 1 or L. |
| `window_closed` | Invite codes can be added in your first {claim_window_days} days. (from `referral_terms()`) |
| `rate_limited` | Too many tries. Try again in {minutes} min. (from `retry_after_seconds`, rounded up) |
| `not_verified` | Confirm your email and we'll add your code then. (The package keeps the code and retries the claim once the account is verified, like an offline claim, 11.6) |
| `same_install` | This code can't be used on this device. |
| `program_paused` | Invites are paused right now. |
| `under_age` / `anonymous_user` | Invites aren't available for this account. |

### 11.3 Language and layout

ARB files with ICU plural and select, localised durations and digits; right-to-left via `Directionality`; the invite
page picks its language from `Accept-Language` with a switch. Launch languages: en, hi, id (apps add more).
**The code itself is never localised:** always ASCII letters and digits, wrapped in `Directionality(ltr)` with a
left-to-right isolate (`⁦…⁩`) in share text, so an Arabic or Hindi-digit screen never reorders or converts
it; input converts non-ASCII digits back before sending. None of the launch languages is right-to-left, so widget
tests run every screen in an RTL test locale (`ar`) to keep RTL from breaking unseen.

### 11.4 Not nagging (`ReferralPromptPolicy`)

Never in the first session; at most one prompt per 14 days, only after an app-defined moment of value; never during
or right after a purchase; on the paywall it is secondary text, never a button competing with Subscribe.

### 11.5 Accessibility

Code in monospace with `Semantics(label: 'A B C D, E F G H')`; "Code copied" announced; tap targets at least 48 dp;
works at 200 % text scale on a 320 dp wide screen (wraps, never shrinks the code); contrast AA.

### 11.6 Offline

A claim made offline, or refused only as `not_verified`, is kept and retried on reconnect, on app resume, on auth token
refresh and on any sign-in state change (email confirmation usually happens outside the app, so resume and token
refresh are what catch it); the screen says "We'll apply your code when you're back online" or the `not_verified` text. The retry
still has to fit the claim window. The sharer's code is cached for sharing offline.

### 11.7 Code format

Cryptographic random, 8 characters from an alphabet without O, 0, I, 1, L; retry on clash; offensive-word filter;
shown as `ABCD-EFGH`; input normalised before sending: Unicode format characters removed (category Cf, which includes
the U+2066/U+2069 isolates from share text and zero-width spaces), whitespace and dashes stripped, non-ASCII digits
converted, upper-cased. The server applies the same normalisation.

## 12. Invite page (`web/invite/`)

Under 50 KB, works without JavaScript to show the code, `noindex`, Open Graph and Twitter tags with an image (WhatsApp
and Telegram previews), store buttons by platform (Play link carries `referrer`), large copy button, region fallback,
no analytics that log the code, terms link, language from `Accept-Language`. Ships `apple-app-site-association` and
`assetlinks.json` templates.

## 13. Security

- Every `security definer` function: `set search_path = ''` and fully qualified names.
- `revoke all on all functions in schema referral from public, anon, authenticated`; `revoke all on schema referral
  from anon, authenticated`; the `referral` schema is not exposed through PostgREST.
- Supabase grants `anon` and `authenticated` EXECUTE on new functions in `public` by default, so each
  `public.referral_*` wrapper is created with `revoke execute … from public, anon` and `grant execute … to
  authenticated` **by name**, and every wrapper also checks `auth.uid() is not null`.
- **App hooks live in schema `referral_app`**, which is never exposed through PostgREST, with
  `revoke execute … from public, anon, authenticated`; only the role that owns the `referral` functions (the
  migration's role, `postgres` on Supabase) can call them, and the kit's security definer functions run as that owner,
  so they can. A hook created in `public` would let any signed-in user call `app_referral_grant` over `/rpc` and give
  themselves rewards.
- Apps create their hooks **after** the migration, and Postgres gives PUBLIC EXECUTE on every new function. A
  per-schema `alter default privileges … revoke` cannot remove that (per-schema defaults only add to the global ones;
  verified on Postgres 17 while building part 1), and changing the global default would change the app's whole
  database. So the protection is: **no API role ever gets USAGE on `referral` or `referral_app`**, which makes every
  function inside unreachable even when a revoke is missed; every kit migration ends with explicit revokes; the hook
  template in the integration guide revokes by name; and `referral.privacy_problems()` lists any schema usage, table
  access or reachable function for `anon`, `authenticated` or `service_role`. CI asserts it is empty and the worker
  sweep alerts the owner when it is not.
- CI test (SQL): `has_function_privilege` must be false for `anon` on every kit function and every hook, false for
  `authenticated` on every hook, every `referral.*` function and every `referral_svc_*` wrapper, true for
  `authenticated` only on the user wrappers, and true for `service_role` only on the `referral_svc_*` wrappers (7).
- Webhook and worker reach the database only through the `referral_svc_*` wrappers with the service role key.
- **The function is deployed with `--no-verify-jwt`, so each route authenticates itself:** `/webhook` with the
  RevenueCat token and signature (6.7); `/worker` with header `X-Referral-Worker-Secret`, compared in constant time
  against `REFERRAL_WORKER_SECRET`. A request that fails either check gets 401 before touching the database; any other
  path gets 404 and any other method 405 (corrected during the build).
- pg_cron triggers the worker every 15 min through `pg_net` (`net.http_post`), reading the worker secret from Supabase
  Vault (`vault.decrypted_secrets`, readable only by the owner role). `pg_net` only *triggers* the run; the grants
  themselves happen synchronously inside the function (15).
- App hooks `referral_app.app_referral_grant(reward_id, user_id, kind, amount, params)`,
  `referral_app.app_referral_is_active(user_id)` and `referral_app.app_referral_age_ok(user_id, minimum_age)` run as
  definer with `search_path = ''`; `app_referral_grant` must be idempotent on `reward_id`.
- Where secrets live: the RevenueCat v2 key (scopes from the API v2 docs: `customer_information:customers:read_write`
  for get, create, grant and delete customer, `customer_information:subscriptions:read` for 6.4 step 2 and 6.5, and
  `project_configuration:entitlements:read` to map the entitlement lookup key to its id (added during the build);
  nothing else), webhook token, signing secret and worker secret
  in the function's environment; the worker secret's copy for pg_cron and the hashing peppers (`referral_pepper_v1`, … 9) in
  Vault. Never in plain SQL, tables, the app or the repo.

## 14. Open-source hygiene

MIT `LICENSE` with the copyright holder; `.env.example` with blank `REVENUECAT_SECRET_KEY`, `REVENUECAT_PROJECT_ID`,
`REFERRAL_WEBHOOK_TOKEN`, `REVENUECAT_WEBHOOK_SIGNING_SECRET`, `REFERRAL_WORKER_SECRET`; gitleaks in CI; no app-specific names, rules or paths in
the kit (example apps live in `examples/`); a test that fails if the package imports anything app-specific.

## 15. Alternatives considered

| Option | Why not |
|---|---|
| Hosted SaaS (WinWinKit, GoMarketMe, ReferralHero) | Monthly cost, users' data with a third party, not open, limited custom reward kinds |
| Apple/Google offer codes only | No "friend joined" reward, no ledger, platform-specific |
| Deep-link MMP (Branch, AppsFlyer) | Paid at scale and tracking disclosures; Play Install Referrer covers Android free; optional later for iOS |
| Rewards in RevenueCat attributes | Not queryable for abuse checks; no exactly-once ledger |
| Grants sent through `pg_net` from SQL | Asynchronous responses; cannot commit "granted" in the step that sent the request. (`pg_net` is still used, only to trigger the worker route, 13) |

## 16. Decisions for the owner (with defaults)

| # | Question | Options | Default |
|---|---|---|---|
| D-R1 | Friend gets the joined reward too? | yes / no | yes |
| D-R2 | When does "paid" count? | first paid period after trial / at trial start (waiting for the first renewal is D-R7's option) | first paid period after trial |
| D-R3 | Caps | 10 joins per 30 days, 6 paid per year / other | as stated |
| D-R4 | Install links | Play Install Referrer + iOS Paste / add an MMP | Play referrer + Paste |
| D-R5 | Creator cash share | later / never | later |
| D-R6 | Sharer already subscribed | bank until expiry / store extension / other reward | bank |
| D-R7 | Refund after the hold | no clawback + abuse mark (code disabled for review at 3 marks) / count at first renewal | no clawback + abuse mark |
| D-R8 | INTRO period counts as paid? | yes if price > 0 (refund adds an abuse mark) / no | yes if price > 0 |
| D-R9 | Minors (`settings.minimum_age`) | 13, or the local age of digital consent where higher / 18 | 13 or local age |
| D-R10 | Paid window after claim | 90 days / other | 90 days |

## 17. Review findings and fixes

### 17.1 First review (draft 1 → draft 2)

The second review re-checked every row: 30 confirmed fixed, 21 partly fixed, 1 fixed wrongly (#5). Rows marked
"draft 3" were finished or corrected in draft 3.

| # | Sev | Finding | Fixed in |
|---|---|---|---|
| 1 | blocker | Grant retry could double the reward | 6.4 stored `target_expires_at` |
| 2 | blocker | `REFUND` event does not exist | 6.3 cancel table |
| 3 | blocker | No "first paid period" rule | 6.3 decision table, unique `original_transaction_id` |
| 4 | blocker | RevenueCat ↔ Supabase user mapping missing | 6.1 |
| 5 | blocker | Restore/transfer could fake `paid` | 6.3 (`TRANSFER` never). Draft 2's "cancel on transfer away" could never fire; draft 3 matches `transferred_from` / `transferred_to` (6.1, 6.3) |
| 6 | blocker | Client could self-activate | 6.2 server-side activation hook, verified + non-anonymous |
| 7 | blocker | 5 days worthless to a paying sharer | 6.4 banked, D-R6, copy 11.1 |
| 8 | major | Hold shorter than refund window, no clawback plan | 6.6, D-R7 |
| 9 | major | No fresh check before grant | 6.5 |
| 10 | blocker | No account deletion / retention | 9 |
| 11 | major | 3.2.2(x) position missing | 3 |
| 12 | major | 5.6.3 referral manipulation | 3, 8 |
| 13 | major | 3.1.1 IAP bypass position missing | 3 |
| 14 | major | Free minutes vs purchased credits | 3 (`source = referral`) |
| 15 | major | Push required / promotional push | 3, 4.1 |
| 16 | minor | Contacts not stated | 3 |
| 17 | major | Privacy labels / Data safety | 10 |
| 18 | major | Stats revealed a friend's purchase | 7 `stats_floor`, 10 |
| 19 | major | Kids and minors | 3, D-R9 |
| 20 | minor | Reward disclosure and program terms | 11.1, 12 terms link |
| 21 | blocker | Event recorded but never processed | 5 `events.state`, 6.7 |
| 22 | major | Webhook auth token only | 6.7 HMAC signature |
| 23 | major | Grant worker undecided, `pg_net` wrong | 2, 6.4, 15 |
| 24 | major | Rule edits changed in-flight rewards | 5 append-only rules, copied onto rewards |
| 25 | major | No capped/expired states | 5, 6.2, 8 |
| 26 | major | No deadline for the paid event | 6.3, D-R10 |
| 27 | major | Same-install check had no data | 5 `installs`, 8 Keychain/Block Store |
| 28 | major | Multi-account farming | 8 |
| 29 | minor | Brute force per account only; code leaks | 8, 7 (`unknown_code` for disabled) |
| 30 | minor | Code generation, rotation | 5 `codes`, 7 rotate, 11.7 |
| 31 | major | Grants and search_path | 13 |
| 32 | minor | Reason enum wrong | 7 |
| 33 | minor | Pending marked seen on read | 7 `referral_ack` |
| 34 | minor | Pending rewards hidden | 7 stats |
| 35 | minor | Time rules vague | 6.8 |
| 36 | minor | Offline claim | 11.6 |
| 37 | major | Play Install Referrer unused | 4.2, 12 |
| 38 | minor | iOS clipboard prompt | 4.2 |
| 39 | major | Code entry vanished silently | 4.2 step 3 |
| 40 | major | Reward copy hid conditions | 11.1 |
| 41 | major | No message per reason | 11.2 |
| 42 | major | Plurals, locales, RTL | 11.3 |
| 43 | major | Thin invite page | 12 |
| 44 | minor | Nagging | 11.4 |
| 45 | minor | Accessibility | 11.5 |
| 46 | minor | Empty states | 11.1 |
| 47 | minor | Placeholder in friend copy | 11.1 |
| 48 | major | App details leaked into a public ADR | 2 (examples/), header links |
| 49 | minor | Licence, `.env.example`, secret scan | 14 |
| 50 | minor | Least-privilege keys | 13 |
| 51 | minor | Kill switch and daily cap | 8 |
| 52 | minor | Decisions without options | 16 |

Partly fixed in draft 2, finished in draft 3: #1 one grant in flight per user (6.4) · #3 purchase after claim, more
event types (6.3) · #4 create customer on 404 (6.1) · #7 banked release filtered, swept, re-checked (6.4) · #9 check
the referral's own transaction (6.5) · #10 deletion gaps (9) · #17 privacy-form wording still [unconfirmed], answered
in the store-review guide · #18 friend told what the sharer learns (4.2, 10) · #19 age hook (6.2) · #20 terms page
(11.1) · #21 two-transaction events (6.7) · #23, #31 worker route secret (13) · #24 rules fixed at claim (5) · #32
`retry_after_seconds` (7, 11.2) · #33 `reward_seen` in 5, `referral_pending(install_id)` (7) · #35 window from
`eligible_from` (6.8) · #38 native paste control (4.2) · #40 copy from the rules (11.1) · #42 code never localised,
RTL tests (11.3) · #51 daily cap behaviour (6.4).

### 17.2 Second review (draft 2 → draft 3)

| # | Sev | Finding | Fixed in |
|---|---|---|---|
| N1 | blocker | Two rewards for one sharer computed the same target; one lost | 6.4 one `granting` per (user, entitlement), RevenueCat read outside the transaction, 2 h gap |
| N2 | blocker | `/worker` open to anyone (`--no-verify-jwt`); pg_cron needs a secret | 13 worker secret, Vault for pg_cron, 15 corrected |
| N3 | blocker | `TRANSFER` matched on the wrong fields | 6.1, 6.3 |
| N4 | blocker | Unique key dropped a second rule; rules copied too late | 5 unique incl. `rule_id`, `rule_set_version` at claim |
| N5 | blocker | Friend deletion broke the ledger and reset caps | 9 pseudonymous referral, 5/8 caps from `rewards` |
| N6 | blocker | Webhook payloads kept personal data; deletion skipped tables | 5 trimmed `events.fields`, 30-day purge, 9 |
| N7 | major | Event states contradicted one-transaction processing | 6.7 two transactions, order by `event_timestamp_ms`, `refunded_at` |
| N8 | major | Banked days released wrongly or never | 6.4 |
| N9 | major | Privacy sentence untrue for one invited friend | 4.2 step 4, 10 |
| N10 | major | No source for the user's age | 6.2 `app_referral_age_ok`, 3, 13 |
| N11 | major | Copy hid the feature, assumed D-R1, paywall line without condition, caps hidden | 11.1, 4.1, 7 `referral_terms()` |
| N12 | major | Flutter paste still shows "Allow Paste" | 4.2 |
| N13 | major | `UNSUBSCRIBE` is not an event; unknown events; cheap INTRO farming | 6.3, 8 abuse score, D-R8 |
| N14 | minor | Code must stay ASCII and left-to-right | 11.3 |
| N15 | minor | Settings used but not defined | 5 `settings` |
| N16 | minor | `logIn` too late | 6.1 |
| N17 | minor | Unsalted hash of numeric transaction ids reversible | 5 HMAC with pepper, 9 |
| N18 | minor | Install-id storage unspecified | 8 |
| N19 | minor | Header named the wrong section | header |
| N20 | minor | D-R2 overlapped D-R7 | 16 |
| N21 | minor | 5.1.1(v) quote was Play's text | 3 split rows |

### 17.3 Third review (draft 3 → draft 4)

Earlier rows found not fully fixed: #1/N1 (lease, wider index: T1, T2) · #3 (subscription start: T7) · #9 was wrong,
API v2 has no original transaction id (T3) · #10/N5 (T5) · #17 privacy-form answers belong in `docs/store-review.md`,
written in the build's docs phase, still [unconfirmed] · #19/N10 `minimum_age` passed to the hook, D-R9 and 3 aligned ·
#21/N7 (T6) · #31 (T4) · #40/N11 friend sentence and `window_closed` built from the rules (4.2, 11.2) · N19 header
counts corrected.

| # | Sev | Finding | Fixed in |
|---|---|---|---|
| T1 | blocker | A reward stuck in `granting` blocked that sharer forever | 5 `granting_started_at`, 6.4 lease sweep |
| T2 | blocker | `failed_retryable` outside the index let a second grant land in the first one's 2 h window | 5 index on `granting` + `failed_retryable`, 6.4 verify read after every grant |
| T3 | blocker | Fresh check matched an id API v2 does not have; key lacked the subscriptions scope | 6.5, 5 `transactions.transaction_ids_seen`, 13 key scopes |
| T4 | blocker | App hooks and wrappers callable through PostgREST | 13 `referral_app` schema, revokes by name, CI privilege test |
| T5 | major | Sharer deletion left data and live grants; worker could recreate the customer | 9, 6.1, 5 `members.deleted_at` |
| T6 | major | Early refunds had no home; parallel processing double-counted abuse | 5 `transactions`, `abuse_marks`, 6.7 skip-locked processing, `waitUntil` |
| T7 | major | Trial started before the claim still rewarded | 6.3 `first_purchased_at_ms` |
| T8 | minor | No pepper rotation plan | 5, 9 `pepper_version` |
| T9 | minor | Tombstones written but never read | 5, 6.3 |
| T10 | minor | Isolate characters broke pasted codes | 11.7 |
| T11 | minor | iOS Paste needs the code copied first | 4.2 |
| T12 | minor | `not_verified` copy promised an automatic claim | 11.2, 11.6 |
| T13 | minor | Unused states, missing defaults, failed events purged unseen | 5 states and defaults, 6.2, 6.7 |
| T14 | minor | One refund could disable a code | 8 threshold 3, D-R7 |

### 17.4 Fourth review (draft 4 → draft 5)

Rows from 17.3 not fully fixed in draft 4: T1 (lease now raises `attempts`, compare-and-set writes: F3, F4) · T2 (F2,
F8) · T3 (fallback match, key scopes now from the docs: F6) · T4 (worker database path, default privileges: F5, F10) ·
T6 (F1, F11) · T7 (F7) · T8 was wrong (F9) · T12 (F14).

| # | Sev | Finding | Fixed in |
|---|---|---|---|
| F1 | blocker | "Skip older events" lost a purchase that arrived after a newer cancellation | 6.7 purchases always evaluated; only the refund flag is ordered (`refund_state_ms`) |
| F2 | major | A second reward for a busy sharer hit the unique index and aborted the whole batch | 6.4 one row per claim call, `not exists` filter |
| F3 | major | Lease returned rows without raising `attempts`: endless loop | 6.4 attempts on claim, backoff, `failed` at `max_attempts` |
| F4 | major | A slow worker could overwrite the row after its lease was swept | 5 `attempt_token`, 6.4 compare-and-set writes |
| F5 | major | The function had no way to reach `referral` functions | 7 `referral_svc_*` wrappers (service role only), 13 |
| F6 | major | Fallback compared RevenueCat's product id and lowercase store with the webhook's | 6.5 `starts_at` + normalised store + environment |
| F7 | major | Lost `INITIAL_PURCHASE` let a pre-claim trial count | 6.3 start filled from API v2 `starts_at` before deciding |
| F8 | minor | Verify read can't detect an app grant at or past the target | 6.4 stated as a known limit; apps route grants through the kit |
| F9 | major | Pepper rotation broke old matches | 9 keep every version in use, versioned Vault names, HMAC in SQL; `pepper_version` on every hashed table (5) |
| F10 | minor | Revokes did not cover hooks created later | 13: no schema usage plus `referral.privacy_problems()` (draft 5's per-schema default-privilege fix does not work in Postgres; corrected during the build) |
| F11 | minor | One event could carry two abuse causes | 5 `abuse_marks.cause` in the key |
| F12 | major | RPCs without `install_id` left the sharer's phone unknown | 7 every RPC takes `install_id` |
| F13 | minor | Store vs promotional, lifetime access, grant response | 6.4 step 2 lists subscriptions, lifetime rule, grant response is the verify read |
| F14 | minor | `not_verified` retry trigger | 11.6 resume and token refresh |

Rules added for behaviour a builder would have guessed: entitlement from the rule, else settings (6.4) · project id
only in the environment (5) · `delete_user` upserts `members` (9) · kit-shipped `referral.activation_trigger()` (6.2)
· `REFUND_REVERSED` with a full cap and the INTRO mark (6.3) · worker batch and time budget (6.4) · Kids apps: don't
install (3) · `referrals.claim_install_hash` (5, 8) · one tombstone per install (5, 9) · read-after-write lag and the
owner's action on `failed` (6.4).

## 18. Consequences

- Each app adds one migration, one function, three SQL hooks (`app_referral_grant`, `app_referral_is_active`,
  `app_referral_age_ok`), two Vault secrets, the package and two entry points; about one day per app once the kit exists.
- Install attribution on iOS stays manual (Paste) until an MMP is added; Android is automatic through Play.
- The kit carries more states and checks than a naive referral table; that is the price of exactly-once grants,
  honest copy and passing review.
