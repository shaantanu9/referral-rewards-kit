# Changelog

## 0.5.0 (2026-11-20)

The growth round (research: `docs/research/referral-growth.md`). Needs server migration 23
(`20261120000023_referral_growth.sql`) for the boost, the invite page settings and the friend's card; on an older
server those parts hide themselves and nothing else changes.

- **Give-first copy (changed default text).** `shareTextBoth`, `shareTextFriendOnly`, `shareTextNoLinkBoth` and
  `shareTextNoLinkFriend` now lead with what the friend gets ("Here's 30 min in X, on me: join with my code … and we
  both get it once you start using the app."); new `shareTextEach` / `shareTextNoLinkEach` disclose "(I get a bonus
  too)" when the sharer's reward differs. The sharer-only and plain texts are unchanged. New headline on the invite
  screen (`ReferralCopy.inviteHeadline`, `texts.inviteHeadline`). Apps that assert the old share sentence in tests
  must update them.
- **Waiting line** on `claimedCount` with the friend's next step and the reward (`ReferralCopy.waitingLine`,
  `texts.waiting`, `texts.activationStepForFriends`), replacing the 0.4 claimed sentence on the invite screen (key
  `referral-claimed` kept). Strings ported from the superseded `feature/waiting-count` branch; no `waitingCount`
  field.
- **WhatsApp button** next to Share (`url_launcher`, `ReferralLauncher`, `whatsAppShareUri`), hidden when it cannot
  launch; `invite_shared` with `channel: whatsapp_button`, `status: opened | unavailable`.
- **QR code** sheet of the https invite link (`qr_flutter`, `showReferralQrSheet`, `ReferralQrSheet`); event
  `invite_qr_shown`.
- **Boost**: `ReferralTerms.boost` (`ReferralBoost`: `startsAt`, `endsAt`, `multiplier`, `events`, `who`),
  `boostAt(now)`; `ReferralBoostBanner` with the real last day ("Double rewards until Sun, 22 Nov …"), never a timer.
- **Invite page settings**: `ReferralInvitePageSettings` (first-name opt-in with the reward disclosure, leave with a
  confirm); the invite screen's "You left the invite program" + "Join again". `ReferralClient.preferences()`,
  `setPreferences(...)`, `ReferralPreferences`, `displayNameProblem`, `MyCodeResult.left` (also `reason: left`);
  event `invite_preferences_changed`.
- **Friend's card**: `ReferralWelcomeCard` (claimed: the gift, the step, days left; joined: pass it on, once),
  `ReferralClient.myClaim()`, `MyClaim`, `MyClaimState`, `MyClaimReward` (`amount`, `baseAmount`, `boosted`);
  events `welcome_card_shown`, `welcome_card_dismissed`.
- `ReferralPromptPolicy`: `ReferralPromptMoment.welcomeRewardReceived`, `shouldPromptFor` / `markPromptedFor`
  (once ever, never in the first session).
- The new RPCs are called "quietly": a server without them does not report `referral_feature_hidden`.
- New dependencies: `url_launcher: ^6.3.0`, `qr_flutter: ^4.1.0`.
- New strings in en, hi, id (52 keys, ICU plurals). **hi and id are not reviewed by native speakers.**
- Tests: models against the real SQL fixtures (`test/fixtures/growth`), copy, widgets (WhatsApp, QR, boost, invite
  page, welcome card), RTL `ar`, 200 % text at 320 dp.

## 0.4.0 (2026-11-19)

Needs server migrations 18–20 (`supabase/migrations/20261119*`); without 18 the new counts are null and the screen
behaves as before.

- Fix: the person who shared a link saw nothing after a friend signed up with it. `ReferralStats.claimedCount`
  (friends who used the code and have not started yet) and `joinedCount` from the first friend; the invite screen
  says "1 friend used your code. Your reward comes when they start using the app." `paidCount` still needs
  `stats_floor` joined friends. `ReferralStats.isEmpty` is false once a friend used the code.
- Fix: `ReferralRewardCard` read the pending rewards only when first built. It now asks again on app resume and when
  its `client` changes, so a reward granted while the app was in the background, or a card built before sign-in,
  appears without a restart. Each reward is reported as shown once.
- New: `PendingClaimQueue.keep(code)` keeps a code from an invite link or the install referrer before sign-in,
  without a server call, and `linkCode()` / `clearLinkCode()`. It is never claimed by itself (one tap, ADR §4.2):
  `InviteCodeEntry` without an `initialCode` shows it as "Use code …"; open code entry after sign-in when
  `linkCode()` is not null.
- New platforms: macOS, Windows and Linux (Dart only: the install id is kept in `flutter_secure_storage` alone, paste
  is the field's menu, no install referrer). iOS supports Swift Package Manager (`ios/referral_kit/Package.swift`);
  CocoaPods apps are unchanged. pana: 160/160.
- Fix: a kept code was dropped when a retry was answered `rate_limited` (5 resumes in an hour while the friend
  verified their email) or `anonymous_user`. Retries now keep it. A typed code still gets the answer at once.
- pub.dev: the `package:flutter/material.dart` import is kept with an ignore comment (Flutter 3.50 deprecates it in
  favour of `material_ui`, which needs Flutter 3.47+; this package supports 3.38+).

## 0.3.2 (2026-11-15)

- Homepage: https://www.myind.ai. No code changes.

## 0.3.1 (2026-11-15)

- Fix: `PendingClaimRetrier` built before `runApp` (as the starter app and the integration guide do) threw a
  null-check error from `AppLifecycleListener` and the app opened on a blank screen. It now initialises the Flutter
  binding first. Test: `retrier_before_run_app_test.dart`.
- pub.dev metadata: description, topics, issue tracker; `publish_to: none` removed.

## 0.3.0 (tag `referral_kit-v0.3.0`)

A drop-in for any app, from everything the first app had to build around 0.2.0: it wrote its own invite
screen, its own HTTP rpc, its own funnel logging and its own share fallback. All of that is now in the package.

Added:

- **`InviteHub` covers a full invite screen.** Copy callback (`onCopied`); rules, caps, joined count and rewards; a
  friend's part (`InviteCodeSection`, also usable alone) with the gift a code brings (only when the friend rule gives
  one), the server's days left as a chip from the theme (`ReferralDeadlineChip`, error container on the last day), the
  field, three steps, "Almost yours" with a 1-of-2 bar and the app's next step (`onAlmostAction`), and one line why
  when a code can't be added (window over, or this account is not eligible: needs `claim_days_left`, migration 9).
  `from` and `initialSection` for entry focus; `scrollable: false` and `padding` to embed in the app's own scroll view
  with no nested scrolling; art slots `header`, `entryHeader`, `entryLeading`; Sign in (`onSignIn`) when signed out.
- **Share without an invite page.** `inviteLink` is optional and may return null (or a non-https link, which counts as
  none); with `storeLink` Share sends the code and the store link, and a line says how the friend uses the code.
- **Every text overridable**: `ReferralTexts` (`texts:` on the hub, section, entry and screen) for the app's voice or
  languages the package lacks; 26 new strings in en / hi / id (hi and id not reviewed by native speakers).
- **One complete event funnel** with the first app's names and props (README "Analytics events"):
  `invite_screen_viewed`, `invite_code_copied`, `invite_shared` (channel buckets, status, has_link),
  `invite_link_opened`, `code_entry_started`, `code_submitted` (now from `PendingClaimQueue.claim`, any caller),
  `code_claim_result` (`via` entry/retry, retry `trigger`), `reward_granted` (from `client.pending()`, once per reward,
  remembered in `eventStore`), `reward_shown`, `reward_acknowledged`, `referral_feature_hidden` (once a day per reason,
  from `availability()`, the screens and `client.reportHidden`).
- `claimEventResult` names every server outcome (`under_age`, `anonymous`, `same_install`, `signed_out`,
  `no_project` are now separate) and `other` for one a newer server adds; `claimResultNames`, `claimReasonName`,
  `outcome.resultName` / `result.resultName`.
- `ReferralClient(codeHasher:, eventStore:, clock:)`, `reportHidden`, `reportLinkOpened`; `ReferralTerms.hasClaimDaysLeft`;
  `ReferralCopy.shareTextNoLink`, `giftTitle`, `deadline`, `steps`, `almostLine`, `cannotAddReason`; `shareChannel`,
  `shareEventProps(result, hasLink:)`, `resolveInviteLink`, `inviteShareText`; `ReferralMessage`,
  `ReferralEntryUnavailable`, `unavailableMessage`; `InviteCodeEntry.showTitle`, `texts`, `onSignIn`.
- `share_plus` from 11 (was 12): apps on Gradle older than AGP 8.12 can use the package.
- Fixed: a client built outside a widget test's zone (an app's `setUp`) hung on its first once-only event.

Must change in an app (only where it used these):

- Event names: forwarded 0.2.0 events now arrive under the new names (table in the README;
  `ReferralEvent.legacyWireName` gives the old one). `referral_invite_viewed` is replaced by `invite_screen_viewed`,
  sent once per open with `from` / `focus` instead of after load with `surface` / `state`.
- Claim result names: `not_allowed` is now `under_age` or `anonymous`; `unavailable` is now `signed_out` or
  `no_project`; an unknown server reason is `other` (was `server_error`).
- `PendingClaimQueue.claim(code, {source, via})`: a subclass overriding `claim(String code)` must take the new named
  parameters (and can drop its own logging: the queue reports `code_submitted` and `code_claim_result`).
- `shareEventProps(result)` now needs `hasLink:` and returns `channel` / `status` / `has_link`.
- `InviteHub`'s friend part is `InviteCodeSection`: with a friend rule the headline is the gift, not
  `entryTitle` (still used when there is no friend reward); `showWindow` on the hub is deprecated (the chip replaces
  the window line).

Moving an app that built its own screens around 0.2.0 (the first app's steps, as an example):

1. Depend on the tag: `git: {url: https://github.com/shaantanu9/referral-rewards-kit.git, ref: referral_kit-v0.3.0, path: packages/referral_kit}`.
2. `referral_rpc.dart` → `ReferralHttpRpc(supabaseUrl:, anonKey:, accessToken:)`; drop `isNotDeployed:` (404 is
   recognised); `ReferralUnavailable.why` → `ReferralUnavailableException.reason.wire` (same strings).
3. `ReferralClient(onEvent: (e) => AppEvents.log(<AppEvent for e.wireName>, e.props), codeHasher: eventHash,
   eventStore: SharedPreferencesKeyValueStore())`: the names are identical, and `codeHasher: eventHash` keeps every
   `code_hash` equal to what was sent before. Then delete `LoggedClaimQueue`, `logRewardsGranted`,
   `logFeatureHiddenOnce`, `claimResultName`, `shareChannel` and the `logReferralEvent` calls in the screens.
   Result values that change: `refused` splits into `paused` / `under_age` / `anonymous`; `own_code` no longer
   includes `same_install`; `server_error` for an unknown reason becomes `other`. Hidden reasons: `no_terms` becomes
   `not_deployed` / `offline` / `server_error`; `signed_out` and `no_invite_url` are unchanged. `reward_granted` gains
   `event`; ids already reported under `events.referral_rewards_logged` are not migrated (no rewards were granted
   live yet, 2026-11-13: 0 codes).
4. `InviteScreen` + `invite_share_section.dart` + `invite_code_section.dart` + `invite_actions.dart` → one `InviteHub`
   with `from: from.name`, `initialSection: focusCode ? enterCode : null`, `initialCode: linkCode`, `storeLink:
   appStoreLink`, `inviteLink: base.isEmpty ? null : ...`, `texts: ReferralTexts(giftTitle: (r) => offer.waitingTitle,
   activationStep: 'Hear your first page read aloud', almostActionLabel: 'Start reading', ...)` from `ReferralOffer`,
   `header: AccountHero(...)`, `entryLeading: RewardSticker(...)`, `onAlmostAction: () => context.go(Paths.home)`,
   `onSignIn: () => context.push(Paths.account)`, `onClaimed: (r) => onReferralClaimed(ref, r)`.
5. Server: apply kit migration `20261114000001_referral_grant_probe.sql` after its `100009` copy (approval needed),
   then `select * from referral.privacy_problems();` must return no rows, and run `supabase/probes/function_grants.sql`.

## 0.2.0 (unreleased)

Additive: an app on 0.1.0 compiles unchanged (all 199 tests from 0.1.0 pass untouched). One visible change: a server
without the kit's functions now shows "Invites aren't available yet." instead of "Couldn't load your invites… Try
again" / "We'll apply your code when you're back online".

Added:

- **"Not deployed" state.** `ReferralUnavailableException` (`notDeployed`, `signedOut`, `noProject`), thrown by an rpc or raised
  by `ReferralClient` from supabase_flutter's `PGRST202` (or your own `isNotDeployed:` check). `InviteFriendsScreen`
  and `InviteCodeEntry` then show "not available yet" with no Retry, or your `unavailableBuilder` (return
  `SizedBox.shrink()` to hide). A code entered meanwhile is still kept and sent later; `ClaimOutcome.unavailable` says
  why.
- **`ReferralClient.availability()`**: `available` / `notDeployed` / `signedOut` / `noProject` / `offline` /
  `serverError`, to hide entry points before opening a screen. Never throws.
- **`ReferralHttpRpc`**: the rpc over raw HTTP (Supabase URL, anon key, access-token getter, optional transport), with
  typed errors (`ReferralUnavailableException`, `ReferralServerError`, `ReferralNetworkError`; bodies never in exceptions).
- **`ReferralRewardCard.onShown(reward)` / `onDismissed(reward, acknowledged)`**, e.g. to refresh the app's balance.
- **`labelsBuilder: (context) => RewardLabels(...)`** on every widget, for reward names from the app's localisations.
- **Analytics without an SDK**: `ReferralEvent` (`wireName`, `props`) and `onEvent` on `ReferralClient` (used by its
  queues and by every widget given that client) and on each widget; `referralCodeHash` (codes are never sent). Events:
  invite viewed, code copied, invite shared (with the app picked, when the platform says), code entry started, code
  submitted, claim result, reward shown / acknowledged, feature unavailable. Table in the README.
- **`InviteHub`**: one screen with your code + Share / Copy on top and "Have an invite code?" below, each part hideable
  (`showInvite`, `showEntry`) and scrollable-to (`initialSection`, `InviteHubState.scrollTo`).
- `InviteFriendsScreen.embedded` and `onLoaded`; `InviteCodeEntry.title`; `systemShare` / `systemShareWithResult`.
- Strings `notAvailable` and `notAvailableCodeKept` (hi and id written by the build, not reviewed by native speakers).

Must change in an app (only if it relied on the old behaviour):

- A custom rpc that turns "function missing" into its own exception: throw
  `ReferralUnavailableException(ReferralUnavailableReason.notDeployed)` instead, or pass `isNotDeployed:` to the client.
  Otherwise the screens keep showing offline / Retry for a server without the kit.
- Code that catches errors from `ReferralClient` and looks for a `PostgrestException` with `PGRST202` now gets
  `ReferralUnavailableException`.

May change:

- Replace a hand-written HTTP rpc with `ReferralHttpRpc`, and a hand-written availability probe with
  `client.availability()`.
- Pass `onEvent` once to `ReferralClient` and forward events to your analytics; set `codeHashSalt`.
- Use `InviteHub` instead of separate invite and code-entry screens.
- Use `onDismissed` / `onShown` instead of re-reading a balance on a timer after a reward card.
- Use `labelsBuilder` instead of rebuilding `RewardLabels` per locale by hand.

## 0.1.0 (unreleased)

- First version: `ReferralClient` over the `public.referral_*` RPCs, `DefaultInstallIdStore` (iOS Keychain, Android
  Block Store + secure storage), `PendingClaimQueue`, `ReferralPromptPolicy`, `ReferralCopy`, `InviteFriendsScreen`,
  `InviteCodeEntry`, `ReferralRewardCard`, native iOS Paste control, Play Install Referrer reader, en / hi / id strings.
