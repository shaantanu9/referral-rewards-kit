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
}

// The code alphabet of the kit (ADR 11.7): 8 characters, no O, 0, I, 1, L.
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/;

/** Same normalisation as the database's referral.normalise_code, for codes taken from a URL. */
export function normaliseCode(input: string): string {
  // Same order as the database (migration 9) and the Flutter package: width folding (NFKC) first, so a full-width
  // hyphen becomes "-" and is removed; then the explicit removal list (never locale-dependent); then digits.
  return input
    .normalize("NFKC")
    .replace(
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

/**
 * The invite page. `code` null (or invalid) renders the page without a code and with the `invalid` line, never an
 * error page, and never echoes the raw input.
 */
export function renderInvite(
  template: string,
  cfg: InviteConfig,
  s: Strings,
  lang: Lang,
  rawCode: string | null,
): string {
  const code = rawCode === null ? null : normaliseCode(rawCode);
  const ok = code !== null && validCode(code);
  const app = escapeHtml(cfg.appName);
  const v: Record<string, string> = {
    LANG: lang,
    TITLE: escapeHtml(fill(s.title, cfg.appName)),
    LEAD: escapeHtml(fill(ok ? s.lead : s.invalid, cfg.appName)),
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
