# @myind/rewards-react-native

[![Built with Myind](https://www.myind.ai/referral-kit/badge.svg)](https://www.myind.ai/referral-kit)

Every widget of the Flutter [`rewards_kit`](https://pub.dev/packages/rewards_kit) for React Native and Expo: daily
streaks, milestones, timed offers, Instagram tag rewards, daily quizzes, quests, recharges, time windows, friend
streaks, opt-in weekly leagues, surprise reveals, recaps and follow-up settings. Built on
[`@myind/rewards-core`](../rewards-core): countdowns use the server's clock, deadlines and stock come from the server,
the odds of every surprise are shown before anything is earned, and the user's fair-play choices (streaks off,
surprises off, timers off) are followed everywhere.

Status: 0.1.0, private (`"private": true`): used from this workspace, not on npm. The install lines below are how an app would add it once that changes.

## Install

```bash
npx expo install @myind/rewards-react-native @myind/rewards-core
```

React Native 0.78+ and React 19. The main entry needs nothing else. Optional entry points:

| Feature | Entry point | Install |
|---|---|---|
| Follow-up reminders on the device (`FollowupScheduler`) | `@myind/rewards-react-native/notifications` | `npx expo install expo-notifications` |
| Remember scheduled reminder ids across restarts | `@myind/rewards-react-native/async-storage` | `npx expo install @react-native-async-storage/async-storage` |
| "Copy code" on the Instagram task | `@myind/rewards-react-native/clipboard` | `npx expo install expo-clipboard` |
| Share the recap card as an image | `@myind/rewards-react-native/view-shot` | `npx expo install react-native-view-shot` (Android: plus `expo-sharing` for the file) |

Haptics on a surprise: pass `onHaptic` to the provider, e.g. expo-haptics
`() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)`.

## Quick start

```tsx
import { FollowupScheduler, RewardsClient, RewardsController, supabaseRewardsRpc } from '@myind/rewards-core';
import { RewardsHub, RewardsKitProvider, RewardToastListener, useRefreshOnResume } from '@myind/rewards-react-native';
import { expoNotifier } from '@myind/rewards-react-native/notifications';
import { asyncStorageFollowupIds } from '@myind/rewards-react-native/async-storage';
import { expoCopyText } from '@myind/rewards-react-native/clipboard';

const client = new RewardsClient({ rpc: supabaseRewardsRpc(supabase), onEvent: (e) => analytics.track(e.name, e.props) });
const controller = new RewardsController({ client });
new FollowupScheduler({ controller, notifier: expoNotifier(), store: asyncStorageFollowupIds() }).start();

export function RewardsScreen() {
  useRefreshOnResume(controller);
  return (
    <RewardsKitProvider copyText={expoCopyText}>
      <RewardToastListener controller={controller}>
        <RewardsHub controller={controller} onOpenInstagram={(a) => Linking.openURL(`https://instagram.com/${a}`)} />
      </RewardToastListener>
    </RewardsKitProvider>
  );
}

// Anywhere the user does something that counts:
await controller.track('chapter_read');
```

Hooks: `useRewards(controller)` and `useQuiz(quiz)` return the immutable snapshots through `useSyncExternalStore`.

## Components

| Component | What it shows |
|---|---|
| `RewardsHub` | Every live program in the server's order: inbox, the surprise odds card, then each program's component; `programRenderers` replace one; pull to refresh |
| `StreakCard`, `DailyGoalRing`, `ActivityHeatmap` | Days in a row, best, freezes, next reward, the at-risk countdown, repair, personal best; today's goal ring; the weeks × 7 history (frozen days striped) |
| `MilestoneProgress`, `MysteryOdds`, `SurpriseOdds` | Progress to the next reward, levels, head start; every chance of a mystery reward; every surprise's odds |
| `OfferBanner`, `QuestList`, `RechargeMeter`, `WindowBadge` | A timed offer with stock and Claim; quests with progress, bonus and reset time; units that refill; a time window that opens and closes |
| `SocialTagTask`, `FriendStreaks`, `LeagueBoard` | "Tag us on Instagram" with code and post link; streaks with friends (invite, accept, end); the opt-in weekly league |
| `QuizCard`, `QuizScreen`, `QuizBody` | The way into today's quiz; the whole flow (rules, question with its time bar, right / wrong, score and rewards); opens in a modal unless you pass `onOpen` |
| `RewardInbox`, `RewardToastListener`, `RewardReveal`, `RewardRevealModal` | Unseen rewards with Got it; a toast per new grant (or the reveal for a surprise, one at a time, held until `celebrateNow()` if you ask); the gift that shakes open (no shake with Reduce Motion) |
| `RecapCard`, `RewardsRecapCard`, `recapYear` | A recap between two days; the shareable "Your 2026" card |
| `RewardedAdButton` | "Watch an ad" through your ad code, with the refreshes after a verified reward |
| `FollowupSettings` | Reminders, each kind of reminder, emails, the reminder time, and "How rewards look" (streaks, surprises, timers) |
| `RewardsListener`, `Countdown` | The building blocks: re-render on every change and load once; a server-clock countdown |
| `MyindAttribution` | The "Rewards by Myind" link (below) |

Every component takes `style` and a `render` prop for your own look (Flutter's `builder`). Words: `textOverrides`
(or ready `texts`) on the provider. Colours: the core's `RewardsTheme` tokens, light and dark by `useColorScheme()`;
override with `theme` / `darkTheme`. Buttons are at least 44 pt with roles and labels; countdowns are `timer`s and
progress is announced.

Sharing the recap card, only after the user taps your Share button:

```tsx
import { shareRecapCard } from '@myind/rewards-react-native/view-shot';
const card = useRef(null);
<RewardsRecapCard ref={card} recap={recap} subtitle="Reader" />
<Button title="Share" onPress={() => shareRecapCard(card, { message: 'My year in Reader' })} />
```

## Attribution

`RewardsHub` and `QuizScreen` show a small "Rewards by Myind" link at the bottom. It opens the site with
`utm_source=rewards-react-native&utm_medium=attribution&utm_campaign=v1` through `Linking`; nothing is sent at
runtime. Free to remove: `showAttribution={false}`. Another text: `attributionVariant` (0–3). Or place
`<MyindAttribution />` yourself.

## Testing your app

`@myind/rewards-core/testing` has `FakeRewardsServer` and `fakeRewards`, with every program kind and story moves
(`breakStreak`, `verifySocial`, `closeLeagueWeek`, `grantMystery`, `newDay`, …). This package's tests use them with
`@testing-library/react-native`.

MIT licensed. Site: https://www.myind.ai/referral-kit · Showcase: https://www.myind.ai/referral-kit/showcase
