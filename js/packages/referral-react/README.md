# @myind/referral-react

[![Built with Myind](https://www.myind.ai/referral-kit/badge.svg)](https://www.myind.ai/referral-kit)

Every screen of a referral program for React DOM, on top of
[`@myind/referral-core`](../referral-core): the invite hub, your code with Share / WhatsApp / Copy / QR, the friend's
code entry with paste and an offline claim queue, reward and welcome cards, and the "Your invite page" settings. The
React port of the Flutter package [`referral_kit`](https://pub.dev/packages/referral_kit): same Supabase server, same
states, same copy (English, Hindi, Indonesian) and the same analytics events.

- Client components (`"use client"`), safe to import and render on the server: they work in the Next.js App Router.
- No CSS-in-JS and no Tailwind: one stylesheet of `--rfk-*` CSS variables, light and dark.
- Every component takes `className`, `style` and a `render` escape hatch (plus slots such as `header`, `leading`).
- Keyboard, visible focus, `aria-live` status lines, 48 px targets, `prefers-reduced-motion`.

Site: https://www.myind.ai/referral-kit · Showcase: https://www.myind.ai/referral-kit/showcase ·
GitHub: https://github.com/shaantanu9/referral-rewards-kit

## Install

```bash
npm install @myind/referral-react @myind/referral-core
```

`react` and `react-dom` 18 or later are peer dependencies.

## Quick start

```tsx
'use client';
import { ReferralClient, StoredInstallIdStore, localStorageStore, supabaseRpc } from '@myind/referral-core';
import { InviteHub, ReferralProvider, ReferralRewardCard } from '@myind/referral-react';
import '@myind/referral-react/styles.css';

const store = localStorageStore();
const client = new ReferralClient({
  rpc: supabaseRpc(supabase), // or referralHttpRpc({ supabaseUrl, anonKey, accessToken })
  installIds: new StoredInstallIdStore({ secure: store }),
  onEvent: (e) => analytics.track(e.name, e.props),
});

export function InvitePage() {
  return (
    <ReferralProvider
      client={client}
      appName="Acme"
      locale="en"
      inviteLink={(code) => `https://acme.app/i/${code}`}
      labels={{ byKind: { minutes: (n) => `${n} min of natural voice` } }}
      codeCache={store}
    >
      <ReferralRewardCard />
      <InviteHub from="settings" onOpenTerms={() => router.push('/terms')} />
    </ReferralProvider>
  );
}
```

Try every component with no server: `FakeReferralServer` from `@myind/referral-core/testing` (see
[`js/examples/next-demo`](../../examples/next-demo)).

## ReferralProvider

Gives every component below it the shared options. Each component also takes the same options as props (a prop wins).

| Prop | Type | Default | What |
|---|---|---|---|
| `client` | `ReferralClient` | – | Required here or on each component |
| `queue` | `PendingClaimQueue` | one on `store` | Keeps a code claimed offline or before verification and retries it |
| `appName` | `string` | `''` | "Start using {app}", share text |
| `locale` | `string` | `'en'` | `en`, `hi`, `id` (`hi-IN` works); others fall back to English |
| `l10nOverrides` | `ReferralLocalizationOverrides` | – | Per-key strings or functions (your voice, another language) |
| `labels` | `RewardLabels` | – | Names of reward kinds and entitlements |
| `texts` | `ReferralTexts` | – | The app's own words (title, gift headline, steps, activation step, …) |
| `inviteLink` | `(code) => string \| URL \| null` | – | Your invite page; without one Share sends the code and `storeLink` |
| `storeLink` | `string` | – | Shared with the code when there is no invite page |
| `share` | `ShareHandler` | `webShare` | Web Share API; copies the text where there is none |
| `launcher` | `ReferralLauncher` | `windowLauncher` | Opens WhatsApp (`wa.me`) in a new tab |
| `codeCache` | `KeyValueStore` | – | Keeps the last code so it can be shared offline |
| `store` | `KeyValueStore` | `localStorageStore()` | The default queue and the welcome card |
| `onEvent` | `(e) => void` | `client.onEvent` | Analytics from the components |
| `onSignIn` | `() => void` | – | Shows a Sign in button when signed out |
| `clock` | `() => Date` | `new Date()` | Boost banner, claim window, welcome card day |
| `policy` | `ReferralPromptPolicy` | – | The pass-it-on card follows its once-only rule |
| `attributionSource` | `string` | `'referral-react'` | `utm_source` of the attribution link |
| `retryPendingClaims` | `boolean` | `true` | Retries a kept claim on `online` and when the page becomes visible |

## Components

Every component takes `className`, `style` and `render(ctx)`, where `ctx.defaultContent` is what it would render
(wrap it, replace it, or use the state and actions in `ctx`).

| Component | Flutter widget | Main props |
|---|---|---|
| `InviteHub` | `InviteHub` | `showInvite`, `showEntry`, `initialSection` (`'invite'` \| `'enterCode'`), `from`, `initialCode`, `eligibleFrom`, `onClaimed`, `onAlmostAction`, `header`, `entryHeader`, `entryLeading`, `entryTitle`, `showSteps`, `onOpenTerms`, `shareText`, `onCopied`, `showWhatsApp`, `showQrCode`, `showInvitePageSettings`, `renderUnavailable`, `showTitle`, `title`, `scrollable`, `showAttribution`, `attributionVariant`; ref: `scrollTo(section)` |
| `InviteFriendsScreen` | `InviteFriendsScreen` | `onOpenTerms`, `header`, `shareText`, `renderUnavailable`, `embedded`, `showTitle`, `onLoaded`, `onCopied`, `from`, `showWhatsApp`, `showQrCode`, `showInvitePageSettings`, `showAttribution`, `attributionVariant` |
| `InviteCodeSection` | `InviteCodeSection` | `terms`, `initialCode`, `eligibleFrom`, `onClaimed`, `onAlmostAction`, `header`, `leading`, `showSteps`, `renderUnavailable` |
| `InviteCodeEntry` | `InviteCodeEntry` | `terms`, `eligibleFrom`, `initialCode`, `onClaimed`, `showWindow`, `renderUnavailable`, `title`, `showTitle` |
| `InviteCodePasteButton` | `InviteCodePasteButton` | `onPasted`, `label`, `alwaysShow` |
| `ReferralInvitePageSettings` | `ReferralInvitePageSettings` | `initialPreferences`, `sharerRewarded`, `onLeft` |
| `ReferralBoostBanner` | `ReferralBoostBanner` | `terms`, `clock` |
| `ReferralDeadlineChip` | `ReferralDeadlineChip` | `text`, `lastDay` |
| `ReferralQrSheet`, `ReferralQrCode` | `ReferralQrSheet` / `showReferralQrSheet` | `open`, `onClose`, `link` / `value`, `size`, `label` |
| `ReferralMessage`, `ReferralUnavailableMessage`, `ReferralEntryUnavailable` | `ReferralMessage`, `ReferralEntryUnavailable` | `text`, `action`, `onAction` / `reason`, `texts`, `onSignIn`, `codeKept` |
| `ReferralRewardCard` | `ReferralRewardCard` | `leading`, `actionLabel`, `onAction`, `onShown`, `onDismissed` |
| `ReferralWelcomeCard` | `ReferralWelcomeCard` | `activationStep`, `onPassItOn`, `leading`, `session` |
| `InviteCodeText` | `InviteCodeText` | `code`, `size` |
| `MyindAttribution` | `MyindAttribution` | `variant`, `source`, `target`, `onClick` |

What each one shows, state by state, is the same as the Flutter widgets: see the
[showcase doc](../../../docs/showcase.md).

## Hooks

For apps that build their own UI. Screen hooks own a controller (a `subscribe` / `getSnapshot` store read with
`useSyncExternalStore`); the controllers are exported too, for tests and other frameworks.

| Hook | Returns |
|---|---|
| `useReferral()` | The provider's resolved options (client, queue, `l10n`, …) |
| `useInviteScreen(opts)` | `status`, `data` (code, terms, stats, prefs, offline), `whatsApp`, `reload`, `controller` |
| `useCodeEntry(opts)` | Entry state (`terms`, `prefilled`, `text`, `message`, `busy`, `done`, `unavailable`), `daysLeft`, `controller` (`setText`, `paste`, `submit`, …) |
| `usePendingRewards(opts)` | `items`, `dismiss(reward)` |
| `useWelcomeCard(opts)` | `claim`, `terms`, `close(action)` |
| `useInvitePageSettings(opts)` | prefs, `showName`, `name`, `saving`, `nameError`, `status`, `dirty`, `controller` |
| `useReferralTerms()`, `useInviteCode()` | `{ loading, value, unavailable, error, reload }` (`useInviteCode` adds `offline`) |
| `useClaim()` | `claim(code, {source, via})`, `busy`, `outcome` (through the offline queue) |
| `usePendingClaimRetrier(queue, signals)` | Retries a kept claim on your signals |
| `useReferralPrompt(policy)` | `shouldPrompt`, `check()`, `markPrompted()` |

## Styling

Import `@myind/referral-react/styles.css` once. Colours, radii and sizes are CSS variables:

```css
:root {
  --rfk-primary: #0f766e;
  --rfk-on-primary: #ffffff;
  --rfk-radius: 16px;
  --rfk-font: 'Inter', system-ui, sans-serif;
}
```

Light and dark follow `prefers-color-scheme`; set `data-theme="light"` or `data-theme="dark"` on any ancestor to force
one. Every element has a `rfk-…` class for finer changes, or skip the stylesheet and style them yourself.

## Attribution

`InviteHub` and `InviteFriendsScreen` show a small "Built with Myind referral kit" link at the bottom
(`<MyindAttribution>`): a real `<a href>` to https://www.myind.ai/referral-kit with `utm_source`,
`utm_medium=attribution` and `utm_campaign=v<variant>`, `rel="noopener"`, an accessible name and a 44 px target.
`InviteHub` shows it once, not again for the invite part inside it. Nothing is sent at runtime.

It is on by default and free to remove, with no licence key:

```tsx
<InviteHub showAttribution={false} />
<InviteFriendsScreen attributionVariant={2} />   // another link text (0..3)
```

If you keep it, thank you: it is how other developers find the kit. Apps that use it can be listed on the
[showcase](https://www.myind.ai/referral-kit/showcase).

## Next.js

The components are client components; put them in any page or layout of the App Router. For the server side (the
invite landing at `/i/[code]`, its metadata and OG image, the referral RPC for server components) use
[`@myind/kit-next`](../kit-next).

## License

MIT. See [LICENSE](LICENSE).
