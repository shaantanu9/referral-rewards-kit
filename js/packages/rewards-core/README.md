# @myind/rewards-core

[![Built with Myind](https://www.myind.ai/referral-kit/badge.svg)](https://www.myind.ai/referral-kit)

The framework-agnostic core of **rewards-kit**: daily streaks, milestones, timed offers, an Instagram tag task, daily
quizzes, quests, recharges, time windows, friend streaks, surprises with honest odds, opt-in weekly leagues, recaps
and follow-up reminders, on your own Supabase project. It is the TypeScript port of the Flutter package
[`rewards_kit`](https://pub.dev/packages/rewards_kit) without its widgets, and it is what the React, Next.js and React
Native packages build on.

- Typed client for every `rewards_*` Postgres function (same RPC names and JSON shapes as the Flutter package).
- `RewardsController` and `QuizController` with `subscribe` / `getSnapshot` returning immutable snapshots, so React's
  `useSyncExternalStore` never tears. Actions resolve to `null` or a short reason (`sold_out`, `offline`, …).
- Countdowns on the server's clock (`ServerClock`), never the device's.
- A follow-up scheduler that keeps the device's notifications equal to the engine's plan (you plug in the
  notification library), and a pure streak-reminder helper.
- Every string the widgets show (English, every one overridable) and theme tokens (Material 3 light and dark).
- Zero runtime dependencies. ESM + CJS + types.

## Install

```bash
npm install @myind/rewards-core
```

The server side (SQL migrations for Supabase) is in the
[GitHub repo](https://github.com/shaantanu9/referral-rewards-kit) under `supabase/migrations`.

## Quick start

```ts
import { RewardsClient, RewardsController, rewardsHttpRpc, defaultRewardsTexts } from '@myind/rewards-core';

const client = new RewardsClient({
  rpc: rewardsHttpRpc({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    accessToken: async () => (await supabase.auth.getSession()).data.session?.access_token,
  }),
  // or: rpc: supabaseRewardsRpc(supabase)
  onEvent: (e) => analytics.track(e.wireName, e.props),
});
const rewards = new RewardsController({ client });
await rewards.refresh();

// React: const snap = useSyncExternalStore(rewards.subscribe, rewards.getSnapshot, rewards.getSnapshot);
const streak = rewards.getSnapshot().state.streak('daily');

const reason = await rewards.track('chapter_read', { dedupeKey: 'chapter:42' });
if (reason) showError(defaultRewardsTexts.error(reason));
rewards.onGrant((g) => toast(defaultRewardsTexts.gotReward(defaultRewardsTexts.reward(g.spec))));
```

### Demos and tests without a server

```ts
import { FakeRewardsServer, fakeRewards } from '@myind/rewards-core/testing';

const server = new FakeRewardsServer({ latencyMs: 150 });
const { client, controller } = fakeRewards(server);
server.breakStreak(); // a broken streak with a repair offer
server.closeLeagueWeek(); // last week's result and a tier up
```

## Attribution

Screens built on the kit show a small "Built with Myind" link by default; removing it is free (`showAttribution:
false` in the UI packages). The link config is `MYIND_ATTRIBUTION` / `attributionLink(variant, source)`.

## Links

- Site: https://www.myind.ai/referral-kit
- Showcase: https://www.myind.ai/referral-kit/showcase
- Flutter versions: [rewards_kit](https://pub.dev/packages/rewards_kit), [referral_kit](https://pub.dev/packages/referral_kit)
- GitHub: https://github.com/shaantanu9/referral-rewards-kit
- Referrals (invite codes, both get a reward): [`@myind/referral-core`](../referral-core)

MIT licensed.
