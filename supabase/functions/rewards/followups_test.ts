// deno test: follow-up emails and unsubscribe (ADR 0002 18.7), on fakes.
import assert from "../referral/test_assert.ts";
import { FakeDb } from "../referral/test_fakes.ts";
import { type ClaimedEmail, type Mailer, renderEmail, resendMailer, runFollowups } from "./followups.ts";
import { createHandler } from "./index.ts";

const TOKEN = "11111111-2222-4333-8444-555555555555";
const email = (over: Partial<ClaimedEmail> = {}): ClaimedEmail => ({
  send_id: "send-1",
  program: "e_day2",
  user_id: "u1",
  email: "asha@example.test",
  name: "Asha",
  subject: "Your first take is still saved, Asha",
  heading: "Hi <Asha>",
  body: "Two minutes today.\n\nNobody hears it but you.",
  button: "Open",
  url: "https://app.example/open",
  unsubscribe_token: TOKEN,
  ...over,
});

class FakeMailer implements Mailer {
  sent: { to: string; subject: string; headers: Record<string, string>; html: string }[] = [];
  failFor = new Set<string>();
  send(m: { to: string; subject: string; html: string; text: string; headers: Record<string, string> }) {
    if (this.failFor.has(m.to)) return Promise.reject(new Error("resend HTTP 422"));
    this.sent.push(m);
    return Promise.resolve(`re_${this.sent.length}`);
  }
}

Deno.test("render: escaped text, paragraphs, button, unsubscribe link", () => {
  const { html, text } = renderEmail(email(), { appName: "Acme", unsubscribeUrl: "https://fn/unsubscribe?t=x" });
  assert.ok(html.includes("Hi &lt;Asha&gt;"), "heading escaped");
  assert.ok(html.includes('<p style="font-size:16px;line-height:1.5;margin:0 0 14px">Nobody hears it but you.</p>'));
  assert.ok(html.includes("https://app.example/open") && html.includes("https://fn/unsubscribe?t=x"));
  assert.ok(text.includes("Stop these emails: https://fn/unsubscribe?t=x"));
});

Deno.test("render: an app template is filled, every value escaped, unknown names emptied", () => {
  const tpl = `<div class="brand"><h1>{{heading}}</h1>{{body}}<a href="{{url}}">{{ button }}</a>
<small>{{app_name}} · {{nope}} · <a href="{{unsubscribe_url}}">Stop</a></small></div>`;
  const { html, text } = renderEmail(email({ template_html: tpl, button: "Open <now>" }), {
    appName: "Acme",
    unsubscribeUrl: "https://fn/unsubscribe?t=x&y=1",
  });
  assert.ok(html.startsWith('<div class="brand"><h1>Hi &lt;Asha&gt;</h1>'), "the app's layout, heading escaped");
  assert.ok(html.includes("<p>Two minutes today.</p>\n<p>Nobody hears it but you.</p>"), "body paragraphs");
  assert.ok(html.includes(">Open &lt;now&gt;</a>"), "spaces inside braces allowed; value escaped");
  assert.ok(html.includes("Acme ·  · "), "unknown placeholder emptied");
  assert.ok(html.includes('href="https://fn/unsubscribe?t=x&amp;y=1"'), "unsubscribe link filled and escaped");
  assert.ok(!html.includes("{{"), "no raw placeholder left");
  assert.ok(text.includes("Stop these emails: https://fn/unsubscribe?t=x&y=1"), "plain text part unchanged");
});

Deno.test("render: a null template falls back to the built-in layout", () => {
  const { html } = renderEmail(email({ template_html: null }), { appName: "Acme", unsubscribeUrl: "https://fn/u" });
  assert.ok(html.startsWith("<!doctype html>"));
});

Deno.test("run: sends with List-Unsubscribe headers, records sent and failed", async () => {
  const db = new FakeDb({
    rewards_svc_followup_claim: () => [email(), email({ send_id: "send-2", email: "bounce@example.test" })],
    rewards_svc_followup_finish: () => true,
  });
  const mailer = new FakeMailer();
  mailer.failFor.add("bounce@example.test");
  const r = await runFollowups(db, mailer, {
    dryRun: false,
    appName: "Acme",
    publicUrl: "https://ref.supabase.co/functions/v1/rewards/",
  });
  assert.deepEqual({ claimed: r.claimed, sent: r.sent, failed: r.failed }, { claimed: 2, sent: 1, failed: 1 });
  assert.equal(
    mailer.sent[0].headers["List-Unsubscribe"],
    `<https://ref.supabase.co/functions/v1/rewards/unsubscribe?t=${TOKEN}>`,
  );
  assert.equal(mailer.sent[0].headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  const fin = db.called("rewards_svc_followup_finish").map((c) => c.params);
  assert.deepEqual(fin[0], { send_id: "send-1", ok: true, provider_id: "re_1", error: null });
  assert.equal(fin[1].ok, false);
  assert.equal(db.called("rewards_svc_followup_claim")[0].params.dry_run, false);
});

Deno.test("run: a dry run sends nothing and shows masked addresses", async () => {
  const db = new FakeDb({ rewards_svc_followup_claim: () => [email({ send_id: null })] });
  const mailer = new FakeMailer();
  const r = await runFollowups(db, mailer, { dryRun: true, appName: "A", publicUrl: "https://x" });
  assert.equal(mailer.sent.length, 0);
  assert.deepEqual(r.preview, [{ program: "e_day2", to: "a***@example.test" }]);
  assert.equal(db.called("rewards_svc_followup_finish").length, 0);
});

Deno.test("resend mailer: endpoint, auth header, body", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const m = resendMailer({
    apiKey: "re_key",
    from: "Acme <hello@example.com>",
    fetch: (u, init) => {
      seen.push({ url: String(u), init: init ?? {} });
      return Promise.resolve(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
    },
  });
  assert.equal(
    await m.send({ to: "a@b.c", subject: "s", html: "<p>h</p>", text: "h", headers: { "List-Unsubscribe": "<u>" } }),
    "msg_1",
  );
  assert.equal(seen[0].url, "https://api.resend.com/emails");
  assert.equal(new Headers(seen[0].init.headers).get("Authorization"), "Bearer re_key");
  const body = JSON.parse(String(seen[0].init.body));
  assert.deepEqual(body.to, ["a@b.c"]);
  assert.equal(body.headers["List-Unsubscribe"], "<u>");
});

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://ref.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  REWARDS_WORKER_SECRET: "worker-secret",
  REWARDS_APP_NAME: "Acme",
};
const BASE = "https://ref.supabase.co/functions/v1/rewards";

function handler(env: Record<string, string>, db: FakeDb, mailer: Mailer | null) {
  const logs: string[] = [];
  return {
    h: createHandler({ env: (n) => env[n], db: () => db, mailer: () => mailer, log: (l) => logs.push(l) }),
    logs,
  };
}

Deno.test("route /followups: bearer required; dry run unless REWARDS_EMAIL_DRY_RUN=false and a mailer exists", async () => {
  const db = new FakeDb({
    rewards_svc_followup_claim: (p) => [email({ send_id: p.dry_run ? null : "send-1" })],
    rewards_svc_followup_finish: () => true,
  });
  const mailer = new FakeMailer();
  const { h, logs } = handler(ENV, db, mailer);
  assert.equal((await h(new Request(`${BASE}/followups`, { method: "POST" }))).status, 401);
  const dry = await (await h(
    new Request(`${BASE}/followups`, { method: "POST", headers: { Authorization: "Bearer worker-secret" } }),
  )).json();
  assert.equal(dry.dryRun, true);
  assert.equal(mailer.sent.length, 0);
  const live = handler({ ...ENV, REWARDS_EMAIL_DRY_RUN: "false" }, db, mailer);
  const r = await (await live.h(
    new Request(`${BASE}/followups`, { method: "POST", headers: { Authorization: "Bearer worker-secret" } }),
  )).json();
  assert.deepEqual({ dryRun: r.dryRun, sent: r.sent }, { dryRun: false, sent: 1 });
  const noMailer = handler({ ...ENV, REWARDS_EMAIL_DRY_RUN: "false" }, db, null);
  assert.equal(
    (await (await noMailer.h(
      new Request(`${BASE}/followups`, { method: "POST", headers: { Authorization: "Bearer worker-secret" } }),
    )).json()).dryRun,
    true,
    "no Resend key: still a dry run",
  );
  assert.ok(!logs.join("").includes("asha@example.test"), "addresses never logged");
});

Deno.test("route /unsubscribe: GET shows a button and changes nothing; POST unsubscribes", async () => {
  const db = new FakeDb({ rewards_svc_followup_unsubscribe: (p) => ({ ok: p.token === TOKEN }) });
  const { h } = handler(ENV, db, null);
  const get = await h(new Request(`${BASE}/unsubscribe?t=${TOKEN}`));
  assert.equal(get.status, 200);
  assert.ok((await get.text()).includes('<form method="post">'));
  assert.equal(db.calls.length, 0, "opening the link (mail scanners) never unsubscribes");
  const post = await h(new Request(`${BASE}/unsubscribe?t=${TOKEN}`, { method: "POST" }));
  assert.equal(post.status, 200);
  assert.ok((await post.text()).includes("You will not get these Acme emails again."));
  assert.equal((await h(new Request(`${BASE}/unsubscribe?t=not-a-token`, { method: "POST" }))).status, 400);
  assert.equal(
    (await h(new Request(`${BASE}/unsubscribe?t=99999999-2222-4333-8444-555555555555`, { method: "POST" }))).status,
    404,
  );
});
