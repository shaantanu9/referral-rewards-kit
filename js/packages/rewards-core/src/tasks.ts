/** Offer and social-tag task states (ADR 0002 §6.3, §6.4, §11). */
import { listOf, optInt, optStr, str, time, type JsonMap } from './json';
import { enumFromWire, RewardSpec } from './models';

/** Offer states. `unknown` covers a state a newer server adds. */
export const OfferStatus = {
  notStarted: 'not_started',
  active: 'active',
  claimed: 'claimed',
  expired: 'expired',
  soldOut: 'sold_out',
  unknown: 'unknown',
} as const;
export type OfferStatus = (typeof OfferStatus)[keyof typeof OfferStatus];
export const offerStatusFromWire = (v: unknown): OfferStatus => enumFromWire(OfferStatus, v, OfferStatus.unknown);

/** A timed offer for this user. [endsAt] is a server deadline that never resets. */
export class OfferState {
  readonly program: string;
  readonly status: OfferStatus;
  readonly startedAt: Date | null;
  readonly endsAt: Date | null;
  /** The real number left, only when the app chose to show stock; null otherwise. */
  readonly stockLeft: number | null;
  readonly rewards: readonly RewardSpec[];

  constructor(init: { program: string; status?: OfferStatus; startedAt?: Date | null; endsAt?: Date | null; stockLeft?: number | null; rewards?: readonly RewardSpec[] }) {
    this.program = init.program;
    this.status = init.status ?? OfferStatus.unknown;
    this.startedAt = init.startedAt ?? null;
    this.endsAt = init.endsAt ?? null;
    this.stockLeft = init.stockLeft ?? null;
    this.rewards = init.rewards ?? [];
  }

  static fromJson(m: JsonMap): OfferState {
    return new OfferState({
      program: str(m['program']),
      status: offerStatusFromWire(m['state']),
      startedAt: time(m['started_at']),
      endsAt: time(m['ends_at']),
      stockLeft: optInt(m['stock_left']),
      rewards: listOf(m['rewards'], (r) => RewardSpec.fromJson(r)),
    });
  }

  copyWith(patch: { status?: OfferStatus; stockLeft?: number }): OfferState {
    return new OfferState({ ...this, status: patch.status ?? this.status, stockLeft: patch.stockLeft ?? this.stockLeft });
  }
}

/** Social tag task states. `unknown` covers a state a newer server adds. */
export const SocialTaskStatus = {
  none: 'none',
  pending: 'pending',
  verified: 'verified',
  rejected: 'rejected',
  expired: 'expired',
  cooldown: 'cooldown',
  unknown: 'unknown',
} as const;
export type SocialTaskStatus = (typeof SocialTaskStatus)[keyof typeof SocialTaskStatus];
export const socialTaskStatusFromWire = (v: unknown): SocialTaskStatus => enumFromWire(SocialTaskStatus, v, SocialTaskStatus.unknown);

/**
 * The "tag us on Instagram" task. [expiresAt] is when a pending code stops counting, or for `cooldown` when a new one
 * is allowed. Never carries the user's handle.
 */
export class SocialTaskState {
  readonly program: string;
  readonly platform: string;
  /** The app's account to tag, without `@`. */
  readonly account: string;
  readonly status: SocialTaskStatus;
  readonly code: string | null;
  readonly expiresAt: Date | null;
  readonly rewards: readonly RewardSpec[];
  /** The link the user sent for their post (`rewards_social_submit_link`), or null. */
  readonly postUrl: string | null;

  constructor(init: {
    program: string;
    platform?: string;
    account?: string;
    status?: SocialTaskStatus;
    code?: string | null;
    expiresAt?: Date | null;
    rewards?: readonly RewardSpec[];
    postUrl?: string | null;
  }) {
    this.program = init.program;
    this.platform = init.platform ?? 'instagram';
    this.account = init.account ?? '';
    this.status = init.status ?? SocialTaskStatus.none;
    this.code = init.code ?? null;
    this.expiresAt = init.expiresAt ?? null;
    this.rewards = init.rewards ?? [];
    this.postUrl = init.postUrl ?? null;
  }

  static fromJson(m: JsonMap): SocialTaskState {
    return new SocialTaskState({
      program: str(m['program']),
      platform: m['platform'] == null ? 'instagram' : str(m['platform']),
      account: str(m['account']),
      status: socialTaskStatusFromWire(m['state'] ?? 'none'),
      code: optStr(m['code']),
      expiresAt: time(m['expires_at']),
      rewards: listOf(m['rewards'], (r) => RewardSpec.fromJson(r)),
      postUrl: optStr(m['post_url']),
    });
  }

  /** Dart `copyWith`: a null / missing value keeps the current one. */
  copyWith(patch: { status?: SocialTaskStatus | null; code?: string | null; expiresAt?: Date | null; account?: string | null; postUrl?: string | null }): SocialTaskState {
    return new SocialTaskState({
      ...this,
      account: patch.account ?? this.account,
      status: patch.status ?? this.status,
      code: patch.code ?? this.code,
      expiresAt: patch.expiresAt ?? this.expiresAt,
      postUrl: patch.postUrl ?? this.postUrl,
    });
  }
}

/** What `rewards_social_start` returns: `{"code": "MYAPP-K7Q2", "account": "myapp", "expires_at": ts}`. */
export class SocialStartResult {
  readonly code: string;
  readonly account: string;
  readonly expiresAt: Date | null;
  constructor(init: { code: string; account?: string; expiresAt?: Date | null }) {
    this.code = init.code;
    this.account = init.account ?? '';
    this.expiresAt = init.expiresAt ?? null;
  }
  static fromJson(m: JsonMap): SocialStartResult {
    return new SocialStartResult({ code: str(m['code']), account: str(m['account']), expiresAt: time(m['expires_at']) });
  }
}
