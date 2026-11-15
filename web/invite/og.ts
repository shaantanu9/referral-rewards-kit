// The invite link's preview image (og:image, 1200×630) for one app: its name, an invite line and its colour.
// One static image per app and language, never one per code (a code in a preview image would be cached and shared by
// chat apps). Pure function + a small CLI; turn the SVG into the PNG that chat apps need with any SVG renderer, e.g.
//   deno run --allow-write=. web/invite/og.ts --app "Example" --accent "#0f766e" --out og.svg
//   magick -density 96 og.svg og.png        (ImageMagick; or rsvg-convert, Inkscape, a browser screenshot)
// then upload og.png and set `ogImageUrl` in the invite config to its absolute https URL.

export interface OgOptions {
  appName: string;
  headline?: string; // default "You're invited to {app}"
  subline?: string; // default "Use your friend's code when you sign up"
  accent?: string; // #rgb or #rrggbb, default #0f766e
  background?: string; // #rgb or #rrggbb, default #f6f7f9
  lang?: string; // the SVG's xml:lang, default en
}

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(
    /"/g,
    "&quot;",
  ).replace(/'/g, "&#39;");

/** A colour the SVG can safely carry, or the default. */
export function safeColour(c: string | undefined, fallback: string): string {
  return c && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : fallback;
}

/** Black or white text on that colour, whichever is readable (WCAG relative luminance). */
export function textOn(hex: string): "#ffffff" | "#16181d" {
  const h = hex.length === 4
    ? hex.slice(1).split("").map((x) => x + x).join("")
    : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05) / (l + 0.05) >= (l + 0.05) / 0.05 ? "#ffffff" : "#16181d";
}

/** Splits text into at most `maxLines` lines of about `perLine` characters, on spaces; the last line gets "…". */
export function wrap(
  text: string,
  perLine: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if ([...next].length <= perLine || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines.map((l) => cut(l, perLine));
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = cut(
    `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`,
    perLine - 1,
    true,
  );
  return kept;
}

function cut(s: string, n: number, force = false): string {
  const cs = [...s];
  return cs.length > n || force ? `${cs.slice(0, n).join("").trimEnd()}…` : s;
}

/** The SVG text. Every value is escaped; long names and lines shrink and wrap so nothing leaves the frame. */
export function renderOgSvg(o: OgOptions): string {
  const app = o.appName.trim() || "App";
  const accent = safeColour(o.accent, "#0f766e");
  const bg = safeColour(o.background, "#f6f7f9");
  const ink = textOn(bg);
  const muted = ink === "#ffffff" ? "#d4d7dd" : "#5d6470";
  const headline = (o.headline ?? "You're invited to {app}").replaceAll(
    "{app}",
    app,
  );
  const subline = (o.subline ?? "Use your friend's code when you sign up")
    .replaceAll("{app}", app);
  const big = [...headline].length > 40 ? 64 : 76;
  const lines = wrap(headline, big === 76 ? 22 : 28, 3);
  const top = 250 - (lines.length - 1) * (big * 0.55);
  const initial = [...app][0].toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" xml:lang="${
    esc(o.lang ?? "en")
  }">
<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${bg}"/>
<rect x="0" y="0" width="${OG_WIDTH}" height="14" fill="${accent}"/>
<rect x="80" y="80" width="96" height="96" rx="24" fill="${accent}"/>
<text x="128" y="146" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="56" font-weight="700" fill="${
    textOn(accent)
  }">${esc(initial)}</text>
<text x="200" y="142" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="40" font-weight="600" fill="${ink}">${
    esc(cut(app, 32))
  }</text>
${
    lines.map((l, i) =>
      `<text x="80" y="${
        Math.round(top + big + i * big * 1.15)
      }" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="${big}" font-weight="800" fill="${ink}">${
        esc(l)
      }</text>`
    ).join("\n")
  }
<text x="80" y="540" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="34" fill="${muted}">${
    esc(wrap(subline, 56, 1)[0] ?? "")
  }</text>
</svg>
`;
}

if (import.meta.main) {
  const args = Deno.args;
  const get = (k: string) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const appName = get("app");
  if (!appName) {
    console.error(
      'usage: og.ts --app "Name" [--headline …] [--subline …] [--accent #hex] [--background #hex] [--lang en] [--out og.svg]',
    );
    Deno.exit(2);
  }
  const svg = renderOgSvg({
    appName,
    headline: get("headline"),
    subline: get("subline"),
    accent: get("accent"),
    background: get("background"),
    lang: get("lang"),
  });
  const out = get("out");
  if (out) Deno.writeTextFileSync(out, svg);
  else console.log(svg);
}
