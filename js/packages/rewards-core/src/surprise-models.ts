/** Surprise odds from the `rewards_state` object (ADR 0002 §18.6). */
import { listOf, numOr, optChance, optMap, optRange, str, type JsonMap } from './json';
import { RewardSpec } from './models';

/**
 * One active rule with a `chance` in a live program, from the state's top-level `surprises`. Shown so the app can say
 * "1 in 10 chance of 5–50 coins" before anything is earned.
 */
export class SurpriseOdd {
  readonly program: string;
  readonly kind: string;
  /** The most it can pay (with a range, its max). */
  readonly amount: number;
  readonly amountRange: readonly [number, number] | null;
  /** 0 < chance ≤ 1, or null. */
  readonly chance: number | null;
  readonly params: JsonMap;

  constructor(init: { program: string; kind: string; amount?: number; amountRange?: readonly [number, number] | null; chance?: number | null; params?: JsonMap }) {
    this.program = init.program;
    this.kind = init.kind;
    this.amount = init.amount ?? 0;
    this.amountRange = init.amountRange ?? null;
    this.chance = init.chance ?? null;
    this.params = init.params ?? {};
  }

  /** Tolerant: `chance` and `amount_range` are read from the top level, else from `params`. */
  static fromJson(m: JsonMap): SurpriseOdd {
    const params = optMap(m['params']);
    return new SurpriseOdd({
      program: str(m['program']),
      kind: str(m['kind']),
      amount: numOr(m['amount']),
      amountRange: optRange(m['amount_range']) ?? optRange(params['amount_range']),
      chance: optChance(m['chance']) ?? optChance(params['chance']),
      params,
    });
  }

  /** The reward as a [RewardSpec] (range and chance in its params), for `texts.reward`. */
  get spec(): RewardSpec {
    const params: Record<string, unknown> = { ...this.params };
    if (this.amountRange) params['amount_range'] = [this.amountRange[0], this.amountRange[1]];
    if (this.chance != null) params['chance'] = this.chance;
    return new RewardSpec({ kind: this.kind, amount: this.amount, params });
  }

  /** Reads the state's `surprises`; entries without a valid chance are skipped. */
  static listFrom(v: unknown): SurpriseOdd[] {
    return listOf(v, (m) => SurpriseOdd.fromJson(m)).filter((s) => s.chance != null);
  }
}
