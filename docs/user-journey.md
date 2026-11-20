# Referral user journey

Updated: 2026-11-20
Every step a sharer and a friend go through, what they see, which kit piece and server call does it, the analytics
event, where the starter app shows it, and how far it is proven. For wiring an app: [integration.md](integration.md)
§8–10. Starter app: [examples/starter_app](../examples/starter_app/README.md). Problems: [ISSUES.md](ISSUES.md).
Still to do: [TODO.md](TODO.md).

Proof levels: **test** = widget/unit test against the fake server; **SQL** = migration tests on a throwaway Postgres
(CI `db-tests`, `function-integration`); **phone** = seen on a real device; **live** = a real project.

## 1. The sharer

| # | The sharer… | Sees | Kit piece / server | Event | Starter app | Proof |
|---|---|---|---|---|---|---|
| S1 | opens Invite friends (Home row, reward card action, settings) | their code, rules, Share / Copy | `InviteHub`, `referral_my_code`, `referral_terms`, `referral_stats` | `invite_screen_viewed` (`from`) | rows on Home, only when `availability()` is available | test, SQL |
| S2 | shares | the system share sheet with the link (or code + store link before the invite page exists) | `inviteLink`, `storeLink`, `share_plus` | `invite_shared` / `invite_code_copied` | Share / Copy | test; share channel not on a phone |
| S3 | a friend signs up with the code | "1 friend used your code. Your reward comes when they start using the app." on **Home** and the invite screen | `ReferralStats.claimedCount` (migration 18) | — | Demo "A friend signs up with your code" | test, SQL; not live (TODO P0) |
| S4 | the friend starts using the app (the app's activation hook) | the reward card on Home; "1 friend joined" | `ReferralRewardCard` (re-asks on resume), `referral_pending`, `referral_ack`, `joinedCount` | `reward_granted`, `reward_shown`, `reward_acknowledged` | Demo "A friend starts using the app" | test, SQL; not live |
| S5 | the friend pays (paid rule) | a pending, then granted reward (RevenueCat grant, after `hold_hours`) | `referral` function `/webhook` + `/worker` | `reward_granted` | — (server only) | SQL, function story test; not live (TODO P0) |

## 2. The friend

| # | The friend… | Sees | Kit piece / server | Event | Starter app | Proof |
|---|---|---|---|---|---|---|
| F1 | taps the shared link `https://<site>/i/<CODE>` without the app | the invite page: code, Copy, App Store / Google Play | `web/invite` (`render.ts`); the Play link carries `referrer=code%3D<CODE>` | — | — | test (`render_test.ts`) |
| F2a | installs from Google Play and opens the app | (nothing yet: the code is kept) | `InstallReferrerCodeReader.readOnce` → `queue.keep(code, source: 'install_referrer')` in `ReferralSetup.start()` | `invite_link_opened` | at start | test (fake referrer); not on a phone (M-checks) |
| F2b | has the app and taps the link | the app opens on code entry | App Links / Associated Domains → route `/i/<CODE>` → `codeFromInviteLink` → `queue.keep` | `invite_link_opened` | `InviteLinkScreen`; Demo "Open an invite link" | test (`handlePushRoute`); App Link not on a phone |
| F2c | installs from the App Store (iOS has no install referrer) | types or pastes the code they copied on the page | `InviteCodeEntry` with `UIPasteControl` (no paste prompt) | `code_entry_started`, `code_submitted` (`typed` / `pasted`) | "Got a code from a friend?" | test; paste not on a phone |
| F3 | is not signed in | Home: "A friend's code H4PZ-8WNE is waiting for you" + Sign in; the link screen: Sign in | `availability()` = `signedOut`, `queue.linkCode()` | `referral_feature_hidden` (`signed_out`, once a day) | waiting card; hub Sign in | test |
| F4 | signs in | code entry opens by itself (once) with the gift, the days left and **"Use code H4PZ-8WNE"** | sign-in stream → `linkCode() != null` → `InviteHub(initialSection: enterCode)`; `referral_terms` | `invite_screen_viewed` (`from: deeplink`) | `_offerLinkCode` on Home; the link screen rebuilds in place | test |
| F5 | taps "Use code …" (one tap, never automatic) | "Almost yours", the 1-of-2 bar, the app's next step | `queue.claim(source: 'prefilled')` → `referral_claim`; clears the link code | `code_submitted`, `code_claim_result` | — | test, SQL |
| F5′ | chooses another code, or leaves | Home keeps a quiet card: Add code / Not now | `queue.clearLinkCode()` on Not now | — | waiting card | test |
| F6 | is offline when tapping | a line that the code is kept and sent later (string `offlineQueued`) | `PendingClaimQueue` + `PendingClaimRetrier` (resume, sign-in stream) | `code_claim_result` (`via: retry`, `trigger`) | retrier with the sign-in stream | package tests |
| F7 | starts using the app (activation) | the welcome gift on Home | `referral_check_activation`, `ReferralRewardCard` | `reward_granted`, `reward_shown` | Demo "You start using the app" | test, SQL; not live |

## 3. Rules the journey keeps

- A code from a link or the install referrer is **never claimed by itself** (ADR 0001 §4.2): the friend sees what it
  gives and taps once. The first code a friend arrived with wins.
- Code entry opens by itself only right after a sign-in (or a code just read from the referrer), never on every app
  start; otherwise Home shows the waiting card, which "Not now" removes.
- Entry points are hidden until `availability()` says yes (server not deployed, signed out).
- Home reloads whenever it is back on top (a `RouteObserver`), so a code added from the link screen, a reward or a
  new count shows without a restart.
- The sharer learns that the link worked at S3, not only at S4 (migration 18). Paid counts stay hidden below
  `stats_floor` (a single friend's purchase must not be revealed).

## 4. What is not proven yet

All on real phones or a live project; tracked in [TODO.md](TODO.md) P0/P1:

- Migrations 18–21 on a live project, then two phones: A shares, B signs up with the link → A sees S3 at once, then S4.
- App Links on Android (assetlinks with the Play app-signing SHA-256) and Associated Domains on iOS opening `/i/<CODE>`.
  The starter's Android filter uses the placeholder host `invite.example.com`; iOS needs the entitlement added in Xcode.
- The Play install referrer from a real Play install (F2a), `UIPasteControl` on iOS 16+ (F2c).
- Paid rewards through real RevenueCat (S5).

## What changed

- 2026-11-20: first version, written with the starter app's journey work (F2a, F2b, F3–F5′ and S3 added to the
  starter; before, it showed only S1, S2, S4, F5 and F7).
