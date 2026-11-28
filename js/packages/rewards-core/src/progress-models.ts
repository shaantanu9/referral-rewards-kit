/** Streak and milestone progress (ADR 0002 §6.1, §6.2), with the 0.7 fair-play fields. */
import { MilestoneLevel, StreakRepair } from './fair-play-models';
import { boolOr, clamp01, intOr, isMap, optInt, str, time, type JsonMap } from './json';
import { RewardSpec } from './models';

const HOUR = 3600 * 1000;

/**
 * A daily streak (ADR 0002 §6.1). [endsTodayAt] is local midnight tonight (at risk after it when today is not done);
 * [breaksAt] is when it really resets, counting freezes.
 */
export class StreakState {
  readonly program: string;
  readonly current: number;
  readonly longest: number;
  readonly todayDone: boolean;
  readonly freezes: number;
  readonly endsTodayAt: Date | null;
  readonly breaksAt: Date | null;
  /** Null when nothing is left to earn. */
  readonly nextReward: RewardSpec | null;
  /** Matching events needed for a day to count (at least 1). */
  readonly dailyGoal: number;
  /** Matching events so far today. */
  readonly todayCount: number;
  /** Missed days still forgiven for free this ISO week, before earned [freezes] are spent. */
  readonly weeklyFreeFreezesLeft: number;
  /** The user switched streaks off (0.7): it keeps counting, the widgets do not show it. */
  readonly hidden: boolean;
  /** The streak broke and can still be brought back (0.7), or null. */
  readonly repair: StreakRepair | null;
  /** When the streak was last brought back (0.7), or null. */
  readonly repairedAt: Date | null;
  /** Most events of this type on one day (0.7). */
  readonly bestDayCount: number;
  /** Today set a new [bestDayCount] of at least 2 (0.7). */
  readonly recordToday: boolean;

  constructor(init: {
    program: string;
    current?: number;
    longest?: number;
    todayDone?: boolean;
    freezes?: number;
    endsTodayAt?: Date | null;
    breaksAt?: Date | null;
    nextReward?: RewardSpec | null;
    dailyGoal?: number;
    todayCount?: number;
    weeklyFreeFreezesLeft?: number;
    hidden?: boolean;
    repair?: StreakRepair | null;
    repairedAt?: Date | null;
    bestDayCount?: number;
    recordToday?: boolean;
  }) {
    this.program = init.program;
    this.current = init.current ?? 0;
    this.longest = init.longest ?? 0;
    this.todayDone = init.todayDone ?? false;
    this.freezes = init.freezes ?? 0;
    this.endsTodayAt = init.endsTodayAt ?? null;
    this.breaksAt = init.breaksAt ?? null;
    this.nextReward = init.nextReward ?? null;
    this.dailyGoal = init.dailyGoal ?? 1;
    this.todayCount = init.todayCount ?? 0;
    this.weeklyFreeFreezesLeft = init.weeklyFreeFreezesLeft ?? 0;
    this.hidden = init.hidden ?? false;
    this.repair = init.repair ?? null;
    this.repairedAt = init.repairedAt ?? null;
    this.bestDayCount = init.bestDayCount ?? 0;
    this.recordToday = init.recordToday ?? false;
  }

  static fromJson(m: JsonMap): StreakState {
    const done = boolOr(m['today_done']);
    const goal = intOr(m['daily_goal'], 1);
    const g = goal < 1 ? 1 : goal;
    return new StreakState({
      program: str(m['program']),
      current: intOr(m['current']),
      longest: intOr(m['longest']),
      todayDone: done,
      freezes: intOr(m['freezes']),
      endsTodayAt: time(m['ends_today_at']),
      breaksAt: time(m['breaks_at']),
      nextReward: isMap(m['next_reward']) ? RewardSpec.fromJson(m['next_reward']) : null,
      dailyGoal: g,
      // An older server sends no count: a done day counts as the goal reached.
      todayCount: optInt(m['today_count']) ?? (done ? g : 0),
      weeklyFreeFreezesLeft: intOr(m['weekly_free_freezes_left']),
      hidden: boolOr(m['hidden']),
      repair: StreakRepair.fromJson(m['repair']),
      repairedAt: time(m['repaired_at']),
      bestDayCount: intOr(m['best_day_count']),
      recordToday: boolOr(m['record_today']),
    });
  }

  /** True when [repairedAt] is less than [withinMs] (default 24 h) before [now] (a server-corrected time). */
  repairedRecently(now: Date, withinMs = 24 * HOUR): boolean {
    const at = this.repairedAt;
    if (at == null) return false;
    const ago = now.getTime() - at.getTime();
    return ago >= 0 && ago < withinMs;
  }

  /** 0..1 towards today's [dailyGoal]; 1 once [todayDone]. */
  get goalProgress(): number {
    return this.todayDone ? 1 : clamp01(this.todayCount / this.dailyGoal);
  }

  /** Days still to go to [nextReward], or null when unknown. */
  get daysToNextReward(): number | null {
    const t = this.nextReward?.threshold;
    if (t == null || t <= this.current) return null;
    return t - this.current;
  }

  /** True when today is not done, there is a streak to lose, and [endsTodayAt] is within [withinMs] (4 h) of [now]. */
  atRisk(now: Date, withinMs = 4 * HOUR): boolean {
    const end = this.endsTodayAt;
    if (this.todayDone || this.current <= 0 || end == null) return false;
    return end.getTime() - now.getTime() <= withinMs;
  }
}

/** Milestone progress (ADR 0002 §6.2): how many events counted, and the next reward. */
export class MilestoneState {
  readonly program: string;
  /** Counted so far, [headStart] included. */
  readonly count: number;
  /** Null when nothing is left to earn. */
  readonly nextReward: RewardSpec | null;
  /** Given at the start (0.7): [count] began here. */
  readonly headStart: number;
  /** The level reached (0.7), or null when the milestone has no levels. */
  readonly level: MilestoneLevel | null;

  constructor(init: { program: string; count?: number; nextReward?: RewardSpec | null; headStart?: number; level?: MilestoneLevel | null }) {
    this.program = init.program;
    this.count = init.count ?? 0;
    this.nextReward = init.nextReward ?? null;
    this.headStart = init.headStart ?? 0;
    this.level = init.level ?? null;
  }

  static fromJson(m: JsonMap): MilestoneState {
    const head = intOr(m['head_start']);
    return new MilestoneState({
      program: str(m['program']),
      count: intOr(m['count']),
      nextReward: isMap(m['next_reward']) ? RewardSpec.fromJson(m['next_reward']) : null,
      headStart: head < 0 ? 0 : head,
      level: MilestoneLevel.fromJson(m['level']),
    });
  }

  /** The next threshold, or null. */
  get target(): number | null {
    return this.nextReward?.threshold ?? null;
  }

  /** 0..1 towards [target]; 1 when nothing is left to earn. */
  get progress(): number {
    const t = this.target;
    if (this.nextReward == null) return 1;
    if (t == null || t <= 0) return 0;
    return clamp01(this.count / t);
  }
}
