// From `referral_svc_event_context` to the `referral_svc_apply_event` decision (ADR 6.3, 6.7).
// Pure: the tables themselves live only in logic.ts (classifyPaid, classifyCancel); this file only maps the
// database's context onto their inputs and their outputs onto the decision JSON documented above
// `referral.apply_event` in migration 4.

import {
  type AbuseCause,
  classifyCancel,
  classifyPaid,
  type EventFields,
  type IntroRule,
  KNOWN_EVENT_TYPES,
  type PaidDecision,
  usersInEvent,
} from "./logic.ts";

export interface ContextReferral {
  referral_id: string;
  friend_id: string;
  sharer_id: string | null;
  claimed_at_ms: number;
  state: string;
  reached_paid: boolean;
  paid_reward: "none" | "held" | "granted";
  rewarded_intro: boolean;
  cancel_cause: "refund" | "transfer" | null;
  holds_transaction: boolean;
  intro_rule: IntroRule | string;
  count_one_time: boolean;
}

/** The JSON `referral_svc_event_context` returns. */
export interface EventContext {
  event: { event_id: string; type: string; event_timestamp_ms: number; fields: EventFields; state: string };
  settings: { entitlement_id: string | null; allow_sandbox: boolean; paid_window_days: number; paid_enabled: boolean };
  transaction: {
    first_purchased_at_ms: number | null;
    refunded_at_ms: number | null;
    refund_state_ms: number | null;
    already_rewarded: boolean;
    tombstoned: boolean;
  } | null;
  referrals: ContextReferral[];
  fingerprint: string;
  now_ms: number;
}

export interface ReferralDecision {
  referral_id: string;
  paid?: { qualifying_at_ms: number; intro: boolean } | null;
  referral_to?: "paid_cancelled" | "refunded_late" | null;
  cancel_cause?: "refund" | "transfer";
  uncancel?: boolean;
  remove_intro_mark?: boolean;
  abuse_marks?: AbuseCause[];
}

export interface Decision {
  event_state: "processed" | "ignored" | "waiting";
  refund: { refunded: boolean; refund_state_ms: number } | null;
  referrals: ReferralDecision[];
}

const CANCEL_TYPES = new Set(["CANCELLATION", "REFUND_REVERSED"]);

function cancelReferral(ctx: EventContext, r: ContextReferral | null) {
  return r === null ? null : {
    friend_ids: [r.friend_id],
    claimed_at_ms: r.claimed_at_ms,
    paid_window_days: ctx.settings.paid_window_days,
    state: r.state,
    paid_reward: r.paid_reward,
    rewarded_intro: r.rewarded_intro,
    cancel_cause: r.cancel_cause,
  };
}

/**
 * Decide what one event does. `paid_enabled = false` still decides: the SQL skips queuing paid rewards.
 * Purchase events: at most one `paid` entry per event (the SQL refuses a second reward for one transaction); when
 * several referrals qualify (aliases joining two friends), the earliest claim wins.
 */
export function decide(ctx: EventContext): Decision {
  const ev = ctx.event;
  const none: Decision = { event_state: "processed", refund: null, referrals: [] };
  if (!KNOWN_EVENT_TYPES.has(ev.type)) return { ...none, event_state: "ignored" };

  if (CANCEL_TYPES.has(ev.type)) {
    const holder = ctx.referrals.find((r) => r.holds_transaction) ?? null;
    const d = classifyCancel(ev, {
      refund_state_ms: ctx.transaction?.refund_state_ms ?? null,
      now_ms: ctx.now_ms,
      referral: cancelReferral(ctx, holder),
    });
    // Without a transaction row (no original_transaction_id) there is nothing to flag.
    if (ctx.transaction === null) return none;
    if (d.effect === "refund") {
      const refs: ReferralDecision[] = holder && (d.referral_to !== null || d.abuse_marks.length > 0)
        ? [{
          referral_id: holder.referral_id,
          referral_to: d.referral_to,
          cancel_cause: "refund",
          abuse_marks: d.abuse_marks,
        }]
        : [];
      return {
        event_state: "processed",
        refund: { refunded: true, refund_state_ms: d.refund_state_ms },
        referrals: refs,
      };
    }
    if (d.effect === "refund_reversed") {
      const refs: ReferralDecision[] = holder && (d.uncancel || d.remove_intro_mark)
        ? [{ referral_id: holder.referral_id, uncancel: d.uncancel, remove_intro_mark: d.remove_intro_mark }]
        : [];
      return {
        event_state: "processed",
        refund: { refunded: false, refund_state_ms: d.refund_state_ms },
        referrals: refs,
      };
    }
    return none;
  }

  const users = usersInEvent(ev.type, ev.fields);

  if (users.kind === "transfer") {
    const involved = new Set([...users.from, ...users.to]);
    const refs: ReferralDecision[] = [];
    for (const r of ctx.referrals) {
      if (!involved.has(r.friend_id)) continue;
      const d = classifyCancel(ev, {
        refund_state_ms: ctx.transaction?.refund_state_ms ?? null,
        now_ms: ctx.now_ms,
        referral: cancelReferral(ctx, r),
      });
      if (d.effect === "transfer_away" && (d.referral_to !== null || d.abuse_marks.length > 0)) {
        refs.push({
          referral_id: r.referral_id,
          referral_to: d.referral_to,
          cancel_cause: "transfer",
          abuse_marks: d.abuse_marks,
        });
      } else if (d.effect === "transfer_in" && d.abuse_marks.length > 0) {
        refs.push({ referral_id: r.referral_id, abuse_marks: d.abuse_marks });
      }
    }
    return { event_state: "processed", refund: null, referrals: refs };
  }

  // Purchase-type events: classifyPaid per referral whose friend is among the event's users.
  const eventUsers = new Set(users.users);
  const candidates = ctx.referrals
    .filter((r) => eventUsers.has(r.friend_id))
    .sort((a, b) => a.claimed_at_ms - b.claimed_at_ms || a.referral_id.localeCompare(b.referral_id));
  if (ctx.transaction === null) return none; // nothing to hold: a paid row needs a store transaction

  let paid: ReferralDecision | null = null;
  let wait = false;
  for (const r of candidates) {
    const d: PaidDecision = classifyPaid(ev, {
      settings: {
        entitlement_id: ctx.settings.entitlement_id,
        allow_sandbox: ctx.settings.allow_sandbox,
        paid_window_days: ctx.settings.paid_window_days,
        intro_rule: r.intro_rule === "never" ? "never" : "if_price_positive",
      },
      count_one_time: r.count_one_time,
      referral: { claimed_at_ms: r.claimed_at_ms, reached_paid: r.reached_paid },
      transaction: {
        first_purchased_at_ms: ctx.transaction.first_purchased_at_ms,
        refunded_at_ms: ctx.transaction.refunded_at_ms,
        already_rewarded: ctx.transaction.already_rewarded,
        tombstoned: ctx.transaction.tombstoned,
      },
    });
    if (d.decision === "wait_for_start") wait = true;
    else if (d.decision === "paid" && paid === null) {
      paid = { referral_id: r.referral_id, paid: { qualifying_at_ms: d.qualifying_at_ms, intro: d.intro } };
    }
  }
  // The start is a fact of the transaction: wait for it, then decide everything again.
  if (wait) return { event_state: "waiting", refund: null, referrals: [] };
  return { event_state: "processed", refund: null, referrals: paid ? [paid] : [] };
}
