// deno test for index.ts (routes, webhook auth, worker auth and run) and process.ts. No network.
import assert from "./test_assert.ts";
import { createHandler, type Deps, findStart, safeEqual } from "./index.ts";
import { processEvent } from "./process.ts";
import { FakeDb, FakeRevenueCat, signedRequest, storeSub } from "./test_fakes.ts";
import initialNormal from "./fixtures/initial_purchase_normal.json" with { type: "json" };

const NOW = 1_762_003_700_000;
const T = Math.floor(NOW / 1000);
const URL_BASE = "http://localhost/functions/v1/referral";
const ENV: Record<string, string> = {
  REFERRAL_WEBHOOK_TOKEN: "test-webhook-token-not-real",
  REVENUECAT_WEBHOOK_SIGNING_SECRET: "test-signing-secret-not-real",
  REFERRAL_WORKER_SECRET: "test-worker-secret-not-real",
  REVENUECAT_SECRET_KEY: "test-revenuecat-key-not-real",
  REVENUECAT_PROJECT_ID: "proj_test",
  SUPABASE_URL: "http://db.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-not-real",
};
const BODY = JSON.stringify(initialNormal);

function setup(env: Record<string, string> = ENV, handlers: ConstructorParameters<typeof FakeDb>[0] = {}) {
  const db = new FakeDb({
    referral_svc_ingest_event: () => "stored",
    referral_svc_event_context: () => null,
    ...handlers,
  });
  const rc = new FakeRevenueCat();
  const logs: string[] = [];
  const pending: Promise<unknown>[] = [];
  const deps: Deps = {
    env: (n) => env[n],
    db: () => db,
    revenuecat: () => rc,
    now: () => NOW,
    waitUntil: (p) => void pending.push(p),
    grant: { sleep: () => Promise.resolve(), verifyDelayMs: 0 },
    log: (l) => void logs.push(l),
  };
  return { handler: createHandler(deps), db, rc, logs, pending };
}

const sign = (o: Partial<Parameters<typeof signedRequest>[2]> = {}, body = BODY) =>
  signedRequest(`${URL_BASE}/webhook`, body, {
    token: ENV.REFERRAL_WEBHOOK_TOKEN,
    secret: ENV.REVENUECAT_WEBHOOK_SIGNING_SECRET,
    t: T,
    ...o,
  });

Deno.test("routes: unknown path 404, wrong method 405", async () => {
  const { handler, db } = setup();
  assert.equal((await handler(new Request(`${URL_BASE}/other`, { method: "POST" }))).status, 404);
  assert.equal((await handler(new Request(`${URL_BASE}`))).status, 404);
  assert.equal((await handler(new Request(`${URL_BASE}/webhook`))).status, 405);
  assert.equal((await handler(new Request(`${URL_BASE}/worker`, { method: "PUT" }))).status, 405);
  assert.equal(db.calls.length, 0);
});

Deno.test("safeEqual", async () => {
  assert.ok(await safeEqual("abc", "abc"));
  assert.ok(!(await safeEqual("abc", "abd")));
  assert.ok(!(await safeEqual("abc", "abcd")));
});

Deno.test("webhook: happy path → 200 stored, then processed via waitUntil", async () => {
  const { handler, db, pending } = setup();
  const res = await handler(await sign());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "stored" });
  const ev = db.called("referral_svc_ingest_event")[0].params.event as Record<string, unknown>;
  assert.equal(ev.event_id, "EVT-0000-INITIAL-NORMAL");
  assert.ok(!JSON.stringify(ev).includes("friend@example.com"), "subscriber_attributes never stored");
  assert.equal(pending.length, 1);
  await Promise.all(pending);
  assert.equal(db.called("referral_svc_event_context").length, 1);
});

Deno.test("webhook: 'Bearer <token>' is accepted too", async () => {
  const { handler } = setup();
  assert.equal((await handler(await sign({ token: `Bearer ${ENV.REFERRAL_WEBHOOK_TOKEN}` }))).status, 200);
});

Deno.test("webhook: no waitUntil → processed before the response", async () => {
  const env = (n: string) => ENV[n];
  const db = new FakeDb({ referral_svc_ingest_event: () => "stored", referral_svc_event_context: () => null });
  const handler = createHandler({ env, db: () => db, now: () => NOW, waitUntil: null, log: () => {} });
  assert.equal((await handler(await sign())).status, 200);
  assert.equal(db.called("referral_svc_event_context").length, 1);
});

Deno.test("webhook: bad or missing token → 401 before any database call", async () => {
  for (
    const token of [
      "wrong",
      "",
      null,
      `Bearer wrong`,
      `${ENV.REFERRAL_WEBHOOK_TOKEN}x`,
      `Basic ${ENV.REFERRAL_WEBHOOK_TOKEN}`,
    ]
  ) {
    const { handler, db } = setup();
    assert.equal((await handler(await sign({ token }))).status, 401, String(token));
    assert.equal(db.calls.length, 0);
  }
});

Deno.test("webhook: bad, missing or stale signature → 401", async () => {
  const cases = [
    { signature: null },
    { signature: "t=1,v1=00" },
    { secret: "another-secret" },
    { t: T - 11 * 60 },
    { t: T + 11 * 60 },
  ];
  for (const c of cases) {
    const { handler, db } = setup();
    assert.equal((await handler(await sign(c))).status, 401, JSON.stringify(c));
    assert.equal(db.calls.length, 0);
  }
});

Deno.test("webhook: body changed after signing → 401", async () => {
  const { handler } = setup();
  const good = await sign();
  const tampered = new Request(good.url, { method: "POST", headers: good.headers, body: BODY.replace("2.39", "9.99") });
  assert.equal((await handler(tampered)).status, 401);
});

Deno.test("webhook: malformed (signed) body → 400, nothing stored", async () => {
  for (const body of ["not json", "{}", '{"event":{"id":"x"}}']) {
    const { handler, db } = setup();
    assert.equal((await handler(await sign({}, body))).status, 400, body);
    assert.equal(db.calls.length, 0);
  }
});

Deno.test("webhook: duplicate → 200 duplicate, not processed again", async () => {
  const { handler, db, pending } = setup(ENV, { referral_svc_ingest_event: () => "duplicate" });
  const res = await handler(await sign());
  assert.deepEqual(await res.json(), { status: "duplicate" });
  assert.equal(pending.length, 0);
  assert.equal(db.called("referral_svc_event_context").length, 0);
});

Deno.test("webhook: ingest failure → 500 so RevenueCat retries", async () => {
  const { handler } = setup(ENV, {
    referral_svc_ingest_event: () => {
      throw new Error("db down");
    },
  });
  assert.equal((await handler(await sign())).status, 500);
});

Deno.test("missing env → 503 not configured, never a crash", async () => {
  for (const drop of ["REFERRAL_WEBHOOK_TOKEN", "REVENUECAT_WEBHOOK_SIGNING_SECRET", "SUPABASE_URL"]) {
    const env = { ...ENV };
    delete env[drop];
    const { handler, db } = setup(env);
    assert.equal((await handler(await sign())).status, 503, drop);
    assert.equal(db.calls.length, 0);
  }
  for (
    const drop of [
      "REFERRAL_WORKER_SECRET",
      "REVENUECAT_SECRET_KEY",
      "REVENUECAT_PROJECT_ID",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]
  ) {
    const env = { ...ENV };
    delete env[drop];
    const { handler } = setup(env);
    const req = new Request(`${URL_BASE}/worker`, {
      method: "POST",
      headers: { "X-Referral-Worker-Secret": ENV.REFERRAL_WORKER_SECRET },
    });
    assert.equal((await handler(req)).status, 503, drop);
  }
});

function workerDb(extra: ConstructorParameters<typeof FakeDb>[0] = {}) {
  return {
    referral_svc_sweep: () => ({ leases_released: 0, alerts: { failed_rewards: 0 }, banked_users: [] }),
    referral_svc_worker_plan: () => ({
      worker_batch: 20,
      worker_time_budget_seconds: 100,
      entitlement_id: "premium",
      banked_check_due: false,
    }),
    referral_svc_pending_events: () => ({ run: [], need_start: [], failed_for_owner: 0 }),
    referral_svc_claim_reward: () => null,
    ...extra,
  };
}

const workerReq = (secret: string | null = ENV.REFERRAL_WORKER_SECRET) =>
  new Request(`${URL_BASE}/worker`, {
    method: "POST",
    headers: secret === null ? {} : { "X-Referral-Worker-Secret": secret },
  });

Deno.test("worker: wrong or missing secret → 401 before any database call", async () => {
  for (const s of [null, "", "wrong", `${ENV.REFERRAL_WORKER_SECRET}x`]) {
    const { handler, db } = setup(ENV, workerDb());
    assert.equal((await handler(workerReq(s))).status, 401, String(s));
    assert.equal(db.calls.length, 0);
  }
});

Deno.test("worker: sweep, events, starts, banked check, grants, alert line and summary", async () => {
  const BANKED = "5a5a5a5a-0000-4000-8000-0000000000b1";
  const STILL = "5a5a5a5a-0000-4000-8000-0000000000b2";
  const FRIEND = "5a5a5a5a-0000-4000-8000-0000000000f1";
  const { handler, db, rc, logs } = setup(
    ENV,
    workerDb({
      referral_svc_sweep: () => ({
        alerts: { failed_rewards: 2, privacy_problems: 0 },
        banked_users: [BANKED, STILL],
        banked: [{ user_id: BANKED, entitlement_ids: ["premium"] }, { user_id: STILL, entitlement_ids: ["premium"] }],
      }),
      referral_svc_worker_plan: () => ({
        worker_batch: 20,
        worker_time_budget_seconds: 100,
        entitlement_id: "premium",
        banked_check_due: true,
      }),
      referral_svc_pending_events: () => ({
        run: ["e-run"],
        need_start: [{
          original_transaction_id: "ot-9",
          app_user_ids: ["$RCAnonymousID:1", FRIEND],
          event_ids: ["e-wait"],
          transaction_ids: ["t-9c"],
          store: "app_store",
          environment: "production",
        }],
        failed_for_owner: 1,
      }),
      referral_svc_fill_start: () => 1,
      referral_svc_release_banked_keys: () => 3,
    }),
  );
  rc.add(FRIEND, { subs: [storeSub({ store_subscription_identifier: "t-9c", starts_at: 4242 })] });
  rc.add(BANKED, { subs: [storeSub({ gives_access: false })] });
  rc.add(STILL, { subs: [storeSub()] });
  const res = await handler(workerReq());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(db.called("referral_svc_fill_start")[0].params, {
    original_transaction_id: "ot-9",
    starts_at_ms: 4242,
  });
  assert.deepEqual(
    db.called("referral_svc_event_context").map((c) => c.params.event_id),
    ["e-run", "e-wait"],
    "the received event, then the one whose start was filled",
  );
  assert.deepEqual(db.called("referral_svc_release_banked_keys").map((c) => c.params), [
    { user_id: BANKED, entitlement_ids: ["premium"] },
  ]);
  assert.deepEqual(body.banked, { checked: true, released: 3 });
  assert.deepEqual(body.starts, { filled: 1, not_found: 0, given_up: 0 });
  assert.equal(db.calls[0].fn, "referral_svc_sweep");
  const alert = JSON.parse(logs.find((l) => l.includes('"alert"'))!);
  assert.equal(alert.alerts.failed_rewards, 2);
  assert.equal(alert.alerts.failed_events_total, 1);
  assert.ok(!("privacy_problems" in alert.alerts), "zero counts are not alerts");
  assert.ok(!logs.join("").includes(ENV.REVENUECAT_SECRET_KEY));
});

Deno.test("worker: a waiting transaction without a matching subscription stays waiting, reported, not alerted", async () => {
  const { handler, db, logs } = setup(
    ENV,
    workerDb({
      referral_svc_pending_events: () => ({
        run: [],
        need_start: [{
          original_transaction_id: "ot-1",
          app_user_ids: ["5a5a5a5a-0000-4000-8000-0000000000f9"],
          event_ids: ["e"],
          transaction_ids: [],
          store: "app_store",
          environment: "production",
        }],
        failed_for_owner: 0,
      }),
    }),
  );
  const body = await (await handler(workerReq())).json();
  assert.deepEqual(body.starts, { filled: 0, not_found: 1, given_up: 0 });
  assert.equal(db.called("referral_svc_fill_start").length, 0);
  assert.ok(!logs.some((l) => l.includes("starts_not_found")), "waiting inside the window is not an alert any more");
  assert.ok(!logs.some((l) => l.includes('"alert"')));
});

Deno.test("worker: events the sweep gave up on (no start within paid_window_days) are alerted once", async () => {
  const { handler, logs } = setup(
    ENV,
    workerDb({
      referral_svc_sweep: () => ({ alerts: { failed_rewards: 0, starts_given_up: 2 }, starts_given_up: 2, banked: [] }),
    }),
  );
  const body = await (await handler(workerReq())).json();
  assert.deepEqual(body.starts, { filled: 0, not_found: 0, given_up: 2 });
  const alert = JSON.parse(logs.find((l) => l.includes('"alert"'))!);
  assert.equal(alert.alerts.starts_given_up, 2);
});

function bankedSetup(banked: unknown, extra: ConstructorParameters<typeof FakeDb>[0] = {}) {
  return setup(
    ENV,
    workerDb({
      referral_svc_sweep: () => ({ alerts: {}, ...(banked as Record<string, unknown>) }),
      referral_svc_worker_plan: () => ({
        worker_batch: 20,
        worker_time_budget_seconds: 100,
        entitlement_id: "premium",
        banked_check_due: true,
      }),
      referral_svc_release_banked_keys: (p) => (p.entitlement_ids as string[]).length,
      ...extra,
    }),
  );
}

Deno.test("worker: banked check releases per entitlement, including a rule's own params.entitlement_id", async () => {
  const U = "5a5a5a5a-0000-4000-8000-0000000000c1";
  const { handler, db, rc } = bankedSetup({ banked: [{ user_id: U, entitlement_ids: ["premium", "pro"] }] });
  rc.entitlements.set("pro", "entl_pro");
  // an active premium subscription; no pro one
  rc.add(U, { subs: [storeSub()] });
  const body = await (await handler(workerReq())).json();
  assert.deepEqual(db.called("referral_svc_release_banked_keys").map((c) => c.params), [
    { user_id: U, entitlement_ids: ["pro"] },
  ]);
  assert.deepEqual(body.banked, { checked: true, released: 1 });
});

Deno.test("worker: banked check without a settings entitlement still runs from the sweep's per-entitlement list", async () => {
  const U = "5a5a5a5a-0000-4000-8000-0000000000c2";
  const { handler, db, rc } = bankedSetup({ banked: [{ user_id: U, entitlement_ids: ["pro"] }] }, {
    referral_svc_worker_plan: () => ({
      worker_batch: 20,
      worker_time_budget_seconds: 100,
      entitlement_id: null,
      banked_check_due: true,
    }),
  });
  rc.entitlements.set("pro", "entl_pro");
  rc.add(U, { subs: [] });
  await handler(workerReq());
  assert.deepEqual(db.called("referral_svc_release_banked_keys").map((c) => c.params.entitlement_ids), [["pro"]]);
});

Deno.test("worker: banked check against an older sweep (banked_users only) uses settings.entitlement_id", async () => {
  const U = "5a5a5a5a-0000-4000-8000-0000000000c3";
  const { handler, db, rc } = bankedSetup({ banked_users: [U] });
  rc.add(U, { subs: [] });
  await handler(workerReq());
  assert.deepEqual(db.called("referral_svc_release_banked_keys").map((c) => c.params), [
    { user_id: U, entitlement_ids: ["premium"] },
  ]);
});

Deno.test("worker: banked check keeps the days banked when a subscription's entitlements cannot be read", async () => {
  const U = "5a5a5a5a-0000-4000-8000-0000000000c4";
  const { handler, db, rc } = bankedSetup({ banked: [{ user_id: U, entitlement_ids: ["premium"] }] });
  rc.add(U, { subs: [storeSub({ entitlements: null })] });
  rc.subOverride.set("sub_1", storeSub({ entitlements: null }));
  const body = await (await handler(workerReq())).json();
  assert.equal(db.called("referral_svc_release_banked_keys").length, 0, "unsure → not released");
  assert.ok(rc.calls.includes("sub:sub_1"), "the subscription was read again first");
  assert.equal(body.errors.length, 1);
  assert.ok(body.errors[0].includes("entitlements unknown"));
});

Deno.test("findStart: matches original or a seen transaction id, same store and environment", () => {
  const need = {
    original_transaction_id: "ot",
    app_user_ids: [],
    event_ids: [],
    transaction_ids: ["t2"],
    store: "APP_STORE",
    environment: "PRODUCTION",
  };
  assert.equal(findStart([storeSub({ store_subscription_identifier: "ot", starts_at: 7 })], need), 7);
  assert.equal(findStart([storeSub({ store_subscription_identifier: "t2", starts_at: 8 })], need), 8);
  assert.equal(findStart([storeSub({ store_subscription_identifier: "zz", starts_at: 9 })], need), null);
  assert.equal(findStart([storeSub({ store_subscription_identifier: "ot", store: "play_store" })], need), null);
  assert.equal(findStart([storeSub({ store_subscription_identifier: "ot", environment: "sandbox" })], need), null);
});

// process.ts ---------------------------------------------------------------------------------------------------------

function ctxJson(type: string, fields: Record<string, unknown>, state = "received") {
  return {
    event: { event_id: "e", type, event_timestamp_ms: NOW, fields, state },
    settings: { entitlement_id: "premium", allow_sandbox: false, paid_window_days: 90, paid_enabled: true },
    transaction: null,
    referrals: [],
    fingerprint: "fp",
    now_ms: NOW,
  };
}

Deno.test("process: retry loops at most 3 times, then marks the event failed", async () => {
  const db = new FakeDb({
    referral_svc_event_context: () => ctxJson("RENEWAL", {}),
    referral_svc_apply_event: () => "retry",
    referral_svc_mark_event_failed: () => "will_retry",
  });
  const r = await processEvent(db, "e");
  assert.equal(r.status, "failed");
  assert.equal(db.called("referral_svc_apply_event").length, 3);
  assert.equal(db.called("referral_svc_mark_event_failed").length, 1);
});

Deno.test("process: retry then applied", async () => {
  let n = 0;
  const db = new FakeDb({
    referral_svc_event_context: () => ctxJson("RENEWAL", {}),
    referral_svc_apply_event: () => (++n === 1 ? "retry" : "applied"),
  });
  assert.equal((await processEvent(db, "e")).status, "applied");
});

Deno.test("process: a thrown error marks the event failed with the error", async () => {
  const db = new FakeDb({
    referral_svc_event_context: () => ctxJson("RENEWAL", {}),
    referral_svc_apply_event: () => {
      throw new Error("breaks a precondition");
    },
    referral_svc_mark_event_failed: () => "alert_owner",
  });
  const r = await processEvent(db, "e");
  assert.deepEqual(r.status === "failed" && r.mark, "alert_owner");
  assert.ok(String(db.called("referral_svc_mark_event_failed")[0].params.error).includes("precondition"));
});

Deno.test("process: unknown event and already processed event stop early", async () => {
  const db = new FakeDb({ referral_svc_event_context: () => null });
  assert.equal((await processEvent(db, "x")).status, "unknown_event");
  const db2 = new FakeDb({ referral_svc_event_context: () => ctxJson("RENEWAL", {}, "processed") });
  assert.equal((await processEvent(db2, "x")).status, "already_done");
  assert.equal(db2.called("referral_svc_apply_event").length, 0);
});

Deno.test("process: store EXPIRATION releases banked days of the entitlements it names, for UUID users only", async () => {
  const U = "5a5a5a5a-0000-4000-8000-000000000001";
  const run = async (fields: Record<string, unknown>) => {
    const db = new FakeDb({
      referral_svc_event_context: () => ctxJson("EXPIRATION", fields),
      referral_svc_apply_event: () => "applied",
      referral_svc_release_banked_keys: () => 1,
    });
    await processEvent(db, "e");
    return db.called("referral_svc_release_banked_keys").map((c) => c.params);
  };
  const base = { app_user_id: U, aliases: ["$RCAnonymousID:1", U], entitlement_ids: ["premium"], store: "APP_STORE" };
  assert.deepEqual(await run(base), [{ user_id: U, entitlement_ids: ["premium"] }]);
  assert.deepEqual(await run({ ...base, store: "PROMOTIONAL" }), [], "a promotional expiry never releases");
  assert.deepEqual(
    await run({ ...base, entitlement_ids: ["other"] }),
    [{ user_id: U, entitlement_ids: ["other"] }],
    "another entitlement (a rule's params.entitlement_id) is released for that entitlement",
  );
  assert.deepEqual(await run({ ...base, entitlement_ids: [] }), []);
  assert.deepEqual(await run({ ...base, store: undefined }), []);
});
