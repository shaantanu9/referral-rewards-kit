# next-demo (private)

[![Built with Myind](https://www.myind.ai/referral-kit/badge.svg)](https://www.myind.ai/referral-kit)

A Next.js App Router app that shows every [`@myind/referral-react`](../../packages/referral-react) component and the
[`@myind/kit-next`](../../packages/kit-next) routes on a **fake referral server** (`FakeReferralServer` from
`@myind/referral-core/testing`). No Supabase, no real users, nothing is sent anywhere. Not published.

| Route | What |
|---|---|
| `/` | Every component, one fake server per state (hub, paused, no invite page, not deployed, signed out, left, last day, window over, link code, rate limited, invite page settings, reward cards, welcome cards, primitives); language and theme switches; story buttons for the hub |
| `/i/<CODE>` | The invite landing (`createInviteRoute`) |
| `/join/<CODE>` | The same as a React page with `inviteMetadata` and `invitePageModel` |
| `/og/invite?lang=en` | The invite OG image (`next/og`) |
| `/terms` | The program terms page |

## Run

From `js/`, after `pnpm install`:

```bash
pnpm -r build                                   # builds the packages, then this app
cd examples/next-demo
~/.claude/skills/nextjs-solo-server/next-solo.sh start --prod --port 3000   # or: pnpm start
```

Set `NEXT_PUBLIC_SITE_URL` when it is served somewhere other than `http://localhost:3000` (the invite page's canonical
and OG URLs use it).
