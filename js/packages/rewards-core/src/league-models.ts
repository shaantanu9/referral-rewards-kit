/**
 * Weekly leagues (ADR 0002 §18.10): what `rewards_league`, `rewards_league_join` and `rewards_league_leave` return.
 * Other members arrive only as a display name (or null), a score and a place; never an id.
 */
import { boolOr, intOr, isMap, listOf, optInt, optStr, str, time, type JsonMap } from './json';
import { RewardGrant, RewardSpec } from './models';
import { parseDay } from './programs';

/** Where a member moved at last week's close. */
export const LeagueTierChange = { up: 'up', same: 'same', down: 'down' } as const;
export type LeagueTierChange = (typeof LeagueTierChange)[keyof typeof LeagueTierChange];
export const leagueTierChangeFromWire = (v: unknown): LeagueTierChange =>
  v === 'up' || v === 'down' || v === 'same' ? v : LeagueTierChange.same;

const optName = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** One row of this week's board. */
export class LeagueMember {
  /** The place (ties share one), or null while below the league's `min_score`. */
  readonly rank: number | null;
  /** The app's display name for that member, or null (show a neutral word). */
  readonly name: string | null;
  readonly score: number;
  /** True on the signed-in user's own row. */
  readonly me: boolean;

  constructor(init: { rank?: number | null; name?: string | null; score?: number; me?: boolean } = {}) {
    this.rank = init.rank ?? null;
    this.name = init.name ?? null;
    this.score = init.score ?? 0;
    this.me = init.me ?? false;
  }

  static fromJson(m: JsonMap): LeagueMember {
    const name = optStr(m['name'])?.trim();
    return new LeagueMember({ rank: optInt(m['rank']), name: name == null || name === '' ? null : name, score: intOr(m['score']), me: boolOr(m['me']) });
  }
}

/** The member's own result of the last closed week. */
export class LeagueLastWeek {
  /** The week's first day (a UTC date). */
  readonly week: Date | null;
  readonly rank: number | null;
  readonly score: number;
  readonly tierChange: LeagueTierChange;
  readonly grants: readonly RewardGrant[];

  constructor(init: { week?: Date | null; rank?: number | null; score?: number; tierChange?: LeagueTierChange; grants?: readonly RewardGrant[] } = {}) {
    this.week = init.week ?? null;
    this.rank = init.rank ?? null;
    this.score = init.score ?? 0;
    this.tierChange = init.tierChange ?? LeagueTierChange.same;
    this.grants = init.grants ?? [];
  }

  static fromJson(m: JsonMap): LeagueLastWeek {
    return new LeagueLastWeek({
      week: parseDay(m['week']),
      rank: optInt(m['rank']),
      score: intOr(m['score']),
      tierChange: leagueTierChangeFromWire(m['tier_change']),
      grants: listOf(m['grants'], (g) => RewardGrant.fromJson(g)),
    });
  }
}

/** One league as the member sees it this week. */
export class LeagueState {
  readonly program: string;
  /** False when the program is off or outside its season: no board, joining is refused. */
  readonly live: boolean;
  /** True when the user opted in and has not left. */
  readonly joined: boolean;
  /** The member's tier (0 = the first) and its name (null without named tiers). */
  readonly tier: number;
  readonly tierName: string | null;
  /** Tier names, lowest first (empty without named tiers). */
  readonly tiers: readonly string[];
  /** This week's first day (UTC date), and its real start and end on the server. */
  readonly week: Date | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly serverTime: Date | null;
  /** At most this many members share a board. */
  readonly groupSize: number;
  /** How many move up / down a tier at the weekly close (0 = none). Shown as rules, never as a zone on the board. */
  readonly promote: number;
  readonly demote: number;
  /** Points needed to be ranked and rewarded. */
  readonly minScore: number;
  /** The member's own place (null while unranked), score, and how many share the board. */
  readonly rank: number | null;
  readonly score: number;
  readonly size: number;
  /** The board, highest score first. Empty when not joined. */
  readonly members: readonly LeagueMember[];
  /** What each place pays: `threshold` = a place ("top N"); only the best one reached is paid. */
  readonly rewards: readonly RewardSpec[];
  /** The member's own last closed week, or null. */
  readonly lastWeek: LeagueLastWeek | null;

  constructor(init: {
    program: string;
    live?: boolean;
    joined?: boolean;
    tier?: number;
    tierName?: string | null;
    tiers?: readonly string[];
    week?: Date | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
    serverTime?: Date | null;
    groupSize?: number;
    promote?: number;
    demote?: number;
    minScore?: number;
    rank?: number | null;
    score?: number;
    size?: number;
    members?: readonly LeagueMember[];
    rewards?: readonly RewardSpec[];
    lastWeek?: LeagueLastWeek | null;
  }) {
    this.program = init.program;
    this.live = init.live ?? true;
    this.joined = init.joined ?? false;
    this.tier = init.tier ?? 0;
    this.tierName = init.tierName ?? null;
    this.tiers = init.tiers ?? [];
    this.week = init.week ?? null;
    this.startsAt = init.startsAt ?? null;
    this.endsAt = init.endsAt ?? null;
    this.serverTime = init.serverTime ?? null;
    this.groupSize = init.groupSize ?? 20;
    this.promote = init.promote ?? 0;
    this.demote = init.demote ?? 0;
    this.minScore = init.minScore ?? 1;
    this.rank = init.rank ?? null;
    this.score = init.score ?? 0;
    this.size = init.size ?? 0;
    this.members = init.members ?? [];
    this.rewards = init.rewards ?? [];
    this.lastWeek = init.lastWeek ?? null;
  }

  static fromJson(m: JsonMap): LeagueState {
    return new LeagueState({
      program: str(m['program']),
      live: boolOr(m['live'], true),
      joined: boolOr(m['joined']),
      tier: intOr(m['tier']),
      tierName: optName(m['tier_name']),
      tiers: Array.isArray(m['tiers']) ? m['tiers'].map(optName).filter((t): t is string => t != null) : [],
      week: parseDay(m['week']),
      startsAt: time(m['starts_at']),
      endsAt: time(m['ends_at']),
      serverTime: time(m['server_time']),
      groupSize: intOr(m['group_size'], 20),
      promote: intOr(m['promote']),
      demote: intOr(m['demote']),
      minScore: intOr(m['min_score'], 1),
      rank: optInt(m['rank']),
      score: intOr(m['score']),
      size: intOr(m['size']),
      members: listOf(m['members'], (x) => LeagueMember.fromJson(x)),
      rewards: listOf(m['rewards'], (x) => RewardSpec.fromJson(x)),
      lastWeek: isMap(m['last_week']) ? LeagueLastWeek.fromJson(m['last_week']) : null,
    });
  }

  /** True when a tier above this one exists (promotion is possible). */
  get canMoveUp(): boolean {
    return this.promote > 0 && this.tier < this.tiers.length - 1;
  }

  /** The tier above this one, or null. */
  get nextTierName(): string | null {
    return this.tier + 1 < this.tiers.length ? this.tiers[this.tier + 1]! : null;
  }
}
