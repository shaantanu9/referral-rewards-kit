/**
 * The invite link's preview image (og:image, 1200×630) for one app: its name, an invite line and its colour. A port
 * of `web/invite/og.ts`. One image per app and language, never one per code (a code in a preview image would be
 * cached and shared by chat apps), and never the sharer's name (WhatsApp caches link previews). [inviteOgModel] is the
 * layout both renderers share: [renderOgSvg] (a static SVG) and `inviteOgImage` (`next/og`, in `@myind/kit-next/og`).
 */

export interface OgOptions {
  appName: string;
  /** Default "You're invited to {app}". */
  headline?: string;
  /** Default "Use your friend's code when you sign up". */
  subline?: string;
  /** #rgb or #rrggbb, default #0f766e. */
  accent?: string;
  /** #rgb or #rrggbb, default #f6f7f9. */
  background?: string;
  /** The SVG's xml:lang, default en. */
  lang?: string;
}

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** A colour the image can safely carry, or the default. */
export function safeColour(c: string | undefined | null, fallback: string): string {
  return c && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : fallback;
}

/** Black or white text on that colour, whichever is readable (WCAG relative luminance). */
export function textOn(hex: string): '#ffffff' | '#16181d' {
  const h = hex.length === 4 ? hex.slice(1).split('').map((x) => x + x).join('') : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#ffffff' : '#16181d';
}

/** Splits text into at most `maxLines` lines of about `perLine` characters, on spaces; the last line gets "…". */
export function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
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
  kept[maxLines - 1] = cut(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, perLine - 1, true);
  return kept;
}

function cut(s: string, n: number, force = false): string {
  const cs = [...s];
  return cs.length > n || force ? `${cs.slice(0, n).join('').trimEnd()}…` : s;
}

/** The image's layout: colours, the initial in the badge, the wrapped headline and its baselines. */
export interface OgModel {
  readonly app: string;
  /** The app name as shown next to the badge (cut at 32 characters). */
  readonly appLabel: string;
  readonly initial: string;
  readonly accent: string;
  readonly onAccent: '#ffffff' | '#16181d';
  readonly background: string;
  readonly ink: '#ffffff' | '#16181d';
  readonly muted: string;
  readonly headlineSize: 64 | 76;
  readonly headlineLines: readonly string[];
  /** The SVG baseline (y) of each headline line. */
  readonly headlineBaselines: readonly number[];
  readonly subline: string;
  readonly lang: string;
}

export function inviteOgModel(o: OgOptions): OgModel {
  const app = o.appName.trim() || 'App';
  const accent = safeColour(o.accent, '#0f766e');
  const bg = safeColour(o.background, '#f6f7f9');
  const ink = textOn(bg);
  const muted = ink === '#ffffff' ? '#d4d7dd' : '#5d6470';
  const headline = (o.headline ?? "You're invited to {app}").replaceAll('{app}', app);
  const subline = (o.subline ?? "Use your friend's code when you sign up").replaceAll('{app}', app);
  const big: 64 | 76 = [...headline].length > 40 ? 64 : 76;
  const lines = wrap(headline, big === 76 ? 22 : 28, 3);
  const top = 250 - (lines.length - 1) * (big * 0.55);
  return {
    app,
    appLabel: cut(app, 32),
    initial: ([...app][0] ?? 'A').toUpperCase(),
    accent,
    onAccent: textOn(accent),
    background: bg,
    ink,
    muted,
    headlineSize: big,
    headlineLines: lines,
    headlineBaselines: lines.map((_, i) => Math.round(top + big + i * big * 1.15)),
    subline: wrap(subline, 56, 1)[0] ?? '',
    lang: o.lang ?? 'en',
  };
}

const font = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

/** The SVG text. Every value is escaped; long names and lines shrink and wrap so nothing leaves the frame. */
export function renderOgSvg(o: OgOptions): string {
  const m = inviteOgModel(o);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" xml:lang="${esc(m.lang)}">
<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${m.background}"/>
<rect x="0" y="0" width="${OG_WIDTH}" height="14" fill="${m.accent}"/>
<rect x="80" y="80" width="96" height="96" rx="24" fill="${m.accent}"/>
<text x="128" y="146" text-anchor="middle" font-family="${font}" font-size="56" font-weight="700" fill="${m.onAccent}">${esc(m.initial)}</text>
<text x="200" y="142" font-family="${font}" font-size="40" font-weight="600" fill="${m.ink}">${esc(m.appLabel)}</text>
${m.headlineLines
  .map(
    (l, i) =>
      `<text x="80" y="${m.headlineBaselines[i]}" font-family="${font}" font-size="${m.headlineSize}" font-weight="800" fill="${m.ink}">${esc(l)}</text>`,
  )
  .join('\n')}
<text x="80" y="540" font-family="${font}" font-size="34" fill="${m.muted}">${esc(m.subline)}</text>
</svg>
`;
}
