// Database access for the rewards Edge Function (ADR 0002 sections 7, 10, 11): only the `public.rewards_svc_*`
// wrappers, executable by service_role only, called through PostgREST with the service role key. Same client as
// the referral function (../referral/db.ts), restricted to the rewards names.
//
// SQL contract (PostgREST named arguments; the SQL parameter names must match exactly):
//
//   rewards_svc_claim_grants(batch int) → jsonb array of ClaimedGrant (entitlement_days grants only; sets
//     `granting`, a new attempt_token and the lease). Empty array when nothing is due.
//   rewards_svc_finish_grant(grant_id uuid, attempt_token uuid, outcome text, error text, target_expires_at_ms bigint)
//     → jsonb {"state": "<new state>"} or {"state": "lost_lease"} when the token no longer matches.
//     outcome ∈ 'granted' | 'retry' | 'failed' | 'cancelled'.
//   rewards_svc_set_target(grant_id uuid, attempt_token uuid, target_expires_at_ms bigint) → boolean
//     (false = lost lease). Stored before RevenueCat is called, so a retry after a timeout reuses the same target.
//   rewards_svc_retry_local() → int (local grants retried)
//   rewards_svc_expire_social() → int (pending social posts expired)
//   rewards_svc_rc_event(user_id uuid, event_type text, event_id text, props jsonb) → {tracked, reason?}
//   rewards_svc_ad_reward(user_id uuid, ad_transaction_id text, currency text, amount numeric, event_id text)
//   rewards_svc_verify_social(platform text, username text, caption text, media_id text)
//     → jsonb {"matched": bool, "post_id": uuid | null, "grants": int}

import { type Db, postgrestDb, type PostgrestOptions } from "../referral/db.ts";

export type { Db };
export { DbError } from "../referral/db.ts";

export const RPC = {
  claimGrants: "rewards_svc_claim_grants",
  finishGrant: "rewards_svc_finish_grant",
  setTarget: "rewards_svc_set_target",
  retryLocal: "rewards_svc_retry_local",
  expireSocial: "rewards_svc_expire_social",
  verifySocial: "rewards_svc_verify_social",
  rcEvent: "rewards_svc_rc_event",
  adReward: "rewards_svc_ad_reward",
} as const;

/** One element of `rewards_svc_claim_grants`. */
export interface ClaimedGrant {
  grant_id: string;
  attempt_token: string;
  /** `entitlement_days` (default when absent) or `rc_currency`. */
  kind?: string;
  /** The grant's unique key: the reference RevenueCat stores with a currency transaction. */
  grant_key?: string;
  /** rc_currency: the currency code and the whole amount. */
  currency_code?: string | null;
  amount?: number;
  /** Null only after deletion (then user_deleted is true). */
  user_id: string | null;
  user_deleted: boolean;
  /** Lookup key (`premium`), from params.entitlement_id. */
  entitlement_id: string | null;
  days: number;
  params: Record<string, unknown> | null;
  /** Stored by set_target on an earlier attempt; null on the first. */
  target_expires_at_ms: number | null;
  attempts: number;
}

export type FinishOutcome = "granted" | "retry" | "failed" | "cancelled";

export interface VerifySocialResult {
  matched: boolean;
  post_id: string | null;
  grants: number;
}

/** PostgREST client that refuses anything but `rewards_svc_*`. */
export function rewardsDb(opts: Omit<PostgrestOptions, "allow">): Db {
  return postgrestDb({ ...opts, allow: /^rewards_svc_[a-z_]+$/ });
}
