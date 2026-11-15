# referral_kit (Flutter)

Updated: 2026-11-14 (0.3.0)
The Flutter part of [referral-kit](../../README.md): a typed client for the kit's Supabase RPCs, the "Invite friends"
screen, invite-code entry, the reward card, an install id that survives reinstall, an offline claim queue, a prompt
policy and copy built from the live rules. Design: [ADR 0001](../../docs/adr/0001-referral-kit.md) sections 4, 7, 8,
11. MIT.

It works only with the kit's SQL migrations installed in your Supabase project (`supabase/migrations/`).

## Install

Not on pub.dev yet. Use git (pinned to a release tag) or a path:

```yaml
dependencies:
  referral_kit:
    git:
      url: https://github.com/<owner>/referral-kit.git   # or a local clone: /path/to/referral-kit
      ref: referral_kit-v0.3.0                            # a tag; never a moving branch in a release build
      path: packages/referral_kit
```

```yaml
dependencies:
  referral_kit:
    path: ../referral-kit/packages/referral_kit          # while developing the kit next to the app
```

Minimums: Flutter 3.38, Dart 3.8, iOS 15, Android API 24 (`flutter_secure_storage` 10 needs 23; Block Store 24).
Ranges are wide on purpose: `share_plus` 11–13 (11 is the first with `SharePlus.instance`; 12 needs AGP 8.12, so an
app on an older Gradle stays on 11), `intl` 0.19–0.20, `flutter_secure_storage` 10–11, `play_install_referrer`
0.5–0.6, `shared_preferences` 2.3+. A full app that copies the wiring: [examples/starter_app](../../examples/starter_app).

## Wire it up (supabase_flutter)

```dart
import 'package:referral_kit/referral_kit.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

final store = SharedPreferencesKeyValueStore();
final referrals = ReferralClient(
  rpc: (fn, params) => Supabase.instance.client.rpc(fn, params: params),
  installIds: DefaultInstallIdStore(),
  onEvent: (e) => analytics.logEvent(name: e.wireName, parameters: e.props), // the whole funnel, see below
  codeHashSalt: 'your-app',
  eventStore: store, // reward_granted once per reward, referral_feature_hidden once a day, across launches
);
final claimQueue = PendingClaimQueue(client: referrals, store: store);

// Retry a kept claim on resume, token refresh and sign-in changes (add a connectivity stream if you have one).
final auth = Supabase.instance.client.auth.onAuthStateChange;
final retrier = PendingClaimRetrier(
  queue: claimQueue,
  tokenRefreshes: auth.where((s) => s.event == AuthChangeEvent.tokenRefreshed),
  signInChanges: auth.where((s) => s.event != AuthChangeEvent.tokenRefreshed),
);
```

Raw HTTP instead (no supabase_flutter):

```dart
final rpc = ReferralHttpRpc(
  supabaseUrl: env.supabaseUrl,                 // null/empty -> ReferralUnavailableException(noProject)
  anonKey: env.supabaseAnonKey,                 // the public key, never service_role
  accessToken: () async => session?.accessToken, // null -> ReferralUnavailableException(signedOut)
);
final referrals = ReferralClient(rpc: rpc.call, installIds: DefaultInstallIdStore());
```

It POSTs to `<url>/rest/v1/rpc/<fn>`; 404 becomes `ReferralUnavailableException(notDeployed)`, other error statuses
`ReferralServerError`, no answer `ReferralNetworkError`. Pass `transport:` to reuse your own HTTP client.

## When the server has no kit yet

Before the migrations are applied, PostgREST answers 404 / `PGRST202` for every `referral_*` call. The package calls
that **not deployed**, distinct from offline:

- `await referrals.availability()` returns `ReferralAvailability.notDeployed` (also `signedOut`, `noProject`,
  `offline`, `serverError`, `available`). Hide your "Invite friends" row unless it is `available` (or `isTransient`).
- `InviteFriendsScreen`, `InviteCodeEntry`, `InviteCodeSection` and `InviteHub` show "Invites aren't available yet."
  with no Retry (signed out: "Sign in to get your invite code…" and a Sign in button when you pass `onSignIn`). Pass
  `unavailableBuilder: (context, reason) => const SizedBox.shrink()` to hide them instead, or `texts: ReferralTexts(
  unavailable: (reason) => ...)` for your own words.
- A code entered meanwhile is kept by `PendingClaimQueue` and sent on the next retry ("We saved your code and will add
  it when they are."); `ClaimOutcome.unavailable` names the reason.
- With supabase_flutter, `PostgrestException(code: PGRST202)` is recognised by its text. A custom rpc should throw
  `ReferralUnavailableException(ReferralUnavailableReason.notDeployed)`, or pass `isNotDeployed: (e) => …` to the client.

Going live: [docs/go-live.md](../../docs/go-live.md).

Add the strings to your app:

```dart
MaterialApp(
  localizationsDelegates: const [
    referralKitLocalizationsDelegate, // en, hi, id; English for any other locale
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
  ],
  // ...
);
```

## Screens

```dart
const labels = RewardLabels(
  byKind: {'minutes': _minutesLabel},          // your kinds, e.g. "30 min of <your feature>"
  entitlementNames: {'premium': 'Premium'},     // RevenueCat entitlement id -> display name
);

InviteFriendsScreen(
  client: referrals,
  appName: 'Your app',
  inviteLink: (code) => Uri.parse('https://your.domain/i/$code'),
  labels: labels,
  onOpenTerms: openTermsPage,
  codeCache: SharedPreferencesKeyValueStore(),  // lets the code be shared offline
);

InviteCodeEntry(
  client: referrals,
  queue: claimQueue,
  eligibleFrom: user.emailConfirmedAt == null ? null : DateTime.parse(user.emailConfirmedAt!),
  initialCode: codeFromLinkOrInstallReferrer,   // shown with one-tap confirm
  labels: labels,
);

ReferralRewardCard(
  client: referrals,
  labels: labels,
  onShown: (reward) => refreshBalance(),          // the reward is already granted on the server
  onDismissed: (reward, acknowledged) => {},      // acknowledged false: the card comes back next launch
); // on the home screen; acks per device
```

Reward names from your own localisations: every widget also takes `labelsBuilder`, which wins over `labels`:

```dart
labelsBuilder: (context) => RewardLabels(
  byKind: {'minutes': (n) => AppLocalizations.of(context).voiceMinutes(n.round())},
  entitlementNames: {'premium': AppLocalizations.of(context).premium},
),
```

### One screen: `InviteHub` (what most apps need)

Your code with Share / Copy, the rules, caps, joined count and rewards on top; a friend's code below, built to make
the gift and its real deadline clear: "A gift is waiting for you: 4 free chapters" (only when the friend rule gives
something), the server's days left as a chip ("Only 3 days left to add a code", red on the last day), the field with
paste and every refusal reason, three steps, and after a code "Almost yours" with a 1-of-2 bar and your next step.
When a code can't be added (window over, or this account is not eligible) the field is gone and one line says why.

```dart
InviteHub(
  client: referrals,
  queue: claimQueue,
  appName: 'Your app',
  from: 'settings',                               // invite_screen_viewed.from: you · settings · home · deeplink
  initialSection: InviteHubSection.enterCode,     // opened from a "Got a code?" row: scroll to the friend part
  inviteLink: (code) => Uri.parse('https://your.domain/i/$code'), // null while you have no invite page…
  storeLink: Uri.parse('https://apps.apple.com/app/id…'),         // …then Share sends the code + this link
  initialCode: codeFromLinkOrInstallReferrer,     // one-tap confirm; reports invite_link_opened
  labelsBuilder: myLabels,
  codeCache: store,                               // share the code offline
  onCopied: (code) {},
  onAlmostAction: () => context.go('/reader'),    // the button under "Almost yours"
  onSignIn: () => context.push('/account'),       // shown when signed out
  texts: ReferralTexts(                           // your voice or language; everything else is localised
    activationStep: 'Hear your first page read aloud',
    almostActionLabel: 'Start reading',
    giftTitle: (reward) => reward == null ? 'Got a code from a friend?' : '$reward are waiting for you',
  ),
  header: MyInviteArt(), entryHeader: MyGiftArt(), entryLeading: MySticker(), // art slots
  scrollable: false,                              // inside your own ListView: no nested scrolling
);
```

Colours come from your `ThemeData` (`colorScheme.secondaryContainer`, `errorContainer`, `onSurfaceVariant`); the
package sets none of its own. Scroll to a part later with a `GlobalKey<InviteHubState>`:
`key.currentState!.scrollTo(InviteHubSection.enterCode)`. Not deployed: one message for both parts. The friend part
alone is `InviteCodeSection`; the bare field is `InviteCodeEntry`.

- Every sentence (rules, caps, paywall line, share text, friend disclosure, empty and paused states, reward cards,
  error per claim reason) comes from `referral_terms()` through `ReferralCopy`; a rule you turn off disappears. Use
  `ReferralCopy(...).paywallLine()` for the secondary paywall line.
- The code is always shown as `ABCD-EFGH`, left to right and ASCII, read out letter by letter, and wraps onto two
  lines at large text sizes instead of shrinking. Share text wraps it in U+2066…U+2069.
- `eligibleFrom` only drives the countdown text ("You can add an invite code for N more days"); the server keeps its
  own `members.eligible_from` and decides. Without it, no countdown is shown.

## Analytics events

The client is the one source of the referral funnel: give `ReferralClient` an `onEvent` and every widget and queue
built on it reports through it, so the app logs nothing of its own (a widget's own `onEvent` replaces it for that
widget's events). Exceptions thrown by your sink are swallowed. Names and props are the ones the first app
logged by hand before 0.3.0, so it switched with no break in its data.

| `wireName` | When | Props |
|---|---|---|
| `invite_screen_viewed` | `InviteHub` / `InviteFriendsScreen` opened (once per open) | `from` (the app's value, `unknown` if none), `focus` (`share` · `code`) |
| `invite_code_copied` | Copy code tapped | `has_link` |
| `invite_shared` | The share sheet closed | `channel` (bucket: `whatsapp` · `telegram` · `instagram` · `discord` · `messenger` · `facebook` · `x` · `snapchat` · `messages` · `mail` · `copy` · `airdrop` · `other` · `unknown` · `dismissed`; never the raw string), `status` (`success` · `dismissed` · `unavailable`), `has_link` |
| `invite_link_opened` | An entry opened with a code from a link or the install referrer | `code_hash` |
| `code_entry_started` | First keystroke, tap, paste, or confirming a prefilled code (once per entry) | `source` (`typed` · `focus` · `pasted` · `prefilled`) |
| `code_submitted` | A code sent through `PendingClaimQueue.claim` | `code_hash`, `source` |
| `code_claim_result` | A claim's outcome (the user's, or a retry that resolved) | `result`, `via` (`entry` · `retry`), `code_hash`, retries also `trigger` (`reconnect` · `appresume` · `tokenrefresh` · `signinchange` · `manual`) |
| `reward_granted` | A granted reward seen in `referral_pending` (once per reward per device) | `kind`, `amount`, `who`, `event` |
| `reward_shown` | A reward card appeared | `kind`, `event`, `who`, `state` |
| `reward_acknowledged` | A reward card dismissed | the same, plus `acknowledged` (bool) |
| `referral_feature_hidden` | Referrals hidden or unusable (once a day per reason) | `reason` (`not_deployed` · `signed_out` · `no_project` · `offline` · `server_error` · `program_paused` · `code_disabled` · `window_closed` · `no_invite_url`, or yours via `client.reportHidden`), `surface` (`client` · `invite` · `entry` · `app`) |

`code_claim_result.result` (`claimEventResult(outcome)`, also `outcome.resultName`), one name per outcome:
`ok`, `invalid` (unknown code), `expired` (window closed), `own_code`, `same_install`, `already_used`, `not_verified`,
`rate_limited`, `paused`, `under_age`, `anonymous`, `other` (a reason a newer server adds) for server answers, and
`offline_queued`, `not_deployed`, `signed_out`, `no_project`, `server_error` for kept codes. The full set is
`claimResultNames`. Names are never renamed or removed; switch on the string with a default branch (not on
`ClaimReason`), so a new server outcome lands in your default as `other` instead of breaking your build.

Once-only events are remembered in `eventStore` (any `KeyValueStore`; memory when null). Without `onEvent` nothing is
remembered or sent. Your own reasons: `client.reportHidden('no_terms_page')`; a link the app handles itself:
`client.reportLinkOpened(code)`.

Events never carry an invite code, user id or install id. `code_hash` is `referralCodeHash(code, salt:)` (12 hex of
SHA-256 over `salt:CODE`), or your own `codeHasher: (normalisedCode) => ...` when your app already sent hashes of its
own and they must keep joining up. Codes are short, so anyone with the salt can test guesses: keep hashes in your
analytics, not in public. Calling `client.claim()` directly (without the queue) reports nothing.

Names before 0.3.0 (`ReferralEvent.legacyWireName`): `referral_invite_viewed` → `invite_screen_viewed`,
`referral_code_copied` → `invite_code_copied`, `referral_invite_shared` → `invite_shared`,
`referral_code_entry_started` → `code_entry_started`, `referral_code_submitted` → `code_submitted`,
`referral_claim_result` → `code_claim_result`, `referral_reward_shown` → `reward_shown`,
`referral_reward_acknowledged` → `reward_acknowledged`, `referral_feature_unavailable` → `referral_feature_hidden`.

## Install referrer (Android) and paste (iOS)

```dart
final prefill = await InstallReferrerCodeReader(store: SharedPreferencesKeyValueStore()).readOnce();
```

Reads the Play Install Referrer once per install (the invite page links Play with `&referrer=code%3DABCDEFGH`) and
returns the code or null. It uses [`play_install_referrer`](https://pub.dev/packages/play_install_referrer) behind
`InstallReferrerSource`, so you can swap it.

On iOS 16+ the Paste button next to the code field is Apple's `UIPasteControl` in a platform view (this package's
Swift code): reading the clipboard after the user taps it shows no "Allow Paste" prompt. Below iOS 16 there is no
button and the text field's own paste menu is used. The package never calls `Clipboard.getData` on iOS. On Android
the button reads the clipboard.

## What each platform stores

| Data | iOS | Android |
|---|---|---|
| Install id (random UUID v4 from `Random.secure`, never an advertising id) | Keychain item `referral_kit.install_id`, accessibility "after first unlock, this device only" (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`), not synchronizable (no iCloud Keychain) | Google Block Store key `referral_kit.install_id` with cloud backup **off**, plus a copy in `flutter_secure_storage` (Android Keystore + encrypted preferences) |
| Kept invite code, prompt policy dates, install-referrer-read flag, cached own code | `SharedPreferences` (`referral_kit.*` keys) | same |

What survives what:

| Event | iOS | Android |
|---|---|---|
| App update | kept | kept |
| Uninstall and reinstall on the same phone | kept: Keychain items are not deleted with the app (long-standing iOS behaviour, not a documented guarantee) | kept when the user has Google backup on (Settings > Google > Backup), per Google's Block Store docs; otherwise a new id (the Keystore copy is deleted with the app) |
| No Google Play services (some phones, emulators without Play) | n/a | `flutter_secure_storage` only: lost on uninstall |
| New phone set up from the old one | new id ("this device only" items do not migrate) | may carry over in device-to-device setup (Block Store); never via cloud backup. A friend claiming on a phone the sharer set up is then refused as `same_install`, which the ADR accepts |
| Restore from cloud backup to a new phone | new id | new id (cloud backup is off) |
| Factory reset / erase | new id | new id |

Not yet verified on a real device: the reinstall rows above come from the platforms' documentation and the
plugins' options; see `docs/TODO.md`.

If your app keeps Android Auto Backup on, `flutter_secure_storage`'s encrypted preferences may be restored without
their Keystore key; the plugin's `resetOnError` (on by default) then discards them and the Block Store value is used.

## Prompting (ADR 11.4)

```dart
final policy = ReferralPromptPolicy(store: SharedPreferencesKeyValueStore());
await policy.startSession();                 // once per launch
policy.reportMomentOfValue();                // your moment of value
policy.reportPurchaseStarted(); await policy.reportPurchaseFinished(); // around purchases
if (await policy.shouldPrompt()) { showInvitePrompt(); await policy.markPrompted(); }
```

Never the first session; at most one prompt per 14 days; only after a moment of value in this session; never during a
purchase, later in that session, or within 24 h after one.

## Dependencies

| Package | Licence | Why |
|---|---|---|
| `flutter_secure_storage` (>=10 <12) | BSD-3-Clause | iOS Keychain options for the install id; Android fallback |
| `com.google.android.gms:play-services-auth-blockstore` 16.4.0 | Android SDK License (Google Play services) | Android Block Store, called from this package's Kotlin |
| `play_install_referrer` (>=0.5 <0.7) | BSD-2-Clause | Play Install Referrer API |
| `share_plus` (>=11 <14) | BSD-3-Clause | System share sheet |
| `shared_preferences` (^2.3) | BSD-3-Clause | Default `KeyValueStore` |
| `intl`, `flutter_localizations` | BSD-3-Clause | Plurals, dates |

## Tests

```bash
flutter test      # client JSON shapes from the SQL, normalisation, copy, policy, queue, widgets, 320 dp at 2x, RTL
flutter analyze
```

`example/` runs the widgets over a fake RPC and is how the native code is compiled (`flutter build apk --debug`;
for iOS, `xcodebuild` on `example/ios/Runner.xcworkspace`). [examples/starter_app](../../examples/starter_app) is a
whole app (entry points, hub, reward card, analytics) over a stateful fake server, with a full-flow test.
