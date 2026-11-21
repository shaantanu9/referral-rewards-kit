import {
  boostDate,
  cleanName,
  escapeHtml,
  fetchInvitePreview,
  type InvitePreview,
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
    !/gtag\(|fbq\(|google-analytics|googletagmanager|localStorage|sessionStorage|document\.cookie|navigator\.sendBeacon/
      .test(html),
    "no tracking",
  );
  // The one request in the page is the optional invite preview, and it only runs with a configured URL.
  assert((html.match(/fetch\(/g) ?? []).length === 1 && html.includes("fetch(d.url,"), "only the preview fetch");
  assert(html.includes('<script type="application/json" id="preview-data">{}</script>'), "no preview config");
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

// ---------------------------------------------------------------------------------------------------------------
// Invite preview (growth design §6)
// ---------------------------------------------------------------------------------------------------------------

const pcfg = {
  ...cfg,
  appName: "Example",
  rewardLabels: {
    en: {
      minutes: { one: "{n} min of natural voice", other: "{n} min of natural voice" },
      entitlement_days: { one: "{n} day of Premium", other: "{n} days of Premium" },
    },
  },
};
const now = new Date("2026-11-20T10:00:00Z");
const named: InvitePreview = {
  valid: true,
  name: "Priya",
  friend_rewards: [{ kind: "minutes", amount: 60, params: {} }],
  sharer_rewarded: true,
  boost: null,
};
const render = (preview: InvitePreview | null | undefined, c: typeof pcfg = pcfg, lang: "en" | "hi" | "id" = "en") =>
  renderInvite(template, c, STRINGS[lang], lang, "ABCDEFGH", { preview, now });
/** The visible body only (no script, no head), for "what does the friend read". */
const body = (html: string) => html.split("<body>")[1].replace(/<script[\s\S]*<\/script>/g, "");

Deno.test("preview: name and disclosure shown together, give-first reward line", () => {
  const html = render(named);
  assert(html.includes('<h1 id="headline"><bdi>Priya</bdi> invited you to Example</h1>'), "named headline");
  assert(
    html.includes('<p id="disclosure" class="disclosure" ><bdi>Priya</bdi> gets a reward if you join.</p>'),
    "disclosure next to the name",
  );
  assert(html.includes(">You get 60 min of natural voice when you start using the app.</p>"), "reward line");
  assert(/<p id="lead"[^>]*>Add this code when you sign up:<\/p>/.test(html), "named lead");
  assert(html.includes(">ABCD-EFGH</output>"), "code still shown");
  assert(html.includes('id="boost" class="boost" hidden'), "no boost line without a boost");
});

Deno.test("preview: the name never reaches the title, Open Graph or Twitter tags", () => {
  const html = render(named);
  const head = html.split("<body>")[0];
  assert(!head.includes("Priya"), "name in <head>");
  assert(html.includes('<meta name="robots" content="noindex, nofollow">'), "noindex stays");
});

Deno.test("preview: no name when null, generic disclosure, no named lead", () => {
  const html = render({ ...named, name: null });
  assert(html.includes(`<h1 id="headline">Example: you&#39;re invited</h1>`), "plain headline");
  assert(!body(html).includes("<bdi>"), "no name slot");
  assert(html.includes(">Your friend gets a reward if you join.</p>"), "anonymous disclosure");
  assert(html.includes("Your friend invited you to Example."), "plain lead");
});

Deno.test("preview: disclosure absent when the sharer gets nothing", () => {
  const html = render({ ...named, sharer_rewarded: false });
  assert(html.includes('id="disclosure" class="disclosure" hidden></p>'), "hidden and empty");
  assert(!html.includes("gets a reward"), "no disclosure text");
  assert(html.includes("<bdi>Priya</bdi> invited you"), "name still shown");
});

Deno.test("preview: XSS attempts in the name are escaped", () => {
  for (
    const evil of [
      "<script>alert(1)</script>",
      '"><img src=x onerror=alert(1)>',
      "Priya</bdi><b>x",
      "&lt;already&gt;",
      "{app}{name}",
    ]
  ) {
    const html = render({ ...named, name: evil });
    const b = body(html);
    assert(!b.includes("<script>alert") && !b.includes("<img") && !b.includes("<b>x"), `raw html for ${evil}`);
    assert(b.includes(`<bdi>${escapeHtml(evil)}</bdi>`), `escaped in an isolate: ${evil}`);
  }
  assert(render({ ...named, name: "{app}{name}" }).includes("<bdi>{app}{name}</bdi> invited"), "not re-filled");
});

Deno.test("preview: control and bidi characters are stripped from the name", () => {
  assert(cleanName("Pri\u202Eya\u2066\u200F") === "Priya", "bidi overrides and isolates");
  assert(cleanName("  Pri\u0000ya\n\tS\u2028 ") === "Priya S", "controls and separators");
  assert(cleanName("\u202E\u202C") === "", "nothing left");
  assert([...cleanName("a".repeat(80))].length === 40, "at most 40");
  assert(cleanName("प्रिया") === "प्रिया", "Devanagari kept");
  const html = render({ ...named, name: "Priya\u202Ednawer 05$" });
  assert(html.includes("<bdi>Priyadnawer 05$</bdi>") && !html.includes("\u202E"), "stripped in the page");
  const empty = render({ ...named, name: "\u202E\u2066" });
  assert(!body(empty).includes("<bdi>") && empty.includes("Your friend gets a reward"), "empty name = no name");
});

Deno.test("preview: boost line with the real end date, double and other multipliers, never a countdown", () => {
  // Ends at midnight UTC on Monday 23 Nov 2026: the last day it runs is Sunday 22 Nov.
  const boosted = { ...named, boost: { ends_at: "2026-11-23T00:00:00Z", multiplier: 2 } };
  const html = render(boosted);
  assert(html.includes('<p id="boost" class="boost" >Double rewards until Sun, 22 Nov</p>'), "double");
  assert(
    render({ ...boosted, boost: { ...boosted.boost, multiplier: 3 } }).includes(">3× rewards until Sun, 22 Nov<"),
    "3x",
  );
  assert(render({ ...boosted, boost: { ...boosted.boost, multiplier: 1.5 } }).includes(">1.5× rewards until"), "1.5x");
  assert(!/countdown|setInterval|\d+:\d\d:\d\d/.test(body(html)), "no timer");
  const past = render({ ...named, boost: { ends_at: "2026-11-19T00:00:00Z", multiplier: 2 } });
  assert(past.includes('id="boost" class="boost" hidden'), "an ended boost is not shown");
  assert(boostDate("2026-11-23T00:00:00Z", "en", "Asia/Kolkata") === "Mon, 23 Nov", "time zone respected");
  assert(boostDate("2026-11-23T00:00:00Z", "hi").includes("22"), "hindi date");
  const bad = render({ ...named, boost: { ends_at: "2026-11-23T00:00:00Z", multiplier: 50 } });
  assert(bad.includes('id="boost" class="boost" hidden'), "out-of-range multiplier ignored");
});

Deno.test("preview: reward labels, plurals, several rewards, neutral fallback", () => {
  const two = render({
    ...named,
    friend_rewards: [{ kind: "minutes", amount: 60 }, { kind: "entitlement_days", amount: 1 }],
  });
  assert(two.includes("You get 60 min of natural voice and 1 day of Premium when"), "list + singular");
  assert(
    render({ ...named, friend_rewards: [{ kind: "entitlement_days", amount: 5 }] }).includes("5 days of Premium"),
    "plural",
  );
  const unknown = render({ ...named, friend_rewards: [{ kind: "coins", amount: 5 }] });
  assert(unknown.includes(">You get a welcome reward when you start using the app.</p>"), "neutral for no label");
  const hi = render(named, pcfg, "hi");
  assert(hi.includes("आपको स्वागत इनाम मिलेगा"), "no Hindi label: neutral Hindi sentence, never English");
  assert(hi.includes("<bdi>Priya</bdi> ने आपको Example पर बुलाया है"), "hindi headline");
  const none = render({ ...named, friend_rewards: [] });
  assert(none.includes('id="reward" class="reward" hidden'), "no reward line when the friend gets nothing");
  assert(!render({ ...named, name: null }, pcfg, "id").includes("<bdi>"), "id");
});

Deno.test("preview: valid:false, null, malformed or a bad code all render the plain page", () => {
  const plain = renderInvite(template, pcfg, STRINGS.en, "en", "ABCDEFGH", { now });
  const visible = (h: string) => body(h).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  for (const p of [{ valid: false } as InvitePreview, null, { valid: "yes" } as unknown as InvitePreview]) {
    const html = render(p);
    assert(visible(html) === visible(plain), `same visible page for ${JSON.stringify(p)}`);
    assert(html.includes(">ABCD-EFGH</output>"), "code still shown");
    for (const id of ["disclosure", "reward", "boost"]) {
      assert(html.includes(`id="${id}" class="${id}" hidden></p>`), id);
    }
  }
  const badCode = renderInvite(template, pcfg, STRINGS.en, "en", "nope", { preview: named, now });
  assert(!badCode.includes("Priya") && badCode.includes("not complete"), "no preview without a valid code");
  const noStrings = renderInvite(template, pcfg, { ...STRINGS.en, preview: undefined }, "en", "ABCDEFGH", {
    preview: named,
    now,
  });
  assert(!noStrings.includes("Priya"), "a language without preview strings ignores the preview");
});

Deno.test("preview: static-host data block only with keys and no server preview, safe in a script tag", () => {
  const keyed = { ...pcfg, supabaseUrl: "https://ref.supabase.co/", anonKey: "sb_publishable_x</script>" };
  const html = renderInvite(template, keyed, STRINGS.en, "en", null);
  const json = html.match(/<script type="application\/json" id="preview-data">([\s\S]*?)<\/script>/)![1];
  assert(!json.includes("</script") && !json.includes("<"), "cannot close the script");
  const d = JSON.parse(json);
  assert(d.url === "https://ref.supabase.co/rest/v1/rpc/referral_invite_preview", "rpc url");
  assert(d.key === "sb_publishable_x</script>" && d.s.invitedBy && d.labels.minutes, "key, strings, labels");
  const served = renderInvite(template, keyed, STRINGS.en, "en", "ABCDEFGH", { preview: null });
  assert(served.includes('id="preview-data">{}</script>'), "server already asked: the browser does not");
  assert(!/\.innerHTML|insertAdjacentHTML|document\.write/.test(html), "text only in the browser");
});

Deno.test("fetchInvitePreview: request shape and parsed result", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (url: string | URL | Request, init?: RequestInit) => {
    seen = { url: String(url), init: init! };
    return Promise.resolve(Response.json({ ...named, name: "Pri\u202Eya" }));
  };
  const p = await fetchInvitePreview("https://ref.supabase.co/", "eyJanon", "abcd-efgh", fake as typeof fetch);
  assert(p && p.valid && p.name === "Priya", "parsed and cleaned");
  const s = seen as unknown as { url: string; init: RequestInit };
  assert(s.url === "https://ref.supabase.co/rest/v1/rpc/referral_invite_preview", "url");
  assert(s.init.method === "POST" && s.init.body === '{"code":"ABCDEFGH"}', "body with the normalised code");
  const h = s.init.headers as Record<string, string>;
  assert(h.apikey === "eyJanon" && h.authorization === "Bearer eyJanon", "legacy key headers");
  await fetchInvitePreview("https://ref.supabase.co", "sb_publishable_x", "ABCDEFGH", fake as typeof fetch);
  const h2 = (seen as unknown as { init: RequestInit }).init.headers as Record<string, string>;
  assert(h2.apikey === "sb_publishable_x" && !("authorization" in h2), "publishable key: apikey only");
});

Deno.test("fetchInvitePreview: null on timeout, HTTP error, network error, bad JSON, bad code", async () => {
  let calls = 0;
  const hang = (_u: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      calls++;
      init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  assert(await fetchInvitePreview("https://x.test", "k", "ABCDEFGH", hang as typeof fetch, 20) === null, "timeout");
  const http = () => Promise.resolve(new Response("nope", { status: 500 }));
  assert(await fetchInvitePreview("https://x.test", "k", "ABCDEFGH", http as typeof fetch) === null, "500");
  const net = () => Promise.reject(new TypeError("network"));
  assert(await fetchInvitePreview("https://x.test", "k", "ABCDEFGH", net as typeof fetch) === null, "network");
  const junk = () => Promise.resolve(new Response("<html>", { status: 200 }));
  assert(await fetchInvitePreview("https://x.test", "k", "ABCDEFGH", junk as typeof fetch) === null, "bad json");
  const odd = () => Promise.resolve(Response.json({ hello: 1 }));
  assert(await fetchInvitePreview("https://x.test", "k", "ABCDEFGH", odd as typeof fetch) === null, "wrong shape");
  assert(
    await fetchInvitePreview("https://x.test", "k", "<bad>", hang as typeof fetch) === null && calls === 1,
    "no call",
  );
  assert(await fetchInvitePreview("", "k", "ABCDEFGH", hang as typeof fetch) === null && calls === 1, "no url");
  const off = () => Promise.resolve(Response.json({ valid: false }));
  const v = await fetchInvitePreview("https://x.test", "k", "ABCDEFGH", off as typeof fetch);
  assert(v !== null && v.valid === false, "valid:false passed through");
});

Deno.test("static host: the page without a code carries the normal lead for the script to show", () => {
  const html = renderInvite(template, cfg, STRINGS.en, "en", null);
  assert(
    /data-lead-ok="[^"]+"/.test(html), "lead-ok attribute filled");
  assert(!html.includes("{{LEAD_OK}}"), "no placeholder left");
  assert(html.includes('lead.textContent = lead.getAttribute("data-lead-ok")'), "script swaps the lead");
});
