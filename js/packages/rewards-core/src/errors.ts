/** Errors raised by the rewards client (ADR 0002 §11). */

/** Every `rewards: <reason>` the server raises. A newer reason still arrives as a [RewardsException]. */
export const RewardsReason = {
  notSignedIn: 'not_signed_in',
  disabled: 'disabled',
  unknownProgram: 'unknown_program',
  unknownEvent: 'unknown_event',
  serverOnlyEvent: 'server_only_event',
  dailyLimit: 'daily_limit',
  badHandle: 'bad_handle',
  handleTaken: 'handle_taken',
  offerNotStarted: 'offer_not_started',
  offerExpired: 'offer_expired',
  offerClaimed: 'offer_claimed',
  soldOut: 'sold_out',
  alreadyPosted: 'already_posted',
  tooSoon: 'too_soon',
  empty: 'empty',
  badCode: 'bad_code',
  ownCode: 'own_code',
  tooManyFriends: 'too_many_friends',
  alreadyFriends: 'already_friends',
  badLink: 'bad_link',
  noPendingPost: 'no_pending_post',
  noAttemptsLeft: 'no_attempts_left',
  notEnoughQuestions: 'not_enough_questions',
  noAttempt: 'no_attempt',
} as const;

/** All reasons this version knows. */
export const allRewardsReasons: ReadonlySet<string> = new Set(Object.values(RewardsReason));

/** The server refused a call with `raise exception 'rewards: <reason>'`. [reason] is the bare reason. */
export class RewardsException extends Error {
  override readonly name = 'RewardsException';
  constructor(readonly reason: string) {
    super(`RewardsException: ${reason}`);
  }
  /** True when [reason] is one of [allRewardsReasons]. */
  get isKnown(): boolean {
    return allRewardsReasons.has(this.reason);
  }
  override toString(): string {
    return this.message;
  }
}

/** Why rewards cannot work right now; the values are the wire strings used in events. */
export const RewardsUnavailableReason = {
  /** PostgREST answers 404 / `PGRST202`: the `rewards_*` functions are not deployed. */
  notDeployed: 'not_deployed',
  /** No signed-in user (no token, or the server said `rewards: not_signed_in`). */
  signedOut: 'signed_out',
  /** No backend configured in this build (no URL or key). */
  noProject: 'no_project',
} as const;
export type RewardsUnavailableReason = (typeof RewardsUnavailableReason)[keyof typeof RewardsUnavailableReason];

/** Thrown when rewards are unavailable rather than failing. Widgets hide themselves. */
export class RewardsUnavailableException extends Error {
  override readonly name = 'RewardsUnavailableException';
  constructor(readonly reason: RewardsUnavailableReason) {
    super(`RewardsUnavailableException: ${reason}`);
  }
  override toString(): string {
    return this.message;
  }
}

/** The server answered with an error status that carried no `rewards:` reason. Never carries the response body. */
export class RewardsServerError extends Error {
  override readonly name = 'RewardsServerError';
  constructor(
    readonly fn: string,
    readonly status: number | null = null,
  ) {
    super(`RewardsServerError: ${fn} ${status ?? ''}`.trimEnd());
  }
  override toString(): string {
    return this.message;
  }
}

/** No answer at all: no network, DNS failure, timeout. */
export class RewardsNetworkError extends Error {
  override readonly name = 'RewardsNetworkError';
  constructor(readonly fn: string) {
    super(`RewardsNetworkError: ${fn}`);
  }
  override toString(): string {
    return this.message;
  }
}

/** An RPC returned something that does not have the documented shape. */
export class RewardsFormatException extends Error {
  override readonly name = 'RewardsFormatException';
  constructor(message: string) {
    super(`RewardsFormatException: ${message}`);
  }
  override toString(): string {
    return this.message;
  }
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

// Lower-case reasons (`offer_expired`) and upper-case codes alike; the client matches on the word after `rewards: `.
const reasonPattern = /rewards: ([A-Za-z][A-Za-z0-9_]*)/;

/** The `<reason>` of a `rewards: <reason>` error, read from its text; null when there is none. */
export function rewardsReasonOf(error: unknown): string | null {
  if (error instanceof RewardsException) return error.reason;
  return reasonPattern.exec(errorText(error))?.[1] ?? null;
}

/** Whether [error] means "the rewards functions do not exist on this server" (`not_deployed` or `PGRST202`). */
export function isRewardsNotDeployed(error: unknown): boolean {
  if (error instanceof RewardsUnavailableException) return error.reason === RewardsUnavailableReason.notDeployed;
  if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'PGRST202') return true;
  return errorText(error).includes('PGRST202');
}
