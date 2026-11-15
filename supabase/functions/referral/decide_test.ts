// deno test for decide.ts: context fixtures (the JSON referral_svc_event_context returns) → apply_event decisions.
import assert from "./test_assert.ts";
import { type ContextReferral, decide, type EventContext } from "./decide.ts";
import type { EventFields } from "./logic.ts";

const DAY = 86_400_000;
const CLAIM = 1_762_000_000_000;
const FRIEND = "8b6f2c1e-0000-4000-8000-00000000f001";
const FRIEND2 = "8b6f2c1e-0000-4000-8000-00000000f002";

function ref(over: Partial<ContextReferral> = {}): ContextReferral {
  return {
    referral_id: "r-1",
    friend_id: FRIEND,
    sharer_id: "s-1",
    claimed_at_ms: CLAIM,
    state: "joined",
    reached_paid: false,
    paid_reward: "none",
    rewarded_intro: false,
    cancel_cause: null,
    holds_transaction: false,
    intro_rule: "if_price_positive",
    count_one_time: false,
    ...over,
  };
}

const purchase: EventFields = {
  app_user_id: FRIEND,
  original_transaction_id: "ot-1",
  transaction_id: "t-1",
  entitlement_ids: ["premium"],
  period_type: "NORMAL",
  price: 4.99,
  store: "APP_STORE",
  environment: "PRODUCTION",
  purchased_at_ms: CLAIM + DAY,
};

function ctx(type: string, fields: EventFields, over: Partial<EventContext> = {}, ts = CLAIM + DAY): EventContext {
  return {
    event: { event_id: "e-1", type, event_timestamp_ms: ts, fields, state: "received" },
    settings: { entitlement_id: "premium", allow_sandbox: false, paid_window_days: 90, paid_enabled: true },
    transaction: {
      first_purchased_at_ms: CLAIM + DAY,
      refunded_at_ms: null,
      refund_state_ms: null,
      already_rewarded: false,
      tombstoned: false,
    },
    referrals: [ref()],
    fingerprint: "f",
    now_ms: CLAIM + 2 * DAY,
    ...over,
  };
}

Deno.test("purchase: INITIAL_PURCHASE NORMAL pays the friend's referral", () => {
  assert.deepEqual(decide(ctx("INITIAL_PURCHASE", purchase)), {
    event_state: "processed",
    refund: null,
    referrals: [{ referral_id: "r-1", paid: { qualifying_at_ms: CLAIM + DAY, intro: false } }],
  });
});

Deno.test("purchase: paid_enabled=false still decides (the SQL skips queuing)", () => {
  const c = ctx("INITIAL_PURCHASE", purchase);
  c.settings.paid_enabled = false;
  assert.equal(decide(c).referrals.length, 1);
});

Deno.test("purchase: INTRO with a positive price is paid with intro=true; rule 'never' is not", () => {
  const f = { ...purchase, period_type: "INTRO" };
  assert.deepEqual(decide(ctx("INITIAL_PURCHASE", f)).referrals[0].paid, {
    qualifying_at_ms: CLAIM + DAY,
    intro: true,
  });
  const c = ctx("INITIAL_PURCHASE", f, { referrals: [ref({ intro_rule: "never" })] });
  assert.deepEqual(decide(c).referrals, []);
});

Deno.test("purchase: TRIAL, sandbox, promotional, family share, wrong entitlement → processed, nothing", () => {
  for (
    const f of [
      { ...purchase, period_type: "TRIAL" },
      { ...purchase, environment: "SANDBOX" },
      { ...purchase, store: "PROMOTIONAL" },
      { ...purchase, is_family_share: true },
      { ...purchase, entitlement_ids: ["other"] },
    ]
  ) {
    assert.deepEqual(decide(ctx("INITIAL_PURCHASE", f)), { event_state: "processed", refund: null, referrals: [] });
  }
});

Deno.test("purchase: sandbox allowed by settings counts", () => {
  const c = ctx("INITIAL_PURCHASE", { ...purchase, environment: "SANDBOX" });
  c.settings.allow_sandbox = true;
  assert.equal(decide(c).referrals.length, 1);
});

Deno.test("purchase: unknown start → waiting, with no referral changes", () => {
  const c = ctx("RENEWAL", purchase);
  c.transaction!.first_purchased_at_ms = null;
  assert.deepEqual(decide(c), { event_state: "waiting", refund: null, referrals: [] });
});

Deno.test("purchase: refunded, tombstoned, already rewarded, already paid → nothing", () => {
  for (
    const over of [
      { refunded_at_ms: CLAIM },
      { tombstoned: true },
      { already_rewarded: true },
    ]
  ) {
    const c = ctx("INITIAL_PURCHASE", purchase);
    Object.assign(c.transaction!, over);
    assert.deepEqual(decide(c).referrals, [], JSON.stringify(over));
  }
  assert.deepEqual(decide(ctx("RENEWAL", purchase, { referrals: [ref({ reached_paid: true })] })).referrals, []);
});

Deno.test("purchase: a referral whose friend is not among the event users is never paid", () => {
  const c = ctx("INITIAL_PURCHASE", purchase, { referrals: [ref({ friend_id: FRIEND2, holds_transaction: true })] });
  assert.deepEqual(decide(c).referrals, []);
});

Deno.test("purchase: friend matched through aliases; two qualifying referrals → only the earliest claim", () => {
  const f = { ...purchase, app_user_id: "$RCAnonymousID:x", aliases: [FRIEND2, FRIEND] };
  const c = ctx("INITIAL_PURCHASE", f, {
    referrals: [
      ref({ referral_id: "r-late", friend_id: FRIEND, claimed_at_ms: CLAIM + 1000 }),
      ref({ referral_id: "r-early", friend_id: FRIEND2, claimed_at_ms: CLAIM }),
    ],
  });
  const d = decide(c);
  assert.equal(d.referrals.length, 1);
  assert.equal(d.referrals[0].referral_id, "r-early");
});

Deno.test("purchase: no transaction row (no original_transaction_id) → nothing", () => {
  assert.deepEqual(decide(ctx("INITIAL_PURCHASE", purchase, { transaction: null })).referrals, []);
});

Deno.test("unknown event type → ignored; known no-effect types → processed", () => {
  assert.equal(decide(ctx("SOMETHING_NEW", purchase)).event_state, "ignored");
  for (const t of ["UNCANCELLATION", "BILLING_ISSUE", "EXPIRATION", "PRODUCT_CHANGE", "TEMPORARY_ENTITLEMENT_GRANT"]) {
    assert.deepEqual(decide(ctx(t, purchase)), { event_state: "processed", refund: null, referrals: [] }, t);
  }
});

const refund: EventFields = { ...purchase, cancel_reason: "CUSTOMER_SUPPORT", price: -4.99 };

Deno.test("refund while held → refund flag + paid_cancelled with cause refund", () => {
  const c = ctx("CANCELLATION", refund, {
    referrals: [ref({ state: "paid", paid_reward: "held", holds_transaction: true, reached_paid: true })],
  }, CLAIM + 3 * DAY);
  assert.deepEqual(decide(c), {
    event_state: "processed",
    refund: { refunded: true, refund_state_ms: CLAIM + 3 * DAY },
    referrals: [{ referral_id: "r-1", referral_to: "paid_cancelled", cancel_cause: "refund", abuse_marks: [] }],
  });
});

Deno.test("refund after the grant → refunded_late + late_refund; an intro adds intro_refund", () => {
  const c = ctx("CANCELLATION", refund, {
    referrals: [ref({ state: "paid", paid_reward: "granted", holds_transaction: true, rewarded_intro: true })],
  }, CLAIM + 9 * DAY);
  assert.deepEqual(decide(c).referrals, [{
    referral_id: "r-1",
    referral_to: "refunded_late",
    cancel_cause: "refund",
    abuse_marks: ["late_refund", "intro_refund"],
  }]);
});

Deno.test("refund uses the referral that holds the transaction, not the event's user", () => {
  const c = ctx("CANCELLATION", { ...refund, app_user_id: "someone-else" }, {
    referrals: [ref({ referral_id: "r-hold", state: "paid", paid_reward: "held", holds_transaction: true })],
  }, CLAIM + 3 * DAY);
  assert.equal(decide(c).referrals[0].referral_id, "r-hold");
});

Deno.test("refund with no referral holding the transaction still sets the flag", () => {
  const c = ctx("CANCELLATION", refund, {}, CLAIM + 3 * DAY);
  assert.deepEqual(decide(c), {
    event_state: "processed",
    refund: { refunded: true, refund_state_ms: CLAIM + 3 * DAY },
    referrals: [],
  });
});

Deno.test("stale refund (not newer than refund_state_ms) and UNSUBSCRIBE → nothing", () => {
  const c = ctx("CANCELLATION", refund, {}, CLAIM + 3 * DAY);
  c.transaction!.refund_state_ms = CLAIM + 3 * DAY;
  assert.deepEqual(decide(c), { event_state: "processed", refund: null, referrals: [] });
  const u = ctx("CANCELLATION", { ...purchase, cancel_reason: "UNSUBSCRIBE" });
  assert.deepEqual(decide(u), { event_state: "processed", refund: null, referrals: [] });
});

Deno.test("REFUND_REVERSED in the window → clear the flag, uncancel, remove the intro mark", () => {
  const c = ctx("REFUND_REVERSED", purchase, {
    referrals: [ref({
      state: "paid_cancelled",
      paid_reward: "held",
      cancel_cause: "refund",
      rewarded_intro: true,
      holds_transaction: true,
    })],
  }, CLAIM + 4 * DAY);
  c.transaction!.refund_state_ms = CLAIM + 3 * DAY;
  c.transaction!.refunded_at_ms = CLAIM + 3 * DAY;
  assert.deepEqual(decide(c), {
    event_state: "processed",
    refund: { refunded: false, refund_state_ms: CLAIM + 4 * DAY },
    referrals: [{ referral_id: "r-1", uncancel: true, remove_intro_mark: true }],
  });
});

Deno.test("REFUND_REVERSED after a transfer cancel → clears the flag only", () => {
  const c = ctx("REFUND_REVERSED", purchase, {
    referrals: [ref({ state: "paid_cancelled", cancel_cause: "transfer", holds_transaction: true })],
  }, CLAIM + 4 * DAY);
  assert.deepEqual(decide(c).referrals, []);
  assert.deepEqual(decide(c).refund, { refunded: false, refund_state_ms: CLAIM + 4 * DAY });
});

Deno.test("cancel events without a transaction row → nothing", () => {
  assert.deepEqual(decide(ctx("CANCELLATION", refund, { transaction: null })), {
    event_state: "processed",
    refund: null,
    referrals: [],
  });
});

Deno.test("TRANSFER away while held → paid_cancelled with cause transfer", () => {
  const f: EventFields = { transferred_from: [FRIEND], transferred_to: ["new-owner"] };
  const c = ctx("TRANSFER", f, { transaction: null, referrals: [ref({ state: "paid", paid_reward: "held" })] });
  assert.deepEqual(decide(c), {
    event_state: "processed",
    refund: null,
    referrals: [{ referral_id: "r-1", referral_to: "paid_cancelled", cancel_cause: "transfer", abuse_marks: [] }],
  });
});

Deno.test("TRANSFER away after the grant → nothing (no clawback)", () => {
  const f: EventFields = { transferred_from: [FRIEND], transferred_to: ["new-owner"] };
  const c = ctx("TRANSFER", f, { transaction: null, referrals: [ref({ state: "paid", paid_reward: "granted" })] });
  assert.deepEqual(decide(c).referrals, []);
});

Deno.test("TRANSFER into a friend in the window → transfer_in mark; outside → nothing", () => {
  const f: EventFields = { transferred_from: ["old-owner"], transferred_to: [FRIEND] };
  assert.deepEqual(decide(ctx("TRANSFER", f, { transaction: null })).referrals, [{
    referral_id: "r-1",
    abuse_marks: ["transfer_in"],
  }]);
  assert.deepEqual(decide(ctx("TRANSFER", f, { transaction: null }, CLAIM + 91 * DAY)).referrals, []);
});

Deno.test("TRANSFER runs per matching referral with that referral's friend only", () => {
  const f: EventFields = { transferred_from: [FRIEND], transferred_to: [FRIEND2] };
  const c = ctx("TRANSFER", f, {
    transaction: null,
    referrals: [
      ref({ referral_id: "r-a", friend_id: FRIEND, state: "paid", paid_reward: "held" }),
      ref({ referral_id: "r-b", friend_id: FRIEND2 }),
      ref({ referral_id: "r-c", friend_id: "unrelated" }),
    ],
  });
  assert.deepEqual(decide(c).referrals, [
    { referral_id: "r-a", referral_to: "paid_cancelled", cancel_cause: "transfer", abuse_marks: [] },
    { referral_id: "r-b", abuse_marks: ["transfer_in"] },
  ]);
});
