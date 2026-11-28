# @myind/referral-core

[![Built with Myind](https://www.myind.ai/referral-kit/badge.svg)](https://www.myind.ai/referral-kit)

The framework-agnostic core of **referral-kit**: a "invite friends, both get a reward" program on your own Supabase
project. It is the TypeScript port of the Flutter package [`referral_kit`](https://pub.dev/packages/referral_kit)
without its widgets, and it is what the React, Next.js and React Native packages build on.

- Typed client for the `referral_*` Postgres functions (same RPC names and JSON shapes as the Flutter package).
- Invite-code normalisation exactly like the server (bidi marks, full-width letters, Devanagari and Arabic digits).
- Every user-facing sentence built from the live rules, in English, Hindi and Indonesian, with per-key overrides.
- The whole analytics funnel as events (`onEvent`), with codes only as salted hashes.
- An offline claim queue, a prompt policy, install id and install-referrer helpers, share text, attribution link.
- Zero runtime dependencies (`fetch`, WebCrypto). ESM + CJS + types. Works in browsers, Node 18+, edge runtimes and
  React Native.

## Install

```bash
npm install @myind/referral-core
# or: pnpm add @myind/referral-core
```

The server side (SQL migrations for Supabase) is in the
[GitHub repo](https://github.com/shaantanu9/referral-rewards-kit) under `supabase/migrations`.

## Quick start

```ts
import {
  ReferralClient,
  PendingClaimQueue,
  ReferralCopy,
  StoredInstallIdStore,
  localStorageStore,
  referralHttpRpc,
  referralLocalizations,
} from '@myind/referral-core';

const store = localStorageStore(); // AsyncStorage / SecureStore adapter on React Native
const referrals = new ReferralClient({
  rpc: referralHttpRpc({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, // the public key, never the service-role key
    accessToken: async () => (await supabase.auth.getSession()).data.session?.access_token,
  }),
  // or: rpc: supabaseRpc(supabase)
  installIds: new StoredInstallIdStore({ secure: store }),
  onEvent: (e) => analytics.track(e.wireName, e.props),
  codeHashSalt: 'my-app',
});

if ((await referrals.availability()) !== 'available') hideInviteEntry();

const { code } = await referrals.myCode();
const copy = new ReferralCopy({ l10n: referralLocalizations('en'), terms: await referrals.terms() });
copy.shareText({ appName: 'Reader', code: code!, link: `https://reader.app/i/${code}` });

// Friend side: claims are kept offline and retried.
const queue = new PendingClaimQueue({ client: referrals, store });
const outcome = await queue.claim('ABCD-EFGH', { source: 'typed' });
copy.claimMessage(outcome.result!); // null for ok, else the sentence for the reason
```

### Demos and tests without a server

```ts
import { FakeReferralServer, fakeReferralClient } from '@myind/referral-core/testing';

const server = new FakeReferralServer({ latencyMs: 150 });
const client = fakeReferralClient(server);
server.aFriendSignsUp(); // "1 friend used your code"
server.aFriendStarts(); // your reward lands
```

## Attribution

Screens built on the kit show a small "Built with Myind" link by default; removing it is free (`showAttribution:
false` in the UI packages). The link config is `MYIND_ATTRIBUTION` / `attributionLink(variant, source)`.

## Links

- Site: https://www.myind.ai/referral-kit
- Showcase: https://www.myind.ai/referral-kit/showcase
- Flutter versions: [referral_kit](https://pub.dev/packages/referral_kit), [rewards_kit](https://pub.dev/packages/rewards_kit)
- GitHub: https://github.com/shaantanu9/referral-rewards-kit
- Rewards (streaks, quizzes, leagues): [`@myind/rewards-core`](../rewards-core)

MIT licensed.
