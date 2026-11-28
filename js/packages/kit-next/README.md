# @myind/kit-next

[![Built with Myind](https://www.myind.ai/referral-kit/badge.svg)](https://www.myind.ai/referral-kit)

Next.js App Router helpers for [referral-kit](https://www.myind.ai/referral-kit): the referral RPC for server
components and route handlers, the invite landing at `/i/[code]` (the Flutter kit's `web/invite` page, ported) with its
metadata, the terms page, the invite link's OG image with `next/og`, and the "Built with Myind" link. The UI
components are in [`@myind/referral-react`](../referral-react).

Site: https://www.myind.ai/referral-kit · Showcase: https://www.myind.ai/referral-kit/showcase ·
GitHub: https://github.com/shaantanu9/referral-rewards-kit

## Install

```bash
npm install @myind/kit-next @myind/referral-react @myind/referral-core
```

`next` 15 or later, `react` and `react-dom` 18 or later are peer dependencies.

## Quick start

```ts
// app/invite-config.ts
import type { InviteConfig } from '@myind/kit-next';

export const inviteConfig: InviteConfig = {
  appName: 'Acme',
  appStoreUrl: 'https://apps.apple.com/app/id000000000',
  playPackage: 'com.acme.app',
  siteUrl: 'https://acme.app',
  ogImageUrl: 'https://acme.app/og/invite?lang=en',
  // Optional: the sharer's opted-in first name, the friend's reward and a boost on the page.
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, // public key only; a service key is never needed
};
```

```ts
// app/i/[code]/route.ts — the page a shared invite link opens
import { createInviteRoute } from '@myind/kit-next';
import { inviteConfig } from '../../invite-config';

export const { GET } = createInviteRoute({ config: inviteConfig });
```

```tsx
// app/og/invite/route.tsx — the link preview image (one per app and language)
import { createInviteOgRoute } from '@myind/kit-next/og';

export const { GET } = createInviteOgRoute({ appName: 'Acme', accent: '#0f766e' });
```

```js
// next.config.mjs — noindex on /i/*, JSON for the app-link files in public/.well-known/
import { withReferralKit } from '@myind/kit-next';

export default withReferralKit({ reactStrictMode: true });
```

## API

### Server RPC

| Export | What |
|---|---|
| `createReferralRpc({ supabaseUrl, anonKey, accessToken, timeoutMs?, fetch? })` | A `ReferralRpc` over PostgREST with the public key and the user's access token, `cache: 'no-store'`. Throws for a service-role or `sb_secret_` key |
| `createServerReferralClient({ …, installId, onEvent? })` | A `ReferralClient` for one request (server components, route handlers, server actions) |
| `isSecretSupabaseKey(key)` | True for a `service_role` JWT or an `sb_secret_…` key |

```ts
const client = createServerReferralClient({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  accessToken: session?.access_token,
  installId: (await cookies()).get('rk_install_id')?.value ?? '',
});
const { code } = await client.myCode();
```

### Invite landing

| Export | What |
|---|---|
| `createInviteRoute({ config, strings?, template?, serverPreview?, lang?, cacheSeconds?, fetch?, now? })` | `{ GET }` for `app/i/[code]/route.ts`. Server-rendered (the code shows with JavaScript off), `noindex, nofollow`, canonical, Open Graph and Twitter tags, store buttons (the Play link carries the code in the install referrer; the App Store button copies the code in the same tap), terms link, the preview when configured. A bad code gives the "link is not complete" page, never an error and never the raw input |
| `createTermsRoute({ config, terms, labels?, cacheSeconds? })` | `{ GET }` for the program terms, generated from the live rules |
| `inviteMetadata({ config, code, lang? \| acceptLanguage? })` | `generateMetadata` for a page-based invite (`app/i/[code]/page.tsx`): title, description, `robots: noindex, nofollow`, canonical, OG and Twitter image. Never the sharer's name |
| `invitePageModel(opts)` / `loadInvitePageModel(opts)` | The page's lines as text segments (the name segment for a `<bdi>`), the code, store and terms links, for your own React page; `load…` fetches the preview first |
| `inviteCodeFromPath(path, prefix?)`, `inviteCodeFromParams(params)`, `inviteCodeFromUrl(url)` | The normalised code from `/i/ABCD-EFGH`, `params.code`, `?code=` or `?referrer=code%3D…`; null when malformed |
| `renderInvite`, `renderTerms`, `pickLang`, `fetchInvitePreview`, `parsePreview`, `normaliseCode`, `INVITE_TEMPLATE`, `INVITE_STRINGS`, … | The pure functions of the port, for other hosts |

Wording ships in English, Hindi and Indonesian (Hindi and Indonesian await a native speaker's review); pass `strings`
for your own voice or more languages. The template is `web/invite/index.html` (`pnpm gen:template` copies it; a test
keeps them equal).

### OG image (`@myind/kit-next/og`)

| Export | What |
|---|---|
| `inviteOgImage({ appName, headline?, subline?, accent?, background?, lang? }, init?)` | An `ImageResponse` (1200×630) |
| `createInviteOgRoute({ appName, accent?, background?, texts?, cacheSeconds? })` | `{ GET }`; `?lang=hi` or the Accept-Language header picks `texts[lang]` |
| `inviteOgModel(opts)`, `renderOgSvg(opts)` | The shared layout, and a static SVG (also exported from the main entry) |

Never one image per code and never the sharer's name: chat apps cache link previews.

### Config

| Export | What |
|---|---|
| `withReferralKit(nextConfig, { invitePath?, wellKnown? })` | Adds `X-Robots-Tag: noindex, nofollow` on the invite route and `Content-Type: application/json` for `/.well-known/apple-app-site-association` and `assetlinks.json`, keeping your `headers()` |

## Attribution

`@myind/kit-next/attribution` re-exports `<MyindAttribution>` from `@myind/referral-react` (a client component you can
place in a server component's tree) and the link data (`attributionLink`). `InviteHub` and `InviteFriendsScreen` show it
by default; `showAttribution={false}` hides it. It is a real link to https://www.myind.ai/referral-kit with UTM tags,
free to remove, and nothing is sent at runtime. Apps that keep it can be listed on the
[showcase](https://www.myind.ai/referral-kit/showcase).

```tsx
import { MyindAttribution } from '@myind/kit-next/attribution';

<footer>
  <MyindAttribution source="acme-web" />
</footer>
```

## Demo

[`js/examples/next-demo`](../../examples/next-demo): every component and these routes on a fake server.

## License

MIT. See [LICENSE](LICENSE).
