// deno test for logic.ts: every row of both ADR 6.3 tables, the shared conditions, ordering, transfers,
// store normalisation, signature check and the 6.5 subscription match. No network, no file reads
// (fixtures are JSON module imports).
import assert from "./test_assert.ts";
import {
  type ApiV2Subscription,
  type CancelContext,
  classifyCancel,
  classifyPaid,
  InvalidEventError,
  matchSubscription,
  normaliseEnvironment,
  normaliseStore,
  type PaidContext,
  trimEvent,
  type TrimmedEvent,
  usersInEvent,
  verifySignature,
} from "./logic.ts";

import initialNormal from "./fixtures/initial_purchase_normal.json" with { type: "json" };
import initialTrial from "./fixtures/initial_purchase_trial.json" with { type: "json" };
import initialIntro from "./fixtures/initial_purchase_intro.json" with { type: "json" };
import renewalConversion from "./fixtures/renewal_trial_conversion.json" with { type: "json" };
import renewal from "./fixtures/renewal.json" with { type: "json" };
import productChange from "./fixtures/product_change.json" with { type: "json" };
import nonRenewing from "./fixtures/non_renewing_purchase.json" with { type: "json" };
import cancelRefund from "./fixtures/cancellation_refund.json" with { type: "json" };
import cancelUnsub from "./fixtures/cancellation_unsubscribe.json" with { type: "json" };
import refundReversed from "./fixtures/refund_reversed.json" with { type: "json" };
import uncancellation from "./fixtures/uncancellation.json" with { type: "json" };
import expiration from "./fixtures/expiration.json" with { type: "json" };
import tempGrant from "./fixtures/temporary_entitlement_grant.json" with { type: "json" };
import paused from "./fixtures/subscription_paused.json" with { type: "json" };
import promoGrant from "./fixtures/promotional_grant.json" with { type: "json" };
import transfer from "./fixtures/transfer.json" with { type: "json" };
import apiSubs from "./fixtures/api_v2_subscriptions.json" with { type: "json" };

const CLAIM = 1_762_000_000_000;
const DAY = 86_400_000;
const FRIEND = "8b6f2c1e-0000-4000-8000-00000000f001";

/** Trim a fixture, optionally overriding raw event fields first (so overrides also go through trimEvent). */
function ev(fixture: unknown, over: Record<string, unknown> = {}): TrimmedEvent {
  const f = structuredClone(fixture) as { event: Record<string, unknown> };
  Object.assign(f.event, over);
  return trimEvent(JSON.stringify(f));
}

function pctx(over: {
  settings?: Partial<PaidContext["settings"]>;
  referral?: Partial<NonNullable<PaidContext["referral"]>> | null;
  transaction?: Partial<PaidContext["transaction"]>;
  count_one_time?: boolean;
} = {}): PaidContext {
  return {
    settings: { entitlement_id: "premium", allow_sandbox: false, paid_window_days: 90, ...over.settings },
    count_one_time: over.count_one_time,
    referral: over.referral === null ? null : { claimed_at_ms: CLAIM, reached_paid: false, ...over.referral },
    transaction: {
      first_purchased_at_ms: CLAIM + 3_600_000,
      refunded_at_ms: null,
      already_rewarded: false,
      tombstoned: false,
      ...over.transaction,
    },
  };
}

const notPaid = (reason: string) => ({ decision: "not_paid", reason });

// ---------------------------------------------------------------------------------------------------------
// trimEvent
// ---------------------------------------------------------------------------------------------------------

Deno.test("trimEvent keeps only the ADR 5 fields and drops subscriber_attributes", () => {
  const t = ev(initialNormal);
  assert.equal(t.event_id, "EVT-0000-INITIAL-NORMAL");
  assert.equal(t.type, "INITIAL_PURCHASE");
  assert.equal(t.event_timestamp_ms, CLAIM + 3_600_000 + 5_000);
  assert.deepEqual(Object.keys(t.fields).sort(), [
    "aliases",
    "app_user_id",
    "entitlement_ids",
    "environment",
    "is_family_share",
    "original_app_user_id",
    "original_transaction_id",
    "period_type",
    "price",
    "product_id",
    "purchased_at_ms",
    "store",
    "transaction_id",
  ]);
  const s = JSON.stringify(t);
  assert.ok(!s.includes("subscriber_attributes"));
  assert.ok(!s.includes("friend@example.com"));
  assert.ok(!s.includes("country_code"));
});

Deno.test("trimEvent accepts bytes, string and object; drops wrongly typed fields", () => {
  const raw = JSON.stringify(initialNormal);
  assert.deepEqual(trimEvent(new TextEncoder().encode(raw)), trimEvent(raw));
  assert.deepEqual(trimEvent(initialNormal), trimEvent(raw));
  const t = ev(initialNormal, { price: "2.39", aliases: ["a", 3, null], is_family_share: "false" });
  assert.equal(t.fields.price, undefined);
  assert.deepEqual(t.fields.aliases, ["a"]);
  assert.equal(t.fields.is_family_share, undefined);
});

Deno.test("trimEvent rejects malformed bodies", () => {
  assert.throws(() => trimEvent("not json"), InvalidEventError);
  assert.throws(() => trimEvent({ api_version: "1.0" }), InvalidEventError);
  assert.throws(() => trimEvent({ event: { type: "RENEWAL", event_timestamp_ms: 1 } }), InvalidEventError);
  assert.throws(() => trimEvent({ event: { id: "x", event_timestamp_ms: 1 } }), InvalidEventError);
  assert.throws(() => trimEvent({ event: { id: "x", type: "RENEWAL" } }), InvalidEventError);
});

Deno.test("trimEvent keeps transfer lists and cancel_reason", () => {
  assert.deepEqual(ev(transfer).fields.transferred_to, ["8b6f2c1e-0000-4000-8000-00000000a002"]);
  assert.equal(ev(cancelRefund).fields.cancel_reason, "CUSTOMER_SUPPORT");
  assert.equal(ev(renewalConversion).fields.is_trial_conversion, true);
});

// ---------------------------------------------------------------------------------------------------------
// normaliseStore / usersInEvent
// ---------------------------------------------------------------------------------------------------------

Deno.test("normaliseStore maps webhook and API v2 spellings to one form", () => {
  for (
    const [a, b] of [
      ["APP_STORE", "app_store"],
      ["PLAY_STORE", "play_store"],
      ["PROMOTIONAL", "promotional"],
      ["MAC_APP_STORE", "mac_app_store"],
      ["STRIPE", "stripe"],
      ["RC_BILLING", "rc_billing"],
      ["AMAZON", "amazon"],
    ]
  ) {
    assert.equal(normaliseStore(a), b);
    assert.equal(normaliseStore(b), b);
  }
  assert.equal(normaliseStore(" Play Store "), "play_store");
  assert.equal(normaliseStore(""), null);
  assert.equal(normaliseStore(null), null);
  assert.equal(normaliseStore(3), null);
  assert.equal(normaliseEnvironment("PRODUCTION"), "production");
  assert.equal(normaliseEnvironment("sandbox"), "sandbox");
  assert.equal(normaliseEnvironment("STAGING"), null);
});

Deno.test("usersInEvent: app_user_id, original_app_user_id and aliases, de-duplicated", () => {
  const u = usersInEvent("INITIAL_PURCHASE", ev(initialNormal).fields);
  assert.deepEqual(u, { kind: "users", users: [FRIEND, "$RCAnonymousID:00000000000000000000000000000001"] });
});

Deno.test("usersInEvent: TRANSFER is matched on from/to only, never app_user_id", () => {
  const t = ev(transfer, { app_user_id: "someone-else" });
  assert.deepEqual(usersInEvent(t.type, t.fields), {
    kind: "transfer",
    from: [FRIEND, "$RCAnonymousID:00000000000000000000000000000001"],
    to: ["8b6f2c1e-0000-4000-8000-00000000a002"],
  });
});

// ---------------------------------------------------------------------------------------------------------
// classifyPaid: one test per row of the 6.3 paid table
// ---------------------------------------------------------------------------------------------------------

Deno.test("row: INITIAL_PURCHASE NORMAL with price > 0 → paid", () => {
  assert.deepEqual(classifyPaid(ev(initialNormal), pctx()), {
    decision: "paid",
    qualifying_at_ms: CLAIM + 3_600_000,
    intro: false,
  });
});

Deno.test("row: INITIAL_PURCHASE PREPAID with price > 0 → paid; NORMAL with price 0 or missing → not paid", () => {
  assert.equal(classifyPaid(ev(initialNormal, { period_type: "PREPAID" }), pctx()).decision, "paid");
  assert.deepEqual(classifyPaid(ev(initialNormal, { price: 0 }), pctx()), notPaid("initial_purchase_zero_price"));
  assert.deepEqual(classifyPaid(ev(initialNormal, { price: null }), pctx()), notPaid("initial_purchase_zero_price"));
});

Deno.test("row: INITIAL_PURCHASE TRIAL → wait for conversion", () => {
  assert.deepEqual(classifyPaid(ev(initialTrial), pctx()), notPaid("trial_wait_for_conversion"));
});

Deno.test("row: INITIAL_PURCHASE INTRO (D-R8 default: yes only if price > 0)", () => {
  assert.deepEqual(classifyPaid(ev(initialIntro), pctx()), {
    decision: "paid",
    qualifying_at_ms: CLAIM + 3_600_000,
    intro: true,
  });
  assert.deepEqual(classifyPaid(ev(initialIntro, { price: 0 }), pctx()), notPaid("intro_zero_price"));
  assert.deepEqual(
    classifyPaid(ev(initialIntro), pctx({ settings: { intro_rule: "never" } })),
    notPaid("intro_not_counted"),
  );
});

Deno.test("row: INITIAL_PURCHASE with PROMOTIONAL or unknown period_type → not paid", () => {
  assert.deepEqual(
    classifyPaid(ev(initialNormal, { period_type: "PROMOTIONAL" }), pctx()),
    notPaid("unknown_period_type"),
  );
  assert.deepEqual(classifyPaid(ev(initialNormal, { period_type: null }), pctx()), notPaid("unknown_period_type"));
});

Deno.test("row: RENEWAL with is_trial_conversion → paid", () => {
  assert.deepEqual(classifyPaid(ev(renewalConversion), pctx()), {
    decision: "paid",
    qualifying_at_ms: CLAIM + 3 * DAY,
    intro: false,
  });
});

Deno.test("row: RENEWAL after a lapse → only if the referral never reached paid", () => {
  assert.equal(classifyPaid(ev(renewal), pctx()).decision, "paid");
  assert.deepEqual(
    classifyPaid(ev(renewal), pctx({ referral: { reached_paid: true } })),
    notPaid("referral_already_paid"),
  );
  assert.deepEqual(classifyPaid(ev(renewal, { price: 0 }), pctx()), notPaid("renewal_zero_price"));
});

Deno.test("row: PRODUCT_CHANGE → never by itself", () => {
  assert.deepEqual(classifyPaid(ev(productChange), pctx()), notPaid("product_change_never_by_itself"));
});

Deno.test("row: NON_RENEWING_PURCHASE → never by default; opt-in with count_one_time", () => {
  const e = ev(nonRenewing);
  assert.deepEqual(classifyPaid(e, pctx()), notPaid("one_time_not_counted"));
  // A one-time purchase has no INITIAL_PURCHASE: its own purchase time is its start.
  assert.equal(
    classifyPaid(e, pctx({ count_one_time: true, transaction: { first_purchased_at_ms: null } })).decision,
    "paid",
  );
  assert.deepEqual(
    classifyPaid(ev(nonRenewing, { price: 0 }), pctx({ count_one_time: true })),
    notPaid("one_time_zero_price"),
  );
});

Deno.test("row: UNCANCELLATION, SUBSCRIPTION_EXTENDED, BILLING_ISSUE, EXPIRATION → no effect", () => {
  for (
    const e of [
      ev(uncancellation),
      ev(expiration),
      ev(initialNormal, { type: "SUBSCRIPTION_EXTENDED" }),
      ev(initialNormal, { type: "BILLING_ISSUE" }),
    ]
  ) {
    assert.deepEqual(classifyPaid(e, pctx()), notPaid("no_effect_on_paid"), e.type);
  }
});

Deno.test("row: store PROMOTIONAL (including the kit's own grants) → never", () => {
  assert.deepEqual(classifyPaid(ev(promoGrant), pctx()), notPaid("promotional_store"));
  assert.deepEqual(classifyPaid(ev(initialNormal, { store: "PROMOTIONAL" }), pctx()), notPaid("promotional_store"));
  assert.deepEqual(classifyPaid(ev(renewalConversion, { store: "PROMOTIONAL" }), pctx()), notPaid("promotional_store"));
});

Deno.test("row: TRANSFER and TEMPORARY_ENTITLEMENT_GRANT → never", () => {
  assert.deepEqual(classifyPaid(ev(transfer), pctx()), notPaid("transfer_never_counts"));
  assert.deepEqual(classifyPaid(ev(tempGrant), pctx()), notPaid("temporary_grant_never_counts"));
});

Deno.test("row: is_family_share → never", () => {
  assert.deepEqual(classifyPaid(ev(initialNormal, { is_family_share: true }), pctx()), notPaid("family_share"));
  assert.deepEqual(classifyPaid(ev(renewalConversion, { is_family_share: true }), pctx()), notPaid("family_share"));
});

Deno.test("row: SANDBOX → never, unless allow_sandbox", () => {
  const e = ev(initialNormal, { environment: "SANDBOX" });
  assert.deepEqual(classifyPaid(e, pctx()), notPaid("sandbox_not_allowed"));
  assert.equal(classifyPaid(e, pctx({ settings: { allow_sandbox: true } })).decision, "paid");
  assert.deepEqual(classifyPaid(ev(initialNormal, { environment: null }), pctx()), notPaid("unknown_environment"));
});

Deno.test("row: any event type not in the table → ignored", () => {
  assert.deepEqual(classifyPaid(ev(paused), pctx()), { decision: "ignored", reason: "unknown_event_type" });
  assert.deepEqual(classifyPaid(ev(initialNormal, { type: "TEST" }), pctx()), {
    decision: "ignored",
    reason: "unknown_event_type",
  });
  assert.deepEqual(classifyPaid(ev(initialNormal, { type: "VIRTUAL_CURRENCY_TRANSACTION" }), pctx()), {
    decision: "ignored",
    reason: "unknown_event_type",
  });
});

Deno.test("cancel-table events are not paid decisions", () => {
  assert.deepEqual(classifyPaid(ev(cancelRefund), pctx()), notPaid("cancel_table_event"));
  assert.deepEqual(classifyPaid(ev(refundReversed), pctx()), notPaid("cancel_table_event"));
});

// ---------------------------------------------------------------------------------------------------------
// classifyPaid: "every qualifying row also needs"
// ---------------------------------------------------------------------------------------------------------

Deno.test("needs: the entitlement in settings.entitlement_id", () => {
  assert.deepEqual(classifyPaid(ev(initialNormal, { entitlement_ids: ["pro"] }), pctx()), notPaid("wrong_entitlement"));
  assert.deepEqual(classifyPaid(ev(initialNormal, { entitlement_ids: null }), pctx()), notPaid("wrong_entitlement"));
  assert.deepEqual(
    classifyPaid(ev(initialNormal), pctx({ settings: { entitlement_id: null } })),
    notPaid("no_entitlement_configured"),
  );
  // The deprecated single `entitlement_id` field is not trusted on its own.
  assert.deepEqual(
    classifyPaid(ev(initialNormal, { entitlement_ids: null, entitlement_id: "premium" }), pctx()),
    notPaid("wrong_entitlement"),
  );
});

Deno.test("needs: the subscription began after the claim", () => {
  assert.deepEqual(
    classifyPaid(
      ev(initialNormal, { purchased_at_ms: CLAIM - 1 }),
      pctx({ transaction: { first_purchased_at_ms: CLAIM - 1 } }),
    ),
    notPaid("started_before_claim"),
  );
  // Equal to the claim is not "after".
  assert.deepEqual(
    classifyPaid(ev(renewalConversion), pctx({ transaction: { first_purchased_at_ms: CLAIM } })),
    notPaid("started_before_claim"),
  );
});

Deno.test("needs: trial started before the claim that converts after it never counts", () => {
  assert.deepEqual(
    classifyPaid(ev(renewalConversion), pctx({ transaction: { first_purchased_at_ms: CLAIM - 2 * DAY } })),
    notPaid("started_before_claim"),
  );
});

Deno.test("trial after the claim, then conversion → paid on the RENEWAL", () => {
  const ctx = pctx({ transaction: { first_purchased_at_ms: CLAIM + 3_600_000 } });
  assert.deepEqual(classifyPaid(ev(initialTrial), ctx), notPaid("trial_wait_for_conversion"));
  assert.equal(classifyPaid(ev(renewalConversion), ctx).decision, "paid");
});

Deno.test("needs: the qualifying event within paid_window_days of the claim", () => {
  const at = (ms: number) => ev(renewalConversion, { purchased_at_ms: ms, event_timestamp_ms: ms + 1000 });
  assert.equal(classifyPaid(at(CLAIM + 90 * DAY), pctx()).decision, "paid");
  assert.deepEqual(classifyPaid(at(CLAIM + 90 * DAY + 1), pctx()), notPaid("outside_paid_window"));
  assert.deepEqual(
    classifyPaid(at(CLAIM + 10 * DAY), pctx({ settings: { paid_window_days: 7 } })),
    notPaid("outside_paid_window"),
  );
  // Without purchased_at_ms the (later) event time is used.
  const late = ev(renewalConversion, { purchased_at_ms: null, event_timestamp_ms: CLAIM + 91 * DAY });
  assert.deepEqual(classifyPaid(late, pctx()), notPaid("outside_paid_window"));
});

Deno.test("needs: no refund, never rewarded, no tombstone, a referral", () => {
  const e = ev(initialNormal);
  assert.deepEqual(classifyPaid(e, pctx({ transaction: { refunded_at_ms: CLAIM + DAY } })), notPaid("refunded"));
  assert.deepEqual(
    classifyPaid(e, pctx({ transaction: { already_rewarded: true } })),
    notPaid("transaction_already_rewarded"),
  );
  assert.deepEqual(classifyPaid(e, pctx({ transaction: { tombstoned: true } })), notPaid("tombstoned"));
  assert.deepEqual(classifyPaid(e, pctx({ referral: null })), notPaid("no_referral"));
  assert.deepEqual(classifyPaid(e, pctx({ referral: { reached_paid: true } })), notPaid("referral_already_paid"));
});

Deno.test("lost INITIAL_PURCHASE: start unknown → wait_for_start, then decided once filled", () => {
  const e = ev(renewalConversion);
  assert.deepEqual(classifyPaid(e, pctx({ transaction: { first_purchased_at_ms: null } })), {
    decision: "wait_for_start",
  });
  assert.equal(classifyPaid(e, pctx({ transaction: { first_purchased_at_ms: CLAIM + DAY } })).decision, "paid");
  assert.deepEqual(
    classifyPaid(e, pctx({ transaction: { first_purchased_at_ms: CLAIM - DAY } })),
    notPaid("started_before_claim"),
  );
  // A definite "no" never waits.
  assert.deepEqual(
    classifyPaid(e, pctx({ transaction: { first_purchased_at_ms: null, refunded_at_ms: CLAIM } })),
    notPaid("refunded"),
  );
});

Deno.test("an early refund blocks a late INITIAL_PURCHASE", () => {
  // The refund arrived first and set refunded_at before any referral held the transaction.
  const refundCtx: CancelContext = { refund_state_ms: null, now_ms: CLAIM + 6 * DAY, referral: null };
  const r = classifyCancel(ev(cancelRefund), refundCtx);
  assert.equal(r.effect, "refund");
  assert.deepEqual(
    classifyPaid(ev(initialNormal), pctx({ transaction: { refunded_at_ms: CLAIM + 5 * DAY } })),
    notPaid("refunded"),
  );
});

// ---------------------------------------------------------------------------------------------------------
// classifyCancel: one test per row of the 6.3 cancel table, plus 6.7 ordering
// ---------------------------------------------------------------------------------------------------------

function cctx(
  over: Partial<Omit<CancelContext, "referral">> & {
    referral?: Partial<NonNullable<CancelContext["referral"]>> | null;
  } = {},
): CancelContext {
  return {
    refund_state_ms: over.refund_state_ms ?? null,
    now_ms: over.now_ms ?? CLAIM + 8 * DAY,
    referral: over.referral === null ? null : {
      friend_ids: [FRIEND],
      claimed_at_ms: CLAIM,
      paid_window_days: 90,
      state: "paid",
      paid_reward: "held",
      rewarded_intro: false,
      cancel_cause: null,
      ...over.referral,
    },
  };
}

Deno.test("cancel row: CANCELLATION CUSTOMER_SUPPORT → refund, referral paid_cancelled while held", () => {
  assert.deepEqual(classifyCancel(ev(cancelRefund), cctx()), {
    effect: "refund",
    refund_state_ms: CLAIM + 5 * DAY,
    referral_to: "paid_cancelled",
    abuse_marks: [],
  });
});

Deno.test("cancel row: price < 0 alone is a refund", () => {
  const e = ev(cancelRefund, { cancel_reason: "UNKNOWN" });
  assert.equal(classifyCancel(e, cctx()).effect, "refund");
  const e2 = ev(cancelRefund, { cancel_reason: "UNSUBSCRIBE" });
  assert.equal(classifyCancel(e2, cctx()).effect, "refund");
});

Deno.test("cancel row: refund with no referral still sets refunded_at", () => {
  assert.deepEqual(classifyCancel(ev(cancelRefund), cctx({ referral: null })), {
    effect: "refund",
    refund_state_ms: CLAIM + 5 * DAY,
    referral_to: null,
    abuse_marks: [],
  });
});

Deno.test("cancel row: refund after the hold → refunded_late + late_refund mark (6.6); INTRO adds intro_refund", () => {
  assert.deepEqual(
    classifyCancel(ev(cancelRefund), cctx({ referral: { paid_reward: "granted", rewarded_intro: true } })),
    {
      effect: "refund",
      refund_state_ms: CLAIM + 5 * DAY,
      referral_to: "refunded_late",
      abuse_marks: ["late_refund", "intro_refund"],
    },
  );
  assert.deepEqual(
    (classifyCancel(ev(cancelRefund), cctx({ referral: { rewarded_intro: true } })) as { abuse_marks: string[] })
      .abuse_marks,
    ["intro_refund"],
  );
});

Deno.test("cancel row: TRANSFER away from the friend → paid_cancelled", () => {
  assert.deepEqual(classifyCancel(ev(transfer), cctx()), {
    effect: "transfer_away",
    referral_to: "paid_cancelled",
    abuse_marks: [],
  });
  // After the grant there is no clawback: no state change.
  assert.deepEqual(classifyCancel(ev(transfer), cctx({ referral: { paid_reward: "granted" } })), {
    effect: "transfer_away",
    referral_to: null,
    abuse_marks: [],
  });
});

Deno.test("cancel row: TRANSFER into a friend in the paid window → abuse mark transfer_in", () => {
  const into = ev(transfer, { transferred_from: ["8b6f2c1e-0000-4000-8000-00000000a002"], transferred_to: [FRIEND] });
  assert.deepEqual(classifyCancel(into, cctx({ referral: { state: "joined", paid_reward: "none" } })), {
    effect: "transfer_in",
    abuse_marks: ["transfer_in"],
  });
  const late = ev(transfer, {
    transferred_from: ["8b6f2c1e-0000-4000-8000-00000000a002"],
    transferred_to: [FRIEND],
    event_timestamp_ms: CLAIM + 91 * DAY,
  });
  assert.deepEqual(classifyCancel(late, cctx()), { effect: "none", reason: "transfer_in_outside_window" });
  // A transfer into a friend never counts as paid either.
  assert.deepEqual(classifyPaid(into, pctx()), notPaid("transfer_never_counts"));
});

Deno.test("cancel: TRANSFER matches on from/to, not app_user_id; unrelated transfers have no effect", () => {
  const other = ev(transfer, { transferred_from: ["x"], transferred_to: ["y"], app_user_id: FRIEND });
  assert.deepEqual(classifyCancel(other, cctx()), { effect: "none", reason: "transfer_unrelated" });
  assert.deepEqual(classifyCancel(ev(transfer), cctx({ referral: null })), {
    effect: "none",
    reason: "transfer_unrelated",
  });
  // Friend matched through an alias in the list.
  const viaAlias = ev(transfer, { transferred_from: ["$RCAnonymousID:x"] });
  assert.equal(
    classifyCancel(viaAlias, cctx({ referral: { friend_ids: [FRIEND, "$RCAnonymousID:x"] } })).effect,
    "transfer_away",
  );
});

Deno.test("cancel row: REFUND_REVERSED clears the refund and un-cancels inside the paid window", () => {
  const c = cctx({
    refund_state_ms: CLAIM + 5 * DAY,
    referral: { state: "paid_cancelled", cancel_cause: "refund", rewarded_intro: true },
  });
  assert.deepEqual(classifyCancel(ev(refundReversed), c), {
    effect: "refund_reversed",
    refund_state_ms: CLAIM + 7 * DAY,
    uncancel: true,
    remove_intro_mark: true,
  });
});

Deno.test("cancel: REFUND_REVERSED outside the paid window, or after a transfer cancel, does not un-cancel", () => {
  const outside = cctx({
    refund_state_ms: CLAIM + 5 * DAY,
    now_ms: CLAIM + 91 * DAY,
    referral: { state: "paid_cancelled", cancel_cause: "refund" },
  });
  const r = classifyCancel(ev(refundReversed), outside);
  assert.equal(r.effect, "refund_reversed");
  assert.equal((r as { uncancel: boolean }).uncancel, false);
  const byTransfer = cctx({
    refund_state_ms: CLAIM + 5 * DAY,
    referral: { state: "paid_cancelled", cancel_cause: "transfer" },
  });
  assert.equal((classifyCancel(ev(refundReversed), byTransfer) as { uncancel: boolean }).uncancel, false);
});

Deno.test("cancel row: CANCELLATION UNSUBSCRIBE → no effect; other non-refund reasons → no effect", () => {
  assert.deepEqual(classifyCancel(ev(cancelUnsub), cctx()), { effect: "none", reason: "unsubscribe_no_effect" });
  assert.deepEqual(classifyCancel(ev(cancelUnsub, { cancel_reason: "BILLING_ERROR" }), cctx()), {
    effect: "none",
    reason: "cancellation_not_refund",
  });
  assert.deepEqual(classifyCancel(ev(initialNormal), cctx()), { effect: "none", reason: "not_a_cancel_event" });
});

Deno.test("6.7 ordering: a late refund cannot undo a newer reversal, and the reverse", () => {
  // Reversal (t=7d) processed first, then the refund (t=5d) arrives late: ignored.
  assert.deepEqual(classifyCancel(ev(cancelRefund), cctx({ refund_state_ms: CLAIM + 7 * DAY })), {
    effect: "none",
    reason: "stale_refund_event",
  });
  // Refund at t=9d processed, then a reversal from t=7d arrives late: ignored.
  assert.deepEqual(classifyCancel(ev(refundReversed), cctx({ refund_state_ms: CLAIM + 9 * DAY })), {
    effect: "none",
    reason: "stale_refund_event",
  });
  // A replay of the same event (equal timestamp) changes nothing.
  assert.deepEqual(classifyCancel(ev(cancelRefund), cctx({ refund_state_ms: CLAIM + 5 * DAY })), {
    effect: "none",
    reason: "stale_refund_event",
  });
  // A newer refund after a reversal applies.
  const newer = ev(cancelRefund, { event_timestamp_ms: CLAIM + 10 * DAY });
  assert.equal(classifyCancel(newer, cctx({ refund_state_ms: CLAIM + 7 * DAY })).effect, "refund");
});

// ---------------------------------------------------------------------------------------------------------
// verifySignature
// ---------------------------------------------------------------------------------------------------------

const SECRET = "whsec_test_00000000000000000000";
const BODY = new TextEncoder().encode(JSON.stringify(initialNormal));
const T = 1_762_003_600; // unix seconds

async function sign(t: string, body: Uint8Array, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [
      "sign",
    ],
  );
  const prefix = new TextEncoder().encode(`${t}.`);
  const data = new Uint8Array(prefix.length + body.length);
  data.set(prefix);
  data.set(body, prefix.length);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("signature: valid header passes", async () => {
  const h = `t=${T},v1=${await sign(String(T), BODY, SECRET)}`;
  assert.deepEqual(await verifySignature(BODY, h, SECRET, T * 1000 + 30_000), { ok: true, t: T });
  // Whitespace and an unknown future key are tolerated.
  const h2 = `t=${T}, v1=${await sign(String(T), BODY, SECRET)}, v2=abc`;
  assert.equal((await verifySignature(BODY, h2, SECRET, T * 1000)).ok, true);
});

Deno.test("signature: tampered body, wrong secret and changed t are rejected", async () => {
  const v1 = await sign(String(T), BODY, SECRET);
  const tampered = new Uint8Array(BODY);
  tampered[10] ^= 1;
  assert.deepEqual(await verifySignature(tampered, `t=${T},v1=${v1}`, SECRET, T * 1000), {
    ok: false,
    reason: "mismatch",
  });
  const wrong = await sign(String(T), BODY, "whsec_other");
  assert.deepEqual(await verifySignature(BODY, `t=${T},v1=${wrong}`, SECRET, T * 1000), {
    ok: false,
    reason: "mismatch",
  });
  assert.deepEqual(await verifySignature(BODY, `t=${T + 1},v1=${v1}`, SECRET, T * 1000), {
    ok: false,
    reason: "mismatch",
  });
});

Deno.test("signature: t more than 10 minutes from now is stale (both directions)", async () => {
  const h = `t=${T},v1=${await sign(String(T), BODY, SECRET)}`;
  assert.equal((await verifySignature(BODY, h, SECRET, T * 1000 + 600_000)).ok, true);
  assert.deepEqual(await verifySignature(BODY, h, SECRET, T * 1000 + 600_001), { ok: false, reason: "stale" });
  assert.deepEqual(await verifySignature(BODY, h, SECRET, T * 1000 - 600_001), { ok: false, reason: "stale" });
});

Deno.test("signature: malformed headers and an empty secret are rejected", async () => {
  const v1 = await sign(String(T), BODY, SECRET);
  for (
    const h of [
      "",
      v1,
      `t=${T}`,
      `v1=${v1}`,
      `t=abc,v1=${v1}`,
      `t=${T},v1=${v1.slice(2)}`,
      `t=${T},v1=${"z".repeat(64)}`,
      `t=${T},t=${T},v1=${v1}`,
      `t=-${T},v1=${v1}`,
      `t=${T};v1=${v1}`,
      `t=${T},v1=${v1}`.padEnd(2000, " "),
    ]
  ) {
    assert.deepEqual(await verifySignature(BODY, h, SECRET, T * 1000), { ok: false, reason: "malformed" }, h);
  }
  assert.deepEqual(await verifySignature(BODY, `t=${T},v1=${v1}`, "", T * 1000), { ok: false, reason: "no_secret" });
});

// ---------------------------------------------------------------------------------------------------------
// matchSubscription (6.5)
// ---------------------------------------------------------------------------------------------------------

const SUBS = apiSubs.items as ApiV2Subscription[];
const TXN = { first_purchased_at_ms: CLAIM + 3_600_000, store: "APP_STORE", environment: "PRODUCTION" };

Deno.test("match: by a seen store_subscription_identifier", () => {
  const r = matchSubscription(SUBS, { ...TXN, first_purchased_at_ms: null }, (id) => id === "2000000000000004");
  assert.equal(r.matched, true);
  assert.equal(r.matched && r.via, "transaction_id_seen");
  assert.equal(r.matched && r.subscription.id, "sub_000000000001");
  // Numeric identifiers (as in RevenueCat's example payload) are compared as strings.
  const numeric = [{ ...SUBS[0], store_subscription_identifier: 2000000000000004 }];
  assert.equal(matchSubscription(numeric, TXN, (id) => id === "2000000000000004").matched, true);
});

Deno.test("match: fallback on starts_at within one minute, normalised store and environment", () => {
  const r = matchSubscription(SUBS, TXN, () => false);
  assert.equal(r.matched && r.via, "starts_at");
  assert.equal(r.matched && r.subscription.id, "sub_000000000001");
  assert.equal(
    matchSubscription(SUBS, { ...TXN, first_purchased_at_ms: TXN.first_purchased_at_ms - 58_000 }, () => false).matched,
    true,
  );
  assert.equal(
    matchSubscription(SUBS, { ...TXN, first_purchased_at_ms: TXN.first_purchased_at_ms - 62_001 }, () => false).matched,
    false,
  );
  assert.equal(matchSubscription(SUBS, { ...TXN, store: "PLAY_STORE" }, () => false).matched, false);
  assert.equal(matchSubscription(SUBS, { ...TXN, environment: "SANDBOX" }, () => false).matched, false);
  assert.equal(matchSubscription(SUBS, { ...TXN, first_purchased_at_ms: null }, () => false).matched, false);
});

Deno.test("match: never a promotional, family-shared or inactive subscription; product ids ignored", () => {
  // The promotional grant starts exactly at the purchase time and is "seen": still no match.
  const promoOnly = [SUBS[1]];
  assert.equal(matchSubscription(promoOnly, { ...TXN, store: "PROMOTIONAL" }, () => true).matched, false);
  const shared = [{ ...SUBS[0], ownership: "family_shared" }];
  assert.equal(matchSubscription(shared, TXN, () => true).matched, false);
  const inactive = [{ ...SUBS[0], gives_access: false }];
  assert.equal(matchSubscription(inactive, TXN, () => true).matched, false);
  const otherProduct = [{ ...SUBS[0], product_id: "prod_something_else" }];
  assert.equal(matchSubscription(otherProduct, TXN, () => false).matched, true);
  assert.equal(matchSubscription([], TXN, () => true).matched, false);
});
