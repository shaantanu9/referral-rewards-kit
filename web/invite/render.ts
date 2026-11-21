// Server-side rendering of the invite page and the terms page (ADR 12, 11.1). Pure functions, no dependencies:
// any host that runs Deno or Node 18+ (Supabase Edge Functions, Vercel, Netlify, a tiny server) can call them for
// `/i/<CODE>` and `/terms`, so the page shows the code with JavaScript off. A static host can instead serve
// `index.html` with the built-in script, which reads the code from the path.

export interface InviteConfig {
  appName: string;
  appStoreUrl: string; // https://apps.apple.com/app/id…
  playPackage: string; // com.example.app
  siteUrl: string; // https://example.com (no trailing slash)
  ogImageUrl: string; // absolute URL of a 1200×630 image
  termsPath?: string; // default /terms
  // Invite preview (growth design §6, ADR 12): the sharer's first name (only when they opted in), the friend's reward
  // and a running boost. Leave both out and the page never calls anything.
  supabaseUrl?: string; // https://<ref>.supabase.co, used by fetchInvitePreview and by index.html on a static host
  anonKey?: string; // the project's anon / publishable key (public by design; never the service role key)
  // Wording per language and reward kind, the same labels the app uses: { en: { minutes: { one: "{n} min of X",
  // other: "{n} min of X" } } }. A kind without a label in the page's language gives a neutral sentence instead.
  rewardLabels?: Partial<Record<Lang, Record<string, PluralLabel>>>;
  timeZone?: string; // IANA zone for the boost's end date when rendered on the server, default UTC
}

/** "{n}" is replaced with the amount, formatted for the page's language. */
export interface PluralLabel {
  one: string;
  other: string;
}

export type Lang = "en" | "hi" | "id";

export interface Strings {
  title: string; // "{app}: you're invited"
  lead: string; // "Your friend invited you to {app}. Use this code when you sign up:"
  copy: string;
  copied: string;
  appStore: string;
  appStoreNote: string; // "Tapping this copies the code. Paste it in the app after installing."
  googlePlay: string;
  playNote: string; // "On Android the code is filled in for you."
  terms: string;
  invalid: string; // "This invite link is not complete. Ask your friend for their code."
  preview?: PreviewStrings; // without it the page ignores any preview (languages added before 0.5 keep working)
}

/** Lines shown from referral_invite_preview. "{name}", "{app}", "{reward}", "{date}", "{n}" are filled in. */
export interface PreviewStrings {
  invitedBy: string; // "{name} invited you to {app}"
  disclosure: string; // "{name} gets a reward if you join." (FTC 16 CFR 255.5: next to the name)
  disclosureAnon: string; // "Your friend gets a reward if you join."
  leadNamed: string; // "Add this code when you sign up:"
  friendReward: string; // "You get {reward} when you start using the app."
  friendRewardNeutral: string; // "You get a welcome reward when you start using the app."
  boostDouble: string; // "Double rewards until {date}"
  boostTimes: string; // "{n}× rewards until {date}"
}

/** The JSON of public.referral_invite_preview(code) (growth design §4.3). */
export type InvitePreview =
  | {
    valid: true;
    name: string | null;
    friend_rewards: { kind: string; amount: number; params?: Record<string, unknown> }[];
    sharer_rewarded: boolean;
    boost: { ends_at: string; multiplier: number } | null;
  }
  | { valid: false };

// The code alphabet of the kit (ADR 11.7): 8 characters, no O, 0, I, 1, L.
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/;

/** Same normalisation as the database's referral.normalise_code, for codes taken from a URL. */
export function normaliseCode(input: string): string {
  // Same order as the database (migration 9) and the Flutter package: width folding (NFKC) first, so a full-width
  // hyphen becomes "-" and is removed; then the explicit removal list (never locale-dependent); then digits.
  return input
    .normalize("NFKC")
    .replace(
      // deno-lint-ignore no-control-regex
      /[\u0009-\u000D\u0020\u00A0\u00AD\u061C\u1680\u180E\u2000-\u200F\u2010-\u2015\u2028\u2029\u202A-\u202F\u205F\u2060-\u206F\u2212\u3000\uFEFF-]/g,
      "",
    )
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
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
export function pickLang(acceptLanguage: string | null, supported: Lang[] = ["en", "hi", "id"]): Lang {
  if (!acceptLanguage) return "en";
  const ranked = acceptLanguage.split(",").map((part, i) => {
    const [tag, ...params] = part.trim().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return { lang: tag.toLowerCase().split("-")[0], q: q ? Number(q.slice(2)) || 0 : 1, i };
  }).filter((x) => x.q > 0).sort((a, b) => b.q - a.q || a.i - b.i);
  for (const r of ranked) if ((supported as string[]).includes(r.lang)) return r.lang as Lang;
  return "en";
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function fill(s: string, app: string): string {
  return s.replaceAll("{app}", app);
}

/** The Play link carries the code in the install referrer (ADR 4.2), read once by the app. */
export function playUrl(cfg: InviteConfig, code: string | null): string {
  const base = `https://play.google.com/store/apps/details?id=${encodeURIComponent(cfg.playPackage)}`;
  return code ? `${base}&referrer=${encodeURIComponent(`code=${code}`)}` : base;
}

// ---------------------------------------------------------------------------------------------------------------
// Invite preview (growth design §4.3, §6)
// ---------------------------------------------------------------------------------------------------------------

/**
 * A name typed by a user, made safe to show: control, bidi and line-separator characters removed (a U+202E override
 * could reorder the sentence around it), whitespace collapsed, at most 40 characters. "" when nothing is left.
 * The caller still HTML-escapes it and puts it in a bidi isolate.
 */
export function cleanName(name: string): string {
  const cleaned = name.normalize("NFC").replace(/[\t\n\v\f\r\u0085\u2028\u2029]/g, " ").replace(
    // deno-lint-ignore no-control-regex
    /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u2028\u2029\uFEFF]/g,
    "",
  )
    .replace(/\s+/g, " ").trim();
  return [...cleaned].slice(0, 40).join("").trim();
}

/** The preview JSON checked field by field; anything malformed is null, so the page falls back to the plain one. */
export function parsePreview(x: unknown): InvitePreview | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (o.valid === false) return { valid: false };
  if (o.valid !== true) return null;
  const rewards = Array.isArray(o.friend_rewards) ? o.friend_rewards : [];
  const friend_rewards = rewards.filter((r): r is { kind: string; amount: number; params?: Record<string, unknown> } =>
    !!r && typeof r === "object" && typeof (r as Record<string, unknown>).kind === "string" &&
    typeof (r as Record<string, unknown>).amount === "number" &&
    Number.isFinite((r as Record<string, unknown>).amount) &&
    ((r as Record<string, unknown>).amount as number) > 0
  ).map((r) => ({ kind: r.kind, amount: r.amount, params: r.params }));
  const b = o.boost as Record<string, unknown> | null | undefined;
  const boost = b && typeof b === "object" && typeof b.ends_at === "string" && !isNaN(Date.parse(b.ends_at)) &&
      typeof b.multiplier === "number" && b.multiplier > 1 && b.multiplier <= 5
    ? { ends_at: b.ends_at, multiplier: b.multiplier }
    : null;
  const name = typeof o.name === "string" ? cleanName(o.name) || null : null;
  return { valid: true, name, friend_rewards, sharer_rewarded: o.sharer_rewarded === true, boost };
}

/**
 * Calls public.referral_invite_preview on the server (anon role). Null on any problem: no config, a bad code, an HTTP
 * error, a timeout (2 s by default) or malformed JSON. The page must render without it.
 */
export async function fetchInvitePreview(
  supabaseUrl: string,
  anonKey: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2000,
): Promise<InvitePreview | null> {
  const c = normaliseCode(code);
  if (!supabaseUrl || !anonKey || !validCode(c)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { "content-type": "application/json", apikey: anonKey };
    // A legacy anon key is a JWT and goes in Authorization too; a new publishable key (sb_publishable_…) does not.
    if (anonKey.startsWith("eyJ")) headers.authorization = `Bearer ${anonKey}`;
    const res = await fetchImpl(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/referral_invite_preview`, {
      method: "POST",
      headers,
      body: JSON.stringify({ code: c }),
      signal: ctrl.signal,
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

const LOCALES: Record<Lang, string> = { en: "en-GB", hi: "hi-IN", id: "id-ID" };
const locale = (lang: Lang) => LOCALES[lang] ?? lang;

/** "60 min of X" from the app's labels, or null when a kind has no label in this language. */
export function rewardText(
  rewards: { kind: string; amount: number }[],
  labels: Record<string, PluralLabel> | undefined,
  lang: Lang,
): string | null {
  if (!rewards.length || !labels) return null;
  const plural = new Intl.PluralRules(locale(lang));
  const num = new Intl.NumberFormat(locale(lang));
  const parts: string[] = [];
  for (const r of rewards) {
    const l = Object.hasOwn(labels, r.kind) ? labels[r.kind] : undefined;
    if (!l) return null;
    parts.push((plural.select(r.amount) === "one" ? l.one : l.other).replaceAll("{n}", num.format(r.amount)));
  }
  return new Intl.ListFormat(locale(lang), { type: "conjunction" }).format(parts);
}

/** "Sun, 22 Nov": the last day the boost runs (ends_at is exclusive), in the given zone. Same as the app's banner. */
export function boostDate(endsAt: string, lang: Lang, timeZone = "UTC"): string {
  const last = new Date(Date.parse(endsAt) - 1);
  const f = new Intl.DateTimeFormat(locale(lang), { weekday: "short", day: "numeric", month: "short", timeZone });
  if (lang !== "en") return f.format(last);
  const part = (t: string) => f.formatToParts(last).find((x) => x.type === t)?.value ?? "";
  return `${part("weekday")}, ${part("day")} ${part("month")}`;
}

/** Fills {name} (escaped, in a bidi isolate) and the other placeholders (escaped) in one pass. */
function fillHtml(template: string, vars: Record<string, string>): string {
  return escapeHtml(template).replace(/\{(name|app|reward|date|n)\}/g, (m, k: string) => {
    if (!(k in vars)) return m;
    return k === "name" ? `<bdi>${escapeHtml(vars[k])}</bdi>` : escapeHtml(vars[k]);
  });
}

interface PreviewLines {
  headline?: string; // HTML
  disclosure?: string; // HTML
  reward?: string; // HTML
  boost?: string; // HTML
  lead?: string; // HTML
}

function previewLines(
  p: InvitePreview | null,
  cfg: InviteConfig,
  s: Strings,
  lang: Lang,
  now: Date,
): PreviewLines {
  const ps = s.preview;
  if (!ps || !p || !p.valid) return {};
  const out: PreviewLines = {};
  const app = cfg.appName;
  if (p.name) {
    out.headline = fillHtml(ps.invitedBy, { name: p.name, app });
    out.lead = fillHtml(ps.leadNamed, { app });
  }
  if (p.sharer_rewarded) {
    out.disclosure = p.name ? fillHtml(ps.disclosure, { name: p.name, app }) : fillHtml(ps.disclosureAnon, { app });
  }
  if (p.friend_rewards.length) {
    const r = rewardText(p.friend_rewards, cfg.rewardLabels?.[lang], lang);
    out.reward = r === null ? fillHtml(ps.friendRewardNeutral, { app }) : fillHtml(ps.friendReward, { reward: r, app });
  }
  if (p.boost && Date.parse(p.boost.ends_at) > now.getTime()) {
    const date = boostDate(p.boost.ends_at, lang, cfg.timeZone ?? "UTC");
    const m = p.boost.multiplier;
    out.boost = m === 2
      ? fillHtml(ps.boostDouble, { date })
      : fillHtml(ps.boostTimes, { date, n: new Intl.NumberFormat(locale(lang)).format(m) });
  }
  return out;
}

/** JSON for a <script type="application/json"> block: nothing in it can close the script or start a comment. */
export function scriptJson(x: unknown): string {
  return JSON.stringify(x).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export interface RenderOptions {
  /** The referral_invite_preview JSON for this code, fetched on the server (fetchInvitePreview). */
  preview?: InvitePreview | null;
  now?: Date;
}

/**
 * The invite page. `code` null (or invalid) renders the page without a code and with the `invalid` line, never an
 * error page, and never echoes the raw input. With a valid `preview` it adds the sharer's name (when they opted in)
 * with the reward disclosure, the friend's reward and a running boost; without one, or `valid: false`, the plain page.
 * The page's title and Open Graph tags never carry the name: chat apps cache link previews.
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
  // The browser fetches the preview itself only on a static host: no preview given here and the keys configured.
  const browserFetch = opts.preview === undefined && !!cfg.supabaseUrl && !!cfg.anonKey && !!s.preview;
  const data = browserFetch
    ? {
      url: cfg.supabaseUrl!.replace(/\/+$/, "") + "/rest/v1/rpc/referral_invite_preview",
      key: cfg.anonKey,
      lang,
      locale: locale(lang),
      app: cfg.appName,
      s: s.preview,
      labels: cfg.rewardLabels?.[lang] ?? {},
    }
    : {};
  const title = escapeHtml(fill(s.title, cfg.appName));
  const v: Record<string, string> = {
    LANG: lang,
    TITLE: title,
    HEADLINE: pl.headline ?? title,
    DISCLOSURE: pl.disclosure ?? "",
    DISCLOSURE_HIDDEN: pl.disclosure ? "" : "hidden",
    REWARD: pl.reward ?? "",
    REWARD_HIDDEN: pl.reward ? "" : "hidden",
    BOOST: pl.boost ?? "",
    BOOST_HIDDEN: pl.boost ? "" : "hidden",
    LEAD: pl.lead ?? escapeHtml(fill(ok ? s.lead : s.invalid, cfg.appName)),
    LEAD_OK: escapeHtml(fill(s.lead, cfg.appName)),
    OG_DESCRIPTION: escapeHtml(fill(ok ? s.lead : s.invalid, cfg.appName)),
    PREVIEW_DATA: scriptJson(data),
    CODE: ok ? escapeHtml(code!) : "",
    CODE_DISPLAY: ok ? escapeHtml(displayCode(code!)) : "",
    CODE_SPOKEN: ok ? escapeHtml(code!.split("").join(" ")) : "",
    CODE_HIDDEN: ok ? "" : "hidden",
    COPY: escapeHtml(s.copy),
    COPIED: escapeHtml(s.copied),
    APP_STORE: escapeHtml(s.appStore),
    APP_STORE_NOTE: escapeHtml(s.appStoreNote),
    APP_STORE_URL: escapeHtml(cfg.appStoreUrl),
    GOOGLE_PLAY: escapeHtml(s.googlePlay),
    PLAY_NOTE: escapeHtml(s.playNote),
    PLAY_URL: escapeHtml(playUrl(cfg, ok ? code : null)),
    TERMS: escapeHtml(s.terms),
    TERMS_URL: escapeHtml(cfg.siteUrl + (cfg.termsPath ?? "/terms")),
    CANONICAL: escapeHtml(cfg.siteUrl + "/i/" + (ok ? code : "")),
    OG_IMAGE: escapeHtml(cfg.ogImageUrl),
    APP: app,
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in v ? v[k] : m));
}

// ---------------------------------------------------------------------------------------------------------------
// Terms page, generated from the database's referral_terms() export (ADR 11.1)
// ---------------------------------------------------------------------------------------------------------------

export interface Terms {
  enabled: boolean;
  paid_enabled: boolean;
  rules: {
    event: "joined" | "paid";
    who: "sharer" | "friend";
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

/** App-supplied wording per reward kind, e.g. { minutes: (n) => `${n} min of natural voice` }. */
export type RewardLabels = Record<string, (amount: number, params?: Record<string, unknown>) => string>;

export function termsLines(t: Terms, labels: RewardLabels, appName: string): string[] {
  const label = (r: Terms["rules"][number]) =>
    (labels[r.kind] ?? ((n: number) => `${n} ${r.kind}`))(r.amount, r.params);
  const find = (event: string, who: string) => t.rules.find((r) => r.event === event && r.who === who);
  const lines: string[] = [];
  if (!t.enabled) lines.push("Invites are paused right now. Rewards already earned are kept.");
  const js = find("joined", "sharer"), jf = find("joined", "friend"), ps = find("paid", "sharer");
  if (js && jf) {
    lines.push(
      `When a friend you invited signs up and starts using ${appName}, you get ${label(js)} and they get ${label(jf)}.`,
    );
  } else if (js) {
    lines.push(`When a friend you invited signs up and starts using ${appName}, you get ${label(js)}.`);
  } else if (jf) {
    lines.push(`A friend who signs up with your code and starts using ${appName} gets ${label(jf)}.`);
  }
  if (ps && t.paid_enabled) {
    lines.push(
      `When a friend you invited subscribes (after any free trial) within ${t.paid_window_days} days of using your code, you get ${
        label(ps)
      }. ` +
        `It is added about ${
          Math.round(t.hold_hours / 24)
        } days after their payment, once it can no longer be refunded. ` +
        `If you already subscribe, it is added when your current plan ends.`,
    );
  }
  lines.push(
    `A code can be added in the first ${t.claim_window_days} days after signing up, and the friend must start using ${appName} within ${t.activate_window_days} days.`,
    `Up to ${t.sharer_joins_per_30d} friends a month and ${t.sharer_paid_per_365d} subscriptions a year earn you a reward.`,
    "Each person and each phone can use one code once. Your own code, or a second account on the same phone, does not count.",
    "Rewards have no cash value, cannot be exchanged, and codes cannot be sold or bought.",
    "Codes that are misused (for example refunds after a reward) can be paused for review.",
    `The program can change or end at any time; rewards already earned or waiting are not affected.`,
  );
  return lines;
}

export function renderTerms(t: Terms, labels: RewardLabels, cfg: InviteConfig, lang: Lang = "en"): string {
  const items = termsLines(t, labels, cfg.appName).map((l) => `<li>${escapeHtml(l)}</li>`).join("\n      ");
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
