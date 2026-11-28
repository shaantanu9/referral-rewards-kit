/**
 * Why referrals cannot work right now, as distinct from "offline" (ADR 11.6 retries) or a refused claim. The values
 * are the wire strings used in analytics events.
 */
export const ReferralUnavailableReason = {
  /** The server has no referral functions: PostgREST answers 404 / `PGRST202` for `rpc/referral_*`. */
  notDeployed: 'not_deployed',
  /** No signed-in user, so no token to call with. */
  signedOut: 'signed_out',
  /** The app has no backend configured in this build (no URL or key). */
  noProject: 'no_project',
} as const;
export type ReferralUnavailableReason = (typeof ReferralUnavailableReason)[keyof typeof ReferralUnavailableReason];

/**
 * Thrown by a `ReferralRpc` (or raised by `ReferralClient` from a recognised "function not found" error) when
 * referrals are unavailable rather than failing. Claims made while unavailable are kept by `PendingClaimQueue`.
 */
export class ReferralUnavailableException extends Error {
  override readonly name = 'ReferralUnavailableException';
  constructor(readonly reason: ReferralUnavailableReason) {
    super(`ReferralUnavailableException: ${reason}`);
  }
  override toString(): string {
    return this.message;
  }
}

/**
 * The server answered with an error status other than 404 (5xx, 401, 403, a body that is not JSON). Never carries the
 * response body. Treated like offline (the claim is kept), but reported as `server_error` in events.
 */
export class ReferralServerError extends Error {
  override readonly name = 'ReferralServerError';
  constructor(
    readonly fn: string,
    readonly status: number | null = null,
  ) {
    super(`ReferralServerError: ${fn} ${status ?? ''}`.trimEnd());
  }
  override toString(): string {
    return this.message;
  }
}

/** No answer at all: no network, DNS failure, timeout. */
export class ReferralNetworkError extends Error {
  override readonly name = 'ReferralNetworkError';
  constructor(readonly fn: string) {
    super(`ReferralNetworkError: ${fn}`);
  }
  override toString(): string {
    return this.message;
  }
}

/** What `ReferralClient.availability()` found. */
export const ReferralAvailability = {
  available: 'available',
  notDeployed: 'not_deployed',
  signedOut: 'signed_out',
  noProject: 'no_project',
  /** No answer (network, timeout); try again later. */
  offline: 'offline',
  /** The server answered with an error; try again later. */
  serverError: 'server_error',
} as const;
export type ReferralAvailability = (typeof ReferralAvailability)[keyof typeof ReferralAvailability];

export const isAvailable = (a: ReferralAvailability): boolean => a === ReferralAvailability.available;

/** True when retrying soon may help (offline or a server error), false when the app should hide or explain. */
export const isTransientAvailability = (a: ReferralAvailability): boolean =>
  a === ReferralAvailability.offline || a === ReferralAvailability.serverError;

export function availabilityFromReason(r: ReferralUnavailableReason): ReferralAvailability {
  switch (r) {
    case 'not_deployed':
      return ReferralAvailability.notDeployed;
    case 'signed_out':
      return ReferralAvailability.signedOut;
    case 'no_project':
      return ReferralAvailability.noProject;
  }
}

/**
 * Whether [error] from an rpc call means "the referral functions do not exist on this server": a
 * [ReferralUnavailableException] `not_deployed`, or supabase-js's PostgREST error for a missing function (code
 * `PGRST202`), matched by its code or text so the package needs no Supabase dependency.
 */
export function isNotDeployedError(error: unknown): boolean {
  if (error instanceof ReferralUnavailableException) return error.reason === ReferralUnavailableReason.notDeployed;
  if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'PGRST202') return true;
  return errorText(error).includes('PGRST202');
}

/** `toString()` of anything, plus `message` / `code` / `details` of a plain error object (supabase-js errors). */
export function errorText(error: unknown): string {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return `${error.toString()} ${(error as { code?: unknown }).code ?? ''}`;
  if (typeof error === 'object') {
    const o = error as Record<string, unknown>;
    const parts = [o['message'], o['code'], o['details'], o['hint']].filter((x) => typeof x === 'string');
    if (parts.length) return parts.join(' ');
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}
