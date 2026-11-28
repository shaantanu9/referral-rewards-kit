/**
 * Typed pieces of the `rewards_state` object (ADR 0002 §11). Every `fromJson` tolerates missing optional fields and
 * reads times as UTC instants. Every class is immutable.
 */
import { boolOr, isMap, numOr, optInt, optMap, optRange, optStr, optChance, str, time, type JsonMap } from './json';

/** Program kinds (ADR 0002 §4), as the server sends them. `unknown` covers a kind a newer server adds. */
export const ProgramKind = {
  streak: 'streak',
  milestone: 'milestone',
  socialTag: 'social_tag',
  offer: 'offer',
  quiz: 'quiz',
  questSet: 'quest_set',
  comeback: 'comeback',
  recharge: 'recharge',
  window: 'window',
  friendStreak: 'friend_streak',
  league: 'league',
  unknown: 'unknown',
} as const;
export type ProgramKind = (typeof ProgramKind)[keyof typeof ProgramKind];

/** Reads a wire value into one of [values]; anything else is `unknown`. */
export function enumFromWire<T extends string>(values: Readonly<Record<string, T>>, v: unknown, unknown: T): T {
  for (const x of Object.values(values)) if (x === v && x !== unknown) return x;
  return unknown;
}
export const programKindFromWire = (v: unknown): ProgramKind => enumFromWire(ProgramKind, v, ProgramKind.unknown);

const sameMap = (a: JsonMap, b: JsonMap): boolean => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => k in b && JSON.stringify(b[k]) === JSON.stringify(a[k]));
};

/** One outcome of a `mystery` reward: `{"kind", "amount", "params", "chance"}`, [chance] from 0 to 1. */
export class MysteryOdd {
  readonly kind: string;
  readonly amount: number;
  readonly params: JsonMap;
  readonly chance: number;

  constructor(init: { kind: string; amount?: number; params?: JsonMap; chance?: number }) {
    this.kind = init.kind;
    this.amount = init.amount ?? 0;
    this.params = init.params ?? {};
    this.chance = init.chance ?? 0;
  }

  static fromJson(m: JsonMap): MysteryOdd {
    return new MysteryOdd({ kind: str(m['kind']), amount: numOr(m['amount']), params: optMap(m['params']), chance: numOr(m['chance']) });
  }

  /**
   * Reads `next_reward.odds`. Tolerates a server that sends the rule's `params.table` (`weight` instead of
   * `chance`): weights become chances that sum to 1. A chance above 1 is read as a percentage.
   */
  static listFrom(v: unknown): MysteryOdd[] {
    if (!Array.isArray(v)) return [];
    const maps = v.filter(isMap);
    if (maps.length === 0) return [];
    if (maps.every((m) => m['chance'] != null)) {
      const odds = maps.map((m) => MysteryOdd.fromJson(m));
      return odds.some((o) => o.chance > 1) ? odds.map((o) => o.withChance(o.chance / 100)) : odds;
    }
    const weights = maps.map((m) => numOr(m['weight']));
    const total = weights.reduce((a, b) => a + (b > 0 ? b : 0), 0);
    return maps.map((m, i) => MysteryOdd.fromJson(m).withChance(total <= 0 || weights[i]! <= 0 ? 0 : weights[i]! / total));
  }

  private withChance(c: number): MysteryOdd {
    return new MysteryOdd({ kind: this.kind, amount: this.amount, params: this.params, chance: c });
  }

  /** The outcome as a [RewardSpec], for `texts.reward`. */
  get spec(): RewardSpec {
    return new RewardSpec({ kind: this.kind, amount: this.amount, params: this.params });
  }
}

/**
 * One reward a rule gives: `{"threshold": 7, "kind": "coins", "amount": 50, "params": {}}`. Kinds are the app's own.
 * [threshold] is null for offer and social rewards. A `mystery` reward carries its [odds]: show them before it is
 * earned (a store rule, not a nicety).
 */
export class RewardSpec {
  readonly kind: string;
  readonly amount: number;
  readonly threshold: number | null;
  readonly params: JsonMap;
  /** For a `mystery` reward: each outcome with its chance (summing to 1). Empty for any other kind. */
  readonly odds: readonly MysteryOdd[];

  constructor(init: { kind: string; amount?: number; threshold?: number | null; params?: JsonMap; odds?: readonly MysteryOdd[] }) {
    this.kind = init.kind;
    this.amount = init.amount ?? 0;
    this.threshold = init.threshold ?? null;
    this.params = init.params ?? {};
    this.odds = init.odds ?? [];
  }

  static fromJson(m: JsonMap): RewardSpec {
    const params = optMap(m['params']);
    return new RewardSpec({
      kind: str(m['kind']),
      amount: numOr(m['amount']),
      threshold: optInt(m['threshold']),
      params,
      odds: MysteryOdd.listFrom(m['odds'] ?? params['table']),
    });
  }

  /** `params.badge` for a `badge` reward. */
  get badge(): string | null {
    return optStr(this.params['badge']);
  }

  get isMystery(): boolean {
    return this.kind === 'mystery';
  }

  /** `params.chance`: when the rule would pay, it pays only with this probability. Null when not 0 < chance ≤ 1. */
  get chance(): number | null {
    return optChance(this.params['chance']);
  }

  /** `params.amount_range` `[min, max]`: the amount is drawn between them; [amount] is the max. */
  get amountRange(): readonly [number, number] | null {
    return optRange(this.params['amount_range']);
  }

  /**
   * What this reward gives when the user switched surprises off (0.7): a `mystery` its most likely outcome (the first
   * on a tie), an `amount_range` its midpoint rounded down; anything else itself.
   */
  get fixed(): RewardSpec {
    if (this.isMystery && this.odds.length > 0) {
      let best = this.odds[0]!;
      for (const o of this.odds) if (o.chance > best.chance) best = o;
      return new RewardSpec({ kind: best.kind, amount: best.amount, threshold: this.threshold, params: best.params });
    }
    const range = this.amountRange;
    if (range == null) return this;
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.params)) if (k !== 'amount_range' && k !== 'chance') params[k] = v;
    return new RewardSpec({ kind: this.kind, amount: Math.trunc((range[0] + range[1]) / 2), threshold: this.threshold, params });
  }

  /** Dart `==`: same kind, amount, threshold and params. */
  equals(other: RewardSpec): boolean {
    return other.kind === this.kind && other.amount === this.amount && other.threshold === this.threshold && sameMap(other.params, this.params);
  }

  toString(): string {
    return `RewardSpec(${this.kind}, ${this.amount}, threshold: ${this.threshold})`;
  }
}

/** Grant states (ADR 0002 §5). Kept as strings on [RewardGrant.state]. */
export const GrantState = {
  queued: 'queued',
  granting: 'granting',
  granted: 'granted',
  failedRetryable: 'failed_retryable',
  failed: 'failed',
  cancelled: 'cancelled',
  skippedCap: 'skipped_cap',
} as const;

const setFlag = (v: unknown): boolean => v != null && v !== false && v !== 'false';

/** One grant from `inbox`, `rewards_track` or `rewards_offer_claim`. */
export class RewardGrant {
  readonly id: string;
  readonly program: string;
  readonly kind: string;
  readonly amount: number;
  readonly params: JsonMap;
  /** `granted`, `queued`, `granting`, `failed_retryable`, … (see [GrantState]). Missing means `granted`. */
  readonly state: string;
  readonly createdAt: Date | null;

  constructor(init: { id: string; program: string; kind: string; amount?: number; params?: JsonMap; state?: string; createdAt?: Date | null }) {
    this.id = init.id;
    this.program = init.program;
    this.kind = init.kind;
    this.amount = init.amount ?? 0;
    this.params = init.params ?? {};
    this.state = init.state ?? GrantState.granted;
    this.createdAt = init.createdAt ?? null;
  }

  static fromJson(m: JsonMap): RewardGrant {
    return new RewardGrant({
      id: str(m['id']),
      program: str(m['program']),
      kind: str(m['kind']),
      amount: numOr(m['amount']),
      params: optMap(m['params']),
      state: m['state'] == null ? GrantState.granted : str(m['state']),
      createdAt: time(m['created_at']),
    });
  }

  /** The reward as a [RewardSpec], for `texts.reward`. */
  get spec(): RewardSpec {
    return new RewardSpec({ kind: this.kind, amount: this.amount, params: this.params });
  }

  /** Granted, or on its way (`queued` / `granting`). */
  get isDeliveredOrOnTheWay(): boolean {
    return this.state === GrantState.granted || this.state === GrantState.queued || this.state === GrantState.granting;
  }

  /** Paid by a rule with `params.chance` (the grant's `params.surprise` is true). */
  get isSurprise(): boolean {
    return boolOr(this.params['surprise']);
  }

  /** Picked from a `mystery` table. */
  get isMystery(): boolean {
    return setFlag(this.params['mystery']);
  }

  /** The `[min, max]` the amount was drawn from (`params.range`), or null. */
  get range(): readonly [number, number] | null {
    return optRange(this.params['range']);
  }

  /** Given while the user had surprises off (0.7, `params.fixed`): a plain reward, never shown as a gamble. */
  get isFixed(): boolean {
    return boolOr(this.params['fixed']);
  }

  /** True when the grant deserves the reveal rather than a toast: `surprise`, `mystery` or `range`, and not fixed. */
  get shouldReveal(): boolean {
    return !this.isFixed && (this.isSurprise || this.isMystery || setFlag(this.params['range']));
  }

  toString(): string {
    return `RewardGrant(${this.id}, ${this.program}, ${this.kind} ${this.amount}, ${this.state})`;
  }
}

/** A badge the user holds. */
export class Badge {
  readonly badge: string;
  readonly program: string | null;
  readonly grantedAt: Date | null;
  constructor(init: { badge: string; program?: string | null; grantedAt?: Date | null }) {
    this.badge = init.badge;
    this.program = init.program ?? null;
    this.grantedAt = init.grantedAt ?? null;
  }
  static fromJson(m: JsonMap): Badge {
    return new Badge({ badge: str(m['badge']), program: optStr(m['program']), grantedAt: time(m['granted_at']) });
  }
}

/**
 * One live program: `{"key", "kind", "starts_at", "ends_at", "public"}`. [public] is the app's own display JSON (an
 * icon name, a title), passed through untouched.
 */
export class ProgramInfo {
  readonly key: string;
  readonly kind: ProgramKind;
  /** The kind as the server sent it (useful when [kind] is `unknown`). */
  readonly kindWire: string;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly public: JsonMap;

  constructor(init: { key: string; kind: ProgramKind; kindWire?: string; startsAt?: Date | null; endsAt?: Date | null; public?: JsonMap }) {
    this.key = init.key;
    this.kind = init.kind;
    this.kindWire = init.kindWire ?? '';
    this.startsAt = init.startsAt ?? null;
    this.endsAt = init.endsAt ?? null;
    this.public = init.public ?? {};
  }

  static fromJson(m: JsonMap): ProgramInfo {
    return new ProgramInfo({
      key: str(m['key']),
      kind: programKindFromWire(m['kind']),
      kindWire: str(m['kind']),
      startsAt: time(m['starts_at']),
      endsAt: time(m['ends_at']),
      public: optMap(m['public']),
    });
  }
}
