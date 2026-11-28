# referral-kit for JavaScript

[![Built with Myind](https://www.myind.ai/referral-kit/badge.svg)](https://www.myind.ai/referral-kit)

The TypeScript ports of the Flutter packages [`referral_kit`](https://pub.dev/packages/referral_kit) and
[`rewards_kit`](https://pub.dev/packages/rewards_kit) (ADR 0003).
Same Supabase server, same RPC names and JSON shapes, same events. Parity per file:
[docs/js-port-parity.md](../docs/js-port-parity.md).

## Packages

| Package | What | State |
|---|---|---|
| [`@myind/referral-core`](packages/referral-core) | Referral client, models, code format, copy in en/hi/id, events, offline claim queue, prompt policy, install id and referrer, share text, attribution; `/testing` fake server | 0.1.0, built here |
| [`@myind/rewards-core`](packages/rewards-core) | Rewards client, models, `RewardsController` / `QuizController` (snapshots for `useSyncExternalStore`), follow-up scheduler, streak reminder, texts, theme tokens, attribution; `/testing` fake engine | 0.1.0, built here |
| [`@myind/referral-react`](packages/referral-react) | Every referral widget for React DOM: `InviteHub`, `InviteFriendsScreen`, `InviteCodeSection`, `InviteCodeEntry`, QR / WhatsApp / boost / deadline extras, invite page settings, reward and welcome cards, `MyindAttribution`; `ReferralProvider` and hooks; `styles.css` (`--rfk-*`) | 0.1.0, built here |
| [`@myind/kit-next`](packages/kit-next) | Next.js App Router: `createReferralRpc` (anon key + user token), invite route `/i/[code]` (the `web/invite` page) with `inviteMetadata`, terms route, `next/og` invite image, `withReferralKit`, `<MyindAttribution>` | 0.1.0, built here |
| [`@myind/rewards-react`](packages/rewards-react) | Every rewards_kit 0.8 widget for React DOM and Next.js (client components, SSR-safe), `RewardsProvider` + hooks, one `styles.css` on `--rk-*` variables, attribution link; demo in [`examples/rewards-react-demo`](examples/rewards-react-demo) | 0.1.0, built here |
| [`@myind/referral-react-native`](packages/referral-react-native) | Every referral widget for React Native; adapters as separate entries: `/async-storage`, `/secure-store`, `/clipboard`, `/netinfo`, `/install-referrer`, `/qrcode` | 0.1.0, built here |
| [`@myind/rewards-react-native`](packages/rewards-react-native) | Every rewards widget for React Native; `/notifications`, `/clipboard`, `/view-shot`, `/async-storage` | 0.1.0, built here |
| [`examples/expo-demo`](examples/expo-demo) | Expo SDK 58 app with every React Native component on the fake servers (private) | built here |

The cores have no runtime dependencies and know nothing about a UI framework: storage, sharing, launching links,
the install referrer and notifications are small interfaces that each platform package fills in.

Demo: [`examples/next-demo`](examples/next-demo) shows every React component and Next route on the fake server
(`pnpm -r build`, then `next start` in that folder).

## Work in this folder

Node 20+ (24 here) and pnpm 11.

```bash
cd js
pnpm install
pnpm typecheck   # tsc on every package
pnpm lint        # tsc with unused / implicit-return checks on src
pnpm test        # vitest (cores, web) and jest + @testing-library/react-native (React Native packages, demo)
pnpm build       # tsup: ESM + CJS + .d.ts in each package's dist/ (React Native packages too: Metro reads `exports`)
pnpm gen:l10n    # regenerate referral-core's strings after an ARB file changes
pnpm --filter rewards-react-demo dev   # every rewards component on the fake engine (stop it when done)
```

Tests read the Dart packages' JSON fixtures (the real SQL output) directly, so both ports are held to the same server.
Nothing here is published: publishing to npm needs the `myind` npm org and the owner's go-ahead.

## Conventions for the UI packages

- Models are immutable classes with `static fromJson`; times are `Date` instants; durations are milliseconds and named
  `…Ms`; Dart enums are `const` objects whose values are the wire strings (`ProgramKind.socialTag === 'social_tag'`).
- Controllers: `subscribe(listener) => unsubscribe`, `getSnapshot()` (same object until a change), async actions that
  resolve to `null` or a reason, `dispose()`. Dart streams become `onGrant(listener)` / `onMoment(listener)`.
- Copy: referral strings come from `referralLocalizations(locale, overrides)` (`t('hi').inviteTitle`); rewards strings
  from `rewardsTexts(overrides)`.
- Attribution: `attributionLink(variant, source)` from either core; show it on top-level screens only, with
  `showAttribution` (default `true`) to hide it.
- React Native: optional native libraries are optional peer dependencies behind their own entry points, never imported
  by the main entry; tests map the cores to their sources (`moduleNameMapper`, tsconfig `paths`) so they need no build.

MIT licensed. Site: https://www.myind.ai/referral-kit · GitHub: https://github.com/shaantanu9/referral-rewards-kit
