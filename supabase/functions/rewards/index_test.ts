// deno test for index.ts: routing, auth, configuration and the two routes end to end on fakes (ADR 0002 section 10).
import assert from "../referral/test_assert.ts";
import { FakeDb, FakeRevenueCat } from "../referral/test_fakes.ts";
import { createHandler, type Deps } from "./index.ts";
import type { GraphApi } from "./instagram.ts";
import { sign } from "./instagram_test.ts";

const ENV: Record<string, string> = {
  SUPABASE_URL: "http://db.test",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  REWARDS_WORKER_SECRET: "worker-secret",
  REVENUECAT_SECRET_KEY: "sk",
  REVENUECAT_PROJECT_ID: "proj",
  INSTAGRAM_VERIFY_TOKEN: "verify-me",
  INSTAGRAM_APP_SECRET: "test-app-secret",
  INSTAGRAM_ACCESS_TOKEN: "ig-token",
};
const BASE = "http://fn.test/functions/v1/rewards";

function setup(over: Partial<Deps> = {}, env: Record<string, string> = ENV) {
  const db = new FakeDb({
    rewards_svc_retry_local: () => 2,
    rewards_svc_expire_social: () => 1,
    rewards_svc_claim_grants: () => [],
    rewards_svc_verify_social: (p) => ({ matched: p.username === "reader.one", post_id: null, grants: 1 }),
  });
  const logs: string[] = [];
  const graph: GraphApi = {
    media: (m) => Promise.resolve({ username: m === "boom" ? null : "Reader.One", caption: "MYAPP-K7Q2HX" }),
    comment: () => Promise.reject(new Error("graph down")),
    user: () => Promise.resolve({ username: "stranger" }),
  };
  const handler = createHandler({
    env: (n) => env[n],
    db: () => db,
    revenuecat: () => new FakeRevenueCat(),
    graph: () => graph,
    now: () => 1_770_000_000_000,
    log: (l) => logs.push(l),
    ...over,
  });
  return { handler, db, logs };
}

const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, { method: "POST", body, headers });

Deno.test("unknown path 404, wrong methods 405", async () => {
  const { handler } = setup();
  assert.equal((await handler(new Request(`${BASE}/nope`))).status, 404);
  assert.equal((await handler(new Request(`${BASE}/worker`))).status, 405);
  assert.equal((await handler(new Request(`${BASE}/instagram`, { method: "PUT" }))).status, 405);
});

Deno.test("worker: missing config 503, missing or wrong bearer 401", async () => {
  assert.equal((await setup({}, { ...ENV, REWARDS_WORKER_SECRET: "" }).handler(post("/worker", ""))).status, 503);
  const { handler, db } = setup();
  assert.equal((await handler(post("/worker", ""))).status, 401);
  assert.equal((await handler(post("/worker", "", { Authorization: "Bearer wrong" }))).status, 401);
  assert.equal(
    (await handler(post("/worker", "", { Authorization: "worker-secret" }))).status,
    401,
    "no Bearer prefix",
  );
  assert.equal(db.calls.length, 0, "no database call before auth");
});

Deno.test("worker: retries local grants, expires social, then grants", async () => {
  const { handler, db } = setup();
  const res = await handler(post("/worker", "", { Authorization: "Bearer worker-secret" }));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(j, { local_granted: 2, social_expired: 1, claimed: 0, outcomes: {} });
  assert.deepEqual(db.calls.map((c) => c.fn), [
    "rewards_svc_retry_local",
    "rewards_svc_expire_social",
    "rewards_svc_claim_grants",
  ]);
});

Deno.test("worker: a database error is a 500 without details", async () => {
  const { handler, logs } = setup({
    db: () =>
      new FakeDb({
        rewards_svc_retry_local: () => {
          throw new Error("boom");
        },
      }),
  });
  const res = await handler(post("/worker", "", { Authorization: "Bearer worker-secret" }));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "internal error" });
  assert.ok(logs.some((l) => l.includes("rewards-worker")));
});

Deno.test("instagram GET: challenge echoed only with the right token", async () => {
  const { handler } = setup();
  const ok = await handler(
    new Request(`${BASE}/instagram?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`),
  );
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "12345");
  const bad = await handler(new Request(`${BASE}/instagram?hub.mode=subscribe&hub.verify_token=no&hub.challenge=1`));
  assert.equal(bad.status, 403);
  const mode = await handler(new Request(`${BASE}/instagram?hub.mode=x&hub.verify_token=verify-me&hub.challenge=1`));
  assert.equal(mode.status, 403);
});

Deno.test("instagram POST: bad signature 401 before any lookup", async () => {
  const { handler, db } = setup();
  const res = await handler(post("/instagram", "{}", { "X-Hub-Signature-256": "sha256=00" }));
  assert.equal(res.status, 401);
  assert.equal(db.calls.length, 0);
  assert.equal((await handler(post("/instagram", "{}"))).status, 401, "missing header");
});

Deno.test("instagram POST: invalid json after a valid signature → 400", async () => {
  const { handler } = setup();
  assert.equal(
    (await handler(post("/instagram", "not json", { "X-Hub-Signature-256": await sign("not json") }))).status,
    400,
  );
});

Deno.test("instagram POST: verifies each mention, lookup failures counted, always 200", async () => {
  const { handler, db, logs } = setup();
  const body = JSON.stringify({
    object: "instagram",
    entry: [{
      changes: [
        { field: "mentions", value: { media_id: "m1" } },
        { field: "mentions", value: { media_id: "m2", comment_id: "c2" } },
        { field: "mentions", value: { media_id: "boom" } },
      ],
      messaging: [{ sender: { id: "77" }, message: { mid: "s1", attachments: [{ type: "story_mention" }] } }],
    }],
  });
  const res = await handler(post("/instagram", body, { "X-Hub-Signature-256": await sign(body) }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { items: 4, dropped: 0, matched: 1, unmatched: 2, failed: 1 });
  const calls = db.called("rewards_svc_verify_social").map((c) => c.params);
  assert.deepEqual(calls[0], {
    platform: "instagram",
    username: "reader.one",
    caption: "MYAPP-K7Q2HX",
    media_id: "m1",
  });
  assert.equal(calls.length, 2, "media + story; the failed comment and the null username never reach the database");
  assert.ok(!logs.join("\n").includes("ig-token"), "token never logged");
  assert.ok(!logs.join("\n").includes("MYAPP-K7Q2HX"), "caption never logged");
});

Deno.test("instagram POST: missing config 503", async () => {
  const { handler } = setup({}, { ...ENV, INSTAGRAM_APP_SECRET: "" });
  assert.equal((await handler(post("/instagram", "{}"))).status, 503);
});
