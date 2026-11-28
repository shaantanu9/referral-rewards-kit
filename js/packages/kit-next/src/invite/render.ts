/**
 * Server-side rendering of the invite page and the terms page (ADR 12, 11.1): a port of `web/invite/render.ts` for
 * Next.js. Pure functions, no dependencies, so the page shows the code with JavaScript off. Keep in step with
 * `web/invite/render.ts` (the tests in `test/render.test.ts` are ported from `web/invite/render_test.ts`).
 */

export interface InviteConfig {
  appName: string;
  /** https://apps.apple.com/app/id… */
  appStoreUrl: string;
  /** com.example.app */
  playPackage: string;
  /** https://example.com (no trailing slash) */
  siteUrl: string;
  /** Absolute URL of a 1200×630 image (e.g. the OG route of this package). */
  ogImageUrl: string;
  /** Default /terms */
  termsPath?: string;
  /**
   * Invite preview (growth design §6, ADR 12): the sharer's first name (only when they opted in), the friend's reward
   * and a running boost. Leave both out and the page never calls anything. Never the service role key.
   */
  supabaseUrl?: string;
  anonKey?: string;
  /** Wording per language and reward kind: `{ en: { minutes: { one: '{n} min of X', other: '{n} min of X' } } }`. */
  rewardLabels?: Partial<Record<Lang, Record<string, PluralLabel>>>;
  /** IANA zone for the boost's end date when rendered on the server, default UTC. */
  timeZone?: string;
}

/** "{n}" is replaced with the amount, formatted for the page's language. */
export interface PluralLabel {
  one: string;
  other: string;
}

export type Lang = 'en' | 'hi' | 'id';

export interface Strings {
  title: string;
  lead: string;
  copy: string;
  copied: string;
  appStore: string;
  appStoreNote: string;
  googlePlay: string;
  playNote: string;
  terms: string;
  invalid: string;
  /** Without it the page ignores any preview. */
  preview?: PreviewStrings;
}

/** Lines shown from referral_invite_preview. "{name}", "{app}", "{reward}", "{date}", "{n}" are filled in. */
export interface PreviewStrings {
  invitedBy: string;
  /** Next to the name (FTC 16 CFR 255.5). */
  disclosure: string;
  disclosureAnon: string;
  leadNamed: string;
  friendReward: string;
  friendRewardNeutral: string;
  boostDouble: string;
  boostTimes: string;
}

export interface PreviewReward {
  kind: string;
  amount: number;
  params?: Record<string, unknown> | undefined;
}

/** The JSON of public.referral_invite_preview(code) (growth design §4.3). */
export type InvitePreview =
  | {
      valid: true;
      name: string | null;
      friend_rewards: PreviewReward[];
      sharer_rewarded: boolean;
      boost: { ends_at: string; multiplier: number } | null;
    }
  | { valid: false };

// The code alphabet of the kit (ADR 11.7): 8 characters, no O, 0, I, 1, L.
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/;

/** Same normalisation as the database's referral.normalise_code, for codes taken from a URL. */
export function normaliseCode(input: string): string {
  // Width folding (NFKC) first, so a full-width hyphen becomes "-" and is removed; then the explicit removal list
  // (never locale-dependent); then digits. Same order as the database (migration 9) and the Flutter package.
  return input
    .normalize('NFKC')
    .replace(
      /[\u0009-\u000D\u0020\u00A0\u00AD\u061C\u1680\u180E\u2000-\u200F\u2010-\u2015\u2028\u2029\u202A-\u202F\u205F\u2060-\u206F\u2212\u3000\uFEFF-]/g,
      '',
    )
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .toUpperCase();
}

export function validCode(code: string): boolean {
  return CODE_RE.test(code);
}

/** Shown as ABCD-EFGH. */
export function displayCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** First supported language in an Accept-Language header, else English. */
export function pickLang(acceptLanguage: string | null | undefined, supported: Lang[] = ['en', 'hi', 'id']): Lang {
  if (!acceptLanguage) return 'en';
  const ranked = acceptLanguage
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { lang: (tag ?? '').toLowerCase().split('-')[0] ?? '', q: q ? Number(q.slice(2)) || 0 : 1, i };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const r of ranked) if ((supported as string[]).includes(r.lang)) return r.lang as Lang;
  return 'en';
}

const htmlEscapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => htmlEscapes[c] ?? c);
}

function fill(s: string, app: string): string {
  return s.replaceAll('{app}', app);
}

/** The Play link carries the code in the install referrer (ADR 4.2), read once by the app. */
export function playUrl(cfg: Pick<InviteConfig, 'playPackage'>, code: string | null): string {
  const base = `https://play.google.com/store/apps/details?id=${encodeURIComponent(cfg.playPackage)}`;
  return code ? `${base}&referrer=${encodeURIComponent(`code=${code}`)}` : base;
}

/**
 * A name typed by a user, made safe to show: control, bidi and line-separator characters removed (a U+202E override
 * could reorder the sentence around it), whitespace collapsed, at most 40 characters. "" when nothing is left. The
 * caller still escapes it and puts it in a bidi isolate.
 */
export function cleanName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[\t\n\v\f\r\u0085\u2028\u2029]/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u2028\u2029\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...cleaned].slice(0, 40).join('').trim();
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object';

/** The preview JSON checked field by field; anything malformed is null, so the page falls back to the plain one. */
export function parsePreview(x: unknown): InvitePreview | null {
  if (!isObj(x)) return null;
  if (x['valid'] === false) return { valid: false };
  if (x['valid'] !== true) return null;
  const rewards = Array.isArray(x['friend_rewards']) ? (x['friend_rewards'] as unknown[]) : [];
  const friend_rewards: PreviewReward[] = [];
  for (const r of rewards) {
    if (!isObj(r)) continue;
    const kind = r['kind'],
      amount = r['amount'];
    if (typeof kind !== 'string' || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) continue;
    friend_rewards.push({ kind, amount, params: r['params'] as Record<string, unknown> | undefined });
  }
  const b = x['boost'];
  const boost =
    isObj(b) &&
    typeof b['ends_at'] === 'string' &&
    !isNaN(Date.parse(b['ends_at'])) &&
    typeof b['multiplier'] === 'number' &&
    b['multiplier'] > 1 &&
    b['multiplier'] <= 5
      ? { ends_at: b['ends_at'], multiplier: b['multiplier'] }
      : null;
  const name = typeof x['name'] === 'string' ? cleanName(x['name']) || null : null;
  return { valid: true, name, friend_rewards, sharer_rewarded: x['sharer_rewarded'] === true, boost };
}

/**
 * Calls public.referral_invite_preview on the server (anon role). Null on any problem: no config, a bad code, an HTTP
 * error, a timeout (2 s by default) or malformed JSON. The page must render without it.
 */
export async function fetchInvitePreview(
  supabaseUrl: string | null | undefined,
  anonKey: string | null | undefined,
  code: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2000,
): Promise<InvitePreview | null> {
  const c = normaliseCode(code);
  if (!supabaseUrl || !anonKey || !validCode(c)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json', apikey: anonKey };
    // A legacy anon key is a JWT and goes in Authorization too; a new publishable key (sb_publishable_…) does not.
    if (anonKey.startsWith('eyJ')) headers['authorization'] = `Bearer ${anonKey}`;
    const res = await fetchImpl(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/referral_invite_preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: c }),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    return parsePreview(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const LOCALES: Record<Lang, string> = { en: 'en-GB', hi: 'hi-IN', id: 'id-ID' };
export const langLocale = (lang: Lang): string => LOCALES[lang] ?? lang;

/** "60 min of X" from the app's labels, or null when a kind has no label in this language. */
export function rewardText(
  rewards: { kind: string; amount: number }[],
  labels: Record<string, PluralLabel> | undefined,
  lang: Lang,
): string | null {
  if (!rewards.length || !labels) return null;
  const plural = new Intl.PluralRules(langLocale(lang));
  const num = new Intl.NumberFormat(langLocale(lang));
  const parts: string[] = [];
  for (const r of rewards) {
    const l = Object.hasOwn(labels, r.kind) ? labels[r.kind] : undefined;
    if (!l) return null;
    parts.push((plural.select(r.amount) === 'one' ? l.one : l.other).replaceAll('{n}', num.format(r.amount)));
  }
  return new Intl.ListFormat(langLocale(lang), { type: 'conjunction' }).format(parts);
}

/** "Sun, 22 Nov": the last day the boost runs (ends_at is exclusive), in the given zone. Same as the app's banner. */
export function boostDate(endsAt: string, lang: Lang, timeZone = 'UTC'): string {
  const last = new Date(Date.parse(endsAt) - 1);
  const f = new Intl.DateTimeFormat(langLocale(lang), { weekday: 'short', day: 'numeric', month: 'short', timeZone });
  if (lang !== 'en') return f.format(last);
  const part = (t: string): string => f.formatToParts(last).find((x) => x.type === t)?.value ?? '';
  return `${part('weekday')}, ${part('day')} ${part('month')}`;
}

/** A line of the invite preview as text segments; the `name` segment goes in a bidi isolate (`<bdi>`). */
export type PreviewSegment = { readonly text: string; readonly name?: true };

const placeholder = /\{(name|app|reward|date|n)\}/g;

/** Fills {name} and the other placeholders into text segments (no HTML). */
export function fillSegments(template: string, vars: Record<string, string>): PreviewSegment[] {
  const out: PreviewSegment[] = [];
  let last = 0;
  for (const m of template.matchAll(placeholder)) {
    const k = m[1]!;
    const at = m.index ?? 0;
    if (at > last) out.push({ text: template.slice(last, at) });
    const v = vars[k];
    if (v === undefined) out.push({ text: m[0] });
    else out.push(k === 'name' ? { text: v, name: true } : { text: v });
    last = at + m[0].length;
  }
  if (last < template.length) out.push({ text: template.slice(last) });
  return out;
}

/** Segments as HTML: escaped, the name in `<bdi>`. */
export function segmentsHtml(segs: readonly PreviewSegment[]): string {
  return segs.map((s) => (s.name ? `<bdi>${escapeHtml(s.text)}</bdi>` : escapeHtml(s.text))).join('');
}

/** Segments as plain text (for metadata). */
export const segmentsText = (segs: readonly PreviewSegment[]): string => segs.map((s) => s.text).join('');

/** The preview's lines for one page (each null when not shown). */
export interface PreviewLines {
  headline: PreviewSegment[] | null;
  disclosure: PreviewSegment[] | null;
  reward: PreviewSegment[] | null;
  boost: PreviewSegment[] | null;
  lead: PreviewSegment[] | null;
}

export function previewLines(
  p: InvitePreview | null,
  cfg: InviteConfig,
  s: Strings,
  lang: Lang,
  now: Date,
): PreviewLines {
  const out: PreviewLines = { headline: null, disclosure: null, reward: null, boost: null, lead: null };
  const ps = s.preview;
  if (!ps || !p || !p.valid) return out;
  const app = cfg.appName;
  if (p.name) {
    out.headline = fillSegments(ps.invitedBy, { name: p.name, app });
    out.lead = fillSegments(ps.leadNamed, { app });
  }
  if (p.sharer_rewarded) {
    out.disclosure = p.name
      ? fillSegments(ps.disclosure, { name: p.name, app })
      : fillSegments(ps.disclosureAnon, { app });
  }
  if (p.friend_rewards.length) {
    const r = rewardText(p.friend_rewards, cfg.rewardLabels?.[lang], lang);
    out.reward = r === null ? fillSegments(ps.friendRewardNeutral, { app }) : fillSegments(ps.friendReward, { reward: r, app });
  }
  if (p.boost && Date.parse(p.boost.ends_at) > now.getTime()) {
    const date = boostDate(p.boost.ends_at, lang, cfg.timeZone ?? 'UTC');
    const m = p.boost.multiplier;
    out.boost =
      m === 2
        ? fillSegments(ps.boostDouble, { date })
        : fillSegments(ps.boostTimes, { date, n: new Intl.NumberFormat(langLocale(lang)).format(m) });
  }
  return out;
}

/** JSON for a <script type="application/json"> block: nothing in it can close the script or start a comment. */
export function scriptJson(x: unknown): string {
  return JSON.stringify(x)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export interface RenderOptions {
  /** The referral_invite_preview JSON for this code, fetched on the server ([fetchInvitePreview]). */
  preview?: InvitePreview | null;
  now?: Date;
}

/**
 * The invite page from [template] (the `{{PLACEHOLDER}}` HTML, `INVITE_TEMPLATE`). `rawCode` null (or invalid)
 * renders the page without a code and with the `invalid` line, never an error page, and never echoes the raw input.
 * With a valid `preview` it adds the sharer's name (when they opted in) with the reward disclosure, the friend's reward
 * and a running boost. The title and Open Graph tags never carry the name: chat apps cache link previews.
 */
export function renderInvite(
  template: string,
  cfg: InviteConfig,
  s: Strings,
  lang: Lang,
  rawCode: string | null,
  opts: RenderOptions = {},
): string {
  const code = rawCode === null ? null : normaliseCode(rawCode);
  const ok = code !== null && validCode(code);
  const app = escapeHtml(cfg.appName);
  const preview = ok ? parsePreview(opts.preview) : null;
  const pl = previewLines(preview, cfg, s, lang, opts.now ?? new Date());
  const html = (segs: PreviewSegment[] | null): string | null => (segs ? segmentsHtml(segs) : null);
  // The browser fetches the preview itself only on a static host: no preview given here and the keys configured.
  const browserFetch = opts.preview === undefined && !!cfg.supabaseUrl && !!cfg.anonKey && !!s.preview;
  const data = browserFetch
    ? {
        url: cfg.supabaseUrl!.replace(/\/+$/, '') + '/rest/v1/rpc/referral_invite_preview',
        key: cfg.anonKey,
        lang,
        locale: langLocale(lang),
        app: cfg.appName,
        s: s.preview,
        labels: cfg.rewardLabels?.[lang] ?? {},
      }
    : {};
  const title = escapeHtml(fill(s.title, cfg.appName));
  const disclosure = html(pl.disclosure),
    reward = html(pl.reward),
    boost = html(pl.boost);
  const v: Record<string, string> = {
    LANG: lang,
    TITLE: title,
    HEADLINE: html(pl.headline) ?? title,
    DISCLOSURE: disclosure ?? '',
    DISCLOSURE_HIDDEN: disclosure ? '' : 'hidden',
    REWARD: reward ?? '',
    REWARD_HIDDEN: reward ? '' : 'hidden',
    BOOST: boost ?? '',
    BOOST_HIDDEN: boost ? '' : 'hidden',
    LEAD: html(pl.lead) ?? escapeHtml(fill(ok ? s.lead : s.invalid, cfg.appName)),
    LEAD_OK: escapeHtml(fill(s.lead, cfg.appName)),
    OG_DESCRIPTION: escapeHtml(fill(ok ? s.lead : s.invalid, cfg.appName)),
    PREVIEW_DATA: scriptJson(data),
    CODE: ok ? escapeHtml(code) : '',
    CODE_DISPLAY: ok ? escapeHtml(displayCode(code)) : '',
    CODE_SPOKEN: ok ? escapeHtml(code.split('').join(' ')) : '',
    CODE_HIDDEN: ok ? '' : 'hidden',
    COPY: escapeHtml(s.copy),
    COPIED: escapeHtml(s.copied),
    APP_STORE: escapeHtml(s.appStore),
    APP_STORE_NOTE: escapeHtml(s.appStoreNote),
    APP_STORE_URL: escapeHtml(cfg.appStoreUrl),
    GOOGLE_PLAY: escapeHtml(s.googlePlay),
    PLAY_NOTE: escapeHtml(s.playNote),
    PLAY_URL: escapeHtml(playUrl(cfg, ok ? code : null)),
    TERMS: escapeHtml(s.terms),
    TERMS_URL: escapeHtml(cfg.siteUrl + (cfg.termsPath ?? '/terms')),
    CANONICAL: escapeHtml(cfg.siteUrl + '/i/' + (ok ? code : '')),
    OG_IMAGE: escapeHtml(cfg.ogImageUrl),
    APP: app,
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => v[k] ?? m);
}

// ---------------------------------------------------------------------------------------------------------------
// Terms page, generated from the database's referral_terms() export (ADR 11.1)
// ---------------------------------------------------------------------------------------------------------------

export interface Terms {
  enabled: boolean;
  paid_enabled: boolean;
  rules: {
    event: 'joined' | 'paid';
    who: 'sharer' | 'friend';
    kind: string;
    amount: number;
    params?: Record<string, unknown>;
  }[];
  claim_window_days: number;
  activate_window_days: number;
  paid_window_days: number;
  hold_hours: number;
  sharer_joins_per_30d: number;
  sharer_paid_per_365d: number;
}

/** App-supplied wording per reward kind, e.g. `{ minutes: (n) => `${n} min of natural voice` }`. */
export type TermsRewardLabels = Record<string, (amount: number, params?: Record<string, unknown>) => string>;

export function termsLines(t: Terms, labels: TermsRewardLabels, appName: string): string[] {
  const label = (r: Terms['rules'][number]): string =>
    (labels[r.kind] ?? ((n: number) => `${n} ${r.kind}`))(r.amount, r.params);
  const find = (event: string, who: string): Terms['rules'][number] | undefined =>
    t.rules.find((r) => r.event === event && r.who === who);
  const lines: string[] = [];
  if (!t.enabled) lines.push('Invites are paused right now. Rewards already earned are kept.');
  const js = find('joined', 'sharer'),
    jf = find('joined', 'friend'),
    ps = find('paid', 'sharer');
  if (js && jf) {
    lines.push(`When a friend you invited signs up and starts using ${appName}, you get ${label(js)} and they get ${label(jf)}.`);
  } else if (js) {
    lines.push(`When a friend you invited signs up and starts using ${appName}, you get ${label(js)}.`);
  } else if (jf) {
    lines.push(`A friend who signs up with your code and starts using ${appName} gets ${label(jf)}.`);
  }
  if (ps && t.paid_enabled) {
    lines.push(
      `When a friend you invited subscribes (after any free trial) within ${t.paid_window_days} days of using your code, you get ${label(ps)}. ` +
        `It is added about ${Math.round(t.hold_hours / 24)} days after their payment, once it can no longer be refunded. ` +
        `If you already subscribe, it is added when your current plan ends.`,
    );
  }
  lines.push(
    `A code can be added in the first ${t.claim_window_days} days after signing up, and the friend must start using ${appName} within ${t.activate_window_days} days.`,
    `Up to ${t.sharer_joins_per_30d} friends a month and ${t.sharer_paid_per_365d} subscriptions a year earn you a reward.`,
    'Each person and each phone can use one code once. Your own code, or a second account on the same phone, does not count.',
    'Rewards have no cash value, cannot be exchanged, and codes cannot be sold or bought.',
    'Codes that are misused (for example refunds after a reward) can be paused for review.',
    `The program can change or end at any time; rewards already earned or waiting are not affected.`,
  );
  return lines;
}

export function renderTerms(t: Terms, labels: TermsRewardLabels, cfg: Pick<InviteConfig, 'appName'>, lang: Lang = 'en'): string {
  const items = termsLines(t, labels, cfg.appName)
    .map((l) => `<li>${escapeHtml(l)}</li>`)
    .join('\n      ');
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(cfg.appName)}: invite program terms</title>
  <style>
    :root { color-scheme: light dark; --fg: #1b1b1f; --bg: #fafafa; }
    @media (prefers-color-scheme: dark) { :root { --fg: #ececf1; --bg: #121214; } }
    body { margin: 0; padding: 24px 16px; font: 16px/1.55 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
    main { max-width: 640px; margin: 0 auto; } li { margin: 0 0 12px; }
  </style>
</head>
<body>
  <main>
    <h1>Invite program terms</h1>
    <ul>
      ${items}
    </ul>
  </main>
</body>
</html>
`;
}
