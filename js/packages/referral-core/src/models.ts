/**
 * Typed results of the `public.referral_*` RPCs. Field names follow the JSON built in
 * `supabase/migrations/20261112000002_referral_codes_claim.sql`, `…000003_referral_joined.sql` and the growth RPCs
 * of migration 23. Every class is immutable; `fromJson` is tolerant of missing optional fields.
 */
import { asList, asMap, isMap, num, optInt, parseDateTime, str, type JsonMap } from './json';

export { ReferralFormatException } from './json';

const time = (v: unknown): Date | null => parseDateTime(v);
const params = (v: unknown, what: string): JsonMap => (v == null ? {} : asMap(v, what));

/** Claim reasons (ADR 7), as the server sends them. `unknown` covers any reason a newer server adds. */
export const ClaimReason = {
  ok: 'ok',
  ownCode: 'own_code',
  alreadyReferred: 'already_referred',
  unknownCode: 'unknown_code',
  windowClosed: 'window_closed',
  rateLimited: 'rate_limited',
  notVerified: 'not_verified',
  anonymousUser: 'anonymous_user',
  sameInstall: 'same_install',
  programPaused: 'program_paused',
  underAge: 'under_age',
  unknown: 'unknown',
} as const;
export type ClaimReason = (typeof ClaimReason)[keyof typeof ClaimReason];

const claimReasons = new Set<string>(Object.values(ClaimReason).filter((r) => r !== 'unknown'));
export const claimReasonFromWire = (v: unknown): ClaimReason =>
  typeof v === 'string' && claimReasons.has(v) ? (v as ClaimReason) : ClaimReason.unknown;

/** `referral_claim` → `{reason, retry_after_seconds?, days_left?}`. */
export class ClaimResult {
  readonly reason: ClaimReason;
  /** The reason string as sent, kept for logging when [reason] is `unknown`. */
  readonly rawReason: string | null;
  /** Only with `rate_limited`. */
  readonly retryAfterSeconds: number | null;
  /** Only with `ok`: days left to start using the app for the joined rewards. */
  readonly daysLeft: number | null;

  constructor(init: { reason: ClaimReason; rawReason?: string | null; retryAfterSeconds?: number | null; daysLeft?: number | null }) {
    this.reason = init.reason;
    this.rawReason = init.rawReason ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.daysLeft = init.daysLeft ?? null;
  }

  static fromJson(json: unknown): ClaimResult {
    const m = asMap(json, 'referral_claim');
    return new ClaimResult({
      reason: claimReasonFromWire(m['reason']),
      rawReason: m['reason'] == null ? null : String(m['reason']),
      retryAfterSeconds: optInt(m['retry_after_seconds']),
      daysLeft: optInt(m['days_left']),
    });
  }

  get isOk(): boolean {
    return this.reason === ClaimReason.ok;
  }
}

/**
 * `referral_my_code` / `referral_rotate_code` → `{code, reason, next_allowed_at?}`, or `{left: true}` (migration 23)
 * when the user left the invite program. Reasons: `ok`, `program_paused`, `anonymous_user`, `under_age`,
 * `account_deleted`, `code_disabled`, `left`, and for rotation `too_soon`.
 */
export class MyCodeResult {
  readonly code: string | null;
  readonly reason: string;
  readonly nextAllowedAt: Date | null;
  /** True when the user left the invite program: no code to share until they join again (same code). */
  readonly left: boolean;

  constructor(init: { code: string | null; reason: string; nextAllowedAt?: Date | null; left?: boolean }) {
    this.code = init.code;
    this.reason = init.reason;
    this.nextAllowedAt = init.nextAllowedAt ?? null;
    this.left = init.left ?? false;
  }

  static fromJson(json: unknown, what = 'referral_my_code'): MyCodeResult {
    const m = asMap(json, what);
    const code = m['code'];
    const left = m['left'] === true || m['reason'] === 'left';
    return new MyCodeResult({
      code: !left && typeof code === 'string' && code !== '' ? code : null,
      reason: str(m['reason']),
      nextAllowedAt: time(m['next_allowed_at']),
      left,
    });
  }

  get hasCode(): boolean {
    return this.code !== null;
  }
}

/** One active rule from `referral_terms().rules`. */
export class ReferralRule {
  /** `joined` or `paid`. */
  readonly event: string;
  /** `sharer` or `friend`. */
  readonly who: string;
  /** `entitlement_days` or an app kind such as `minutes`. */
  readonly kind: string;
  readonly amount: number;
  readonly params: JsonMap;

  constructor(init: { event: string; who: string; kind: string; amount: number; params?: JsonMap }) {
    this.event = init.event;
    this.who = init.who;
    this.kind = init.kind;
    this.amount = init.amount;
    this.params = init.params ?? {};
  }

  static fromJson(json: unknown): ReferralRule {
    const m = asMap(json, 'rule');
    return new ReferralRule({
      event: str(m['event']),
      who: str(m['who']),
      kind: str(m['kind']),
      amount: num(m['amount']),
      params: params(m['params'], 'rule.params'),
    });
  }
}

/**
 * `referral_terms().boost`: a reward boost with a real, server-stored end that can never be extended once started
 * (ADR growth G8). Rewards for friends who claim inside `[startsAt, endsAt)` are multiplied.
 */
export class ReferralBoost {
  readonly startsAt: Date | null;
  /** Exclusive: the boost covers claims made before this instant. */
  readonly endsAt: Date;
  /** Above 1 and at most 5 on the server, e.g. 2. */
  readonly multiplier: number;
  /** `joined` and/or `paid`. */
  readonly events: readonly string[];
  /** `sharer` and/or `friend`. */
  readonly who: readonly string[];

  constructor(init: { endsAt: Date; multiplier: number; startsAt?: Date | null; events?: readonly string[]; who?: readonly string[] }) {
    this.endsAt = init.endsAt;
    this.multiplier = init.multiplier;
    this.startsAt = init.startsAt ?? null;
    this.events = init.events ?? ['joined'];
    this.who = init.who ?? ['sharer', 'friend'];
  }

  /** Null for anything that is not a boost object with an end and a multiplier above 1. */
  static tryParse(json: unknown): ReferralBoost | null {
    if (!isMap(json)) return null;
    const end = time(json['ends_at']);
    const mult = num(json['multiplier']);
    if (end == null || mult <= 1) return null;
    const strings = (v: unknown, fallback: readonly string[]): readonly string[] =>
      Array.isArray(v) ? v.map((e) => String(e)) : fallback;
    return new ReferralBoost({
      startsAt: time(json['starts_at']),
      endsAt: end,
      multiplier: mult,
      events: strings(json['events'], ['joined']),
      who: strings(json['who'], ['sharer', 'friend']),
    });
  }

  get forSharer(): boolean {
    return this.who.includes('sharer');
  }
  get forFriend(): boolean {
    return this.who.includes('friend');
  }

  /** True from [startsAt] (when given) until just before [endsAt]. */
  isRunningAt(now: Date): boolean {
    return now.getTime() < this.endsAt.getTime() && (this.startsAt == null || now.getTime() >= this.startsAt.getTime());
  }
}

/** `referral_terms` → rules, caps and windows (ADR 11.1). */
export class ReferralTerms {
  readonly enabled: boolean;
  readonly paidEnabled: boolean;
  readonly ruleSetVersion: number | null;
  readonly rules: readonly ReferralRule[];
  readonly claimWindowDays: number;
  readonly activateWindowDays: number;
  readonly paidWindowDays: number;
  readonly holdHours: number;
  readonly sharerJoinsPer30d: number;
  readonly sharerPaidPer365d: number;
  /**
   * Days the caller still has to add a code, from the server (`claim_days_left`); null when they cannot add one
   * (not verified yet, or already referred) or when an older server does not send it.
   */
  readonly claimDaysLeft: number | null;
  /** True when the server sent `claim_days_left` at all, so a null [claimDaysLeft] means "cannot add a code". */
  readonly hasClaimDaysLeft: boolean;
  /** The boost running now (migration 23), or null. */
  readonly boost: ReferralBoost | null;

  constructor(init: {
    enabled: boolean;
    paidEnabled: boolean;
    rules: readonly ReferralRule[];
    claimWindowDays: number;
    activateWindowDays: number;
    paidWindowDays: number;
    holdHours: number;
    sharerJoinsPer30d: number;
    sharerPaidPer365d: number;
    ruleSetVersion?: number | null;
    claimDaysLeft?: number | null;
    hasClaimDaysLeft?: boolean;
    boost?: ReferralBoost | null;
  }) {
    this.enabled = init.enabled;
    this.paidEnabled = init.paidEnabled;
    this.rules = init.rules;
    this.claimWindowDays = init.claimWindowDays;
    this.activateWindowDays = init.activateWindowDays;
    this.paidWindowDays = init.paidWindowDays;
    this.holdHours = init.holdHours;
    this.sharerJoinsPer30d = init.sharerJoinsPer30d;
    this.sharerPaidPer365d = init.sharerPaidPer365d;
    this.ruleSetVersion = init.ruleSetVersion ?? null;
    this.claimDaysLeft = init.claimDaysLeft ?? null;
    this.hasClaimDaysLeft = init.hasClaimDaysLeft ?? false;
    this.boost = init.boost ?? null;
  }

  static fromJson(json: unknown): ReferralTerms {
    const m = asMap(json, 'referral_terms');
    return new ReferralTerms({
      enabled: m['enabled'] === true,
      paidEnabled: m['paid_enabled'] === true,
      ruleSetVersion: optInt(m['rule_set_version']),
      rules: asList(m['rules'], 'referral_terms.rules').map((r) => ReferralRule.fromJson(r)),
      claimWindowDays: optInt(m['claim_window_days']) ?? 7,
      activateWindowDays: optInt(m['activate_window_days']) ?? 30,
      paidWindowDays: optInt(m['paid_window_days']) ?? 90,
      holdHours: optInt(m['hold_hours']) ?? 72,
      sharerJoinsPer30d: optInt(m['sharer_joins_per_30d']) ?? 0,
      sharerPaidPer365d: optInt(m['sharer_paid_per_365d']) ?? 0,
      claimDaysLeft: optInt(m['claim_days_left']),
      hasClaimDaysLeft: Object.prototype.hasOwnProperty.call(m, 'claim_days_left'),
      boost: ReferralBoost.tryParse(m['boost']),
    });
  }

  /** No rules: used when terms could not be loaded (e.g. offline), so no sentence promises a reward. */
  static readonly none = new ReferralTerms({
    enabled: true,
    paidEnabled: false,
    rules: [],
    claimWindowDays: 7,
    activateWindowDays: 30,
    paidWindowDays: 90,
    holdHours: 72,
    sharerJoinsPer30d: 0,
    sharerPaidPer365d: 0,
  });

  /** [boost] when it is still running at [now], else null. */
  boostAt(now: Date): ReferralBoost | null {
    const b = this.boost;
    return b != null && b.isRunningAt(now) ? b : null;
  }

  /** The rule for [event] and [who], or null. Paid rules count only while `paid_enabled` is on. */
  rule(event: string, who: string): ReferralRule | null {
    if (event === 'paid' && !this.paidEnabled) return null;
    return this.rules.find((r) => r.event === event && r.who === who) ?? null;
  }
}

/** `referral_check_activation` → `{state}`: `no_referral`, `claimed`, `joined`, `expired`, or a later state. */
export class ActivationResult {
  constructor(readonly state: string) {}
  static fromJson(json: unknown): ActivationResult {
    return new ActivationResult(str(asMap(json, 'referral_check_activation')['state']));
  }
  get joined(): boolean {
    return this.state === 'joined' || this.state === 'paid';
  }
}

/** One reward as `referral_stats` and `referral_pending` list it. */
export class RewardItem {
  readonly id: string;
  readonly who: string | null;
  readonly event: string | null;
  readonly kind: string;
  readonly amount: number;
  /** `granted` or `banked` in `referral_pending`. */
  readonly state: string | null;
  /** When it was granted (`rewards_granted[].at`). */
  readonly at: Date | null;
  /** Approximate date a pending reward lands (`pending[].available_at`). */
  readonly availableAt: Date | null;
  readonly params: JsonMap;

  constructor(init: {
    id: string;
    kind: string;
    amount: number;
    who?: string | null;
    event?: string | null;
    state?: string | null;
    at?: Date | null;
    availableAt?: Date | null;
    params?: JsonMap;
  }) {
    this.id = init.id;
    this.kind = init.kind;
    this.amount = init.amount;
    this.who = init.who ?? null;
    this.event = init.event ?? null;
    this.state = init.state ?? null;
    this.at = init.at ?? null;
    this.availableAt = init.availableAt ?? null;
    this.params = init.params ?? {};
  }

  static fromJson(json: unknown): RewardItem {
    const m = asMap(json, 'reward');
    return new RewardItem({
      id: str(m['id']),
      who: m['who'] == null ? null : String(m['who']),
      event: m['event'] == null ? null : String(m['event']),
      kind: str(m['kind']),
      amount: num(m['amount']),
      state: m['state'] == null ? null : String(m['state']),
      at: time(m['at']),
      availableAt: time(m['available_at']),
      params: params(m['params'], 'reward.params'),
    });
  }
}

/**
 * `referral_stats`. [claimedCount] and [joinedCount] come from server migration 18 and are null from an older server.
 * [paidCount] is null below the server's `stats_floor`.
 */
export class ReferralStats {
  readonly rewardsGranted: readonly RewardItem[];
  readonly pending: readonly RewardItem[];
  readonly banked: readonly RewardItem[];
  readonly skippedCap: number;
  /** Friends who used the code and have not started using the app yet. */
  readonly claimedCount: number | null;
  /** Friends who started using the app with the code. */
  readonly joinedCount: number | null;
  /** Joined friends who bought; null below `stats_floor`. */
  readonly paidCount: number | null;

  constructor(init: {
    rewardsGranted: readonly RewardItem[];
    pending: readonly RewardItem[];
    banked: readonly RewardItem[];
    skippedCap: number;
    claimedCount?: number | null;
    joinedCount?: number | null;
    paidCount?: number | null;
  }) {
    this.rewardsGranted = init.rewardsGranted;
    this.pending = init.pending;
    this.banked = init.banked;
    this.skippedCap = init.skippedCap;
    this.claimedCount = init.claimedCount ?? null;
    this.joinedCount = init.joinedCount ?? null;
    this.paidCount = init.paidCount ?? null;
  }

  static fromJson(json: unknown): ReferralStats {
    const m = asMap(json, 'referral_stats');
    const list = (k: string): RewardItem[] => asList(m[k], `referral_stats.${k}`).map((r) => RewardItem.fromJson(r));
    return new ReferralStats({
      rewardsGranted: list('rewards_granted'),
      pending: list('pending'),
      banked: list('banked'),
      skippedCap: optInt(m['skipped_cap']) ?? 0,
      claimedCount: optInt(m['claimed_count']),
      joinedCount: optInt(m['joined_count']),
      paidCount: optInt(m['paid_count']),
    });
  }

  static readonly empty = new ReferralStats({ rewardsGranted: [], pending: [], banked: [], skippedCap: 0 });

  /** True when there is nothing to show yet: no friend used the code and no reward exists. */
  get isEmpty(): boolean {
    return (
      this.rewardsGranted.length === 0 &&
      this.pending.length === 0 &&
      this.banked.length === 0 &&
      this.skippedCap === 0 &&
      (this.claimedCount ?? 0) === 0 &&
      (this.joinedCount ?? 0) === 0
    );
  }
}

/**
 * `referral_preferences` / `referral_preferences_set` → `{show_name, display_name, participating}`, or `{reason}` when
 * a change was refused (`under_age`, `anonymous_user`, `invalid_name`).
 */
export class ReferralPreferences {
  /** The sharer's first name is shown on their invite page (opt-in, default off). */
  readonly showName: boolean;
  readonly displayName: string | null;
  /** False after "Leave the invite program". */
  readonly participating: boolean;
  /** Why a change was refused, or null when it was saved. */
  readonly reason: string | null;

  constructor(init: { showName?: boolean; displayName?: string | null; participating?: boolean; reason?: string | null } = {}) {
    this.showName = init.showName ?? false;
    this.displayName = init.displayName ?? null;
    this.participating = init.participating ?? true;
    this.reason = init.reason ?? null;
  }

  static fromJson(json: unknown, what = 'referral_preferences'): ReferralPreferences {
    const m = asMap(json, what);
    const name = m['display_name'];
    const reason = m['reason'];
    return new ReferralPreferences({
      showName: m['show_name'] === true,
      displayName: typeof name === 'string' && name.trim() !== '' ? name : null,
      participating: m['participating'] !== false,
      reason: typeof reason === 'string' && reason !== '' ? reason : null,
    });
  }

  get isOk(): boolean {
    return this.reason === null;
  }
}

/**
 * A display name the server accepts (migration 23): 1–40 characters after trimming, at least one letter, no `@` and
 * no `://`. Null when [name] is fine, else `empty`, `too_long`, `no_letter` or `email_or_link`.
 */
export function displayNameProblem(name: string): 'empty' | 'too_long' | 'no_letter' | 'email_or_link' | null {
  const t = name.trim();
  if (t === '') return 'empty';
  if ([...t].length > 40) return 'too_long';
  if (t.includes('@') || t.includes('://')) return 'email_or_link';
  if (!/\p{L}/u.test(t)) return 'no_letter';
  return null;
}

/** The friend's own claim state in `referral_my_claim`. */
export const MyClaimState = {
  /** No code added. */
  none: 'none',
  /** A code was added; the friend has not started using the app yet. */
  claimed: 'claimed',
  /** The friend started using the app (also `paid`, `void` and any later state the server adds). */
  joined: 'joined',
  /** The activation window ended before the friend started. */
  expired: 'expired',
} as const;
export type MyClaimState = (typeof MyClaimState)[keyof typeof MyClaimState];

export function myClaimStateFromWire(v: unknown): MyClaimState {
  if (v == null || v === '' || v === 'none' || v === 'no_referral') return MyClaimState.none;
  if (v === 'claimed') return MyClaimState.claimed;
  if (v === 'expired') return MyClaimState.expired;
  return MyClaimState.joined;
}

/** One reward in `referral_my_claim.rewards`: what the friend gets on starting, with any boost already applied. */
export class MyClaimReward {
  readonly kind: string;
  /** What the friend gets (after the boost). */
  readonly amount: number;
  /** Before the boost; equals [amount] when not boosted. */
  readonly baseAmount: number;
  readonly params: JsonMap;
  readonly boosted: boolean;

  constructor(init: { kind: string; amount: number; baseAmount?: number | null; params?: JsonMap; boosted?: boolean }) {
    this.kind = init.kind;
    this.amount = init.amount;
    this.baseAmount = init.baseAmount ?? init.amount;
    this.params = init.params ?? {};
    this.boosted = init.boosted ?? false;
  }

  static fromJson(json: unknown): MyClaimReward {
    const m = asMap(json, 'referral_my_claim.rewards[]');
    const amount = num(m['amount']);
    return new MyClaimReward({
      kind: str(m['kind']),
      amount,
      baseAmount: m['base_amount'] == null ? amount : num(m['base_amount']),
      params: isMap(m['params']) ? m['params'] : {},
      boosted: m['boosted'] === true,
    });
  }
}

/** `referral_my_claim`: the caller's own claim as a friend (migration 23). */
export class MyClaim {
  readonly state: MyClaimState;
  readonly claimedAt: Date | null;
  readonly activateBy: Date | null;
  /** Days left to start using the app (claimed only). */
  readonly daysLeft: number | null;
  readonly joinedAt: Date | null;
  readonly rewards: readonly MyClaimReward[];

  constructor(init: {
    state: MyClaimState;
    claimedAt?: Date | null;
    activateBy?: Date | null;
    daysLeft?: number | null;
    joinedAt?: Date | null;
    rewards?: readonly MyClaimReward[];
  }) {
    this.state = init.state;
    this.claimedAt = init.claimedAt ?? null;
    this.activateBy = init.activateBy ?? null;
    this.daysLeft = init.daysLeft ?? null;
    this.joinedAt = init.joinedAt ?? null;
    this.rewards = init.rewards ?? [];
  }

  static fromJson(json: unknown): MyClaim {
    const m = asMap(json, 'referral_my_claim');
    return new MyClaim({
      state: myClaimStateFromWire(m['state']),
      claimedAt: time(m['claimed_at']),
      activateBy: time(m['activate_by']),
      daysLeft: optInt(m['days_left']),
      joinedAt: time(m['joined_at']),
      rewards: asList(m['rewards'], 'referral_my_claim.rewards').map((r) => MyClaimReward.fromJson(r)),
    });
  }

  static readonly none = new MyClaim({ state: MyClaimState.none });
}
