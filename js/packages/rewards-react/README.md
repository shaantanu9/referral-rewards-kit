# @myind/rewards-react

[![Built with Myind](https://www.myind.ai/referral-kit/badge.svg)](https://www.myind.ai/referral-kit)

React components for **rewards-kit**: daily streaks, milestones, timed offers, an Instagram tag task, daily quizzes,
quests, recharges, time windows, friend streaks, surprises with honest odds, opt-in weekly leagues, recaps and
reminder settings, on your own Supabase project. Every widget of the Flutter package
[`rewards_kit`](https://pub.dev/packages/rewards_kit) (0.8), for React DOM and the Next.js App Router, on
[`@myind/rewards-core`](../rewards-core).

- The same states, copy and fair-play choices as the Flutter widgets: a user who switched streaks, surprises or timers
  off sees no streak, no odds or gamble, no countdown. Countdowns run on the server's clock.
- Every component takes `className`, `style` and a `render` prop (Flutter's `builder`) that replaces its whole look.
- One stylesheet on `--rk-*` CSS variables: light by default, dark with `prefers-color-scheme`, or forced with
  `data-theme="light" | "dark"` on any ancestor. No CSS-in-JS, no Tailwind needed.
- Client components (`'use client'`), safe to render on the server; nothing loads until mount.
- Keyboard and screen readers: real buttons and links, visible focus rings, `role="switch"`, countdowns announced
  politely once a minute (not every tick), right / wrong and "done" never shown by colour alone.
- React 18 or 19. No other runtime dependency.

## Install

```bash
npm install @myind/rewards-core @myind/rewards-react
```

The server side (SQL migrations for Supabase) is in the
[GitHub repo](https://github.com/shaantanu9/referral-rewards-kit) under `supabase/migrations`.

## Quick start

```tsx
'use client';
import '@myind/rewards-react/styles.css';
import { RewardsClient, RewardsController, supabaseRewardsRpc } from '@myind/rewards-core';
import { RewardsHub, RewardsProvider, RewardToastListener } from '@myind/rewards-react';
import { useState } from 'react';
import { supabase } from './supabase';

export function Rewards() {
  const [controller] = useState(() => new RewardsController({ client: new RewardsClient({ rpc: supabaseRewardsRpc(supabase) }) }));
  return (
    <RewardsProvider controller={controller}>
      <RewardToastListener>
        <RewardsHub onShareInvite={(code) => navigator.share?.({ text: code })} />
      </RewardToastListener>
    </RewardsProvider>
  );
}
```

Track what users do anywhere with `controller.track('chapter_read')`; every component updates. Strings:
`<RewardsProvider texts={rewardsTexts({ claim: 'Grab it', reward: (r) => `${r.amount} gems` })}>`. Colours:
`<div style={rewardsThemeStyle({ accent: '#0B57D0', radius: 12 })}>…</div>` or set `--rk-accent` in your CSS.

Try every component with no server: `js/examples/rewards-react-demo` (`pnpm --filter rewards-react-demo dev`) runs
them on `FakeRewardsServer` from `@myind/rewards-core/testing`.

## Provider and hooks

| Export | What |
|---|---|
| `RewardsProvider({ controller, texts? })` | One controller and texts for every component below. Renders no element. |
| `useRewards(controller?)` | The controller's snapshot (`useSyncExternalStore`); re-renders on every change. |
| `useRewardsState(controller?)` | `snapshot.state`. |
| `useRewardsListener(controller?)` | The snapshot, and loads the state once on mount when nobody has yet. |
| `useRewardsController(controller?)`, `useRewardsTexts(texts?)` | The prop, else the provider's. |
| `useQuiz(program, { controller?, quiz?, open?, revealForMs? })` | A `QuizController` made after mount, disposed on unmount (StrictMode-safe), and its snapshot. |
| `useQuizSnapshot(quiz)` | A quiz controller's snapshot. |
| `useCountdown(endsAt, clock, { onExpired?, hidden? })` | Milliseconds left on the server clock, re-rendering each second. |
| `useGrantQueue(controller, { holdUntilMoment?, onAnnounce })` | Each new grant once, held until `celebrateNow()` when asked. |
| `rewardsThemeStyle(overrides?, 'light' \| 'dark')` | The theme as a `style` object of `--rk-*` variables. |

## Components

Every component takes `controller?` and `texts?` (default: the provider's), `className?`, `style?`, and
`render?` (your own look; it gets the same data the Flutter `builder` gets). Each hides itself while rewards are not
visible (not loaded, unavailable, switched off) and loads the state once on mount.

| Component | Props (besides the common ones) | Notes |
|---|---|---|
| `RewardsHub` | `programRenderers`, `onOpenInstagram`, `onShareInvite`, `onOpenQuiz`, `onPlaySound`, `renderImage`, `header`, `showSurprises` (true), `showAttribution` (true), `attributionVariant` (1), `spacing` | Inbox, the Surprises odds card, then one component per live program in the server's order; attribution once at the bottom. |
| `StreakCard` | `program?`, `atRiskWithinMs` (4 h), `render(streak, controller)` | Risk countdown, repair offer, "is back", personal-best chip, mystery odds. |
| `DailyGoalRing` | `program?`, `size` (56), `strokeWidth` (6), `render(streak)` | `role="img"` labelled "1/2" or "Goal met". |
| `MilestoneProgress` | `program`, `title?`, `headStartLabel?`, `render(milestone, controller)` | Head start and levels (0.7). |
| `ActivityHeatmap` | `program?`, `weeks` (15), `cellSize` (12), `gap` (3), `showLegend`, `renderCell(day, level, isToday)`, `render(history)` | Loads `rewards_history` once; every cell labelled with its day and count. |
| `QuestList` | `program`, `title?`, `render(quest, controller)` | Reset countdown reloads the state. |
| `OfferBanner` | `program`, `title?`, `onClaimed`, `render(offer, claim)` | Hides when claimed, sold out or past its deadline. |
| `Countdown` | `endsAt`, `clock`, `onExpired`, `prefix`, `hidden`, `render(leftMs)` | `role="timer"`; a polite live region repeats it rounded to the minute. |
| `WindowBadge` | `program`, `title?`, `render(window, open)` | Reloads at each edge. |
| `RechargeMeter` | `program`, `icon`, `emptyIcon`, `showUseButton` (false), `render(recharge, use)` | Reloads when the next unit is due. |
| `FriendStreaks` | `program`, `title?`, `onShareInvite`, `render(friends, controller)` | Without `onShareInvite` the code is shown to copy. |
| `LeagueBoard` | `program`, `title?`, `maxRows?`, `render(league, controller)` | Opt-in; own row bold with "(You)"; nothing marks moving down. |
| `RecapCard` | `from`, `to`, `title?`, `render(recap)` | Loads `rewards_recap` once. |
| `RecapShareCard` (`RewardsRecapCard`) | `recap`, `title?`, `subtitle?`, `footer?`, `aspectRatio` (4/5), `maxEvents` (3), `imageWidth` (1080), `fileName`, `showActions` (true), `downloadLabel`, `shareLabel`, `shareRef`, `rasterize`, `render` | A PNG (SVG on a canvas) only after the user taps Download or Share (Web Share with files where the browser has it). `recapYear(2026)`, `recapCardSvg`, `recapSvgToPng`. |
| `RewardInbox` | `showEmpty` (false), `render(inbox, seen)` | "Got it" marks seen; pending ones say "On its way". |
| `RewardToastListener` | `children`, `holdUntilMoment` (false), `revealSurprises` (true), `onGrant`, `toastMs` (4000) | Polite toasts; surprise grants open the reveal dialog one at a time. |
| `RewardReveal` | `grant`, `autoOpen`, `onOpened`, `onEvent`, `onHaptic`, `render(grant, opened, open)` | 600 ms shake then the line; `prefers-reduced-motion` opens at once; fixed grants are never shown as a gamble. |
| `RewardRevealDialog` | `RewardReveal` props + `onClose` | Modal; "Close", then "Nice!"; Escape closes. |
| `SurpriseOdds` | `program?`, `title?`, `render(surprises)` | Hidden while surprises are off. |
| `MysteryOdds` | `reward`, `render(odds)` | Each outcome's chance as a percentage. |
| `SocialTagTask` | `program`, `onOpenInstagram`, `onCopy`, `showLinkField`, `render(task, start)` | Events never carry the code, handle or link. |
| `RewardedAdButton` | `label`, `onShowAd` (your ad adapter), `enabled` (true), `refreshAfterMs` ([5000, 20000]), `render(show, busy, message)` | Reloads now and after each delay once the ad is verified. |
| `FollowupSettings` | `showEmails` (true), `defaultReminderTime` (19:00), `showChoices` (false), `onChanged`, `render(prefs, save, reason)` | Saves each change at once, undoes a failed save; choices apply to the controller. |
| `QuizCard` | `program`, `title?`, `onOpen`, `onPlaySound`, `renderImage`, `render(quiz, open)` | Without `onOpen` the quiz opens in a dialog. |
| `QuizScreen` | `program`, `quiz?`, `title?`, `onDone`, `onPlaySound`, `renderImage`, `render(quiz, snapshot)`, `showAttribution` (true), `attributionVariant` (1), `headingLevel` (2) | The whole flow; resumes an attempt in progress. |
| `QuizBody`, `QuizQuestionView` | `quiz`, `snapshot`, `onDone`, `footer`, media props | The default quiz look, for your own layout. |
| `RewardsListener` | `render(snapshot, controller)`, `hidden(snapshot)` | Port of the Flutter `RewardsListener`. |
| `MyindAttribution` | `variant` (0), `source` (`rewards-react`), `onOpen` | See below. |
| Base pieces | `Card`, `ProgressBar`, `Icon`, `Switch`, `cx`, `useReducedMotion` | What the defaults are built from. |

## Attribution

`RewardsHub` and `QuizScreen` show a small centred "Rewards by Myind" link at the bottom (`attributionVariant`, default
1). It is a real `<a>` to `https://www.myind.ai/referral-kit` with `utm_source=rewards-react`,
`utm_medium=attribution` and `utm_campaign=v1`, opening in a new tab (`rel="noopener"`), labelled
"Opens myind.ai: Rewards by Myind", at least 44 px. Nothing is sent at runtime. It is shown once per screen: a quiz
opened from the hub adds no second link. It is free to remove, with no licence key: `showAttribution={false}`. Put
`<MyindAttribution variant={0..3} />` anywhere else yourself.

## Differences from the Flutter widgets

- `builder` is `render`; `programBuilders` is `programRenderers`; `imageBuilder` is `renderImage`; durations are ms.
- No pull-to-refresh or scroll view in `RewardsHub` (the page scrolls); `QuizCard` opens a dialog instead of pushing a
  route; `FollowupSettings` uses a native time input instead of `showTimePicker`.
- The haptic is `navigator.vibrate` where it exists (`onHaptic` to replace it).
- `RecapShareCard` adds Download / Share buttons (their two labels are props, English by default, not yet in
  `rewardsTexts`); the image always uses the default layout, in the card's colours.

MIT licensed. Site: https://www.myind.ai/referral-kit · GitHub: https://github.com/shaantanu9/referral-rewards-kit
