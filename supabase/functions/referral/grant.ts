// Granting `entitlement_days` exactly once (ADR 6.4), with the fresh check before a paid grant (ADR 6.5).
// Step 1 (claim) and every write after it are SQL (migration 5); this file makes the RevenueCat calls in between.

import type { Db } from "./db.ts";
import { matchSubscription, normaliseStore } from "./logic.ts";
import {
  type RcCustomer,
  type RcEntitlementRef,
  type RcSubscription,
  type RevenueCat,
  RevenueCatError,
} from "./revenuecat.ts";

export const DAY_MS = 86_400_000;
/** RevenueCat ignores a grant within two hours of another promotional grant's expiry: stay clear of it. */
export const DUPLICATE_WINDOW_MS = 2 * 3600_000 + 60_000;

/** The JSON `referral_svc_claim_reward` returns for one claimed reward. */
export interface ClaimedReward {
  reward_id: string;
  attempt_token: string;
  user_id: string;
  event: string;
  /** Lookup key (`premium`), from the reward's grant_key. */
  entitlement_id: string;
  days: number;
  params: Record<string, unknown> | null;
  target_expires_at_ms: number | null;
  attempts: number;
  user_deleted: boolean;
  friend_id: string | null;
  friend_deleted: boolean;
  transaction: {
    first_purchased_at_ms: number | null;
    store: string | null;
    environment: string | null;
    refunded: boolean;
  } | null;
}

export type Outcome = "granted" | "banked" | "cancelled" | "retry" | "failed";

export interface GrantResult {
  reward_id: string;
  /**
   * What was sent to finish_reward, `lost_lease` when a set_target / finish found the lease gone, or `fallback` when
   * a lifetime holder got the rule's `params.fallback` instead (state = what the app hook grant answered).
   */
  outcome: Outcome | "lost_lease" | "fallback";
  /** The state finish_reward answered (e.g. `failed` when a retry reached max_attempts). */
  state: string | null;
  error: string | null;
}

export interface GrantOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Wait before re-reading the customer after a grant timed out (ADR 6.4: 30 s). */
  verifyDelayMs?: number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A queue outcome with its error text (shared with the rewards function). */
export class Finish {
  constructor(
    readonly outcome: Outcome,
    readonly error: string | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {}
}

/** RevenueCat errors to a queue outcome: 5xx/timeout → retry, 429 → retry after, other 4xx → failed. */
export function fromRcError(e: RevenueCatError): Finish {
  if (e.kind === "rate_limited") return new Finish("retry", e.message, e.retryAfterSeconds);
  if (e.kind === "server" || e.kind === "timeout") return new Finish("retry", e.message);
  return new Finish("failed", e.message);
}

/** A subscription's entitlements could not be read (no list even after re-reading it): never assume either way. */
export class EntitlementsUnknown extends Error {
  constructor(readonly subscriptionId: string | null) {
    super("subscription entitlements unknown");
    this.name = "EntitlementsUnknown";
  }
}

/**
 * Every entitlement of an API v2 subscription. Its `entitlements` field is one page (`items`, `next_page`): a page
 * with a `next_page` is completed from GET …/subscriptions/{id}/entitlements (all pages, capped by the client's
 * maxPages, which throws past the cap). A subscription without the list is read again once (GET subscription);
 * still without it → EntitlementsUnknown, never "holds it" nor "does not hold it".
 */
export async function subscriptionEntitlements(rc: RevenueCat, s: RcSubscription): Promise<RcEntitlementRef[]> {
  const id = typeof s.id === "string" && s.id !== "" ? s.id : null;
  let list = s.entitlements;
  if (!Array.isArray(list?.items)) {
    if (id === null) throw new EntitlementsUnknown(null);
    try {
      list = (await rc.getSubscription(id)).entitlements;
    } catch (e) {
      if (e instanceof RevenueCatError && e.kind === "not_found") throw new EntitlementsUnknown(id);
      throw e;
    }
    if (!Array.isArray(list?.items)) throw new EntitlementsUnknown(id);
  }
  const items = list!.items as RcEntitlementRef[];
  if (!list!.next_page) return items;
  if (id === null) throw new EntitlementsUnknown(null);
  return await rc.listSubscriptionEntitlements(id);
}

/** Does this subscription carry the entitlement (by lookup key or internal id), reading every page? */
export async function holdsEntitlement(
  rc: RevenueCat,
  s: RcSubscription,
  lookupKey: string,
  entitlementId: string,
): Promise<boolean> {
  const items = await subscriptionEntitlements(rc, s);
  return items.some((e) => e && (e.lookup_key === lookupKey || e.id === entitlementId));
}

/** An active store (not promotional) subscription carrying the entitlement. Throws EntitlementsUnknown when unsure. */
export async function activeStoreSubscription(
  rc: RevenueCat,
  subs: RcSubscription[],
  lookupKey: string,
  entitlementId: string,
): Promise<boolean> {
  for (const s of subs) {
    const store = normaliseStore(s.store);
    if (s.gives_access !== true || store === "promotional" || store === null) continue;
    if (await holdsEntitlement(rc, s, lookupKey, entitlementId)) return true;
  }
  return false;
}

/** Active entitlement rows for one entitlement id; `expires_at` null = lifetime. */
export function activeFor(c: RcCustomer, entitlementId: string) {
  const items = c.active_entitlements?.items;
  return (Array.isArray(items) ? items : []).filter((e) => e && e.entitlement_id === entitlementId);
}

async function listOrCreate(
  rc: RevenueCat,
  userId: string,
): Promise<{ subs: RcSubscription[]; created: RcCustomer | null }> {
  try {
    return { subs: await rc.listSubscriptions(userId), created: null };
  } catch (e) {
    if (!(e instanceof RevenueCatError) || e.kind !== "not_found") throw e;
    // ADR 6.1: a sharer who never opened a paywall still gets their days (deleted users were cancelled above).
    try {
      return { subs: [], created: await rc.createCustomer(userId) };
    } catch (e2) {
      // Another run created it first (409 or similar): carry on with an empty subscription list.
      if (e2 instanceof RevenueCatError && e2.kind === "client" && e2.status === 409) {
        return { subs: [], created: null };
      }
      throw e2;
    }
  }
}

async function freshCheck(db: Db, rc: RevenueCat, c: ClaimedReward): Promise<Finish | null> {
  if (c.friend_deleted || c.friend_id === null) return new Finish("cancelled", "friend deleted");
  if (c.transaction === null) return new Finish("cancelled", "fresh check: no transaction");
  if (c.transaction.refunded) return new Finish("cancelled", "refund");
  let subs: RcSubscription[];
  try {
    subs = await rc.listSubscriptions(c.friend_id);
  } catch (e) {
    if (e instanceof RevenueCatError && e.kind === "not_found") subs = [];
    else throw e;
  }
  const ids = subs.map((s) => s.store_subscription_identifier)
    .filter((x): x is string | number => (typeof x === "string" && x !== "") || typeof x === "number")
    .map(String);
  const seen = new Set<string>();
  if (ids.length > 0) {
    const flags = await db.rpc<boolean[]>("referral_svc_seen_ids", { reward_id: c.reward_id, ids }) ?? [];
    ids.forEach((id, i) => flags[i] === true && seen.add(id));
  }
  const m = matchSubscription(subs, c.transaction, (id) => seen.has(id));
  return m.matched ? null : new Finish("cancelled", "fresh check: no matching active subscription");
}

/**
 * Step 2's target: `days` after max(now, latest active expiry), clear of RevenueCat's duplicate window, whole seconds.
 * `latestMs` 0 = no active entitlement.
 */
export function computeTarget(latestMs: number, nowMs: number, days: number): number {
  let t = Math.max(nowMs, latestMs) + days * DAY_MS;
  if (latestMs > 0) t = Math.max(t, latestMs + DUPLICATE_WINDOW_MS);
  return Math.ceil(t / 1000) * 1000;
}

/** Does the customer hold the entitlement until at least `target` (lifetime counts)? */
export function reachesTarget(c: RcCustomer, entId: string, target: number): boolean {
  // RevenueCat may keep whole seconds; a second of slack never hides an ignored grant (those are hours off).
  return activeFor(c, entId).some((e) => e.expires_at === null || e.expires_at >= target - 1000);
}

async function verify(rc: RevenueCat, userId: string, entId: string, target: number, customer: RcCustomer | null) {
  const cust = customer?.active_entitlements ? customer : await rc.getCustomer(userId);
  return reachesTarget(cust, entId, target)
    ? new Finish("granted")
    : new Finish("failed", "verify: entitlement expiry short of the target");
}

async function run(
  db: Db,
  rc: RevenueCat,
  c: ClaimedReward,
  o: Required<GrantOptions>,
): Promise<Finish | "lost_lease" | "fallback"> {
  if (c.user_deleted) return new Finish("cancelled", "account deleted");
  if (c.event === "paid") {
    const f = await freshCheck(db, rc, c);
    if (f) return f;
  }
  const entId = await rc.entitlementIdFor(c.entitlement_id);
  if (entId === null) return new Finish("failed", `unknown entitlement lookup key`);

  // Step 2: decide the target once.
  let target = c.target_expires_at_ms;
  if (target === null) {
    const { subs, created } = await listOrCreate(rc, c.user_id);
    let banked: boolean;
    try {
      banked = await activeStoreSubscription(rc, subs, c.entitlement_id, entId);
    } catch (e) {
      if (e instanceof EntitlementsUnknown) return new Finish("retry", e.message);
      throw e;
    }
    if (banked) return new Finish("banked");
    const customer = created?.active_entitlements ? created : await rc.getCustomer(c.user_id);
    const active = activeFor(customer, entId);
    if (active.some((e) => e.expires_at === null)) {
      // ADR 6.4: the rule's params.fallback (another reward kind) instead of cancelling; validated in SQL.
      return hasFallback(c) ? "fallback" : new Finish("cancelled", "lifetime");
    }
    const latest = Math.max(0, ...active.map((e) => e.expires_at ?? 0));
    const t = computeTarget(latest, o.now(), c.days);
    const st = await db.rpc<{ status: string; target_expires_at_ms?: number }>("referral_svc_set_target", {
      reward_id: c.reward_id,
      attempt_token: c.attempt_token,
      target_expires_at_ms: t,
    });
    if (st?.status !== "ok") return "lost_lease";
    target = st.target_expires_at_ms ?? t;
  }

  // Step 3: grant with the stored target, then verify.
  return await grantAndVerify(rc, c.user_id, entId, target, o);
}

/**
 * Step 3: grant with the stored target, then verify. A timeout may have landed, so wait and read once before
 * calling it a retry. Non-RevenueCat errors propagate.
 */
export async function grantAndVerify(
  rc: RevenueCat,
  userId: string,
  entId: string,
  target: number,
  o: { sleep: (ms: number) => Promise<void>; verifyDelayMs: number },
): Promise<Finish> {
  let granted: RcCustomer;
  try {
    granted = await rc.grantEntitlement(userId, entId, target);
  } catch (e) {
    if (!(e instanceof RevenueCatError)) throw e;
    if (e.kind === "timeout") {
      // The grant may have landed; read-after-write can lag, so wait, then read once.
      await o.sleep(o.verifyDelayMs);
      try {
        const v = await verify(rc, userId, entId, target, null);
        return v.outcome === "granted" ? v : new Finish("retry", e.message);
      } catch {
        return new Finish("retry", e.message);
      }
    }
    return fromRcError(e);
  }
  return await verify(rc, userId, entId, target, granted);
}

/** The rule named a fallback reward for lifetime holders (`params.fallback`, an object; SQL checks the rest). */
export function hasFallback(c: ClaimedReward): boolean {
  const f = c.params?.fallback;
  return typeof f === "object" && f !== null && !Array.isArray(f);
}

/** Steps 2 and 3 for one claimed reward, then the compare-and-set outcome. */
export async function grantOne(
  db: Db,
  rc: RevenueCat,
  c: ClaimedReward,
  opts: GrantOptions = {},
): Promise<GrantResult> {
  const o: Required<GrantOptions> = {
    now: opts.now ?? Date.now,
    sleep: opts.sleep ?? realSleep,
    verifyDelayMs: opts.verifyDelayMs ?? 30_000,
  };
  let f: Finish | "lost_lease" | "fallback";
  try {
    f = await run(db, rc, c, o);
  } catch (e) {
    f = e instanceof RevenueCatError
      ? fromRcError(e)
      : new Finish("retry", (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 300));
  }
  if (f === "lost_lease") return { reward_id: c.reward_id, outcome: "lost_lease", state: null, error: null };
  if (f === "fallback") {
    const st = await db.rpc<string>("referral_svc_fallback_reward", {
      reward_id: c.reward_id,
      attempt_token: c.attempt_token,
    });
    if (st === "lost_lease") return { reward_id: c.reward_id, outcome: "lost_lease", state: null, error: null };
    if (st !== "no_fallback") return { reward_id: c.reward_id, outcome: "fallback", state: st, error: null };
    f = new Finish("cancelled", "lifetime"); // SQL found no valid fallback: today's behaviour
  }
  const state = await db.rpc<string>("referral_svc_finish_reward", {
    reward_id: c.reward_id,
    attempt_token: c.attempt_token,
    outcome: f.outcome,
    error: f.error,
    retry_after_seconds: f.retryAfterSeconds,
  });
  return {
    reward_id: c.reward_id,
    outcome: state === "lost_lease" ? "lost_lease" : f.outcome,
    state,
    error: f.error,
  };
}

export interface RunGrantsOptions extends GrantOptions {
  batch: number;
  /** Absolute time (ms, same clock as `now`) after which no new reward is claimed. */
  deadlineMs: number;
}

export interface RunGrantsSummary {
  claimed: number;
  outcomes: Record<string, number>;
  cap_reached: boolean;
  results: GrantResult[];
}

/** Claim and grant until the batch, the time budget or the queue runs out (ADR 6.4 step 1). */
export async function runGrants(db: Db, rc: RevenueCat, opts: RunGrantsOptions): Promise<RunGrantsSummary> {
  const now = opts.now ?? Date.now;
  const out: RunGrantsSummary = { claimed: 0, outcomes: {}, cap_reached: false, results: [] };
  while (out.claimed < opts.batch && now() < opts.deadlineMs) {
    const c = await db.rpc<ClaimedReward | { cap_reached: true } | null>("referral_svc_claim_reward", {});
    if (c === null) break;
    if ("cap_reached" in c) {
      out.cap_reached = true;
      break;
    }
    out.claimed++;
    const r = await grantOne(db, rc, c, opts);
    out.results.push(r);
    out.outcomes[r.outcome] = (out.outcomes[r.outcome] ?? 0) + 1;
  }
  return out;
}
