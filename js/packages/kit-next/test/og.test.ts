// Ported from web/invite/og_test.ts (Deno) so the Next.js port is held to the same cases. Do not edit the cases here
// without changing the Deno ones too.
import { test } from 'vitest';
import { INVITE_TEMPLATE } from '../src/invite/template';
import { INVITE_STRINGS as STRINGS } from '../src/invite/strings';

const Deno = { test: (name: string, fn: () => unknown): void => void test(name, fn as () => void | Promise<void>) };
import {
  OG_HEIGHT,
  OG_WIDTH,
  renderOgSvg,
  safeColour,
  textOn,
  wrap,
} from "../src/invite/og";
import { renderInvite } from "../src/invite/render";

const ok = (c: unknown, m = "expected true") => {
  if (!c) throw new Error(m);
};

Deno.test("og: 1200×630, app name, default lines, accent", () => {
  const svg = renderOgSvg({ appName: "Example", accent: "#b45309" });
  ok(svg.includes(`width="${OG_WIDTH}" height="${OG_HEIGHT}"`));
  ok(svg.includes(">Example</text>"), "app name");
  ok(
    svg.includes(">You&#39;re invited to</text>") &&
      svg.includes(">Example</text>"),
    "headline filled and escaped",
  );
  ok(svg.includes("Use your friend&#39;s code when you sign up"));
  ok(svg.includes('fill="#b45309"'), "accent used");
  ok(!/\{app\}/.test(svg));
});

Deno.test("og: every value escaped, bad colours refused", () => {
  const svg = renderOgSvg({
    appName: '<script>"x"</script>',
    headline: "a & b",
    accent: 'red" onload="x',
    background: "url(x)",
  });
  ok(
    !svg.includes("<script>") && svg.includes("&lt;script&gt;&quot;x&quot;"),
    "name escaped",
  );
  ok(svg.includes("a &amp; b"));
  ok(!svg.includes("onload"), "bad colour dropped");
  ok(
    svg.includes('fill="#0f766e"') && svg.includes('fill="#f6f7f9"'),
    "defaults used",
  );
  eqColour(safeColour("#ABC", "#000"), "#ABC");
});

Deno.test("og: long text wraps to at most 3 lines and ends with an ellipsis", () => {
  const lines = wrap(
    "one two three four five six seven eight nine ten eleven twelve thirteen fourteen",
    12,
    3,
  );
  ok(lines.length === 3, `got ${lines.length}`);
  ok(lines[2]!.endsWith("…"));
  ok(lines.every((l) => [...l].length <= 12), lines.join("|"));
  ok(
    wrap("Supercalifragilisticexpialidocious", 10, 2)[0] === "Supercalif…",
    "a single long word is cut",
  );
  const svg = renderOgSvg({
    appName: "A very long application name that goes on and on",
    headline: "x ".repeat(60),
  });
  ok((svg.match(/font-weight="800"/g) ?? []).length <= 3);
});

Deno.test("og: readable text colour on light and dark", () => {
  ok(
    textOn("#ffffff") === "#16181d" && textOn("#000") === "#ffffff" &&
      textOn("#0f766e") === "#ffffff",
  );
  ok(
    renderOgSvg({ appName: "Dark", background: "#111827" }).includes(
      'fill="#ffffff">Dark</text>',
    ),
  );
});

Deno.test("og: works for Hindi text", () => {
  const svg = renderOgSvg({
    appName: "उदाहरण",
    headline: "आपको {app} पर आमंत्रण मिला है",
    lang: "hi",
  });
  ok(svg.includes('xml:lang="hi"') && svg.includes("उदाहरण पर"));
  ok(svg.includes(">उ</text>"), "initial is the first character");
});

Deno.test("og: the sharer's name never reaches the preview image or the cached link preview tags", async () => {
  // The image takes no name at all; the page's og:/twitter: tags stay generic even with a named preview.
  const svg = renderOgSvg({ appName: "Example", lang: "en" });
  ok(!svg.includes("Priya"), "name in the image");
  const template = INVITE_TEMPLATE;
  const html = renderInvite(
    template,
    {
      appName: "Example",
      appStoreUrl: "https://apps.apple.com/app/id000000000",
      playPackage: "com.example.app",
      siteUrl: "https://example.test",
      ogImageUrl: "https://example.test/og.png",
    },
    STRINGS.en,
    "en",
    "ABCDEFGH",
    {
      preview: {
        valid: true,
        name: "Priya",
        friend_rewards: [{ kind: "minutes", amount: 60 }],
        sharer_rewarded: true,
        boost: null,
      },
    },
  );
  ok(html.includes("<bdi>Priya</bdi>"), "name is on the page");
  const tags = html.match(
    /<meta (property="og:|name="twitter:)[^>]*>|<title>[^<]*<\/title>/g,
  ) ?? [];
  ok(tags.length >= 6, `found ${tags.length} tags`);
  ok(tags.every((t) => !t.includes("Priya")), "name in a cached tag");
  ok(
    html.includes('content="https://example.test/og.png"'),
    "one static image per app",
  );
});

function eqColour(a: string, b: string) {
  if (a !== b) throw new Error(`${a} != ${b}`);
}
