# Invite page

The page a shared link opens: `https://<your-site>/i/<CODE>` (ADR 12). Under 50 KB, shows the code with JavaScript
off when served by `render.ts`, `noindex`, no analytics, store buttons (the Play link carries the code in the install
referrer; the App Store button copies the code in the same tap), and a terms page built from your live rules.

## Files

| File | What |
|---|---|
| `index.html` | Template with `{{PLACEHOLDERS}}`. On a static host it also works alone: its script reads the code from the path |
| `render.ts` | `renderInvite`, `renderTerms`, `pickLang`, `normaliseCode`: pure functions for any Deno / Node 18+ host |
| `strings.ts` | Wording in en, hi, id |
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

Terms: export `referral_terms()` from the database to `terms.json` when the rules change, then
`renderTerms(terms, { minutes: (n) => `${n} min of <feature>`, entitlement_days: (n) => `${n} days of Premium` }, cfg)`.

Preview image (once per app, and per language if you translate it):

```sh
deno run --allow-write=. web/invite/og.ts --app "Example" --accent "#0f766e" --out og.svg
magick -density 96 og.svg og.png   # ImageMagick; rsvg-convert, Inkscape or a browser screenshot also work
```

Upload `og.png` and set `ogImageUrl` to its absolute https URL. Chat apps need PNG or JPEG, not SVG.
Options: `--headline` (default "You're invited to {app}"), `--subline`, `--background`, `--lang`.

Tests: `deno test web/invite/`.
