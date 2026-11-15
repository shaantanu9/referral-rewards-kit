// deno test: RevenueCat link (ADR 0002 18.5): webhook parsing, the /revenuecat route, in-app currency grants.
import assert from "../referral/test_assert.ts";
import { FakeDb, FakeRevenueCat, signedRequest } from "../referral/test_fakes.ts";
import { RevenueCatError } from "../referral/revenuecat.ts";
import { fetchCurrency, type RcCurrency } from "./currency.ts";
import { grantOne } from "./grant.ts";
import { createHandler } from "./index.ts";
import { rcAction, supabaseUserId } from "./rc_webhook.ts";

const USER = "5a5a5a5a-0000-4000-8000-0000000000aa";
const NOW = 1_770_000_000_000;

const adEvent = (over: Record<string, unknown> = {}) => ({
  api_version: "1.0",
  event: {
    type: "VIRTUAL_CURRENCY_TRANSACTION",
    id: "evt-ad-1",
    app_user_id: USER,
    source: "ad_reward",
    ad_transaction_id: "ad-tx-9",
    adjustments: [{ amount: 5, currency: { code: "GEMS", name: "Gems" } }],
    subscriber_attributes: { $email: { value: "secret@example.com" } },
    ...over,
  },
});

Deno.test("parse: an ad reward", () => {
  assert.deepEqual(rcAction(adEvent()), {
    kind: "ad",
    userId: USER,
    adTransactionId: "ad-tx-9",
    currency: "GEMS",
    amount: 5,
    eventId: "evt-ad-1",
  });
});

Deno.test("parse: other events keep only safe props, never subscriber attributes", () => {
  const a = rcAction({
    event: {
      type: "INITIAL_PURCHASE",
      id: "evt-2",
      app_user_id: "$RCAnonymousID:abc",
      aliases: ["$RCAnonymousID:abc", USER.toUpperCase()],
      product_id: "plus_monthly",
      environment: "PRODUCTION",
      price: 4.99,
      subscriber_attributes: { $email: { value: "x@y.z" } },
    },
  });
  assert.deepEqual(a, {
    kind: "event",
    userId: USER,
    type: "INITIAL_PURCHASE",
    eventId: "evt-2",
    props: { product_id: "plus_monthly", environment: "PRODUCTION", price: 4.99 },
  });
  assert.ok(!JSON.stringify(a).includes("x@y.z"));
});

Deno.test("parse: skips without a Supabase user, type, ad transaction or event", () => {
  assert.deepEqual(rcAction({ event: { type: "RENEWAL", id: "e", app_user_id: "not-a-uuid" } }), {
    kind: "skip",
    reason: "no_supabase_user",
  });
  assert.equal((rcAction(adEvent({ ad_transaction_id: null })) as { reason: string }).reason, "no_ad_transaction");
  assert.equal((rcAction({}) as { reason: string }).reason, "no_event");
  assert.equal(
    (rcAction({ event: { type: "bad type", id: "e", app_user_id: USER } }) as { reason: string }).reason,
    "no_type",
  );
  assert.equal(supabaseUserId({ app_user_id: 42, aliases: "x" }), null);
});

Deno.test("currency client: path, body, Idempotency-Key, balance", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const cur = fetchCurrency({
    secretKey: "sk_test",
    projectId: "proj1",
    fetch: (input, init) => {
      seen.push({ url: String(input), init: init ?? {} });
      return Promise.resolve(
        new Response(JSON.stringify({ items: [{ currency_code: "GEMS", balance: 110 }] }), { status: 200 }),
      );
    },
  });
  assert.equal(await cur.add(USER, "GEMS", 10, "daily_quiz:t9:rc_currency:u", "grant-1"), 110);
  assert.equal(
    seen[0].url,
    `https://api.revenuecat.com/v2/projects/proj1/customers/${USER}/virtual_currencies/transactions`,
  );
  const h = new Headers(seen[0].init.headers);
  assert.equal(h.get("Idempotency-Key"), "grant-1");
  assert.equal(h.get("Authorization"), "Bearer sk_test");
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), {
    adjustments: { GEMS: 10 },
    reference: "daily_quiz:t9:rc_currency:u",
  });
});

Deno.test("currency client: a 409 on create means the customer exists", async () => {
  const cur = fetchCurrency({
    secretKey: "k",
    projectId: "p",
    fetch: () => Promise.resolve(new Response("{}", { status: 409 })),
  });
  await cur.createCustomer(USER);
});

class FakeCurrency implements RcCurrency {
  calls: string[] = [];
  fail: (RevenueCatError | null)[] = [];
  add(customerId: string, code: string, amount: number, _ref: string, key: string) {
    this.calls.push(`add:${customerId}:${code}:${amount}:${key}`);
    const f = this.fail.shift();
    return f ? Promise.reject(f) : Promise.resolve(amount);
  }
  createCustomer(customerId: string) {
    this.calls.push(`create:${customerId}`);
    return Promise.resolve();
  }
}

const claim = (over = {}) => ({
  grant_id: "g-1",
  attempt_token: "tok",
  kind: "rc_currency",
  grant_key: "k1",
  user_id: USER,
  user_deleted: false,
  entitlement_id: null,
  currency_code: "GEMS",
  amount: 30,
  days: 30,
  params: { currency_code: "GEMS" },
  target_expires_at_ms: null,
  attempts: 1,
  ...over,
});
const finishDb = () =>
  new FakeDb({ rewards_svc_finish_grant: (p) => ({ state: p.outcome === "retry" ? "failed_retryable" : p.outcome }) });

Deno.test("worker: rc_currency granted once with the grant id as idempotency key", async () => {
  const cur = new FakeCurrency();
  const db = finishDb();
  const r = await grantOne(db, new FakeRevenueCat(), claim(), {}, cur);
  assert.equal(r.outcome, "granted");
  assert.deepEqual(cur.calls, [`add:${USER}:GEMS:30:g-1`]);
  assert.equal(db.calls.length, 1);
});

Deno.test("worker: unknown customer is created, then the same idempotent call again", async () => {
  const cur = new FakeCurrency();
  cur.fail = [new RevenueCatError("not_found", "add_currency", 404)];
  const r = await grantOne(finishDb(), new FakeRevenueCat(), claim(), {}, cur);
  assert.equal(r.outcome, "granted");
  assert.deepEqual(cur.calls, [`add:${USER}:GEMS:30:g-1`, `create:${USER}`, `add:${USER}:GEMS:30:g-1`]);
});

Deno.test("worker: rc_currency errors and edge cases", async () => {
  const cur = new FakeCurrency();
  cur.fail = [new RevenueCatError("server", "add_currency", 503)];
  assert.equal((await grantOne(finishDb(), new FakeRevenueCat(), claim(), {}, cur)).outcome, "retry");
  cur.fail = [new RevenueCatError("client", "add_currency", 422)];
  assert.equal((await grantOne(finishDb(), new FakeRevenueCat(), claim(), {}, cur)).outcome, "failed");
  assert.equal(
    (await grantOne(finishDb(), new FakeRevenueCat(), claim({ user_id: null, user_deleted: true }), {}, cur)).outcome,
    "cancelled",
  );
  assert.equal((await grantOne(finishDb(), new FakeRevenueCat(), claim({ amount: 2.5 }), {}, cur)).outcome, "failed");
  assert.equal((await grantOne(finishDb(), new FakeRevenueCat(), claim(), {}, undefined)).outcome, "retry");
});

const ENV: Record<string, string> = {
  SUPABASE_URL: "http://db.test",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  REWARDS_RC_WEBHOOK_TOKEN: "rc-token",
};
const URL_ = "http://fn.test/functions/v1/rewards/revenuecat";

function route(env = ENV, handlers: Record<string, (p: Record<string, unknown>) => unknown> = {}) {
  const db = new FakeDb({
    rewards_svc_ad_reward: () => ({ tracked: true }),
    rewards_svc_rc_event: () => ({ tracked: false, reason: "ignored_unregistered" }),
    ...handlers,
  });
  const logs: string[] = [];
  const h = createHandler({ env: (n) => env[n], db: () => db, now: () => NOW, log: (l) => logs.push(l) });
  return { h, db, logs };
}
const post = (body: unknown, auth: string | null = "rc-token") =>
  new Request(URL_, {
    method: "POST",
    body: JSON.stringify(body),
    headers: auth === null ? {} : { Authorization: auth },
  });

Deno.test("route: token required (raw or Bearer), 503 unconfigured, 405 on GET", async () => {
  assert.equal((await route({}).h(post(adEvent()))).status, 503);
  const { h, db } = route();
  assert.equal((await h(post(adEvent(), null))).status, 401);
  assert.equal((await h(post(adEvent(), "wrong"))).status, 401);
  assert.equal(db.calls.length, 0);
  assert.equal((await h(post(adEvent(), "Bearer rc-token"))).status, 200);
  assert.equal((await h(new Request(URL_))).status, 405);
});

Deno.test("route: an ad reward goes to rewards_svc_ad_reward; nothing personal is logged", async () => {
  const { h, db, logs } = route();
  const res = await h(post(adEvent()));
  assert.deepEqual(await res.json(), { status: "tracked", reason: null });
  assert.deepEqual(db.called("rewards_svc_ad_reward")[0].params, {
    user_id: USER,
    ad_transaction_id: "ad-tx-9",
    currency: "GEMS",
    amount: 5,
    event_id: "evt-ad-1",
  });
  assert.ok(!logs.join("").includes("secret@example.com") && !logs.join("").includes(USER));
});

Deno.test("route: other events go to rewards_svc_rc_event; skipped ones answer 200 without a database call", async () => {
  const { h, db } = route();
  const ok = await h(post({ event: { type: "INITIAL_PURCHASE", id: "e1", app_user_id: USER, product_id: "p" } }));
  assert.deepEqual(await ok.json(), { status: "ignored", reason: "ignored_unregistered" });
  assert.equal(db.called("rewards_svc_rc_event")[0].params.event_type, "INITIAL_PURCHASE");
  const skip = await h(post({ event: { type: "RENEWAL", id: "e2", app_user_id: "anon" } }));
  assert.deepEqual(await skip.json(), { status: "ignored", reason: "no_supabase_user" });
  assert.equal(db.calls.length, 1);
});

Deno.test("route: a database error is a 500 so RevenueCat retries", async () => {
  const { h } = route(ENV, {
    rewards_svc_ad_reward: () => {
      throw new Error("db down");
    },
  });
  assert.equal((await h(post(adEvent()))).status, 500);
});

Deno.test("route: with a signing secret the signature is required", async () => {
  const env = { ...ENV, REWARDS_RC_SIGNING_SECRET: "sign-me" };
  const { h } = route(env);
  assert.equal((await h(post(adEvent()))).status, 401, "missing signature");
  const body = JSON.stringify(adEvent());
  const req = await signedRequest(URL_, body, { token: "rc-token", secret: "sign-me", t: Math.floor(NOW / 1000) });
  assert.equal((await h(req)).status, 200);
});
