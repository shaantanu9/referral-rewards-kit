# Invite page

The page a shared link opens: `https://<your-site>/i/<CODE>` (ADR 12). Under 50 KB, shows the code with JavaScript
off when served by `render.ts`, `noindex`, no analytics, store buttons (the Play link carries the code in the install
referrer; the App Store button copies the code in the same tap), and a terms page built from your live rules.

## Files

| File | What |
|---|---|
| `index.html` | Template with `{{PLACEHOLDERS}}`. On a static host it also works alone: its script reads the code from the path |
| `render.ts` | `renderInvite`, `renderTerms`, `pickLang`, `normaliseCode`, `fetchInvitePreview`: for any Deno / Node 18+ host |
| `strings.ts` | Wording in en, hi, id (hi and id are **unreviewed**: a native speaker checks them before launch, preview lines included) |
| `og.ts` | The link preview image (`og:image`, 1200×630) for one app: name, invite line, colour. One per app and language, never per code |
| `well-known/apple-app-site-association` | Serve at `/.well-known/apple-app-site-association` (JSON, no extension, no redirect). Replace `TEAMID.com.example.app` |
| `well-known/assetlinks.json` | Serve at `/.well-known/assetlinks.json`. Use the **Play app-signing** SHA-256 from Play Console, not your upload key |

## Use

```ts
import { pickLang, renderInvite, renderTerms } from "./render.ts";
import { STRINGS } from "./strings.ts";

const cfg = { appName: "Example", appStoreUrl: "https://apps.apple.com/app/id000000000",
  playPackage: "com.example.app", siteUrl: "https://example.com", ogImageUrl: "https://example.com/og.png" };
const lang = pickLang(request.headers.get("accept-language"));
const html = renderInvite(template, cfg, STRINGS[lang], lang, codeFromPath);
```

## Invite preview: the sharer's name, the friend's reward, a boost (0.5)

With the preview the page leads with what the friend gets, and names the sharer when they asked for it:

> **Priya invited you to Example**
> Priya gets a reward if you join.
> You get 60 min of natural voice when you start using the app.
> Double rewards until Sun, 22 Nov

It comes from `public.referral_invite_preview(code)` (anon, read-only; growth design §4.3):
`{ valid, name, friend_rewards, sharer_rewarded, boost }`.

- **The name only appears when the sharer opted in** (the "show my first name" switch in the app). Otherwise `name`
  is null and the page says "Your friend". Codes of people who left the program, unknown or disabled codes all give
  `{ "valid": false }`, and the page is then the plain one (the code is still shown, so a mistyped link still works).
- **The disclosure sits next to the name** whenever the sharer is rewarded ("Priya gets a reward if you join.";
  without a name, "Your friend gets a reward if you join."), as the FTC Endorsement Guides ask.
- The name is cleaned (control and bidi characters removed, at most 40 characters), HTML-escaped and put in a `<bdi>`
  isolate. It is **never** in the `<title>`, the Open Graph / Twitter tags or the preview image: WhatsApp and other
  chat apps cache link previews, and a cached name would outlive the sharer's opt-out.
- The boost line shows the real last day ("Double rewards until Sun, 22 Nov", "3× rewards until …"), never a
  countdown, and only while the boost is running.
- Reward wording uses the same labels as the app (`rewardLabels`). A kind without a label in the page's language gives
  a neutral sentence ("You get a welcome reward when you start using the app."), never another language's label.
- No preview (an error, a 2 s timeout, no keys): the plain page, exactly as before.

### Config keys

| Key | What |
|---|---|
| `supabaseUrl` | `https://<ref>.supabase.co` |
| `anonKey` | The project's anon or publishable key (public by design). **Never** the service role key |
| `rewardLabels` | Per language and reward kind: `{ en: { minutes: { one: "{n} min of X", other: "{n} min of X" }, entitlement_days: { one: "{n} day of Premium", other: "{n} days of Premium" } } }` |
| `timeZone` | IANA zone for the boost date when rendered on the server (default `UTC`); in the browser the viewer's own zone is used |

### Server-rendered (recommended)

```ts
import { fetchInvitePreview, pickLang, renderInvite } from "./render.ts";

const preview = await fetchInvitePreview(cfg.supabaseUrl!, cfg.anonKey!, codeFromPath); // null on any problem
const html = renderInvite(template, cfg, STRINGS[lang], lang, codeFromPath, { preview });
```

Passing `preview` (even `null`) tells the page the server already asked, so the browser makes no request.

### Static host

Render the page once per language with no code and no preview (`renderInvite(template, cfg, STRINGS[lang], lang,
null)`) and upload it. When `supabaseUrl` and `anonKey` are set, the page's script calls the same RPC from the browser
(one `POST` to `/rest/v1/rpc/referral_invite_preview` with `{"code": "…"}`, 2 s timeout) and fills the lines with
`textContent` only. That request is the page's only network call; it sends the code to your own Supabase project and
nothing else, no analytics. Without the keys the page makes no request at all.

A language you add needs the `preview` block in its `Strings`; without it the page ignores the preview.

## Terms

Terms: export `referral_terms()` from the database to `terms.json` when the rules change, then
`renderTerms(terms, { minutes: (n) => `${n} min of <feature>`, entitlement_days: (n) => `${n} days of Premium` }, cfg)`.

Preview image (once per app, and per language if you translate it):

```sh
deno run --allow-write=. web/invite/og.ts --app "Example" --accent "#0f766e" --out og.svg
magick -density 96 og.svg og.png   # ImageMagick; rsvg-convert, Inkscape or a browser screenshot also work
```

Upload `og.png` and set `ogImageUrl` to its absolute https URL. Chat apps need PNG or JPEG, not SVG.
Options: `--headline` (default "You're invited to {app}"), `--subline`, `--background`, `--lang`.

Tests: `cd web/invite && deno test --allow-read=. .` (as CI runs them).
