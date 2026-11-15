// Granting rewards `entitlement_days` through RevenueCat (ADR 0002 section 7, 10.1). An unconditional promotional
// grant: no "friend paid" fresh check and no banking. The target rule, the duplicate window, the grant call and the
// verify-after-timeout are the referral function's own code (../referral/grant.ts), imported, not copied.

import { activeFor, computeTarget, Finish, fromRcError, grantAndVerify, reachesTarget } from "../referral/grant.ts";
import { type RcCustomer, type RevenueCat, RevenueCatError } from "../referral/revenuecat.ts";
import { type ClaimedGrant, type Db, type FinishOutcome, RPC } from "./db.ts";
import type { RcCurrency } from "./currency.ts";

export interface GrantResult {
  grant_id: string;
  /** What was sent to finish_grant, `skipped` when the time budget ran out before it started, or `lost_lease`. */
  outcome: FinishOutcome | "lost_lease" | "skipped";
  /** The state finish_grant answered (e.g. `failed` when a retry reached max_attempts). */
  state: string | null;
  error: string | null;
}

export interface GrantOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Wait before re-reading the customer after a grant timed out (ADR 0001 6.4: 30 s). */
  verifyDelayMs?: number;
}

type Opts = Required<GrantOptions>;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function errorText(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 300);
}

/** GET the customer; on 404 create it (a user who never opened a paywall still gets their days). */
async function getOrCreate(rc: RevenueCat, userId: string): Promise<RcCustomer> {
  try {
    return await rc.getCustomer(userId);
  } catch (e) {
    if (!(e instanceof RevenueCatError) || e.kind !== "not_found") throw e;
  }
  try {
    const created = await rc.createCustomer(userId);
    return created.active_entitlements ? created : { ...created, active_entitlements: { items: [] } };
  } catch (e) {
    // Another run created it first: read it.
    if (e instanceof RevenueCatError && e.kind === "client" && e.status === 409) return await rc.getCustomer(userId);
    throw e;
  }
}

/** The lookup key from the claim, else params.entitlement_id. */
function lookupKey(c: ClaimedGrant): string | null {
  const k = c.entitlement_id ?? (c.params?.entitlement_id as unknown);
  return typeof k === "string" && k !== "" ? k : null;
}

async function run(db: Db, rc: RevenueCat, c: ClaimedGrant, o: Opts, out: { target: number | null }) {
  if (c.user_deleted || c.user_id === null) return new Finish("cancelled", "account deleted");
  const key = lookupKey(c);
  if (key === null) return new Finish("failed", "no entitlement_id in params");
  if (!Number.isInteger(c.days) || c.days <= 0) return new Finish("failed", "days must be a positive integer");
  const entId = await rc.entitlementIdFor(key);
  if (entId === null) return new Finish("failed", "unknown entitlement lookup key");

  let target = c.target_expires_at_ms;
  if (target === null) {
    // First attempt: decide the target once, store it, then grant.
    const customer = await getOrCreate(rc, c.user_id);
    const active = activeFor(customer, entId);
    if (active.some((e) => e.expires_at === null)) return new Finish("cancelled", "lifetime");
    const latest = Math.max(0, ...active.map((e) => e.expires_at ?? 0));
    const t = computeTarget(latest, o.now(), c.days);
    const ok = await db.rpc<boolean>(RPC.setTarget, {
      grant_id: c.grant_id,
      attempt_token: c.attempt_token,
      target_expires_at_ms: t,
    });
    if (ok !== true) return "lost_lease" as const;
    target = t;
    out.target = t;
  } else {
    // Retry with a stored target: an earlier attempt (e.g. one that timed out) may have landed. Re-granting the same
    // expiry would fall inside RevenueCat's duplicate window and be ignored anyway, so check first and skip.
    out.target = target;
    let customer: RcCustomer | null = null;
    try {
      customer = await rc.getCustomer(c.user_id);
    } catch (e) {
      if (!(e instanceof RevenueCatError) || e.kind !== "not_found") throw e;
    }
    if (customer !== null && reachesTarget(customer, entId, target)) return new Finish("granted");
    if (customer === null) await getOrCreate(rc, c.user_id);
  }
  return await grantAndVerify(rc, c.user_id, entId, target, o);
}

function opts(o: GrantOptions): Opts {
  return { now: o.now ?? Date.now, sleep: o.sleep ?? realSleep, verifyDelayMs: o.verifyDelayMs ?? 30_000 };
}

/** One claimed grant: target, grant, verify, then the compare-and-set finish. */
/** rc_currency: one transaction with the grant id as RevenueCat's Idempotency-Key (a retry is applied once). */
async function runCurrency(cur: RcCurrency | undefined, c: ClaimedGrant): Promise<Finish> {
  if (c.user_deleted || c.user_id === null) return new Finish("cancelled", "account deleted");
  if (!cur) return new Finish("retry", "no RevenueCat currency client configured");
  const code = c.currency_code ?? (c.params?.currency_code as string | undefined) ?? null;
  const amount = Number(c.amount);
  if (!code || !/^[A-Za-z0-9_]{1,40}$/.test(code)) return new Finish("failed", "no currency_code");
  if (!Number.isInteger(amount) || amount <= 0) return new Finish("failed", "amount must be a positive integer");
  const ref = c.grant_key ?? c.grant_id;
  try {
    await cur.add(c.user_id, code, amount, ref, c.grant_id);
  } catch (e) {
    if (!(e instanceof RevenueCatError) || e.kind !== "not_found") throw e;
    await cur.createCustomer(c.user_id);
    await cur.add(c.user_id, code, amount, ref, c.grant_id);
  }
  return new Finish("granted");
}

export async function grantOne(
  db: Db,
  rc: RevenueCat,
  c: ClaimedGrant,
  o: GrantOptions = {},
  cur?: RcCurrency,
): Promise<GrantResult> {
  const out: { target: number | null } = { target: c.target_expires_at_ms };
  let f: Finish | "lost_lease";
  try {
    f = c.kind === "rc_currency" ? await runCurrency(cur, c) : await run(db, rc, c, opts(o), out);
  } catch (e) {
    f = e instanceof RevenueCatError ? fromRcError(e) : new Finish("retry", errorText(e));
  }
  if (f === "lost_lease") return { grant_id: c.grant_id, outcome: "lost_lease", state: null, error: null };
  // Referral's Finish also knows `banked`; this path never produces it.
  const outcome = f.outcome as FinishOutcome;
  const res = await db.rpc<{ state?: string } | null>(RPC.finishGrant, {
    grant_id: c.grant_id,
    attempt_token: c.attempt_token,
    outcome,
    error: f.error,
    target_expires_at_ms: out.target,
  });
  const state = typeof res?.state === "string" ? res.state : null;
  return { grant_id: c.grant_id, outcome: state === "lost_lease" ? "lost_lease" : outcome, state, error: f.error };
}

export interface RunGrantsOptions extends GrantOptions {
  /** Client for `rc_currency` grants; without it they are retried later. */
  currency?: RcCurrency;
  /** Grants claimed per `rewards_svc_claim_grants` call. */
  batch: number;
  /** Stop claiming after this many in one run. */
  max: number;
  /** Absolute time (ms, same clock as `now`) after which no grant is started. */
  deadlineMs: number;
}

export interface RunGrantsSummary {
  claimed: number;
  outcomes: Record<string, number>;
  results: GrantResult[];
}

/**
 * Claim and grant until `max`, the time budget or the queue runs out. A grant claimed but not started before the
 * deadline is left alone (`skipped`): its lease expires and the SQL makes it retryable.
 */
export async function runGrants(db: Db, rc: RevenueCat, o: RunGrantsOptions): Promise<RunGrantsSummary> {
  const now = o.now ?? Date.now;
  const out: RunGrantsSummary = { claimed: 0, outcomes: {}, results: [] };
  const add = (r: GrantResult) => {
    out.results.push(r);
    out.outcomes[r.outcome] = (out.outcomes[r.outcome] ?? 0) + 1;
  };
  while (out.claimed < o.max && now() < o.deadlineMs) {
    const batch = Math.max(1, Math.min(o.batch, o.max - out.claimed));
    const claimed = await db.rpc<ClaimedGrant[] | null>(RPC.claimGrants, { batch });
    if (!Array.isArray(claimed) || claimed.length === 0) break;
    out.claimed += claimed.length;
    for (const c of claimed) {
      if (now() >= o.deadlineMs) add({ grant_id: c.grant_id, outcome: "skipped", state: null, error: null });
      else add(await grantOne(db, rc, c, o, o.currency));
    }
    if (claimed.length < batch) break;
  }
  return out;
}
