# @myind/referral-react-native

[![Built with Myind](https://www.myind.ai/referral-kit/badge.svg)](https://www.myind.ai/referral-kit)

Every screen of the Flutter [`referral_kit`](https://pub.dev/packages/referral_kit) for React Native and Expo: invite
friends, enter an invite code, rewards that landed, the friend's welcome card, the invite page settings and the QR
code. Built on [`@myind/referral-core`](../referral-core), so it talks to the same Supabase functions with the same
JSON and reports the same analytics events. Copy in English, Hindi and Indonesian.

Status: 0.1.0, private (`"private": true`): used from this workspace, not on npm. The install lines below are how an app would add it once that changes.

## Install

```bash
npx expo install @myind/referral-react-native @myind/referral-core
```

React Native 0.78+ and React 19. The main entry needs nothing else: Share, Linking and AppState come with React Native.
Each feature below that needs a native library has its own entry point, so you install only what you use:

| Feature | Entry point | Install |
|---|---|---|
| Pending claims, prompt policy, code cache, welcome card storage | `@myind/referral-react-native/async-storage` | `npx expo install @react-native-async-storage/async-storage` |
| Install id in the Keychain / Keystore | `@myind/referral-react-native/secure-store` | `npx expo install expo-secure-store` |
| Copy code, Paste (iOS 16+ system paste control, no prompt) | `@myind/referral-react-native/clipboard` | `npx expo install expo-clipboard` |
| Retry a kept claim when the device is back online | `@myind/referral-react-native/netinfo` | `npx expo install @react-native-community/netinfo` |
| Code prefilled from the Google Play install referrer (Android) | `@myind/referral-react-native/install-referrer` | `npx expo install expo-application` |
| "Show QR code" | `@myind/referral-react-native/qrcode` | `npx expo install react-native-svg react-native-qrcode-svg` |

Bare React Native without Expo modules: `KeyValueStore`, `ReferralClipboard`, `InstallReferrerSource` and the QR
renderer are small interfaces; wrap `react-native-keychain`, `@react-native-clipboard/clipboard`,
`react-native-device-info` (`getInstallReferrer`) or any QR library the same way.

## Quick start

```tsx
import { PendingClaimQueue, PendingClaimRetrier, ReferralClient, supabaseRpc } from '@myind/referral-core';
import { appStateResumes, InviteHub, ReferralKitProvider, ReferralRewardCard } from '@myind/referral-react-native';
import { asyncStorageStore } from '@myind/referral-react-native/async-storage';
import { secureInstallIdStore } from '@myind/referral-react-native/secure-store';
import { expoClipboard } from '@myind/referral-react-native/clipboard';
import { netInfoReconnects } from '@myind/referral-react-native/netinfo';
import { qrCodeSvg } from '@myind/referral-react-native/qrcode';

const store = asyncStorageStore();
const client = new ReferralClient({
  rpc: supabaseRpc(supabase),
  installIds: secureInstallIdStore({ backup: store }),
  eventStore: store,
  onEvent: (e) => analytics.track(e.wireName, e.props),
});
const queue = new PendingClaimQueue({ client, store });
new PendingClaimRetrier({ queue, appResumes: appStateResumes, reconnects: netInfoReconnects() });

export function InviteScreen() {
  return (
    <ReferralKitProvider locale="en" clipboard={expoClipboard} renderQr={qrCodeSvg}>
      <ReferralRewardCard client={client} />
      <InviteHub client={client} queue={queue} appName="Reader" inviteLink={(c) => `https://reader.app/i/${c}`} from="settings" />
    </ReferralKitProvider>
  );
}
```

A code from a deep link: `queue.keep(code)` (it shows prefilled for one tap). From the Play install referrer:

```ts
import { InstallReferrerCodeReader } from '@myind/referral-core';
import { playInstallReferrer } from '@myind/referral-react-native/install-referrer';

const code = await new InstallReferrerCodeReader({ store, source: playInstallReferrer() }).readOnce();
if (code) await queue.keep(code);
```

## Components

| Component | What it shows |
|---|---|
| `InviteHub` | Your code with Share / WhatsApp / Copy / QR on top, a friend's code below; `ref.scrollTo('enterCode')`, `initialSection`, `scrollable={false}` inside your own list |
| `InviteFriendsScreen` | The sharer's screen: give-first headline, boost banner, code, rules and caps, joined count, waiting friends, rewards earned and pending, invite page settings, paused / left / disabled states, offline cached code |
| `InviteCodeSection` | The friend's side: the gift, the server's days left as a chip, the code field, three steps, "Almost yours" after a code, "can't add a code" |
| `InviteCodeEntry` | The code field with Paste, the claim-window countdown, the disclosure sentence, a message per refusal, one-tap confirm for a prefilled code, offline queue |
| `InviteCodePasteButton` | Paste: the iOS 16+ system control (no "Allow Paste" prompt, the clipboard is never read on iOS), a button on Android |
| `InviteCodeText` | `ABCD-EFGH` in monospace, read out letter by letter, always left to right |
| `ReferralRewardCard` | Rewards that landed (`referral_pending`), acked on Dismiss; reloads when the app comes back |
| `ReferralWelcomeCard` | The friend's welcome gift and days left; then "Pass it on" once (follows your prompt policy) |
| `ReferralInvitePageSettings` | First name on the invite page (validated like the server), "Leave the invite program" with a native confirm |
| `ReferralBoostBanner`, `ReferralDeadlineChip`, `ReferralQrSheet` | The boost's real last day; the days-left chip (error colours on the last day); the QR sheet (dark on white) |
| `ReferralMessage`, `ReferralUnavailableMessage`, `ReferralEntryUnavailable` | One sentence for not deployed / signed out (with Sign in) / no project; load failed with Retry |
| `MyindAttribution` | The "Built with Myind referral kit" link (below) |

Every component takes `style`; the cards take a `render` prop for your own look (Flutter's `builder`), and every
unavailable state takes `renderUnavailable`. Words: `texts` (your voice for the invite screens) and
`l10nOverrides` / `locale` on the provider. Colours: Material 3 light and dark by default, following
`useColorScheme()`; override with `theme` / `darkTheme` on the provider. Every button is at least 44 pt, has an
accessibility role and label, and status lines are live regions.

## Attribution

`InviteHub` and `InviteFriendsScreen` show a small "Built with Myind referral kit" link at the bottom (once in the hub).
It opens `https://www.myind.ai/referral-kit` with `utm_source=referral-react-native&utm_medium=attribution&utm_campaign=v0`
through `Linking`; nothing is sent at runtime. Free to remove: `showAttribution={false}`. Pick another text with
`attributionVariant` (0–3), or place `<MyindAttribution />` anywhere yourself.

## Testing your app

`@myind/referral-core/testing` has `FakeReferralServer` and `fakeReferralClient`: every state (offline, not deployed,
paused, rate limited, banked rewards, a friend who signs up, starts, pays) with no server. This package's tests use
them with `@testing-library/react-native`.

MIT licensed. Site: https://www.myind.ai/referral-kit · Showcase: https://www.myind.ai/referral-kit/showcase
