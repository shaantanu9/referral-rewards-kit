// deno test for grant.ts against a fake RevenueCat and a scripted database (ADR 6.4, 6.5).
import assert from "./test_assert.ts";
import { type ClaimedReward, grantOne, runGrants } from "./grant.ts";
import { FakeDb, FakeRevenueCat, storeSub } from "./test_fakes.ts";
import { RevenueCatError } from "./revenuecat.ts";

const NOW = 1_770_000_000_000;
const DAY = 86_400_000;
const SHARER = "5a5a5a5a-0000-4000-8000-000000000001";
const FRIEND = "5a5a5a5a-0000-4000-8000-000000000002";

function claim(over: Partial<ClaimedReward> = {}): ClaimedReward {
  return {
    reward_id: "w-1",
    attempt_token: "tok-1",
    user_id: SHARER,
    event: "joined",
    entitlement_id: "premium",
    days: 5,
    params: null,
    target_expires_at_ms: null,
    attempts: 1,
    user_deleted: false,
    friend_id: FRIEND,
    friend_deleted: false,
    transaction: { first_purchased_at_ms: 1_000, store: "app_store", environment: "production", refunded: false },
    ...over,
  };
}

function db(opts: { seen?: string[]; lostLease?: boolean; finish?: string } = {}) {
  let target: number | null = null;
  return new FakeDb({
    referral_svc_set_target: (p) => {
      if (opts.lostLease) return { status: "lost_lease" };
      target ??= p.target_expires_at_ms as number;
      return { status: "ok", target_expires_at_ms: target };
    },
    referral_svc_finish_reward: (p) => opts.finish ?? (p.outcome === "retry" ? "failed_retryable" : p.outcome),
    referral_svc_seen_ids: (p) => (p.ids as string[]).map((i) => (opts.seen ?? []).includes(i)),
  });
}

const fast = { now: () => NOW, sleep: () => Promise.resolve(), verifyDelayMs: 0 };

function finish(d: FakeDb) {
  const c = d.called("referral_svc_finish_reward");
  assert.equal(c.length, 1, "one finish call");
  return c[0].params;
}

Deno.test("grant: existing customer, no entitlement → target now + days, granted and verified", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER);
  const d = db();
  const r = await grantOne(d, rc, claim(), fast);
  assert.equal(r.outcome, "granted");
  assert.equal(d.called("referral_svc_set_target")[0].params.target_expires_at_ms, NOW + 5 * DAY);
  assert.equal(rc.customers.get(SHARER)!.active.get("entl_premium"), NOW + 5 * DAY);
  assert.equal(finish(d).attempt_token, "tok-1");
});

Deno.test("grant: target extends the latest active promotional expiry", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER, { active: new Map([["entl_premium", NOW + 3 * DAY]]) });
  rc.promoExpiry.set(`${SHARER}:entl_premium`, NOW + 3 * DAY);
  const d = db();
  assert.equal((await grantOne(d, rc, claim(), fast)).outcome, "granted");
  assert.equal(d.called("referral_svc_set_target")[0].params.target_expires_at_ms, NOW + 8 * DAY);
});

Deno.test("grant: 404 on the sharer → create the customer, then grant", async () => {
  const rc = new FakeRevenueCat();
  const d = db();
  const r = await grantOne(d, rc, claim(), fast);
  assert.equal(r.outcome, "granted");
  assert.ok(rc.calls.includes(`create:${SHARER}`));
});

Deno.test("grant: active store subscription for the entitlement → banked (no target, no grant)", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER, { subs: [storeSub()], active: new Map([["entl_premium", NOW + 20 * DAY]]) });
  const d = db();
  assert.equal((await grantOne(d, rc, claim(), fast)).outcome, "banked");
  assert.equal(d.called("referral_svc_set_target").length, 0);
  assert.ok(!rc.calls.some((c) => c.startsWith("grant:")));
});

Deno.test("grant: a store subscription for another entitlement, or a promotional one, does not bank", async () => {
  for (
    const s of [
      storeSub({ entitlements: { items: [{ id: "entl_other", lookup_key: "other" }] } }),
      storeSub({ store: "promotional" }),
      storeSub({ gives_access: false }),
    ]
  ) {
    const rc = new FakeRevenueCat();
    rc.add(SHARER, { subs: [s] });
    assert.equal((await grantOne(db(), rc, claim(), fast)).outcome, "granted");
  }
});

Deno.test("grant: lifetime (active entitlement without expiry) → cancelled 'lifetime'", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER, { active: new Map([["entl_premium", null]]) });
  const d = db();
  assert.equal((await grantOne(d, rc, claim(), fast)).outcome, "cancelled");
  assert.equal(finish(d).error, "lifetime");
});

Deno.test("grant: lifetime without params.fallback → exactly today's cancel, no fallback call", async () => {
  for (const params of [null, {}, { entitlement_id: "premium" }, { fallback: null }, { fallback: "coins" }]) {
    const rc = new FakeRevenueCat();
    rc.add(SHARER, { active: new Map([["entl_premium", null]]) });
    const d = db();
    const r = await grantOne(d, rc, claim({ params }), fast);
    assert.deepEqual([r.outcome, r.state, r.error], ["cancelled", "cancelled", "lifetime"], JSON.stringify(params));
    assert.deepEqual(finish(d), {
      reward_id: "w-1",
      attempt_token: "tok-1",
      outcome: "cancelled",
      error: "lifetime",
      retry_after_seconds: null,
    });
    assert.equal(d.called("referral_svc_fallback_reward").length, 0);
  }
});

Deno.test("grant: lifetime with params.fallback → the fallback reward, no RevenueCat grant, no finish", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER, { active: new Map([["entl_premium", null]]) });
  const d = db();
  d.handlers.referral_svc_fallback_reward = () => "granted";
  const r = await grantOne(d, rc, claim({ params: { fallback: { kind: "coins", amount: 50 } } }), fast);
  assert.deepEqual([r.outcome, r.state, r.error], ["fallback", "granted", null]);
  assert.deepEqual(d.called("referral_svc_fallback_reward")[0].params, { reward_id: "w-1", attempt_token: "tok-1" });
  assert.equal(d.called("referral_svc_finish_reward").length, 0);
  assert.equal(d.called("referral_svc_set_target").length, 0);
  assert.ok(!rc.calls.some((c) => c.startsWith("grant:")));
});

Deno.test("grant: lifetime fallback answers: hook failed, lost lease, or SQL found no valid fallback → lifetime", async () => {
  const run = async (answer: string) => {
    const rc = new FakeRevenueCat();
    rc.add(SHARER, { active: new Map([["entl_premium", null]]) });
    const d = db();
    d.handlers.referral_svc_fallback_reward = () => answer;
    const r = await grantOne(d, rc, claim({ params: { fallback: { kind: "coins", amount: 50 } } }), fast);
    return { r, finishes: d.called("referral_svc_finish_reward").map((c) => c.params) };
  };
  const failed = await run("failed");
  assert.deepEqual([failed.r.outcome, failed.r.state, failed.finishes.length], ["fallback", "failed", 0]);
  const lost = await run("lost_lease");
  assert.deepEqual([lost.r.outcome, lost.finishes.length], ["lost_lease", 0]);
  const none = await run("no_fallback");
  assert.deepEqual([none.r.outcome, none.r.error], ["cancelled", "lifetime"]);
  assert.equal(none.finishes[0].error, "lifetime");
});

Deno.test("grant: a subscription whose entitlements list has a next page is read in full before deciding", async () => {
  const rc = new FakeRevenueCat();
  const page1 = {
    items: [{ id: "entl_a", lookup_key: "a" }],
    next_page: "/v2/projects/p/subscriptions/sub_1/entitlements?starting_after=entl_a",
  };
  rc.add(SHARER, { subs: [storeSub({ entitlements: page1 })], active: new Map([["entl_premium", NOW + 20 * DAY]]) });
  rc.subEntitlements.set("sub_1", [{ id: "entl_a", lookup_key: "a" }, { id: "entl_premium", lookup_key: "premium" }]);
  assert.equal((await grantOne(db(), rc, claim(), fast)).outcome, "banked", "premium was on the second page");
  assert.ok(rc.calls.includes("sub_ents:sub_1"));

  const rc2 = new FakeRevenueCat();
  rc2.add(SHARER, { subs: [storeSub({ entitlements: page1 })] });
  rc2.subEntitlements.set("sub_1", [{ id: "entl_a", lookup_key: "a" }, { id: "entl_b", lookup_key: "b" }]);
  assert.equal((await grantOne(db(), rc2, claim(), fast)).outcome, "granted", "not on any page → not banked");
});

Deno.test("grant: a single-page entitlements list is not fetched again", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER, {
    subs: [storeSub({ entitlements: { items: [{ id: "entl_premium", lookup_key: "premium" }], next_page: null } })],
  });
  assert.equal((await grantOne(db(), rc, claim(), fast)).outcome, "banked");
  assert.ok(!rc.calls.some((c) => c.startsWith("sub_ents:") || c.startsWith("sub:")));
});

Deno.test("grant: a subscription without its entitlements list is read again; still missing → retry, never assumed", async () => {
  // re-read finds the list holding premium → banked
  const rc = new FakeRevenueCat();
  rc.add(SHARER, { subs: [storeSub({ entitlements: undefined })] });
  rc.subOverride.set("sub_1", storeSub());
  assert.equal((await grantOne(db(), rc, claim(), fast)).outcome, "banked");
  assert.ok(rc.calls.includes("sub:sub_1"));

  // re-read finds a list without premium → granted
  const rc2 = new FakeRevenueCat();
  rc2.add(SHARER, { subs: [storeSub({ entitlements: null })] });
  rc2.subOverride.set("sub_1", storeSub({ entitlements: { items: [{ id: "entl_other", lookup_key: "other" }] } }));
  assert.equal((await grantOne(db(), rc2, claim(), fast)).outcome, "granted");

  // still missing, gone (404) or no subscription id → retry with the reason, no grant
  for (
    const mk of [
      (r: FakeRevenueCat) => r.subOverride.set("sub_1", storeSub({ entitlements: null })),
      (r: FakeRevenueCat) => r.fail.sub = [new RevenueCatError("not_found", "get_subscription", 404)],
      (r: FakeRevenueCat) => r.customers.get(SHARER)!.subs[0].id = undefined as unknown as string,
    ]
  ) {
    const rc3 = new FakeRevenueCat();
    rc3.add(SHARER, { subs: [storeSub({ entitlements: null })] });
    rc3.subOverride.set("sub_1", storeSub({ entitlements: null }));
    mk(rc3);
    const d = db();
    const r = await grantOne(d, rc3, claim(), fast);
    assert.equal(r.outcome, "retry");
    assert.equal(finish(d).error, "subscription entitlements unknown");
    assert.ok(!rc3.calls.some((c) => c.startsWith("grant:")));
  }
});

Deno.test("grant: an entitlements page read that fails with 5xx → retry", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER, { subs: [storeSub({ entitlements: { items: [], next_page: "/v2/next" } })] });
  rc.subEntitlements.set("sub_1", []);
  rc.fail.sub_ents = [new RevenueCatError("server", "list_subscription_entitlements", 503)];
  assert.equal((await grantOne(db(), rc, claim(), fast)).outcome, "retry");
});

Deno.test("grant: ignored duplicate (another promo grant within 2 h of the target) → failed, never granted", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER);
  const target = NOW + 5 * DAY;
  // a grant the app made itself, after step 2 stored the target: RevenueCat ignores ours as a duplicate
  rc.promoExpiry.set(`${SHARER}:entl_premium`, target - 3600_000);
  rc.customers.get(SHARER)!.active.set("entl_premium", target - 3600_000);
  const d = db();
  const r = await grantOne(d, rc, claim({ target_expires_at_ms: target }), fast);
  assert.equal(r.outcome, "failed");
  assert.ok(String(finish(d).error).startsWith("verify"));
});

Deno.test("grant: the grant response without active_entitlements is verified by reading the customer", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER);
  rc.grantReturnsEntitlements = false;
  assert.equal((await grantOne(db(), rc, claim(), fast)).outcome, "granted");
  assert.equal(rc.calls.filter((c) => c === `get:${SHARER}`).length, 2, "step 2 read + verify read");
});

Deno.test("grant: a stored target is resent as is (no step 2)", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER);
  const d = db();
  assert.equal((await grantOne(d, rc, claim({ target_expires_at_ms: NOW + 7 * DAY }), fast)).outcome, "granted");
  assert.equal(d.called("referral_svc_set_target").length, 0);
  assert.ok(rc.calls.includes(`grant:${SHARER}:${NOW + 7 * DAY}`));
});

Deno.test("grant: 429 → retry with Retry-After seconds", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER);
  rc.fail.grant = [new RevenueCatError("rate_limited", "grant_entitlement", 429, 42)];
  const d = db();
  assert.equal((await grantOne(d, rc, claim(), fast)).outcome, "retry");
  assert.equal(finish(d).retry_after_seconds, 42);
});

Deno.test("grant: 5xx → retry; other 4xx → failed; 429 while listing → retry", async () => {
  const cases: [string, RevenueCatError, string][] = [
    ["grant", new RevenueCatError("server", "grant_entitlement", 503), "retry"],
    ["grant", new RevenueCatError("client", "grant_entitlement", 400), "failed"],
    ["subs", new RevenueCatError("rate_limited", "list_subscriptions", 429, 5), "retry"],
  ];
  for (const [op, err, want] of cases) {
    const rc = new FakeRevenueCat();
    rc.add(SHARER);
    rc.fail[op] = [err];
    assert.equal((await grantOne(db(), rc, claim(), fast)).outcome, want, `${op} ${err.status}`);
  }
});

Deno.test("grant: timeout after the grant landed → re-read once → granted", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER);
  rc.fail.grant = ["timeout_after_landing"];
  let slept = -1;
  const r = await grantOne(db(), rc, claim(), {
    ...fast,
    verifyDelayMs: 1234,
    sleep: (ms) => (slept = ms, Promise.resolve()),
  });
  assert.equal(r.outcome, "granted");
  assert.equal(slept, 1234);
});

Deno.test("grant: timeout that never landed → retry (the same target is resent later)", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER);
  rc.fail.grant = [new RevenueCatError("timeout", "grant_entitlement", null)];
  const d = db();
  assert.equal((await grantOne(d, rc, claim(), fast)).outcome, "retry");
  assert.ok(d.called("referral_svc_set_target").length === 1, "target stored before the grant");
});

Deno.test("grant: lost lease at set_target → stop without RevenueCat grant or finish", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER);
  const d = db({ lostLease: true });
  assert.equal((await grantOne(d, rc, claim(), fast)).outcome, "lost_lease");
  assert.equal(d.called("referral_svc_finish_reward").length, 0);
  assert.ok(!rc.calls.some((c) => c.startsWith("grant:")));
});

Deno.test("grant: lost lease at finish is reported", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER);
  assert.equal((await grantOne(db({ finish: "lost_lease" }), rc, claim(), fast)).outcome, "lost_lease");
});

Deno.test("grant: deleted user → cancelled before any RevenueCat call", async () => {
  const rc = new FakeRevenueCat();
  const d = db();
  assert.equal((await grantOne(d, rc, claim({ user_deleted: true }), fast)).outcome, "cancelled");
  assert.deepEqual(rc.calls, []);
});

Deno.test("fresh check: matching seen transaction id → granted", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER);
  rc.add(FRIEND, { subs: [storeSub({ store_subscription_identifier: "tid-9", starts_at: 999_999 })] });
  const d = db({ seen: ["tid-9"] });
  assert.equal((await grantOne(d, rc, claim({ event: "paid" }), fast)).outcome, "granted");
  assert.deepEqual(d.called("referral_svc_seen_ids")[0].params.ids, ["tid-9"]);
});

Deno.test("fresh check: starts_at fallback match → granted", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER);
  rc.add(FRIEND, { subs: [storeSub({ store_subscription_identifier: "tid-new", starts_at: 1_000 })] });
  assert.equal((await grantOne(db(), rc, claim({ event: "paid" }), fast)).outcome, "granted");
});

Deno.test("fresh check: cancel when friend deleted, refunded, no subscription, or not active", async () => {
  const cases: [Partial<ClaimedReward>, ReturnType<typeof storeSub>[] | null][] = [
    [{ friend_deleted: true }, [storeSub()]],
    [{ transaction: { first_purchased_at_ms: 1_000, store: "app_store", environment: "production", refunded: true } }, [
      storeSub(),
    ]],
    [{}, null], // friend unknown to RevenueCat (404)
    [{}, [storeSub({ gives_access: false })]],
    [{}, [storeSub({ ownership: "family_shared" })]],
    [{}, [storeSub({ starts_at: 5_000_000, store_subscription_identifier: "unseen" })]],
  ];
  for (const [over, subs] of cases) {
    const rc = new FakeRevenueCat();
    rc.add(SHARER);
    if (subs) rc.add(FRIEND, { subs });
    const d = db();
    const r = await grantOne(d, rc, claim({ event: "paid", ...over }), fast);
    assert.equal(r.outcome, "cancelled", JSON.stringify(over));
    assert.ok(!rc.calls.some((c) => c.startsWith("grant:")), "no grant on a failed fresh check");
  }
});

Deno.test("runGrants: stops at the batch, at cap_reached, at the deadline and when the queue is empty", async () => {
  const rc = new FakeRevenueCat();
  rc.add(SHARER);
  let n = 0;
  const d = db();
  d.handlers.referral_svc_claim_reward =
    () => (++n <= 3 ? claim({ reward_id: `w-${n}`, attempt_token: `t-${n}` }) : null);
  let s = await runGrants(d, rc, { ...fast, batch: 2, deadlineMs: NOW + 1 });
  assert.equal(s.claimed, 2);
  s = await runGrants(d, rc, { ...fast, batch: 10, deadlineMs: NOW + 1 });
  assert.equal(s.claimed, 1, "queue empties after the third");
  d.handlers.referral_svc_claim_reward = () => ({ cap_reached: true });
  s = await runGrants(d, rc, { ...fast, batch: 10, deadlineMs: NOW + 1 });
  assert.ok(s.cap_reached && s.claimed === 0);
  s = await runGrants(d, rc, { ...fast, batch: 10, deadlineMs: NOW });
  assert.equal(s.claimed, 0, "no claim after the deadline");
});
