// deno test for grant.ts: rewards entitlement_days against a fake RevenueCat and a scripted database (ADR 0002 7, 10.1).
import assert from "../referral/test_assert.ts";
import { FakeDb, FakeRevenueCat } from "../referral/test_fakes.ts";
import { RevenueCatError } from "../referral/revenuecat.ts";
import type { ClaimedGrant } from "./db.ts";
import { grantOne, runGrants } from "./grant.ts";

const NOW = 1_770_000_000_000;
const DAY = 86_400_000;
const USER = "5a5a5a5a-0000-4000-8000-0000000000aa";
const fast = { now: () => NOW, sleep: () => Promise.resolve(), verifyDelayMs: 0 };

function claim(over: Partial<ClaimedGrant> = {}): ClaimedGrant {
  return {
    grant_id: "g-1",
    attempt_token: "tok-1",
    user_id: USER,
    user_deleted: false,
    entitlement_id: "premium",
    days: 3,
    params: { entitlement_id: "premium" },
    target_expires_at_ms: null,
    attempts: 1,
    ...over,
  };
}

function db(over: Record<string, (p: Record<string, unknown>) => unknown> = {}) {
  return new FakeDb({
    rewards_svc_set_target: () => true,
    rewards_svc_finish_grant: (p) => ({ state: p.outcome === "retry" ? "failed_retryable" : p.outcome }),
    ...over,
  });
}

Deno.test("new customer: created, target = now + days, stored before the grant, granted", async () => {
  const d = db();
  const rc = new FakeRevenueCat();
  const r = await grantOne(d, rc, claim(), fast);
  assert.equal(r.outcome, "granted");
  assert.equal(r.state, "granted");
  const set = d.called("rewards_svc_set_target")[0].params;
  assert.equal(set.target_expires_at_ms, NOW + 3 * DAY);
  assert.ok(rc.calls.indexOf(`create:${USER}`) >= 0, "customer created");
  assert.ok(
    rc.calls.findIndex((c) => c.startsWith("grant:")) > rc.calls.indexOf(`create:${USER}`),
    "grant after create",
  );
  assert.equal(d.called("rewards_svc_finish_grant")[0].params.target_expires_at_ms, NOW + 3 * DAY);
});

Deno.test("existing access: days are added after the current expiry", async () => {
  const d = db();
  const rc = new FakeRevenueCat();
  rc.add(USER, { active: new Map([["entl_premium", NOW + 10 * DAY]]) });
  await grantOne(d, rc, claim(), fast);
  assert.equal(d.called("rewards_svc_set_target")[0].params.target_expires_at_ms, NOW + 13 * DAY);
});

Deno.test("lifetime access → cancelled, no grant", async () => {
  const d = db();
  const rc = new FakeRevenueCat();
  rc.add(USER, { active: new Map([["entl_premium", null]]) });
  const r = await grantOne(d, rc, claim(), fast);
  assert.equal(r.outcome, "cancelled");
  assert.ok(!rc.calls.some((c) => c.startsWith("grant:")));
});

Deno.test("deleted user → cancelled without calling RevenueCat", async () => {
  const d = db();
  const rc = new FakeRevenueCat();
  const r = await grantOne(d, rc, claim({ user_id: null, user_deleted: true }), fast);
  assert.equal(r.outcome, "cancelled");
  assert.equal(rc.calls.length, 0);
});

Deno.test("missing entitlement id or bad days → failed", async () => {
  const rc = new FakeRevenueCat();
  assert.equal((await grantOne(db(), rc, claim({ entitlement_id: null, params: {} }), fast)).outcome, "failed");
  assert.equal((await grantOne(db(), rc, claim({ days: 0 }), fast)).outcome, "failed");
  assert.equal((await grantOne(db(), rc, claim({ entitlement_id: "nope" }), fast)).outcome, "failed");
});

Deno.test("retry with a stored target that already landed → granted without a second grant", async () => {
  const d = db();
  const rc = new FakeRevenueCat();
  rc.add(USER, { active: new Map([["entl_premium", NOW + 3 * DAY]]) });
  const r = await grantOne(d, rc, claim({ target_expires_at_ms: NOW + 3 * DAY, attempts: 2 }), fast);
  assert.equal(r.outcome, "granted");
  assert.ok(!rc.calls.some((c) => c.startsWith("grant:")), "no second grant");
  assert.equal(d.called("rewards_svc_set_target").length, 0, "stored target reused");
});

Deno.test("RevenueCat 5xx → retry", async () => {
  const d = db();
  const rc = new FakeRevenueCat();
  rc.add(USER);
  rc.fail.grant = [new RevenueCatError("server", "grant_entitlement", 503)];
  const r = await grantOne(d, rc, claim(), fast);
  assert.equal(r.outcome, "retry");
  assert.equal(r.state, "failed_retryable");
});

Deno.test("lost lease at set_target → lost_lease, no grant, no finish", async () => {
  const d = db({ rewards_svc_set_target: () => false });
  const rc = new FakeRevenueCat();
  rc.add(USER);
  const r = await grantOne(d, rc, claim(), fast);
  assert.equal(r.outcome, "lost_lease");
  assert.ok(!rc.calls.some((c) => c.startsWith("grant:")));
  assert.equal(d.called("rewards_svc_finish_grant").length, 0);
});

Deno.test("lost lease at finish is reported", async () => {
  const d = db({ rewards_svc_finish_grant: () => ({ state: "lost_lease" }) });
  const rc = new FakeRevenueCat();
  const r = await grantOne(d, rc, claim(), fast);
  assert.equal(r.outcome, "lost_lease");
});

Deno.test("runGrants claims until the queue is empty", async () => {
  let n = 0;
  const d = db({
    rewards_svc_claim_grants: () => (n++ === 0 ? [claim(), claim({ grant_id: "g-2", user_id: "u-2" })] : []),
  });
  const s = await runGrants(d, new FakeRevenueCat(), { ...fast, batch: 2, max: 10, deadlineMs: NOW + 1 });
  assert.equal(s.claimed, 2);
  assert.equal(s.outcomes.granted, 2);
});

Deno.test("runGrants stops at the time budget and leaves claimed grants to their lease", async () => {
  let t = NOW;
  const d = db({
    rewards_svc_claim_grants: () => [claim(), claim({ grant_id: "g-2" })],
    // the first grant takes past the deadline
    rewards_svc_finish_grant: () => {
      t = NOW + 2_000;
      return { state: "granted" };
    },
  });
  const s = await runGrants(d, new FakeRevenueCat(), {
    ...fast,
    now: () => t,
    batch: 2,
    max: 10,
    deadlineMs: NOW + 1000,
  });
  assert.equal(s.outcomes.granted, 1);
  assert.equal(s.outcomes.skipped, 1, "second grant skipped after the deadline");
  assert.equal(d.called("rewards_svc_claim_grants").length, 1);
});
