/** The whole `rewards_state` object and the `rewards_track` result (ADR 0002 §11). */
import { RewardsChoices } from './fair-play-models';
import { asMap, boolOr, listOf, time } from './json';
import { Badge, ProgramInfo, RewardGrant } from './models';
import { FriendStreakState, QuestState, RechargeState, WindowState } from './programs';
import { MilestoneState, StreakState } from './progress-models';
import { QuizState } from './quiz-models';
import { SurpriseOdd } from './surprise-models';
import { OfferState, SocialTaskState } from './tasks';

export interface RewardsStateInit {
  enabled?: boolean;
  serverTime?: Date | null;
  programs?: readonly ProgramInfo[];
  streaks?: readonly StreakState[];
  milestones?: readonly MilestoneState[];
  offers?: readonly OfferState[];
  social?: readonly SocialTaskState[];
  inbox?: readonly RewardGrant[];
  badges?: readonly Badge[];
  quests?: readonly QuestState[];
  recharges?: readonly RechargeState[];
  windows?: readonly WindowState[];
  friends?: readonly FriendStreakState[];
  quizzes?: readonly QuizState[];
  surprises?: readonly SurpriseOdd[];
  choices?: RewardsChoices;
}

/** Everything `rewards_state()` returns. Immutable; the controller replaces it with [copyWith]. */
export class RewardsState {
  /** The engine's master switch (`settings.enabled`). Widgets hide when false. */
  readonly enabled: boolean;
  /** The server's clock when it built this object; feeds `ServerClock`. */
  readonly serverTime: Date | null;
  readonly programs: readonly ProgramInfo[];
  readonly streaks: readonly StreakState[];
  readonly milestones: readonly MilestoneState[];
  readonly offers: readonly OfferState[];
  readonly social: readonly SocialTaskState[];
  /** Grants not yet seen (latest 50). */
  readonly inbox: readonly RewardGrant[];
  readonly badges: readonly Badge[];
  readonly quests: readonly QuestState[];
  readonly recharges: readonly RechargeState[];
  /** The current window of each `window` program, or its next one. */
  readonly windows: readonly WindowState[];
  /** Every friend streak, of every `friend_streak` program. */
  readonly friends: readonly FriendStreakState[];
  readonly quizzes: readonly QuizState[];
  /** Odds of every surprise rule in a live program (ADR 0002 §18.6). */
  readonly surprises: readonly SurpriseOdd[];
  /** The user's streak / surprise / timer choices (0.7). */
  readonly choices: RewardsChoices;

  constructor(init: RewardsStateInit = {}) {
    this.enabled = init.enabled ?? false;
    this.serverTime = init.serverTime ?? null;
    this.programs = init.programs ?? [];
    this.streaks = init.streaks ?? [];
    this.milestones = init.milestones ?? [];
    this.offers = init.offers ?? [];
    this.social = init.social ?? [];
    this.inbox = init.inbox ?? [];
    this.badges = init.badges ?? [];
    this.quests = init.quests ?? [];
    this.recharges = init.recharges ?? [];
    this.windows = init.windows ?? [];
    this.friends = init.friends ?? [];
    this.quizzes = init.quizzes ?? [];
    this.surprises = init.surprises ?? [];
    this.choices = init.choices ?? RewardsChoices.none;
  }

  static fromJson(json: unknown): RewardsState {
    const m = asMap(json, 'rewards_state');
    return new RewardsState({
      enabled: boolOr(m['enabled']),
      serverTime: time(m['server_time']),
      programs: listOf(m['programs'], (x) => ProgramInfo.fromJson(x)),
      streaks: listOf(m['streaks'], (x) => StreakState.fromJson(x)),
      milestones: listOf(m['milestones'], (x) => MilestoneState.fromJson(x)),
      offers: listOf(m['offers'], (x) => OfferState.fromJson(x)),
      social: listOf(m['social'], (x) => SocialTaskState.fromJson(x)),
      inbox: listOf(m['inbox'], (x) => RewardGrant.fromJson(x)),
      badges: listOf(m['badges'], (x) => Badge.fromJson(x)),
      quests: listOf(m['quests'], (x) => QuestState.fromJson(x)),
      recharges: listOf(m['recharges'], (x) => RechargeState.fromJson(x)),
      windows: listOf(m['windows'], (x) => WindowState.fromJson(x)),
      friends: listOf(m['friends'], (x) => FriendStreakState.fromJson(x)),
      quizzes: listOf(m['quizzes'], (x) => QuizState.fromJson(x)),
      surprises: SurpriseOdd.listFrom(m['surprises']),
      choices: RewardsChoices.fromJson(m['choices']),
    });
  }

  /** An empty, disabled state. */
  static readonly empty = new RewardsState();

  program(key: string): ProgramInfo | null {
    return this.programs.find((p) => p.key === key) ?? null;
  }
  streak(program: string): StreakState | null {
    return this.streaks.find((s) => s.program === program) ?? null;
  }
  milestone(program: string): MilestoneState | null {
    return this.milestones.find((s) => s.program === program) ?? null;
  }
  offer(program: string): OfferState | null {
    return this.offers.find((s) => s.program === program) ?? null;
  }
  socialTask(program: string): SocialTaskState | null {
    return this.social.find((s) => s.program === program) ?? null;
  }
  quest(program: string): QuestState | null {
    return this.quests.find((s) => s.program === program) ?? null;
  }
  recharge(program: string): RechargeState | null {
    return this.recharges.find((s) => s.program === program) ?? null;
  }
  window(program: string): WindowState | null {
    return this.windows.find((s) => s.program === program) ?? null;
  }
  quiz(program: string): QuizState | null {
    return this.quizzes.find((s) => s.program === program) ?? null;
  }
  /** The surprise odds of one program. */
  surprisesOf(program: string): SurpriseOdd[] {
    return this.surprises.filter((s) => s.program === program);
  }
  /** The friend streaks of one program. */
  friendsOf(program: string): FriendStreakState[] {
    return this.friends.filter((f) => f.program === program);
  }

  /** A copy with the given fields replaced (a missing or undefined field keeps its value). */
  copyWith(patch: RewardsStateInit): RewardsState {
    const pick = <K extends keyof RewardsStateInit>(k: K): RewardsStateInit[K] =>
      (patch[k] === undefined ? (this as unknown as RewardsStateInit)[k] : patch[k]) as RewardsStateInit[K];
    return new RewardsState({
      enabled: pick('enabled'),
      serverTime: pick('serverTime'),
      programs: pick('programs'),
      streaks: pick('streaks'),
      milestones: pick('milestones'),
      offers: pick('offers'),
      social: pick('social'),
      inbox: pick('inbox'),
      badges: pick('badges'),
      quests: pick('quests'),
      recharges: pick('recharges'),
      windows: pick('windows'),
      friends: pick('friends'),
      quizzes: pick('quizzes'),
      surprises: pick('surprises'),
      choices: pick('choices'),
    });
  }
}

/**
 * What `rewards_track` returns: `{"enabled", "duplicate", "grants", "streaks"}` (only the changed ones); [milestones]
 * and [quests] are read too when a server sends them.
 */
export class TrackResult {
  /** False when the engine is switched off (nothing was stored). */
  readonly enabled: boolean;
  readonly duplicate: boolean;
  readonly grants: readonly RewardGrant[];
  readonly streaks: readonly StreakState[];
  readonly milestones: readonly MilestoneState[];
  readonly quests: readonly QuestState[];

  constructor(init: {
    enabled?: boolean;
    duplicate?: boolean;
    grants?: readonly RewardGrant[];
    streaks?: readonly StreakState[];
    milestones?: readonly MilestoneState[];
    quests?: readonly QuestState[];
  } = {}) {
    this.enabled = init.enabled ?? true;
    this.duplicate = init.duplicate ?? false;
    this.grants = init.grants ?? [];
    this.streaks = init.streaks ?? [];
    this.milestones = init.milestones ?? [];
    this.quests = init.quests ?? [];
  }

  static fromJson(json: unknown): TrackResult {
    const m = asMap(json, 'rewards_track');
    return new TrackResult({
      enabled: boolOr(m['enabled'], true),
      duplicate: boolOr(m['duplicate']),
      grants: listOf(m['grants'], (x) => RewardGrant.fromJson(x)),
      streaks: listOf(m['streaks'], (x) => StreakState.fromJson(x)),
      milestones: listOf(m['milestones'], (x) => MilestoneState.fromJson(x)),
      quests: listOf(m['quests'], (x) => QuestState.fromJson(x)),
    });
  }
}

/** Replaces items of [base] whose key matches an item of [changed], appends the rest, keeps order. */
export function mergeBy<T>(base: readonly T[], changed: readonly T[], key: (t: T) => string): readonly T[] {
  if (changed.length === 0) return base;
  const byKey = new Map<string, T>();
  for (const c of changed) byKey.set(key(c), c);
  const out = base.map((b) => {
    const k = key(b);
    const c = byKey.get(k);
    if (c === undefined) return b;
    byKey.delete(k);
    return c;
  });
  out.push(...byKey.values());
  return out;
}
