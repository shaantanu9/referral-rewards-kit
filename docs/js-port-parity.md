# JS port parity: Dart → TypeScript

Updated: 2026-11-27 (React Native section added)

What this is for: one table per Flutter package showing which Dart file became which TypeScript file in the
`js/` workspace, and how close it is, so the UI agents (work packages C, D, E) and the owner can see what the cores
cover and what is still missing. Related: [ADR 0003](adr/0003-attribution-backlink-engine.md),
[plan](growth/attribution-and-multiplatform-plan.md), [js/README.md](../js/README.md).

Status: ✅ ported with the same behaviour (Dart tests ported and green) · 🟡 ported with a stated difference ·
🖼️ widget, belongs to a UI package · ➖ not needed in JS.

## referral_kit → `@myind/referral-core` (`js/packages/referral-core/src`)

| Dart (`packages/referral_kit/lib/src`) | TypeScript | Status | Notes |
|---|---|---|---|
| `availability.dart` | `availability.ts` | ✅ | Enums are wire strings (`'not_deployed'`); `isAvailable()` / `isTransientAvailability()` replace the getters. `isNotDeployedError` also reads a supabase-js error's `code`. |
| `client.dart` | `client.ts` | ✅ | `ReferralClient({rpc, installIds, onEvent, codeHashSalt, codeHasher, eventStore, clock, isNotDeployed})`; `setPreferences({showName, displayName, participating})`. |
| `http_rpc.dart` | `http-rpc.ts` | ✅ | `referralHttpRpc({supabaseUrl, anonKey, accessToken, timeoutMs, transport})` over `fetch` + `AbortController`; plus `supabaseRpc(supabase)`. |
| `models.dart` | `models.ts`, `json.ts` | ✅ | Classes with `fromJson`; times parsed like Dart's `DateTime.tryParse` (ISO and Postgres text); `displayNameProblem`. |
| `code_format.dart` | `code-format.ts` | ✅ | Same normalisation as the SQL (all Dart cases ported). |
| `sha256.dart` | `sha256.ts` | ✅ | `sha256Hex` (sync, so `codeHash` stays sync) and `sha256HexAsync` (WebCrypto), tested equal. |
| `events.dart` | `events.ts` | ✅ | `ReferralEventName` values are the wire names; `referralLegacyEventNames`; `claimResultName(result)` / `outcome.resultName`. |
| `event_memory.dart` | `event-memory.ts` | ✅ | |
| `prompt_policy.dart` | `prompt-policy.ts` | ✅ | Durations as `minIntervalMs`, `purchaseCooldownMs`. |
| `pending_claim.dart` | `pending-claim.ts` | 🟡 | `PendingClaimRetrier` takes `Subscribe` functions (`reconnects`, `tokenRefreshes`, `signInChanges`, `appResumes`) instead of Dart streams and `AppLifecycleListener`; `browserOnline` / `browserResume` for the web. RN: `AppState` in package E. |
| `install_id.dart` | `install-id.ts` | 🟡 | `StoredInstallIdStore({secure, backup})` over any `KeyValueStore` replaces `DefaultInstallIdStore` (Keychain / Block Store). RN wires expo-secure-store in E; the web uses `localStorageStore`. |
| `install_referrer.dart` | `install-referrer.ts` | 🟡 | Interface + `codeFromReferrer` + `InstallReferrerCodeReader`; the Play source (`PlayInstallReferrerSource`) is an RN adapter for E. Default source: `noInstallReferrer`. |
| `storage.dart` | `storage.ts` | 🟡 | `MemoryKeyValueStore`, `localStorageStore(prefix)` (SSR- and private-mode-safe) instead of SharedPreferences. |
| `launcher.dart` | `launcher.ts` | 🟡 | `ReferralLauncher` takes URL strings; `windowLauncher` for the web; RN `Linking` in E. `whatsAppShareUri` returns a string. |
| `share.dart` | `share.ts` | 🟡 | `ShareResult` keeps share_plus's shape; `webShare` (Web Share API, clipboard fallback); RN `Share.share` in E. `resolveInviteLink` returns a string. |
| `paste.dart` | `paste.ts` | 🟡 | The paste button (UIPasteControl) is UI. Logic: `pastedCodeText` (Flutter's behaviour) and a JS addition `extractInviteCode` (codes in links and share messages). |
| `copy.dart` | `copy.ts` | ✅ | `ReferralCopy({l10n, terms, labels})`; dates through `Intl.DateTimeFormat` (same English output; hi / id close to Dart intl). `RewardLabelsBuilder` (BuildContext) ➖. |
| `texts.dart` | `texts.ts` | ✅ | `ReferralTexts` as an interface of optional fields. |
| `l10n/*.arb`, `l10n/gen/*` | `l10n/messages.ts` (generated), `l10n/icu.ts`, `l10n/index.ts` | ✅ | `scripts/gen-l10n.mjs` copies the ARB strings; plurals follow Dart's `Intl.pluralLogic`. `referralLocalizations(locale, overrides)` / `t()`. |
| `l10n/delegate.dart` | – | ➖ | Flutter localisation delegate. |
| `desktop_plugin.dart` | – | ➖ | Flutter plugin registration. |
| `widgets/*` | – | 🖼️ | React DOM: `@myind/referral-react` (table below). React Native: `@myind/referral-react-native` (E). |
| `examples/starter_app/lib/fake_referral_server.dart` | `testing/index.ts` | ✅ | `FakeReferralServer` + `fakeReferralClient`, with extra switches (offline, server error, claim reasons, paid / pending / banked rewards, rotation, expired claim). |
| – | `attribution.ts` | new | ADR 0003 link config; identical file in rewards-core (a test compares the two). |

## referral_kit widgets → `@myind/referral-react` (`js/packages/referral-react/src`)

Every component takes `className`, `style` and `render(ctx)` (Flutter's builders and slots), reads its options from
`ReferralProvider` or props, and keeps the Flutter widget's states, copy and events. Tests: 85 (vitest + jsdom +
Testing Library), porting the intent of `widgets_test`, `widget_gaps_test`, `growth_widgets_test`, `invite_hub_test`,
`invite_hub_flow_test`, `attribution_test`, `reward_card_refresh_test` and `app_slots_test`, plus SSR.

| Dart widget | React | Status | Notes |
|---|---|---|---|
| `invite_hub.dart` `InviteHub` | `components/invite-hub.tsx` `InviteHub` | 🟡 | `scrollTo` through a ref (`InviteHubHandle`), `scrollIntoView`, smooth unless reduced motion. `scrollable` defaults to false on the web (flows in the page); `showAppBar` → `showTitle`. Attribution once. |
| `invite_friends_screen.dart` `InviteFriendsScreen` | `components/invite-friends-screen.tsx` + `controllers/invite-screen.ts` | ✅ | Every state (loading, error + Retry, offline cache, unavailable, paused, disabled, left + Join again, empty, waiting, joined, earned, pending, banked, skipped). SnackBar → `aria-live` toast. Share via `ShareHandler` (`webShare`: Web Share API, else copies and says so). |
| `invite_code_section.dart` `InviteCodeSection`, `ReferralDeadlineChip` | `components/invite-code-section.tsx`, `invite-extras.tsx` | ✅ | Open / almost (`role=progressbar`) / cannot / unavailable. |
| `invite_code_entry.dart` `InviteCodeEntry` | `components/invite-code-entry.tsx` + `controllers/code-entry.ts` | ✅ | Paste: field paste and a Paste button (`clipboard.readText`, hidden where unavailable) both use `extractInviteCode` (codes inside links and messages) then `pastedCodeText`. Claims through `PendingClaimQueue`. |
| `paste.dart` `InviteCodePasteButton` | `InviteCodePasteButton` | 🟡 | No UIPasteControl on the web. |
| `invite_extras.dart` `ReferralBoostBanner`, `ReferralQrSheet`, `showReferralQrSheet` | `ReferralBoostBanner`, `ReferralQrSheet`, `ReferralQrCode`, `qrPath` | 🟡 | Bottom sheet → modal dialog (focus trap, Escape). QR as inline SVG from `qrcode-generator` 2.0.4, black on white. |
| `invite_page_settings.dart` `ReferralInvitePageSettings` | `components/invite-page-settings.tsx` + controller | ✅ | Switch is `input[role=switch]`; leave confirm in a dialog. |
| `message.dart` `ReferralMessage`, `ReferralEntryUnavailable`, `unavailableMessage` | `components/message.tsx` (+ `ReferralUnavailableMessage` for the factory) | ✅ | `ReferralUnavailableBuilder` → `renderUnavailable(reason)`. |
| `reward_card.dart` `ReferralRewardCard` | `components/reward-card.tsx` + controller | ✅ | App resume → `visibilitychange`; a new `client` reloads. `onAction` gets the reward. |
| `welcome_card.dart` `ReferralWelcomeCard` | `components/welcome-card.tsx` + controller | ✅ | App launch → page load (`welcomeCardSession`, or the `session` prop). |
| `code_text.dart` `InviteCodeText`, `referralL10n` | `InviteCodeText`; `useReferral().l10n` | ✅ | `role=img` with the spelled-out label. |
| `myind_attribution.dart` `MyindAttribution` | `components/myind-attribution.tsx` | ✅ | Real `<a href rel="noopener">`, `utm_source` default `referral-react`, 44 px target. |
| `RewardLabelsBuilder` | – | ➖ | Pass `labels` (or `l10nOverrides`) from the app's own i18n. |
| – | `context.tsx` `ReferralProvider`, `hooks.ts` | new | `useInviteScreen`, `useCodeEntry`, `usePendingRewards`, `useWelcomeCard`, `useInvitePageSettings`, `useReferralTerms`, `useInviteCode`, `useClaim`, `usePendingClaimRetrier`, `useReferralPrompt`; the provider retries a kept claim on `online` / page visible. |

## web/invite → `@myind/kit-next` (`js/packages/kit-next/src`)

| Source | TypeScript | Status | Notes |
|---|---|---|---|
| `web/invite/render.ts` | `invite/render.ts` | ✅ | Same functions; preview lines as text segments (`fillSegments`) so a React page can use them. `render_test.ts` ported (24 cases). |
| `web/invite/strings.ts` | `invite/strings.ts` `INVITE_STRINGS` | ✅ | A test checks it equals the web file. |
| `web/invite/index.html` | `invite/template.ts` `INVITE_TEMPLATE` | ✅ | Generated (`pnpm gen:template`); a test checks it equals the web file. |
| `web/invite/og.ts` | `invite/og.ts` (`renderOgSvg`, `inviteOgModel`), `og-image.tsx` (`next/og`) | ✅ | `og_test.ts` ported (6 cases). The Deno CLI is not ported. |
| – | `route.ts`, `invite/page.ts`, `rpc.ts`, `config.ts`, `attribution.ts` | new | `createInviteRoute`, `createTermsRoute`, `inviteMetadata`, `invitePageModel`, `inviteCodeFrom*`, `createReferralRpc` / `createServerReferralClient` (refuses service keys), `withReferralKit`. |

## rewards_kit → `@myind/rewards-core` (`js/packages/rewards-core/src`)

| Dart (`packages/rewards_kit/lib/src`) | TypeScript | Status | Notes |
|---|---|---|---|
| `client.dart` | `client.ts` | 🟡 | Same RPCs and params. `timezone` defaults to the runtime's IANA zone (Dart: null); pass `timezone: null` for Dart's behaviour. `recap()` takes a `Date` (local day) or `YYYY-MM-DD`. Options objects instead of named args. |
| `http_rpc.dart` | `http-rpc.ts` | ✅ | `rewardsHttpRpc(...)`, `supabaseRewardsRpc(supabase)`. |
| `json.dart` | `json.ts` | ✅ | Ranges are `[min, max]` tuples. |
| `errors.dart` | `errors.ts` | ✅ | `RewardsReason` const + `allRewardsReasons`; reasons also read from supabase-js error objects. |
| `events.dart` | `events.ts` | ✅ | |
| `clock.dart` | `clock.ts` | ✅ | `offsetMs`, `leftMs(deadline)`. |
| `models.dart`, `progress_models.dart` | `models.ts`, `progress-models.ts` | ✅ | `RewardSpec.equals()` for Dart's `==`; durations in ms (`atRisk(now, withinMs)`). |
| `fair_play_models.dart` | `fair-play-models.ts` | ✅ | `RewardsChoices.equals()`. |
| `surprise_models.dart` | `surprise-models.ts` | ✅ | |
| `tasks.dart`, `programs.dart` | `tasks.ts`, `programs.ts` | ✅ | `HistoryDay.dayKey`; `formatDay(date, utc?)`. |
| `quiz_models.dart` | `quiz-models.ts` | ✅ | `timeLimitMs`, `windowMs`. |
| `league_models.dart` | `league-models.ts` | ✅ | |
| `followup_models.dart` | `followup-models.ts` | ✅ | `TimeOfDay` is `{hour, minute}`; `FollowupPrefs.equals()`. |
| `state.dart` | `state.ts` | ✅ | `copyWith(patch)`. |
| `controller.dart` | `controller.ts`, `store.ts` | 🟡 | `ChangeNotifier` → `SnapshotStore` (`subscribe`, `getSnapshot`, also `addListener`). `newGrants` / `moments` streams → `onGrant` / `onMoment`. Caches (histories, recaps, leagues, invites) are also in the snapshot. |
| `quiz_controller.dart` | `quiz-controller.ts` | ✅ | `revealForMs` (default 2000, null = wait), `tickEveryMs`; snapshot carries `timeLeftMs` / `timeFraction`, refreshed on every tick. |
| `followup_scheduler.dart` | `followup-scheduler.ts` | ✅ | `FollowupNotifier.schedule({id, at, title, body, payload})`; `followupIdStoreOn(stringStore)` for persistence. |
| `reminder.dart` | `reminder.ts` | ✅ | `streakReminderAt(streak, {now, beforeMs, quietFromHour, quietToHour})`. |
| `theme.dart` | `theme.ts` | 🟡 | Design tokens (Material 3 light / dark defaults, `resolveRewardsTheme`, `rewardsThemeCssVars`) instead of a ThemeExtension reading the app's ColorScheme. |
| `texts.dart`, `texts_v2.dart`, `texts_reveal.dart`, `texts_followups.dart`, `texts_leagues.dart`, `texts_fair_play.dart` | `texts.ts`, `texts-format.ts` | ✅ | `rewardsTexts(overrides)` with nested groups; English only, as in Dart. |
| `widgets/*` (26 files) | `@myind/rewards-react` (`js/packages/rewards-react/src`, see the table below) | ✅ web / 🖼️ RN | React DOM done (work package D); React Native in work package E. |
| `example/lib/fake_server.dart`, `fake_followups.dart`, `fake_league.dart` | `testing/index.ts` | ✅ | `FakeRewardsServer` (every program kind) + `fakeRewards` + `MemoryFollowupNotifier`, seeded randomness, story moves (`breakStreak`, `closeLeagueWeek`, `verifySocial`, `expireOffer`, `newDay`, …). |
| – | `attribution.ts` | new | Same file as referral-core. |

## React Native (work package E): Flutter widget → `@myind/referral-react-native` / `@myind/rewards-react-native`

Status as above. Tests: jest (`@react-native/jest-preset` 0.88.1) + `@testing-library/react-native` 14 on the cores'
`/testing` fakes. Every component: `style`, a `render` prop where Flutter has a `builder`, 44 pt targets, roles and
labels, light / dark from `useColorScheme()`.

### referral_kit widgets → `js/packages/referral-react-native/src`

| Dart widget | React Native | Status | Notes |
|---|---|---|---|
| `code_text.dart` `InviteCodeText`, `codeTextStyle` | `components/InviteCodeText.tsx` | ✅ | Spelled-out label, LTR, wraps in halves. |
| `message.dart` `ReferralMessage`, `.unavailable`, `ReferralEntryUnavailable`, `unavailableMessage` | `components/ReferralMessage.tsx` | ✅ | `.unavailable` factory → `ReferralUnavailableMessage`; `unavailableBuilder` → `renderUnavailable`. |
| `paste.dart` `InviteCodePasteButton` | `components/InviteCodePasteButton.tsx` | 🟡 | iOS 16+ system paste control through the clipboard adapter (`/clipboard`: expo-clipboard `ClipboardPasteButton` = `UIPasteControl`); never reads the clipboard on iOS; Android button. Hidden without a clipboard adapter. |
| `invite_code_entry.dart` `InviteCodeEntry` | `components/InviteCodeEntry.tsx` | ✅ | Countdown, disclosure, every reason, prefilled one tap, kept link code, offline / not-verified queue, events. |
| `invite_code_section.dart` `InviteCodeSection`, `ReferralDeadlineChip` | `components/InviteCodeSection.tsx` | ✅ | |
| `invite_extras.dart` `ReferralBoostBanner`, `ReferralQrSheet`, `showReferralQrSheet` | `components/InviteExtras.tsx` | 🟡 | The sheet is a `Modal` component (`visible`, `onClose`); the QR is drawn by a renderer (`/qrcode`: react-native-qrcode-svg), so "Show QR code" shows only when the app gives one. |
| `invite_page_settings.dart` `ReferralInvitePageSettings` | `components/ReferralInvitePageSettings.tsx` | ✅ | Leave confirm is a native `Alert` (`confirmLeave` to replace it). |
| `invite_friends_screen.dart` `InviteFriendsScreen` | `components/InviteFriendsScreen.tsx` | 🟡 | Copy needs a clipboard adapter (hidden without one); "Code copied" is a live-region line + screen-reader announcement instead of a SnackBar; the app bar is a plain title row (`showAppBar={false}` under a navigator header). |
| `invite_hub.dart` `InviteHub`, `InviteHubSection`, `scrollTo` | `components/InviteHub.tsx` | ✅ | `ref.current.scrollTo(section)`; `initialSection` after the invite part loads. |
| `reward_card.dart` `ReferralRewardCard` | `components/ReferralRewardCard.tsx` | ✅ | Reloads on `AppState` resume (injectable `resumes`) and on a new client. `labelsBuilder` ➖ (labels from the provider). |
| `welcome_card.dart` `ReferralWelcomeCard` | `components/ReferralWelcomeCard.tsx` | ✅ | `ReferralWelcomeCard.session` as in Dart. |
| `myind_attribution.dart` `MyindAttribution` | `components/MyindAttribution.tsx` | ✅ | `utm_source=referral-react-native`; role `link`. |
| Platform: SharedPreferences, Keychain / Block Store, url_launcher, share_plus, connectivity, `AppLifecycleListener`, Play referrer | `/async-storage`, `/secure-store`, `platform.ts` (`rnShare`, `linkingLauncher`, `appStateResumes`), `/netinfo`, `/install-referrer` (expo-application) | 🟡 | Block Store (Android backup that survives a reinstall) is not wrapped here: `secureInstallIdStore({ backup })` takes any store. |

### rewards_kit widgets → `js/packages/rewards-react-native/src`

| Dart widget | React Native | Status | Notes |
|---|---|---|---|
| `base.dart` `RewardsListener`, `countdown.dart` `Countdown`, `mystery_odds.dart` `MysteryOdds` | `components/base.tsx` | ✅ | `useSyncExternalStore`; refresh once on mount; server-clock ticks; `hidden` still fires `onExpired`. |
| `streak_card.dart`, `milestone_progress.dart`, `daily_goal_ring.dart`, `activity_heatmap.dart` | `components/progress.tsx` | ✅ | The ring is drawn with views (no SVG). |
| `offer_banner.dart`, `quest_list.dart`, `recharge_meter.dart`, `window_badge.dart`, `surprise_odds.dart`, `reward_inbox.dart` `RewardInbox` | `components/programs.tsx` | ✅ | |
| `social_tag_task.dart`, `friend_streaks.dart`, `league_board.dart` | `components/social.tsx` | 🟡 | Copy code needs `copyText` (`/clipboard`); without it the code is selectable text. |
| `quiz_card.dart`, `quiz_screen.dart`, `quiz_views.dart` `QuizBody` | `components/quiz.tsx` | 🟡 | `QuizCard` opens the default `QuizScreen` in a full-screen `Modal` (no navigator dependency); `imageBuilder` → `renderImage`. |
| `reward_reveal.dart` `RewardReveal`, `showRewardReveal` | `components/reveal.tsx` | 🟡 | `Animated` shake / pop; Reduce Motion from `AccessibilityInfo`; the haptic is the app's `onHaptic` (e.g. expo-haptics); `showRewardReveal` → `RewardRevealModal`. |
| `reward_inbox.dart` `RewardToastListener` | `components/reveal.tsx` | 🟡 | Hold-until-moment queue and one-at-a-time reveals as in Dart; the SnackBar is a toast overlay with an announcement. |
| `recap_card.dart`, `recap_share_card.dart` `RewardsRecapCard`, `RecapShareKey`, `recapYear` | `components/recap.tsx`, `/view-shot` | 🟡 | `RecapShareKey.toPngBytes` → `captureRecapCard(ref)` / `shareRecapCard(ref)` (react-native-view-shot, only after the user taps Share). |
| `rewarded_ad_button.dart`, `followup_settings.dart` | `components/settings.tsx` | 🟡 | Refresh after 5 s and 20 s as in Dart. `showTimePicker` → a small built-in hour / minute dialog, or the app's `pickTime`. |
| `rewards_hub.dart` `RewardsHub` | `components/RewardsHub.tsx` | ✅ | `programBuilders` → `programRenderers`; `RefreshIndicator` → `RefreshControl`. |
| `myind_attribution.dart` `MyindAttribution` | `components/MyindAttribution.tsx` | ✅ | Default variant 1, `utm_source=rewards-react-native`. |
| `FollowupNotifier` (app's plugin) | `/notifications` (expo-notifications), `/async-storage` (`followupIdStoreOn`) | ✅ | |

Demo: [`js/examples/expo-demo`](../js/examples/expo-demo) shows every component above on the fake servers.

## rewards_kit widgets → `@myind/rewards-react` (`js/packages/rewards-react/src`)

Every component takes `controller` / `texts` (or the `RewardsProvider`'s), `className`, `style` and `render` (Flutter
`builder`). Flutter widget tests are ported by intent in `js/packages/rewards-react/test` (vitest + jsdom + Testing
Library on `FakeRewardsServer`).

| Dart (`packages/rewards_kit/lib/src/widgets`) | TypeScript | Status | Notes |
|---|---|---|---|
| `base.dart` (`RewardsListener`) | `base.tsx`, `context.tsx` | ✅ | `RewardsListener`, `useRewardsListener` (refresh once on mount), `RewardsProvider`, `useRewards`, `useRewardsState`, `useQuiz`. |
| `countdown.dart` | `countdown.tsx` | ✅ | `Countdown` + `useCountdown`; `role="timer"` plus a polite live region rounded to the minute. |
| `rewards_hub.dart` | `rewards-hub.tsx` | 🟡 | `programRenderers`; no pull-to-refresh / `scrollable` (the page scrolls). |
| `streak_card.dart`, `daily_goal_ring.dart`, `milestone_progress.dart` | `progress.tsx` | ✅ | All 0.7 fair-play states. |
| `mystery_odds.dart`, `surprise_odds.dart` | `odds.tsx` | ✅ | |
| `activity_heatmap.dart`, `quest_list.dart`, `recharge_meter.dart`, `window_badge.dart`, `friend_streaks.dart` | `programs.tsx` | ✅ | Heatmap cells labelled per day; frozen days striped in CSS. |
| `offer_banner.dart`, `social_tag_task.dart`, `rewarded_ad_button.dart` | `tasks.tsx` | ✅ | Ad = injected `onShowAd`; reloads now, after 5 s and 20 s. Clipboard = `navigator.clipboard`. |
| `reward_inbox.dart` (+ `RewardToastListener`), `reward_reveal.dart` (+ `showRewardReveal`) | `inbox.tsx` | 🟡 | Toasts instead of SnackBars; `RewardRevealDialog` instead of `showRewardReveal`; haptic = `navigator.vibrate`; `useGrantQueue` holds grants until `celebrateNow`. |
| `league_board.dart` | `league-board.tsx` | ✅ | `leagueRows`. |
| `recap_card.dart`, `recap_share_card.dart` | `recap.tsx` | 🟡 | `RecapShareCard` (alias `RewardsRecapCard`) draws a self-contained SVG to a PNG on a tap; Download / Share labels are props, not yet in `rewardsTexts`. |
| `followup_settings.dart` | `followup-settings.tsx` | 🟡 | Native `<input type="time">` instead of `showTimePicker`; `role="switch"` buttons. |
| `quiz_card.dart`, `quiz_screen.dart`, `quiz_views.dart` | `quiz.tsx` | 🟡 | `QuizCard` opens a dialog instead of pushing a route; `QuizBody` / `QuizQuestionView` exported. |
| `myind_attribution.dart` | `myind-attribution.tsx` | ✅ | Real `<a rel="noopener" target="_blank">`, 44 px, `utm_source=rewards-react`; once per screen (`AttributionShownContext`). |
| `theme.dart` (`RewardsTheme.of`) | `styles.css`, `theme.ts` | 🟡 | CSS variables (light, dark via `prefers-color-scheme` and `data-theme`); `rewardsThemeStyle(overrides)`. |

## Not at parity yet

| Item | Why | Where it goes |
|---|---|---|
| Android Block Store (an install id that survives a reinstall) | Not wrapped in an adapter here; `secureInstallIdStore({ backup })` takes any `KeyValueStore` an app builds on it | Open |
| RN visual checks on a device (VoiceOver / TalkBack, font scale 2.0, RTL) | jest renders the tree, not pixels; needs a simulator | Owner / next pass |
| hi / id date formats in `copy.ts` | `Intl.DateTimeFormat` and Dart `intl` can differ in small ways for hi / id (English matches exactly) | Accepted; tests check the day and weekday only |
| Rewards texts in languages other than English | The Dart package is English-only too | Apps pass `rewardsTexts(overrides)` |
| Publishing to npm | Needs the `myind` npm org and the owner's word | Owner |

