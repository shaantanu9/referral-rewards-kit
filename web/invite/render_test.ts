import {
  escapeHtml,
  normaliseCode,
  pickLang,
  playUrl,
  renderInvite,
  renderTerms,
  type Terms,
  termsLines,
} from "./render.ts";
import { STRINGS } from "./strings.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const template = await Deno.readTextFile(new URL("./index.html", import.meta.url));
const cfg = {
  appName: "Example <App>",
  appStoreUrl: "https://apps.apple.com/app/id000000000",
  playPackage: "com.example.app",
  siteUrl: "https://example.test",
  ogImageUrl: "https://example.test/og.png",
};

Deno.test("page stays under 50 KB", () => {
  assert(new TextEncoder().encode(template).length < 50_000, "template too big");
  const html = renderInvite(template, cfg, STRINGS.en, "en", "ABCDEFGH");
  assert(new TextEncoder().encode(html).length < 50_000, "rendered page too big");
});

Deno.test("renders the code without JavaScript, spelled out for screen readers", () => {
  const html = renderInvite(template, cfg, STRINGS.en, "en", "abcd-efgh");
  assert(html.includes(">ABCD-EFGH</output>"), "display code");
  assert(html.includes('data-code="ABCDEFGH"'), "data code");
  assert(html.includes('aria-label="A B C D E F G H"'), "spoken code");
  assert(
    !/\{\{[A-Z_]+\}\}/.test(html.replace(/<script>[\s\S]*<\/script>/, "")),
    "no placeholder left outside the script",
  );
});

Deno.test("noindex, no analytics, no external scripts", () => {
  const html = renderInvite(template, cfg, STRINGS.en, "en", "ABCDEFGH");
  assert(html.includes('content="noindex, nofollow"'), "noindex");
  assert(!/<script[^>]+src=/.test(html), "no external script");
  assert(
    !/gtag\(|fbq\(|google-analytics|googletagmanager|localStorage|sessionStorage|document\.cookie|navigator\.sendBeacon|fetch\(/
      .test(html),
    "no tracking or network calls",
  );
});

Deno.test("Play link carries the code in the install referrer", () => {
  assert(
    playUrl(cfg, "ABCDEFGH") ===
      "https://play.google.com/store/apps/details?id=com.example.app&referrer=code%3DABCDEFGH",
    "referrer",
  );
  const html = renderInvite(template, cfg, STRINGS.en, "en", "ABCDEFGH");
  assert(html.includes("referrer=code%3DABCDEFGH"), "in page");
});

Deno.test("invalid or hostile codes are never echoed", () => {
  for (const bad of ["<script>x</script>", "ABCDEFG0", "ABC", '"onload=', "ABCDEFGHJ"]) {
    const html = renderInvite(template, cfg, STRINGS.en, "en", bad);
    assert(html.includes('data-code=""') && html.includes('aria-label=""></output>'), `code slot empty for ${bad}`);
    assert(!html.includes("<script>x</script>") && !html.includes('"onload='), `echoed ${bad}`);
    assert(html.includes("not complete"), "invalid line shown");
    assert(html.includes('id="code-box" hidden'), "code box hidden");
    assert(html.includes('details?id=com.example.app"'), "Play link without referrer");
  }
});

Deno.test("app name is escaped", () => {
  const html = renderInvite(template, cfg, STRINGS.en, "en", "ABCDEFGH");
  assert(html.includes("Example &lt;App&gt;"), "escaped");
  assert(!html.includes("Example <App>"), "raw name");
  assert(escapeHtml(`"'&`) === "&quot;&#39;&amp;", "escape all");
});

Deno.test("normalisation matches the database", () => {
  assert(normaliseCode(" abcd-efgh ") === "ABCDEFGH", "trim dash case");
  assert(normaliseCode("⁦ABCD-EFGH⁩") === "ABCDEFGH", "isolates");
  assert(normaliseCode("AB​CD EF‑GH") === "ABCDEFGH", "zero width, nb hyphen");
  assert(normaliseCode("ＡＢＣＤ２３４５") === "ABCD2345", "full width");
  assert(normaliseCode("ABCD२३४५") === "ABCD2345", "devanagari");
  assert(normaliseCode("ABCD٢٣٤٥") === "ABCD2345", "arabic-indic");
  assert(normaliseCode("ABCD－EFGH") === "ABCDEFGH", "full-width hyphen");
  assert(
    normaliseCode("ABCD\u00A0EFGH") === "ABCDEFGH" && normaliseCode("ABCD\u3000EFGH") === "ABCDEFGH",
    "nbsp, ideographic space",
  );
  assert(normaliseCode("AB\u0085CD") === "AB\u0085CD", "U+0085 kept, as in SQL and Dart");
});

Deno.test("language from Accept-Language", () => {
  assert(pickLang("hi-IN,hi;q=0.9,en;q=0.8") === "hi", "hi");
  assert(pickLang("fr-FR,id;q=0.5") === "id", "first supported");
  assert(pickLang("en;q=0.1,id;q=0.9") === "id", "by q");
  assert(pickLang("de") === "en", "fallback");
  assert(pickLang(null) === "en", "none");
  const html = renderInvite(template, cfg, STRINGS.hi, "hi", "ABCDEFGH");
  assert(html.startsWith('<!doctype html>\n<html lang="hi">'), "lang attr");
});

const terms: Terms = {
  enabled: true,
  paid_enabled: true,
  rules: [
    { event: "joined", who: "sharer", kind: "minutes", amount: 30 },
    { event: "joined", who: "friend", kind: "minutes", amount: 30 },
    { event: "paid", who: "sharer", kind: "entitlement_days", amount: 5 },
  ],
  claim_window_days: 7,
  activate_window_days: 30,
  paid_window_days: 90,
  hold_hours: 72,
  sharer_joins_per_30d: 10,
  sharer_paid_per_365d: 6,
};
const labels = {
  minutes: (n: number) => `${n} min of natural voice`,
  entitlement_days: (n: number) => `${n} days of Premium`,
};

Deno.test("terms state every rule, cap and window from the live numbers", () => {
  const text = termsLines(terms, labels, "Example").join(" ");
  for (
    const s of [
      "you get 30 min of natural voice and they get 30 min of natural voice",
      "5 days of Premium",
      "within 90 days",
      "about 3 days after their payment",
      "first 7 days",
      "within 30 days",
      "Up to 10 friends a month and 6 subscriptions a year",
      "no cash value",
      "cannot be sold",
      "change or end",
    ]
  ) {
    assert(text.includes(s), `missing: ${s}`);
  }
});

Deno.test("terms: friend gets nothing (D-R1 = no) and paid rule off", () => {
  const t = { ...terms, rules: [terms.rules[0]], paid_enabled: true };
  const text = termsLines(t, labels, "Example").join(" ");
  assert(text.includes("you get 30 min of natural voice.") && !text.includes("they get"), "sharer only");
  assert(!text.includes("Premium"), "no paid line without a paid rule");
  const paused = termsLines({ ...terms, enabled: false }, labels, "Example").join(" ");
  assert(paused.startsWith("Invites are paused"), "paused");
});

Deno.test("terms page is noindex and escaped", () => {
  const html = renderTerms(terms, labels, cfg);
  assert(html.includes('content="noindex"') && html.includes("Example &lt;App&gt;"), "noindex and escaped");
});
