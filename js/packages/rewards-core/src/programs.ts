/**
 * States of the 0.2 program kinds (ADR 0002 §18.2, §18.3): quests, recharges, windows, friend streaks, plus the
 * history and recap reads.
 */
import { boolOr, clamp01, intOr, isMap, listOf, numOr, str, time, type JsonMap } from './json';
import { Badge, RewardSpec } from './models';

/** One task of a quest set: `{"key","event","count","progress","done","rewards":[spec]}`. */
export class QuestTask {
  readonly key: string;
  /** The event type it counts. */
  readonly event: string;
  /** How many are needed (at least 1). */
  readonly count: number;
  readonly progress: number;
  readonly done: boolean;
  readonly rewards: readonly RewardSpec[];

  constructor(init: { key: string; event?: string; count?: number; progress?: number; done?: boolean; rewards?: readonly RewardSpec[] }) {
    this.key = init.key;
    this.event = init.event ?? '';
    this.count = init.count ?? 1;
    this.progress = init.progress ?? 0;
    this.done = init.done ?? false;
    this.rewards = init.rewards ?? [];
  }

  static fromJson(m: JsonMap): QuestTask {
    const count = intOr(m['count'], 1);
    return new QuestTask({
      key: str(m['key']),
      event: str(m['event']),
      count: count < 1 ? 1 : count,
      progress: intOr(m['progress']),
      done: boolOr(m['done']),
      rewards: listOf(m['rewards'], (r) => RewardSpec.fromJson(r)),
    });
  }

  /** 0..1; 1 when [done]. */
  get fraction(): number {
    return this.done ? 1 : clamp01(this.progress / this.count);
  }
}

/** A quest set. [endsAt] is when the period resets (null for `never`). */
export class QuestState {
  readonly program: string;
  /** `daily`, `weekly` or `never` (as the server sent it). */
  readonly period: string;
  readonly endsAt: Date | null;
  /** Every task done. */
  readonly done: boolean;
  readonly tasks: readonly QuestTask[];
  /** The reward for finishing every task; empty when none. */
  readonly bonus: readonly RewardSpec[];

  constructor(init: { program: string; period?: string; endsAt?: Date | null; done?: boolean; tasks?: readonly QuestTask[]; bonus?: readonly RewardSpec[] }) {
    this.program = init.program;
    this.period = init.period ?? 'never';
    this.endsAt = init.endsAt ?? null;
    this.done = init.done ?? false;
    this.tasks = init.tasks ?? [];
    this.bonus = init.bonus ?? [];
  }

  static fromJson(m: JsonMap): QuestState {
    return new QuestState({
      program: str(m['program']),
      period: m['period'] == null ? 'never' : str(m['period']),
      endsAt: time(m['ends_at']),
      done: boolOr(m['done']),
      tasks: listOf(m['tasks'], (t) => QuestTask.fromJson(t)),
      bonus: listOf(m['bonus'], (r) => RewardSpec.fromJson(r)),
    });
  }

  get doneCount(): number {
    return this.tasks.filter((t) => t.done).length;
  }
}

/** Units that refill over time ("3 hearts, one back every 4 hours"). [nextAt] is null when full. */
export class RechargeState {
  readonly program: string;
  readonly units: number;
  readonly max: number;
  readonly everyMinutes: number;
  readonly nextAt: Date | null;

  constructor(init: { program: string; units?: number; max?: number; everyMinutes?: number; nextAt?: Date | null }) {
    this.program = init.program;
    this.units = init.units ?? 0;
    this.max = init.max ?? 0;
    this.everyMinutes = init.everyMinutes ?? 0;
    this.nextAt = init.nextAt ?? null;
  }

  static fromJson(m: JsonMap): RechargeState {
    return new RechargeState({
      program: str(m['program']),
      units: intOr(m['units']),
      max: intOr(m['max']),
      everyMinutes: intOr(m['every_minutes']),
      nextAt: time(m['next_at']),
    });
  }

  get full(): boolean {
    return this.units >= this.max;
  }
  get empty(): boolean {
    return this.units <= 0;
  }

  /** Keeps fields the answer does not carry (`rewards_recharge_use` has no `every_minutes`). */
  mergedWith(newer: RechargeState): RechargeState {
    return new RechargeState({
      program: this.program,
      units: newer.units,
      max: newer.max === 0 ? this.max : newer.max,
      everyMinutes: newer.everyMinutes === 0 ? this.everyMinutes : newer.everyMinutes,
      nextAt: newer.nextAt,
    });
  }
}

/** A time window ("Happy hour 21:00–22:00"): the current window or the next one. */
export class WindowState {
  readonly program: string;
  readonly active: boolean;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;

  constructor(init: { program: string; active?: boolean; startsAt?: Date | null; endsAt?: Date | null }) {
    this.program = init.program;
    this.active = init.active ?? false;
    this.startsAt = init.startsAt ?? null;
    this.endsAt = init.endsAt ?? null;
  }

  static fromJson(m: JsonMap): WindowState {
    return new WindowState({ program: str(m['program']), active: boolOr(m['active']), startsAt: time(m['starts_at']), endsAt: time(m['ends_at']) });
  }

  /** Whether it is open at [now] (a server-corrected time), from the times rather than the [active] snapshot. */
  activeAt(now: Date): boolean {
    const s = this.startsAt,
      e = this.endsAt;
    if (s == null || e == null) return this.active;
    return now.getTime() >= s.getTime() && now.getTime() < e.getTime();
  }
}

/** A streak kept with one friend: both must act each day. [friendName] is what the friend chose to show. */
export class FriendStreakState {
  readonly program: string;
  readonly pairId: string;
  readonly friendId: string;
  readonly friendName: string;
  readonly current: number;
  readonly longest: number;
  readonly todayMe: boolean;
  readonly todayFriend: boolean;
  readonly breaksAt: Date | null;
  readonly nextReward: RewardSpec | null;

  constructor(init: {
    program: string;
    pairId: string;
    friendId?: string;
    friendName?: string;
    current?: number;
    longest?: number;
    todayMe?: boolean;
    todayFriend?: boolean;
    breaksAt?: Date | null;
    nextReward?: RewardSpec | null;
  }) {
    this.program = init.program;
    this.pairId = init.pairId;
    this.friendId = init.friendId ?? '';
    this.friendName = init.friendName ?? '';
    this.current = init.current ?? 0;
    this.longest = init.longest ?? 0;
    this.todayMe = init.todayMe ?? false;
    this.todayFriend = init.todayFriend ?? false;
    this.breaksAt = init.breaksAt ?? null;
    this.nextReward = init.nextReward ?? null;
  }

  static fromJson(m: JsonMap): FriendStreakState {
    return new FriendStreakState({
      program: str(m['program']),
      pairId: str(m['pair_id']),
      friendId: str(m['friend_id']),
      friendName: str(m['friend_name']),
      current: intOr(m['current']),
      longest: intOr(m['longest']),
      todayMe: boolOr(m['today_me']),
      todayFriend: boolOr(m['today_friend']),
      breaksAt: time(m['breaks_at']),
      nextReward: isMap(m['next_reward']) ? RewardSpec.fromJson(m['next_reward']) : null,
    });
  }

  get todayBoth(): boolean {
    return this.todayMe && this.todayFriend;
  }
}

/** What `rewards_friend_invite` returns: a code to share (`F` + 7 characters) valid until [expiresAt]. */
export class FriendInvite {
  readonly code: string;
  readonly expiresAt: Date | null;
  constructor(init: { code: string; expiresAt?: Date | null }) {
    this.code = init.code;
    this.expiresAt = init.expiresAt ?? null;
  }
  static fromJson(m: JsonMap): FriendInvite {
    return new FriendInvite({ code: str(m['code']), expiresAt: time(m['expires_at']) });
  }
}

/** What `rewards_friend_accept` returns. */
export class FriendAcceptResult {
  constructor(
    readonly pairId: string,
    readonly program: string,
  ) {}
  static fromJson(m: JsonMap): FriendAcceptResult {
    return new FriendAcceptResult(str(m['pair_id']), str(m['program']));
  }
}

/** `YYYY-MM-DD` as a UTC date (midnight); null when it is not one. */
export function parseDay(v: unknown): Date | null {
  if (typeof v !== 'string' || v.length < 10) return null;
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(v);
  if (!m) return null;
  const d = new Date(Date.UTC(parseInt(m[1]!, 10), parseInt(m[2]!, 10) - 1, parseInt(m[3]!, 10)));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A calendar day as `YYYY-MM-DD`. A `YYYY-MM-DD…` string passes through; a Date gives its local year, month and day
 * (like a Dart local DateTime), or its UTC ones with [utc] (for the UTC dates [parseDay] returns).
 */
export function formatDay(d: Date | string, utc = false): string {
  if (typeof d === 'string') return d.substring(0, 10);
  const y = utc ? d.getUTCFullYear() : d.getFullYear();
  const m = (utc ? d.getUTCMonth() : d.getMonth()) + 1;
  const day = utc ? d.getUTCDate() : d.getDate();
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** One local day of a streak's history. */
export class HistoryDay {
  /** The local day as a UTC date at midnight (`2026-11-14` → `Date.UTC(2026, 10, 14)`); compare dates, not instants. */
  readonly day: Date;
  readonly count: number;
  /** Missed but saved by a freeze. */
  readonly frozen: boolean;

  constructor(init: { day: Date; count?: number; frozen?: boolean }) {
    this.day = init.day;
    this.count = init.count ?? 0;
    this.frozen = init.frozen ?? false;
  }

  static fromJson(m: JsonMap): HistoryDay {
    return new HistoryDay({ day: parseDay(m['day']) ?? new Date(Date.UTC(1970, 0, 1)), count: intOr(m['count']), frozen: boolOr(m['frozen']) });
  }

  /** The day as `YYYY-MM-DD`. */
  get dayKey(): string {
    return formatDay(this.day, true);
  }

  copyWith(patch: { count?: number }): HistoryDay {
    return new HistoryDay({ day: this.day, count: patch.count ?? this.count, frozen: this.frozen });
  }
}

/** `rewards_history`: `{"program","daily_goal","days":[…]}`, oldest first, ending today. */
export class StreakHistory {
  readonly program: string;
  readonly dailyGoal: number;
  readonly days: readonly HistoryDay[];

  constructor(init: { program: string; dailyGoal?: number; days?: readonly HistoryDay[] }) {
    this.program = init.program;
    this.dailyGoal = init.dailyGoal ?? 1;
    this.days = init.days ?? [];
  }

  static fromJson(m: JsonMap): StreakHistory {
    const goal = intOr(m['daily_goal'], 1);
    return new StreakHistory({ program: str(m['program']), dailyGoal: goal < 1 ? 1 : goal, days: listOf(m['days'], (d) => HistoryDay.fromJson(d)) });
  }

  /** The last day (today), or null. */
  get today(): HistoryDay | null {
    return this.days.length === 0 ? null : this.days[this.days.length - 1]!;
  }

  /** The same history with today's count replaced (after a track changed it). */
  withTodayCount(count: number): StreakHistory {
    if (this.days.length === 0) return this;
    return new StreakHistory({
      program: this.program,
      dailyGoal: this.dailyGoal,
      days: [...this.days.slice(0, -1), this.days[this.days.length - 1]!.copyWith({ count })],
    });
  }

  /** Heatmap level 0..4 for [count]: 0 none, 1 started, 2 goal met, 3 twice the goal, 4 three times or more. */
  levelOf(count: number): number {
    if (count <= 0) return 0;
    if (count < this.dailyGoal) return 1;
    if (count < this.dailyGoal * 2) return 2;
    if (count < this.dailyGoal * 3) return 3;
    return 4;
  }
}

/** One line of a recap's event counts. */
export class RecapEvent {
  constructor(
    readonly type: string,
    readonly count: number = 0,
  ) {}
  static fromJson(m: JsonMap): RecapEvent {
    return new RecapEvent(str(m['type']), intOr(m['count']));
  }
}

/** One line of a recap's grants: [count] grants of [kind] adding up to [amount]. */
export class RecapGrant {
  constructor(
    readonly kind: string,
    readonly amount: number = 0,
    readonly count: number = 0,
  ) {}
  static fromJson(m: JsonMap): RecapGrant {
    return new RecapGrant(str(m['kind']), numOr(m['amount']), intOr(m['count']));
  }
  get spec(): RewardSpec {
    return new RewardSpec({ kind: this.kind, amount: this.amount });
  }
}

/** `rewards_recap(from_day, to_day)`: `{"days_active","events","grants","best_streak","badges"}`. */
export class Recap {
  /** The first and last day asked for (UTC dates). */
  readonly from: Date | null;
  readonly to: Date | null;
  readonly daysActive: number;
  readonly events: readonly RecapEvent[];
  readonly grants: readonly RecapGrant[];
  readonly bestStreak: number;
  readonly badges: readonly Badge[];

  constructor(init: {
    from?: Date | null;
    to?: Date | null;
    daysActive?: number;
    events?: readonly RecapEvent[];
    grants?: readonly RecapGrant[];
    bestStreak?: number;
    badges?: readonly Badge[];
  } = {}) {
    this.from = init.from ?? null;
    this.to = init.to ?? null;
    this.daysActive = init.daysActive ?? 0;
    this.events = init.events ?? [];
    this.grants = init.grants ?? [];
    this.bestStreak = init.bestStreak ?? 0;
    this.badges = init.badges ?? [];
  }

  static fromJson(m: JsonMap, range: { from?: Date | null; to?: Date | null } = {}): Recap {
    const badges: Badge[] = [];
    if (Array.isArray(m['badges'])) {
      for (const b of m['badges']) {
        if (isMap(b)) badges.push(Badge.fromJson(b));
        else if (typeof b === 'string') badges.push(new Badge({ badge: b }));
      }
    }
    return new Recap({
      from: range.from ?? null,
      to: range.to ?? null,
      daysActive: intOr(m['days_active']),
      events: listOf(m['events'], (e) => RecapEvent.fromJson(e)),
      grants: listOf(m['grants'], (g) => RecapGrant.fromJson(g)),
      bestStreak: intOr(m['best_streak']),
      badges,
    });
  }
}
