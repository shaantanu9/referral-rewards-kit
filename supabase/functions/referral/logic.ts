// Paid decision logic for the referral kit (ADR 0001, sections 5, 6.1, 6.3, 6.5, 6.7).
//
// Pure functions only: no network, no database, no imports. The edge function (part 7) and the SQL tests
// (part 5) mirror these rules; this file is the reference the decision tables are unit-tested against.
// Where the ADR is ambiguous the safer reading is taken (never reward when unsure); each such choice is
// marked "Ambiguity" below and listed in docs/ISSUES.md.

// ---------------------------------------------------------------------------------------------------------
// Event trimming (ADR 5, `events.fields`)
// ---------------------------------------------------------------------------------------------------------

/** The only webhook fields the kit ever stores. Never `subscriber_attributes` (may hold email or name). */
export interface EventFields {
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  transferred_from?: string[];
  transferred_to?: string[];
  original_transaction_id?: string;
  transaction_id?: string;
  product_id?: string;
  entitlement_ids?: string[];
  period_type?: string;
  price?: number;
  store?: string;
  environment?: string;
  is_family_share?: boolean;
  is_trial_conversion?: boolean;
  cancel_reason?: string;
  purchased_at_ms?: number;
}

export interface TrimmedEvent {
  event_id: string;
  type: string;
  event_timestamp_ms: number;
  fields: EventFields;
}

export class InvalidEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEventError";
  }
}

const STRING_FIELDS = [
  "app_user_id",
  "original_app_user_id",
  "original_transaction_id",
  "transaction_id",
  "product_id",
  "period_type",
  "store",
  "environment",
  "cancel_reason",
] as const;
const STRING_LIST_FIELDS = ["aliases", "transferred_from", "transferred_to", "entitlement_ids"] as const;
const NUMBER_FIELDS = ["price", "purchased_at_ms"] as const;
const BOOLEAN_FIELDS = ["is_family_share", "is_trial_conversion"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Trim a RevenueCat webhook body (`{api_version, event: {...}}`) to what the kit stores.
 * Accepts the raw bytes, the raw string, or the parsed object. Fields of the wrong type are dropped, not coerced.
 * Throws InvalidEventError when the body is not JSON or lacks `event.id`, `event.type` or `event.event_timestamp_ms`.
 */
export function trimEvent(rawWebhookBody: Uint8Array | string | unknown): TrimmedEvent {
  let body: unknown = rawWebhookBody;
  if (rawWebhookBody instanceof Uint8Array) body = new TextDecoder().decode(rawWebhookBody);
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      throw new InvalidEventError("body is not JSON");
    }
  }
  if (!isRecord(body) || !isRecord(body.event)) throw new InvalidEventError("missing event object");
  const ev = body.event;
  if (typeof ev.id !== "string" || ev.id === "") throw new InvalidEventError("missing event.id");
  if (typeof ev.type !== "string" || ev.type === "") throw new InvalidEventError("missing event.type");
  if (typeof ev.event_timestamp_ms !== "number" || !Number.isFinite(ev.event_timestamp_ms)) {
    throw new InvalidEventError("missing event.event_timestamp_ms");
  }

  const fields: Record<string, unknown> = {};
  for (const k of STRING_FIELDS) if (typeof ev[k] === "string") fields[k] = ev[k];
  for (const k of STRING_LIST_FIELDS) {
    const v = ev[k];
    if (Array.isArray(v)) fields[k] = v.filter((x): x is string => typeof x === "string");
  }
  for (const k of NUMBER_FIELDS) {
    const v = ev[k];
    if (typeof v === "number" && Number.isFinite(v)) fields[k] = v;
  }
  for (const k of BOOLEAN_FIELDS) if (typeof ev[k] === "boolean") fields[k] = ev[k];

  return {
    event_id: ev.id,
    type: ev.type,
    event_timestamp_ms: ev.event_timestamp_ms,
    fields: fields as EventFields,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Store and environment normalisation (ADR 6.5)
// ---------------------------------------------------------------------------------------------------------

/**
 * One form for a store name: lower snake case, the API v2 spelling (`app_store`, `play_store`, `promotional`, …).
 * Webhook `APP_STORE` and API v2 `app_store` both give `app_store`. Unknown stores pass through in the same form, so
 * they still compare equal across the two sources. Non-strings and empty strings give null.
 */
export function normaliseStore(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const n = s.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return n === "" ? null : n;
}

/** `PRODUCTION` / `production` → `production`; `SANDBOX` / `sandbox` → `sandbox`; anything else → null. */
export function normaliseEnvironment(e: unknown): "production" | "sandbox" | null {
  if (typeof e !== "string") return null;
  const n = e.trim().toLowerCase();
  return n === "production" || n === "sandbox" ? n : null;
}

// ---------------------------------------------------------------------------------------------------------
// Users an event concerns (ADR 6.1)
// ---------------------------------------------------------------------------------------------------------

export type EventUsers =
  | { kind: "users"; users: string[] }
  | { kind: "transfer"; from: string[]; to: string[] };

function uniq(xs: (string | undefined)[]): string[] {
  return [...new Set(xs.filter((x): x is string => typeof x === "string" && x !== ""))];
}

/**
 * The user ids an event concerns. `TRANSFER` is sent only to the destination, so it is matched on its two lists,
 * never on `app_user_id` / aliases (ADR 6.1).
 */
export function usersInEvent(type: string, fields: EventFields): EventUsers {
  if (type === "TRANSFER") {
    return { kind: "transfer", from: uniq(fields.transferred_from ?? []), to: uniq(fields.transferred_to ?? []) };
  }
  return { kind: "users", users: uniq([fields.app_user_id, fields.original_app_user_id, ...(fields.aliases ?? [])]) };
}

// ---------------------------------------------------------------------------------------------------------
// Paid decision table (ADR 6.3)
// ---------------------------------------------------------------------------------------------------------

/** D-R8: does an INTRO-period purchase count as paid? Default `if_price_positive`. */
export type IntroRule = "if_price_positive" | "never";

export interface PaidContext {
  settings: {
    /** `settings.entitlement_id`: the entitlement whose purchase counts as paid. */
    entitlement_id: string | null;
    allow_sandbox: boolean;
    paid_window_days: number;
    /** D-R8, default `if_price_positive`. */
    intro_rule?: IntroRule;
  };
  /** From the referral's rule set: `params.count_one_time` of the paid rule. Default false. */
  count_one_time?: boolean;
  referral: {
    claimed_at_ms: number;
    /** The referral already reached `paid` (any transaction). */
    reached_paid: boolean;
  } | null;
  transaction: {
    /** When the subscription began, trial included; null while unknown (lost INITIAL_PURCHASE). */
    first_purchased_at_ms: number | null;
    refunded_at_ms: number | null;
    /** This transaction already rewarded some referral. */
    already_rewarded: boolean;
    /** A tombstone matches this transaction (HMAC comparison done by the caller). */
    tombstoned: boolean;
  };
}

export type NotPaidReason =
  // Row-specific reasons, one per row of the 6.3 table.
  | "initial_purchase_zero_price" // INITIAL_PURCHASE NORMAL/PREPAID with price <= 0 or no price
  | "trial_wait_for_conversion" // INITIAL_PURCHASE TRIAL
  | "intro_not_counted" // INITIAL_PURCHASE INTRO, D-R8 = never
  | "intro_zero_price" // INITIAL_PURCHASE INTRO, price <= 0
  | "unknown_period_type" // INITIAL_PURCHASE with PROMOTIONAL or missing/unknown period_type
  | "renewal_zero_price" // RENEWAL with price <= 0
  | "product_change_never_by_itself" // PRODUCT_CHANGE
  | "one_time_not_counted" // NON_RENEWING_PURCHASE without params.count_one_time
  | "one_time_zero_price" // NON_RENEWING_PURCHASE with count_one_time but price <= 0
  | "no_effect_on_paid" // UNCANCELLATION, SUBSCRIPTION_EXTENDED, BILLING_ISSUE, EXPIRATION
  | "promotional_store" // store = PROMOTIONAL
  | "transfer_never_counts" // TRANSFER
  | "temporary_grant_never_counts" // TEMPORARY_ENTITLEMENT_GRANT
  | "family_share" // is_family_share = true
  | "sandbox_not_allowed" // environment = SANDBOX without allow_sandbox
  | "unknown_environment" // environment missing or not PRODUCTION/SANDBOX
  | "cancel_table_event" // CANCELLATION, REFUND_REVERSED: handled by classifyCancel
  // "Every qualifying row also needs" reasons.
  | "no_entitlement_configured"
  | "wrong_entitlement"
  | "no_referral"
  | "referral_already_paid" // also the "RENEWAL after a lapse" row when the referral already reached paid
  | "tombstoned"
  | "refunded"
  | "transaction_already_rewarded"
  | "started_before_claim"
  | "outside_paid_window";

export type PaidDecision =
  | {
    decision: "paid";
    /** The time the qualifying payment happened (`purchased_at_ms`, else `event_timestamp_ms`). */
    qualifying_at_ms: number;
    /** The rewarded purchase was an INTRO period: a later refund adds an `intro_refund` abuse mark. */
    intro: boolean;
  }
  | { decision: "not_paid"; reason: NotPaidReason }
  /** Start of the subscription unknown (its INITIAL_PURCHASE was lost): fill it from API v2 `starts_at`, then retry. */
  | { decision: "wait_for_start" }
  /** Event type not in the 6.3 tables: stored, no effect. */
  | { decision: "ignored"; reason: "unknown_event_type" };

const DAY_MS = 86_400_000;

/** Every event type named in either 6.3 table. Anything else is `ignored`. */
export const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "NON_RENEWING_PURCHASE",
  "UNCANCELLATION",
  "SUBSCRIPTION_EXTENDED",
  "BILLING_ISSUE",
  "EXPIRATION",
  "TRANSFER",
  "TEMPORARY_ENTITLEMENT_GRANT",
  "CANCELLATION",
  "REFUND_REVERSED",
]);

const notPaid = (reason: NotPaidReason): PaidDecision => ({ decision: "not_paid", reason });

function pricePositive(f: EventFields): boolean {
  return typeof f.price === "number" && f.price > 0;
}

/**
 * The 6.3 paid decision for one event and one referral. Pure: the caller loads `ctx` from the database.
 * Order: event type row → exclusions that apply to every event → the row's own condition → the conditions every
 * qualifying row also needs → start known (else `wait_for_start`).
 */
export function classifyPaid(
  event: Pick<TrimmedEvent, "type" | "event_timestamp_ms" | "fields">,
  ctx: PaidContext,
): PaidDecision {
  const { type, fields: f } = event;
  if (!KNOWN_EVENT_TYPES.has(type)) return { decision: "ignored", reason: "unknown_event_type" };

  // Rows that never count, whatever else is true.
  switch (type) {
    case "PRODUCT_CHANGE":
      return notPaid("product_change_never_by_itself");
    case "UNCANCELLATION":
    case "SUBSCRIPTION_EXTENDED":
    case "BILLING_ISSUE":
    case "EXPIRATION":
      return notPaid("no_effect_on_paid");
    case "TRANSFER":
      return notPaid("transfer_never_counts");
    case "TEMPORARY_ENTITLEMENT_GRANT":
      return notPaid("temporary_grant_never_counts");
    case "CANCELLATION":
    case "REFUND_REVERSED":
      return notPaid("cancel_table_event");
  }

  // Exclusions for every purchase event.
  if (normaliseStore(f.store) === "promotional") return notPaid("promotional_store");
  if (f.is_family_share === true) return notPaid("family_share");
  const env = normaliseEnvironment(f.environment);
  if (env === null) return notPaid("unknown_environment");
  if (env === "sandbox" && !ctx.settings.allow_sandbox) return notPaid("sandbox_not_allowed");
  if (!ctx.settings.entitlement_id) return notPaid("no_entitlement_configured");
  if (!(f.entitlement_ids ?? []).includes(ctx.settings.entitlement_id)) return notPaid("wrong_entitlement");

  // The row's own condition.
  let intro = false;
  let isOneTime = false;
  if (type === "INITIAL_PURCHASE") {
    const p = (f.period_type ?? "").toUpperCase();
    if (p === "NORMAL" || p === "PREPAID") {
      if (!pricePositive(f)) return notPaid("initial_purchase_zero_price");
    } else if (p === "TRIAL") {
      return notPaid("trial_wait_for_conversion");
    } else if (p === "INTRO") {
      if ((ctx.settings.intro_rule ?? "if_price_positive") === "never") return notPaid("intro_not_counted");
      if (!pricePositive(f)) return notPaid("intro_zero_price");
      intro = true;
    } else {
      return notPaid("unknown_period_type");
    }
  } else if (type === "RENEWAL") {
    // Trial conversion: yes. Other renewal ("after a lapse"): only if the referral never reached paid, which the
    // `referral_already_paid` check below enforces for every row. Ambiguity: a paid renewal needs price > 0 too.
    if (!pricePositive(f)) return notPaid("renewal_zero_price");
  } else if (type === "NON_RENEWING_PURCHASE") {
    if (!ctx.count_one_time) return notPaid("one_time_not_counted");
    if (!pricePositive(f)) return notPaid("one_time_zero_price");
    isOneTime = true;
  }

  // Every qualifying row also needs these.
  const r = ctx.referral;
  const t = ctx.transaction;
  if (!r) return notPaid("no_referral");
  if (r.reached_paid) return notPaid("referral_already_paid");
  if (t.tombstoned) return notPaid("tombstoned");
  if (t.refunded_at_ms !== null) return notPaid("refunded");
  if (t.already_rewarded) return notPaid("transaction_already_rewarded");

  // Ambiguity: the window is measured on the payment time (`purchased_at_ms`), falling back to the later
  // `event_timestamp_ms` when absent, which can only make the window stricter.
  const qualifyingAt = typeof f.purchased_at_ms === "number" ? f.purchased_at_ms : event.event_timestamp_ms;
  if (qualifyingAt > r.claimed_at_ms + ctx.settings.paid_window_days * DAY_MS) return notPaid("outside_paid_window");

  // Ambiguity: a one-time purchase has no INITIAL_PURCHASE; its own purchase time is its start.
  const start = t.first_purchased_at_ms ?? (isOneTime ? f.purchased_at_ms ?? null : null);
  if (start === null) return { decision: "wait_for_start" };
  if (start <= r.claimed_at_ms || qualifyingAt <= r.claimed_at_ms) return notPaid("started_before_claim");

  return { decision: "paid", qualifying_at_ms: qualifyingAt, intro };
}

// ---------------------------------------------------------------------------------------------------------
// Cancel table (ADR 6.3) with the refund ordering rule (ADR 6.7)
// ---------------------------------------------------------------------------------------------------------

export type AbuseCause = "late_refund" | "intro_refund" | "transfer_in";

export interface CancelContext {
  /** Time of the event that last set or cleared the refund; null when never. */
  refund_state_ms: number | null;
  now_ms: number;
  /** The friend this event's transaction belongs to (Supabase uid = RevenueCat app user id); null if no referral. */
  referral: {
    friend_ids: string[];
    claimed_at_ms: number;
    paid_window_days: number;
    state: string;
    /** The paid reward for this transaction: none yet, still held (not granted), or already granted. */
    paid_reward: "none" | "held" | "granted";
    /** The rewarded purchase was an INTRO period (D-R8). */
    rewarded_intro: boolean;
    /** Why the referral is `paid_cancelled`, if it is. Only a refund cancel can be undone by REFUND_REVERSED. */
    cancel_cause: "refund" | "transfer" | null;
  } | null;
}

export type CancelDecision =
  | {
    effect: "refund";
    /** Set `transactions.refunded_at` and `refund_state_ms` (even if no referral holds the transaction). */
    refund_state_ms: number;
    /** `paid_cancelled` while the reward is held; `refunded_late` after it was granted (6.6); else unchanged. */
    referral_to: "paid_cancelled" | "refunded_late" | null;
    abuse_marks: AbuseCause[];
  }
  | {
    effect: "refund_reversed";
    /** Clear `transactions.refunded_at`, set `refund_state_ms`. */
    refund_state_ms: number;
    /** Un-cancel the referral (back to `paid`, reward back to queued). */
    uncancel: boolean;
    /** Delete the `intro_refund` abuse mark of that event's refund. */
    remove_intro_mark: boolean;
  }
  | {
    effect: "transfer_away";
    /** `paid_cancelled` while the reward is held; null when it was already granted (no clawback). */
    referral_to: "paid_cancelled" | null;
    abuse_marks: AbuseCause[];
  }
  | { effect: "transfer_in"; abuse_marks: AbuseCause[] }
  | {
    effect: "none";
    reason:
      | "unsubscribe_no_effect"
      | "cancellation_not_refund"
      | "stale_refund_event"
      | "transfer_unrelated"
      | "transfer_in_outside_window"
      | "not_a_cancel_event";
  };

function isRefund(f: EventFields): boolean {
  return (f.cancel_reason ?? "").toUpperCase() === "CUSTOMER_SUPPORT" || (typeof f.price === "number" && f.price < 0);
}

function isNewer(ts: number, stateMs: number | null): boolean {
  return stateMs === null || ts > stateMs;
}

/** The 6.3 cancel table for one event, with 6.7's refund ordering. */
export function classifyCancel(
  event: Pick<TrimmedEvent, "type" | "event_timestamp_ms" | "fields">,
  ctx: CancelContext,
): CancelDecision {
  const { type, fields: f } = event;
  const r = ctx.referral;

  if (type === "CANCELLATION") {
    if (!isRefund(f)) {
      return {
        effect: "none",
        reason: (f.cancel_reason ?? "").toUpperCase() === "UNSUBSCRIBE"
          ? "unsubscribe_no_effect"
          : "cancellation_not_refund",
      };
    }
    if (!isNewer(event.event_timestamp_ms, ctx.refund_state_ms)) {
      return { effect: "none", reason: "stale_refund_event" };
    }
    const marks: AbuseCause[] = [];
    let to: "paid_cancelled" | "refunded_late" | null = null;
    if (r && r.paid_reward === "held" && r.state === "paid") to = "paid_cancelled";
    if (r && r.paid_reward === "granted") {
      to = "refunded_late";
      marks.push("late_refund");
    }
    if (r && r.paid_reward !== "none" && r.rewarded_intro) marks.push("intro_refund");
    return { effect: "refund", refund_state_ms: event.event_timestamp_ms, referral_to: to, abuse_marks: marks };
  }

  if (type === "REFUND_REVERSED") {
    if (!isNewer(event.event_timestamp_ms, ctx.refund_state_ms)) {
      return { effect: "none", reason: "stale_refund_event" };
    }
    const inWindow = r !== null && ctx.now_ms <= r.claimed_at_ms + r.paid_window_days * DAY_MS;
    const uncancel = r !== null && r.state === "paid_cancelled" && r.cancel_cause === "refund" && inWindow;
    return {
      effect: "refund_reversed",
      refund_state_ms: event.event_timestamp_ms,
      uncancel,
      remove_intro_mark: r !== null && r.rewarded_intro,
    };
  }

  if (type === "TRANSFER") {
    const u = usersInEvent(type, f);
    if (u.kind !== "transfer" || !r) return { effect: "none", reason: "transfer_unrelated" };
    const friend = new Set(r.friend_ids);
    const away = u.from.some((x) => friend.has(x));
    const into = u.to.some((x) => friend.has(x));
    const inWindow = event.event_timestamp_ms <= r.claimed_at_ms + r.paid_window_days * DAY_MS &&
      event.event_timestamp_ms >= r.claimed_at_ms;
    const marks: AbuseCause[] = into && inWindow ? ["transfer_in"] : [];
    if (away) {
      const to = r.paid_reward === "held" && r.state === "paid" ? "paid_cancelled" : null;
      return { effect: "transfer_away", referral_to: to, abuse_marks: marks };
    }
    if (into) {
      return inWindow
        ? { effect: "transfer_in", abuse_marks: marks }
        : { effect: "none", reason: "transfer_in_outside_window" };
    }
    return { effect: "none", reason: "transfer_unrelated" };
  }

  return { effect: "none", reason: "not_a_cancel_event" };
}

// ---------------------------------------------------------------------------------------------------------
// Webhook signature (ADR 6.7)
// ---------------------------------------------------------------------------------------------------------

export type SignatureResult =
  | { ok: true; t: number }
  | { ok: false; reason: "no_secret" | "malformed" | "stale" | "mismatch" };

/** Allowed distance between the header's `t` and now (ADR 6.7). */
export const SIGNATURE_TOLERANCE_MS = 10 * 60 * 1000;

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Check `X-RevenueCat-Webhook-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>` where the HMAC is over
 * `"<t>.<raw body bytes>"` with the integration's signing secret. The comparison is WebCrypto's `verify`, which is
 * constant-time. `t` more than 10 minutes from `nowMs` (either way) is rejected.
 */
export async function verifySignature(
  rawBody: Uint8Array,
  header: string,
  secret: string,
  nowMs: number,
): Promise<SignatureResult> {
  if (!secret) return { ok: false, reason: "no_secret" };
  if (typeof header !== "string" || header.length > 1024) return { ok: false, reason: "malformed" };

  let tStr: string | null = null;
  const sigs: Uint8Array<ArrayBuffer>[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) return { ok: false, reason: "malformed" };
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === "t") {
      if (tStr !== null || !/^\d{1,12}$/.test(value)) return { ok: false, reason: "malformed" };
      tStr = value;
    } else if (key === "v1") {
      const b = hexToBytes(value);
      if (!b) return { ok: false, reason: "malformed" };
      sigs.push(b);
    }
    // Other keys (future versions) are ignored.
  }
  if (tStr === null || sigs.length === 0) return { ok: false, reason: "malformed" };
  const t = Number(tStr);
  if (Math.abs(nowMs - t * 1000) > SIGNATURE_TOLERANCE_MS) return { ok: false, reason: "stale" };

  const prefix = new TextEncoder().encode(`${tStr}.`);
  const signed = new Uint8Array(prefix.length + rawBody.length);
  signed.set(prefix, 0);
  signed.set(rawBody, prefix.length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  for (const sig of sigs) {
    if (await crypto.subtle.verify("HMAC", key, sig, signed)) return { ok: true, t };
  }
  return { ok: false, reason: "mismatch" };
}

// ---------------------------------------------------------------------------------------------------------
// Fresh check before a paid grant (ADR 6.5)
// ---------------------------------------------------------------------------------------------------------

/** The API v2 subscription fields the match reads. */
export interface ApiV2Subscription {
  id?: string;
  store_subscription_identifier?: string | number | null;
  starts_at?: number | null;
  store?: string | null;
  environment?: string | null;
  ownership?: string | null;
  gives_access?: boolean | null;
  [k: string]: unknown;
}

export interface TransactionForMatch {
  first_purchased_at_ms: number | null;
  /** Webhook or API spelling; normalised here. */
  store: string | null;
  environment: string | null;
}

export type SubscriptionMatch =
  | { matched: true; via: "transaction_id_seen" | "starts_at"; subscription: ApiV2Subscription }
  | { matched: false };

const STARTS_AT_TOLERANCE_MS = 60_000;

function ownedAndActive(s: ApiV2Subscription): boolean {
  return s.gives_access === true && (s.ownership ?? "").toLowerCase() === "purchased";
}

/**
 * Find the friend's active, owned subscription that is this referral's transaction (ADR 6.5).
 * `isSeenTransactionId(id)` answers "is HMAC(id) in `transactions.transaction_ids_seen`" (the caller holds the
 * pepper). Fallback: `starts_at` within one minute of `first_purchased_at_ms`, same normalised store, same
 * environment. Product ids are never compared (API v2 `product_id` is RevenueCat's, not the store's).
 * Ambiguity: the owned-and-active condition applies to both paths, and promotional subscriptions never match.
 */
export function matchSubscription(
  apiV2Subscriptions: readonly ApiV2Subscription[],
  txn: TransactionForMatch,
  isSeenTransactionId: (storeSubscriptionIdentifier: string) => boolean,
): SubscriptionMatch {
  const candidates = apiV2Subscriptions.filter((s) =>
    isRecord(s) && ownedAndActive(s) && normaliseStore(s.store) !== "promotional"
  );

  for (const s of candidates) {
    const id = s.store_subscription_identifier;
    if ((typeof id === "string" && id !== "") || typeof id === "number") {
      if (isSeenTransactionId(String(id))) return { matched: true, via: "transaction_id_seen", subscription: s };
    }
  }

  const start = txn.first_purchased_at_ms;
  const store = normaliseStore(txn.store);
  const env = normaliseEnvironment(txn.environment);
  if (start === null || store === null || env === null) return { matched: false };
  for (const s of candidates) {
    if (typeof s.starts_at !== "number") continue;
    if (Math.abs(s.starts_at - start) > STARTS_AT_TOLERANCE_MS) continue;
    if (normaliseStore(s.store) !== store) continue;
    if (normaliseEnvironment(s.environment) !== env) continue;
    return { matched: true, via: "starts_at", subscription: s };
  }
  return { matched: false };
}
