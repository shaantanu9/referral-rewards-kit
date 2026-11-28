/**
 * Fair play and progress (0.7): the user's own choices about streaks, surprises and timers, a streak's repair offer,
 * and a milestone's level. Every reader is tolerant: an older server sends none of it.
 */
import { boolOr, clamp01, intOr, isMap, optInt, optStr, time } from './json';

/**
 * What the user chose (`rewards_state().choices`, the follow-up prefs answer). All false by default.
 * - [streaksOff]: streaks keep counting, but no streak is shown (each streak in state is `hidden`).
 * - [surprisesOff]: no chance bonus, a mystery gives its most likely entry, a range its midpoint (`fixed` grants).
 * - [timersOff]: no countdowns or deadline chips in the widgets.
 */
export class RewardsChoices {
  static readonly streaksOffKey = 'streaks_off';
  static readonly surprisesOffKey = 'surprises_off';
  static readonly timersOffKey = 'timers_off';
  static readonly keys: ReadonlySet<string> = new Set(['streaks_off', 'surprises_off', 'timers_off']);

  readonly streaksOff: boolean;
  readonly surprisesOff: boolean;
  readonly timersOff: boolean;

  constructor(init: { streaksOff?: boolean; surprisesOff?: boolean; timersOff?: boolean } = {}) {
    this.streaksOff = init.streaksOff ?? false;
    this.surprisesOff = init.surprisesOff ?? false;
    this.timersOff = init.timersOff ?? false;
  }

  static fromJson(v: unknown): RewardsChoices {
    const m = isMap(v) ? v : {};
    return new RewardsChoices({
      streaksOff: boolOr(m[RewardsChoices.streaksOffKey]),
      surprisesOff: boolOr(m[RewardsChoices.surprisesOffKey]),
      timersOff: boolOr(m[RewardsChoices.timersOffKey]),
    });
  }

  /** Nothing switched off. */
  static readonly none = new RewardsChoices();

  toJson(): Record<string, boolean> {
    return { streaks_off: this.streaksOff, surprises_off: this.surprisesOff, timers_off: this.timersOff };
  }

  copyWith(patch: { streaksOff?: boolean; surprisesOff?: boolean; timersOff?: boolean }): RewardsChoices {
    return new RewardsChoices({
      streaksOff: patch.streaksOff ?? this.streaksOff,
      surprisesOff: patch.surprisesOff ?? this.surprisesOff,
      timersOff: patch.timersOff ?? this.timersOff,
    });
  }

  equals(o: RewardsChoices): boolean {
    return o.streaksOff === this.streaksOff && o.surprisesOff === this.surprisesOff && o.timersOff === this.timersOff;
  }

  toString(): string {
    return `RewardsChoices(streaks: ${!this.streaksOff}, surprises: ${!this.surprisesOff}, timers: ${!this.timersOff})`;
  }
}

/**
 * A broken streak that can still be brought back (`streak.repair`): reach [needed] events in one day, [done] so far
 * today, before [until], and the streak returns to [restoresTo] days.
 */
export class StreakRepair {
  readonly restoresTo: number;
  readonly until: Date | null;
  readonly needed: number;
  readonly done: number;

  constructor(init: { restoresTo: number; until?: Date | null; needed?: number; done?: number }) {
    this.restoresTo = init.restoresTo;
    this.until = init.until ?? null;
    this.needed = init.needed ?? 0;
    this.done = init.done ?? 0;
  }

  /** Null when [v] is not an object or has no `restores_to` above 0. */
  static fromJson(v: unknown): StreakRepair | null {
    if (!isMap(v)) return null;
    const to = optInt(v['restores_to']);
    if (to == null || to <= 0) return null;
    return new StreakRepair({ restoresTo: to, until: time(v['until']), needed: intOr(v['needed']), done: intOr(v['done']) });
  }

  /** Events still to do today (never negative). */
  get left(): number {
    return this.needed - this.done < 0 ? 0 : this.needed - this.done;
  }
}

/** A milestone's level: level [number] (1-based) named [name], reached at [at], the next at [nextAt] (null at the top). */
export class MilestoneLevel {
  readonly number: number;
  readonly name: string | null;
  readonly at: number;
  readonly nextAt: number | null;

  constructor(init: { number: number; name?: string | null; at?: number; nextAt?: number | null }) {
    this.number = init.number;
    this.name = init.name ?? null;
    this.at = init.at ?? 0;
    this.nextAt = init.nextAt ?? null;
  }

  /** Null when [v] is not an object or has no whole `number`. */
  static fromJson(v: unknown): MilestoneLevel | null {
    if (!isMap(v)) return null;
    const n = optInt(v['number']);
    if (n == null) return null;
    const name = optStr(v['name'])?.trim();
    return new MilestoneLevel({ number: n, name: name == null || name === '' ? null : name, at: intOr(v['at']), nextAt: optInt(v['next_at']) });
  }

  /** True at the last level. */
  get isTop(): boolean {
    return this.nextAt == null;
  }

  /** 0..1 from [at] to [nextAt] for [count]; 1 at the top level. */
  progress(count: number): number {
    const next = this.nextAt;
    if (next == null) return 1;
    if (next <= this.at) return 0;
    return clamp01((count - this.at) / (next - this.at));
  }
}
