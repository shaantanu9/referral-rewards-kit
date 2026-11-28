import {
  isRewardsNotDeployed,
  RewardsException,
  RewardsFormatException,
  RewardsNetworkError,
  RewardsReason,
  rewardsReasonOf,
  RewardsServerError,
  RewardsUnavailableException,
  RewardsUnavailableReason,
} from './errors';
import { RewardsChoices } from './fair-play-models';
import {
  FollowupPlan,
  FollowupPrefs,
  formatReminderTime,
  isIterableList,
  parseMutedGroups,
  parseReminderTime,
} from './followup-models';
import { RewardsEvent, RewardsEventName, reportRewardsEvent, type RewardsEventProps, type RewardsEventSink } from './events';
import type { RewardsRpc } from './http-rpc';
import { asMap, boolOr, decodeResult, intOr, listOf } from './json';
import { LeagueState } from './league-models';
import { RewardGrant } from './models';
import { formatDay, FriendAcceptResult, FriendInvite, parseDay, RechargeState, Recap, StreakHistory } from './programs';
import { QuizAnswerResult, QuizQuestion, QuizState } from './quiz-models';
import { RewardsState, TrackResult } from './state';
import { SocialStartResult, SocialTaskState } from './tasks';

export interface RewardsClientOptions {
  /** `rewardsHttpRpc(...)`, `supabaseRewardsRpc(supabase)`, or your own `(fn, params) => json`. */
  readonly rpc: RewardsRpc;
  /**
   * The device's IANA timezone (`Asia/Kolkata`). Streak days are counted in it. Default: the runtime's
   * `Intl.DateTimeFormat().resolvedOptions().timeZone`; return null to let the server keep the last one it stored.
   */
  readonly timezone?: (() => string | null | undefined | Promise<string | null | undefined>) | null;
  readonly onEvent?: RewardsEventSink | null;
}

/** The runtime's IANA time zone, or null. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** `"<program>:<yyyy-mm-dd>"` with the device's local day of [now]. */
export const followupOpenedKey = (program: string, now: Date): string => `${program}:${formatDay(now)}`;

/** A calendar day for [RewardsClient.recap]: a Date (its local day) or `YYYY-MM-DD`. */
export type DayInput = Date | string;

/** Typed client for the user RPCs (ADR 0002 §11 and §18.3). */
export class RewardsClient {
  private readonly rpc: RewardsRpc;
  readonly timezone: () => string | null | undefined | Promise<string | null | undefined>;
  readonly onEvent: RewardsEventSink | null;
  private lastPrefs: FollowupPrefs | null = null;

  constructor(opts: RewardsClientOptions) {
    this.rpc = opts.rpc;
    this.timezone = opts.timezone === undefined ? deviceTimeZone : (opts.timezone ?? (() => null));
    this.onEvent = opts.onEvent ?? null;
  }

  report(e: RewardsEvent): void {
    reportRewardsEvent(this.onEvent, e);
  }

  private async call(fn: string, params: Record<string, unknown>): Promise<unknown> {
    try {
      return decodeResult(await this.rpc(fn, params));
    } catch (e) {
      if (
        e instanceof RewardsUnavailableException ||
        e instanceof RewardsException ||
        e instanceof RewardsServerError ||
        e instanceof RewardsNetworkError ||
        e instanceof RewardsFormatException
      ) {
        throw e;
      }
      const reason = rewardsReasonOf(e);
      if (reason === RewardsReason.notSignedIn) throw new RewardsUnavailableException(RewardsUnavailableReason.signedOut);
      if (reason != null) throw new RewardsException(reason);
      if (isRewardsNotDeployed(e)) throw new RewardsUnavailableException(RewardsUnavailableReason.notDeployed);
      throw new RewardsNetworkError(fn);
    }
  }

  /** Runs [fn] and reports [name] with `result` `ok` or the refusal reason (plus [props]). */
  private async reported<T>(name: RewardsEventName, props: RewardsEventProps, fn: () => Promise<T>): Promise<T> {
    try {
      const r = await fn();
      this.report(new RewardsEvent(name, { ...props, result: 'ok' }));
      return r;
    } catch (e) {
      if (e instanceof RewardsException) this.report(new RewardsEvent(name, { ...props, result: e.reason }));
      throw e;
    }
  }

  /** Everything the app shows (ADR 0002 §11). Also starts `first_seen` offer windows on the server. */
  async state(): Promise<RewardsState> {
    const s = RewardsState.fromJson(await this.call('rewards_state', {}));
    this.report(new RewardsEvent(RewardsEventName.stateLoaded, { programs: s.programs.length, inbox: s.inbox.length }));
    return s;
  }

  /** Records one action. [dedupeKey] makes it count once (e.g. `chapter:42`); null counts once per local day. */
  async track(type: string, opts: { dedupeKey?: string | null; props?: Record<string, unknown> } = {}): Promise<TrackResult> {
    const tz = (await this.timezone()) ?? null;
    const r = TrackResult.fromJson(
      await this.call('rewards_track', { type, dedupe_key: opts.dedupeKey ?? null, props: opts.props ?? {}, timezone: tz }),
    );
    this.report(new RewardsEvent(RewardsEventName.tracked, { type, duplicate: r.duplicate, grants: r.grants.length }));
    return r;
  }

  /** Claims a live offer. Refusals arrive as [RewardsException] (`offer_expired`, `sold_out`, …). */
  claimOffer(program: string): Promise<RewardGrant[]> {
    return this.reported(RewardsEventName.offerClaimed, { program }, async () => {
      const m = asMap(await this.call('rewards_offer_claim', { program }), 'rewards_offer_claim');
      return listOf(m['grants'], (g) => RewardGrant.fromJson(g));
    });
  }

  /** Starts (or returns the pending) Instagram task with the user's handle; returns the code for the caption. */
  startSocial(program: string, handle: string): Promise<SocialStartResult> {
    return this.reported(RewardsEventName.socialStarted, { program }, async () =>
      SocialStartResult.fromJson(asMap(await this.call('rewards_social_start', { program, handle }), 'rewards_social_start')),
    );
  }

  /** Marks granted inbox items as seen; returns how many were marked. */
  async markSeen(grantIds: readonly string[]): Promise<number> {
    if (grantIds.length === 0) return 0;
    const n = intOr(await this.call('rewards_mark_seen', { grant_ids: [...grantIds] }));
    this.report(new RewardsEvent(RewardsEventName.inboxSeen, { count: n }));
    return n;
  }

  // ---- 0.2 (ADR 0002 §18.3) ----

  /** A streak's events per local day, oldest first, [weeks] × 7 days ending today. [program] null = the first streak. */
  async history(opts: { program?: string | null; weeks?: number } = {}): Promise<StreakHistory> {
    return StreakHistory.fromJson(
      asMap(await this.call('rewards_history', { program: opts.program ?? null, weeks: opts.weeks ?? 15 }), 'rewards_history'),
    );
  }

  /** Totals between two local days, both included (dates only). */
  async recap(fromDay: DayInput, toDay: DayInput): Promise<Recap> {
    const from = formatDay(fromDay),
      to = formatDay(toDay);
    return Recap.fromJson(asMap(await this.call('rewards_recap', { from_day: from, to_day: to }), 'rewards_recap'), {
      from: parseDay(from),
      to: parseDay(to),
    });
  }

  /** Spends [units] of a recharge program. Refusal: `empty`. */
  useRecharge(program: string, units = 1): Promise<RechargeState> {
    return this.reported(RewardsEventName.rechargeUsed, { program, units }, async () =>
      RechargeState.fromJson(asMap(await this.call('rewards_recharge_use', { program, units }), 'rewards_recharge_use')),
    );
  }

  /** A code a friend can accept to start a friend streak (valid 7 days). */
  friendInvite(program: string): Promise<FriendInvite> {
    return this.reported(RewardsEventName.friendInvited, { program }, async () =>
      FriendInvite.fromJson(asMap(await this.call('rewards_friend_invite', { program }), 'rewards_friend_invite')),
    );
  }

  /** Accepts a friend's code. Refusals: `bad_code`, `own_code`, `too_many_friends`, `already_friends`. */
  friendAccept(code: string): Promise<FriendAcceptResult> {
    return this.reported(RewardsEventName.friendAccepted, {}, async () =>
      FriendAcceptResult.fromJson(
        asMap(await this.call('rewards_friend_accept', { code: code.trim().toUpperCase() }), 'rewards_friend_accept'),
      ),
    );
  }

  /** Ends a friend streak for both friends. */
  friendRemove(pairId: string): Promise<boolean> {
    return this.reported(RewardsEventName.friendRemoved, {}, async () =>
      boolOr(await this.call('rewards_friend_remove', { pair_id: pairId }), true),
    );
  }

  /** Sends the link of the user's post for a pending social task. Refusals: `bad_link`, `no_pending_post`. */
  submitSocialLink(program: string, url: string): Promise<SocialTaskState> {
    return this.reported(RewardsEventName.socialLinkSubmitted, { program }, async () =>
      SocialTaskState.fromJson(
        asMap(await this.call('rewards_social_submit_link', { program, url: url.trim() }), 'rewards_social_submit_link'),
      ),
    );
  }

  /** Today's quiz for this user. */
  async quizToday(program: string): Promise<QuizState> {
    return QuizState.fromJson(asMap(await this.call('rewards_quiz_today', { program }), 'rewards_quiz_today'));
  }

  /** Starts an attempt. Refusals: `no_attempts_left`, `not_enough_questions`. */
  quizStart(program: string): Promise<QuizState> {
    return this.reported(RewardsEventName.quizStarted, { program }, async () =>
      QuizState.fromJson(asMap(await this.call('rewards_quiz_start', { program }), 'rewards_quiz_start')),
    );
  }

  /** The current question of the attempt (the same one again until it is answered). Refusal: `no_attempt`. */
  async quizQuestion(program: string): Promise<QuizQuestion> {
    return QuizQuestion.fromJson(asMap(await this.call('rewards_quiz_question', { program }), 'rewards_quiz_question'));
  }

  /** Answers question [index] with [choice] (`-1` = no answer, sent when time ran out). */
  async quizAnswer(program: string, index: number, choice: number): Promise<QuizAnswerResult> {
    const r = QuizAnswerResult.fromJson(
      asMap(await this.call('rewards_quiz_answer', { program, index, choice }), 'rewards_quiz_answer'),
    );
    this.report(new RewardsEvent(RewardsEventName.quizAnswered, { program, index, correct: r.correct, timed_out: r.timedOut }));
    if (r.finished) {
      this.report(new RewardsEvent(RewardsEventName.quizFinished, { program, score: r.score, total: index + 1, grants: r.grants.length }));
    }
    return r;
  }

  // ---- 0.4 (ADR 0002 §18.7) ----

  /** The notifications planned for the next [days] days, sorted by time. */
  async followupsPlan(days = 14): Promise<FollowupPlan> {
    return FollowupPlan.fromJson(asMap(await this.call('rewards_followups_plan', { days }), 'rewards_followups_plan'));
  }

  /**
   * Reads the user's follow-up choices, or saves [patch] first and returns the result. Keys: `notifications_off`,
   * `emails_off`, `reminder_time` ({hour, minute} or "HH:MM"; sent as "HH:MM", null clears it), `muted_groups` (a
   * list; left out when it is not one), `streaks_off`, `surprises_off`, `timers_off`. Other keys are not sent.
   * Reports `rewards_followup_prefs_changed` once per saved key. The result is kept as [lastFollowupPrefs].
   */
  followupPrefs(patch: Readonly<Record<string, unknown>> = {}): Promise<FollowupPrefs> {
    return this.savePrefs(patch, {});
  }

  private async savePrefs(patch: Readonly<Record<string, unknown>>, extra: RewardsEventProps): Promise<FollowupPrefs> {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!FollowupPrefs.keys.has(k)) continue;
      if (k === FollowupPrefs.mutedGroupsKey && !isIterableList(v)) continue;
      if (k === FollowupPrefs.reminderTimeKey) body[k] = v == null ? null : (formatReminderTime(parseReminderTime(v)) ?? v);
      else if (k === FollowupPrefs.mutedGroupsKey) body[k] = [...parseMutedGroups(v)];
      else if (RewardsChoices.keys.has(k)) body[k] = boolOr(v);
      else body[k] = v;
    }
    const p = FollowupPrefs.fromJson(asMap(await this.call('rewards_followup_prefs', { patch: body }), 'rewards_followup_prefs'));
    this.lastPrefs = p;
    for (const k of Object.keys(body)) {
      this.report(new RewardsEvent(RewardsEventName.followupPrefsChanged, { field: k, ...(k === FollowupPrefs.mutedGroupsKey ? extra : {}) }));
    }
    return p;
  }

  /** What the server returned on the last [followupPrefs] call, or null before the first. */
  get lastFollowupPrefs(): FollowupPrefs | null {
    return this.lastPrefs;
  }

  /** Mutes or unmutes the follow-up notifications of [group] (0.5), from [lastFollowupPrefs] (read first if none). */
  async setFollowupGroupMuted(group: string, muted: boolean): Promise<FollowupPrefs> {
    const current = this.lastPrefs ?? (await this.followupPrefs());
    return this.savePrefs(current.groupMutedPatch(group, muted), { group });
  }

  /** Records that a follow-up notification of [program] was opened: `followup_opened`, once per program and local day. */
  async trackFollowupOpened(program: string, now: Date = new Date()): Promise<TrackResult> {
    const r = await this.track('followup_opened', { dedupeKey: followupOpenedKey(program, now), props: { program } });
    this.report(new RewardsEvent(RewardsEventName.followupOpened, { program }));
    return r;
  }

  // ---- 0.6 (ADR 0002 §18.10) ----

  /** This week's league for the user. Also closes an ended week on the server, so last week's result is never late. */
  async league(program: string): Promise<LeagueState> {
    return LeagueState.fromJson(asMap(await this.call('rewards_league', { program }), 'rewards_league'));
  }

  /** Opts in (the user's own tap) and returns the league with this week's board. */
  joinLeague(program: string): Promise<LeagueState> {
    return this.reported(RewardsEventName.leagueJoined, { program }, async () =>
      LeagueState.fromJson(asMap(await this.call('rewards_league_join', { program }), 'rewards_league_join')),
    );
  }

  /** Leaves at once: off this week's board; the tier is kept for a later join. */
  leaveLeague(program: string): Promise<LeagueState> {
    return this.reported(RewardsEventName.leagueLeft, { program }, async () =>
      LeagueState.fromJson(asMap(await this.call('rewards_league_leave', { program }), 'rewards_league_leave')),
    );
  }
}
