import type { RewardsClient, DayInput } from './client';
import { ServerClock } from './clock';
import { RewardsException, RewardsReason, RewardsServerError, RewardsUnavailableException, type RewardsUnavailableReason } from './errors';
import { RewardsEvent, RewardsEventName } from './events';
import type { RewardsChoices } from './fair-play-models';
import type { LeagueState } from './league-models';
import { GrantState, type RewardGrant } from './models';
import { formatDay, RechargeState, type FriendInvite, type Recap, type StreakHistory } from './programs';
import type { StreakState } from './progress-models';
import type { QuizState } from './quiz-models';
import { mergeBy, RewardsState, type TrackResult } from './state';
import { SnapshotStore, Emitter } from './store';
import { OfferStatus, SocialTaskStatus, type SocialTaskState } from './tasks';

/** An immutable view of a [RewardsController]: replaced (a new object) on every change, the same object otherwise. */
export interface RewardsSnapshot {
  readonly state: RewardsState;
  /** True once a refresh succeeded. */
  readonly loaded: boolean;
  readonly loading: boolean;
  /** The last failure that was not "unavailable" (offline, server error), or null. */
  readonly error: unknown;
  /** Why rewards cannot be used (not deployed, signed out, no project), or null. Widgets hide while set. */
  readonly unavailable: RewardsUnavailableReason | null;
  /** True when the widgets should show something: loaded, available and enabled. */
  readonly visible: boolean;
  /** Histories loaded by `loadHistory`, by program (`''` = the first streak). */
  readonly histories: Readonly<Record<string, StreakHistory>>;
  /** Recaps loaded by `loadRecap`, by `recapKey(from, to)`. */
  readonly recaps: Readonly<Record<string, Recap>>;
  /** Leagues loaded by `loadLeague` / `joinLeague` / `leaveLeague`, by program. */
  readonly leagues: Readonly<Record<string, LeagueState>>;
  /** Invite codes made by `friendInvite` in this session, by program. */
  readonly invites: Readonly<Record<string, FriendInvite>>;
  /** Increases on every change. */
  readonly version: number;
}

/** The key of a recap in [RewardsSnapshot.recaps]: `YYYY-MM-DD..YYYY-MM-DD`. */
export const recapKey = (from: DayInput, to: DayInput): string => `${formatDay(from)}..${formatDay(to)}`;

/**
 * Holds the last [RewardsState] for the widgets, the server clock, and the grants as they land (port of the Dart
 * `RewardsController`, a ChangeNotifier). Subscribe with [subscribe] / [getSnapshot] (`useSyncExternalStore`).
 *
 * Nothing runs in the constructor: call [refresh]. Action methods resolve to null on success, or a short reason
 * (`offer_expired`, `sold_out`, `offline`, `unavailable`, `server_error`, …) so a widget can show the right line
 * without try/catch.
 */
export class RewardsController extends SnapshotStore<RewardsSnapshot> {
  readonly client: RewardsClient;
  readonly clock: ServerClock;

  private stateValue: RewardsState = RewardsState.empty;
  private loadedValue = false;
  private loadingValue = false;
  private errorValue: unknown = null;
  private unavailableValue: RewardsUnavailableReason | null = null;
  private inFlight: Promise<void> | null = null;
  private readonly emitted = new Set<string>();
  private readonly grants = new Emitter<RewardGrant>();
  private readonly moments = new Emitter<void>();
  private histories: Record<string, StreakHistory> = {};
  private recaps: Record<string, Recap> = {};
  private invites: Record<string, FriendInvite> = {};
  private leagues: Record<string, LeagueState> = {};

  constructor(opts: { client: RewardsClient; clock?: ServerClock }) {
    super();
    this.client = opts.client;
    this.clock = opts.clock ?? new ServerClock();
  }

  protected buildSnapshot(version: number): RewardsSnapshot {
    return Object.freeze({
      state: this.stateValue,
      loaded: this.loadedValue,
      loading: this.loadingValue,
      error: this.errorValue,
      unavailable: this.unavailableValue,
      visible: this.visible,
      histories: Object.freeze({ ...this.histories }),
      recaps: Object.freeze({ ...this.recaps }),
      leagues: Object.freeze({ ...this.leagues }),
      invites: Object.freeze({ ...this.invites }),
      version,
    });
  }

  get state(): RewardsState {
    return this.stateValue;
  }
  get loaded(): boolean {
    return this.loadedValue;
  }
  get loading(): boolean {
    return this.loadingValue;
  }
  get error(): unknown {
    return this.errorValue;
  }
  get unavailable(): RewardsUnavailableReason | null {
    return this.unavailableValue;
  }
  /** True when the widgets should show something. */
  get visible(): boolean {
    return this.loadedValue && this.unavailableValue == null && this.stateValue.enabled;
  }

  /** Each granted reward once per controller: what landed from tracking, claiming, or while the app was closed. */
  onGrant(listener: (grant: RewardGrant) => void): () => void {
    return this.grants.on(listener);
  }

  /** Fires on [celebrateNow]: a reward toast that holds grants back shows them now. */
  onMoment(listener: () => void): () => void {
    return this.moments.on(listener);
  }

  /** Tells listeners that now is a good moment to celebrate (a chapter ended, a lesson closed). */
  celebrateNow(): void {
    this.moments.emit(undefined);
  }

  /** Applies the user's streak / surprise / timer [choices] (0.7) at once, then reloads. Nothing when unchanged. */
  async applyChoices(choices: RewardsChoices): Promise<void> {
    if (this.stateValue.choices.equals(choices)) return;
    this.stateValue = this.stateValue.copyWith({ choices });
    this.notify();
    if (this.loadedValue) await this.refresh();
  }

  /** The last history loaded by [loadHistory] for [program] (null = the first streak), or null. */
  history(program?: string | null): StreakHistory | null {
    return this.histories[program ?? ''] ?? null;
  }

  /** The last recap loaded by [loadRecap] for exactly these days, or null. */
  recap(fromDay: DayInput, toDay: DayInput): Recap | null {
    return this.recaps[recapKey(fromDay, toDay)] ?? null;
  }

  /** The last league loaded for [program], or null. */
  league(program: string): LeagueState | null {
    return this.leagues[program] ?? null;
  }

  /** The last invite code made by [friendInvite] for [program] in this session, or null. */
  invite(program: string): FriendInvite | null {
    return this.invites[program] ?? null;
  }

  private emitGrants(grants: readonly RewardGrant[]): void {
    for (const g of grants) {
      if (g.state !== GrantState.granted || this.emitted.has(g.id)) continue;
      this.emitted.add(g.id);
      this.client.report(
        new RewardsEvent(RewardsEventName.grantReceived, { program: g.program, kind: g.kind, amount: g.amount, state: g.state }),
      );
      this.grants.emit(g);
    }
  }

  private fail(e: unknown): string {
    if (e instanceof RewardsUnavailableException) {
      this.unavailableValue = e.reason;
      this.client.report(new RewardsEvent(RewardsEventName.unavailable, { reason: e.reason }));
      return 'unavailable';
    }
    if (e instanceof RewardsException) return e.reason;
    this.errorValue = e;
    return e instanceof RewardsServerError ? 'server_error' : 'offline';
  }

  /** Loads the state. Calls made while one is running share it. Never rejects. */
  refresh(): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = this.doRefresh().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async doRefresh(): Promise<void> {
    this.loadingValue = true;
    this.notify();
    try {
      const s = await this.client.state();
      this.clock.sync(s.serverTime);
      this.stateValue = s;
      this.loadedValue = true;
      this.errorValue = null;
      this.unavailableValue = null;
      if (!s.enabled) this.client.report(new RewardsEvent(RewardsEventName.unavailable, { reason: 'disabled' }));
      this.emitGrants(s.inbox);
    } catch (e) {
      this.fail(e);
    } finally {
      this.loadingValue = false;
      this.notify();
    }
  }

  /**
   * Tracks one action and merges what changed. Refreshes afterwards when something else may have moved (a grant, a
   * milestone count, an offer that starts on an event). Resolves to null or a reason.
   */
  async track(type: string, opts: { dedupeKey?: string | null; props?: Record<string, unknown> } = {}): Promise<string | null> {
    let r: TrackResult;
    try {
      r = await this.client.track(type, opts);
    } catch (e) {
      const reason = this.fail(e);
      this.notify();
      return reason;
    }
    if (r.duplicate || !r.enabled) return null;
    this.stateValue = this.stateValue.copyWith({
      streaks: mergeBy(this.stateValue.streaks, r.streaks, (s) => s.program),
      milestones: mergeBy(this.stateValue.milestones, r.milestones, (m) => m.program),
      quests: mergeBy(this.stateValue.quests, r.quests, (q) => q.program),
    });
    this.updateHistories(r.streaks);
    this.applyGrants(r.grants, { notify: false });
    this.notify();
    const s = this.stateValue;
    const mayHaveMoved =
      r.grants.length > 0 ||
      s.milestones.length > 0 ||
      s.quests.length > 0 ||
      s.friends.length > 0 ||
      s.offers.some((o) => o.status === OfferStatus.notStarted);
    if (mayHaveMoved) await this.refresh();
    return null;
  }

  /** Claims an offer. On a refusal the offer's state is corrected locally (expired, sold out, claimed). */
  async claimOffer(program: string): Promise<string | null> {
    try {
      const grants = await this.client.claimOffer(program);
      this.setOffer(program, OfferStatus.claimed);
      this.applyGrants(grants);
      return null;
    } catch (e) {
      const reason = this.fail(e);
      const fixed =
        reason === RewardsReason.offerExpired
          ? OfferStatus.expired
          : reason === RewardsReason.soldOut
            ? OfferStatus.soldOut
            : reason === RewardsReason.offerClaimed
              ? OfferStatus.claimed
              : null;
      if (fixed != null) this.setOffer(program, fixed);
      this.notify();
      return reason;
    }
  }

  private setOffer(program: string, status: OfferStatus): void {
    this.stateValue = this.stateValue.copyWith({
      offers: this.stateValue.offers.map((o) => (o.program === program ? o.copyWith({ status }) : o)),
    });
  }

  /** Starts the Instagram task with [handle]; the task becomes pending with its code. */
  async startSocial(program: string, handle: string): Promise<string | null> {
    try {
      const r = await this.client.startSocial(program, handle);
      this.stateValue = this.stateValue.copyWith({
        social: this.stateValue.social.map((s) =>
          s.program === program
            ? s.copyWith({ status: SocialTaskStatus.pending, code: r.code, expiresAt: r.expiresAt, account: r.account === '' ? null : r.account })
            : s,
        ),
      });
      this.notify();
      return null;
    } catch (e) {
      const reason = this.fail(e);
      this.notify();
      return reason;
    }
  }

  /** Marks granted inbox items seen and removes them; pending ones stay until they land. */
  async markSeen(grantIds: readonly string[]): Promise<string | null> {
    const ids = this.stateValue.inbox.filter((g) => grantIds.includes(g.id) && g.state === GrantState.granted).map((g) => g.id);
    if (ids.length === 0) return null;
    try {
      await this.client.markSeen(ids);
      this.stateValue = this.stateValue.copyWith({ inbox: this.stateValue.inbox.filter((g) => !ids.includes(g.id)) });
      this.notify();
      return null;
    } catch (e) {
      const reason = this.fail(e);
      this.notify();
      return reason;
    }
  }

  // ---- 0.2 (ADR 0002 §18) ----

  /** Adds grants that reached the app outside [track] / [claimOffer] to the inbox and [onGrant], each once. */
  applyGrants(grants: readonly RewardGrant[], opts: { notify?: boolean } = {}): void {
    if (grants.length === 0) return;
    const inbox = this.stateValue.inbox;
    this.stateValue = this.stateValue.copyWith({ inbox: [...grants.filter((g) => !inbox.some((i) => i.id === g.id)), ...inbox] });
    this.emitGrants(grants);
    if (opts.notify ?? true) this.notify();
  }

  /** Puts a quiz state from the server into the state's quizzes (used by `QuizController`). */
  applyQuiz(quiz: QuizState): void {
    this.stateValue = this.stateValue.copyWith({ quizzes: mergeBy(this.stateValue.quizzes, [quiz], (q) => q.program) });
    this.notify();
  }

  private updateHistories(changed: readonly StreakState[]): void {
    if (changed.length === 0) return;
    const next = { ...this.histories };
    for (const s of changed) {
      const h = next[s.program];
      if (h) next[s.program] = h.withTodayCount(s.todayCount);
      const first = next[''];
      if (first && first.program === s.program) next[''] = first.withTodayCount(s.todayCount);
    }
    this.histories = next;
  }

  /** Runs one server call, applies its answer, notifies; resolves to null or the reason. */
  private async act<T>(call: () => Promise<T>, apply: (value: T) => void): Promise<string | null> {
    try {
      apply(await call());
      this.notify();
      return null;
    } catch (e) {
      const reason = this.fail(e);
      this.notify();
      return reason;
    }
  }

  /** Loads a streak's day-by-day history for the heatmap; read it with [history]. */
  loadHistory(opts: { program?: string | null; weeks?: number } = {}): Promise<string | null> {
    return this.act(
      () => this.client.history(opts),
      (h) => {
        const next = { ...this.histories, [opts.program ?? '']: h };
        if (opts.program == null && h.program !== '') next[h.program] = h;
        this.histories = next;
      },
    );
  }

  /** Loads totals between two local days; read it with [recap]. */
  loadRecap(fromDay: DayInput, toDay: DayInput): Promise<string | null> {
    return this.act(
      () => this.client.recap(fromDay, toDay),
      (r) => {
        this.recaps = { ...this.recaps, [recapKey(fromDay, toDay)]: r };
      },
    );
  }

  /** Spends recharge units ("use a heart"). Refusal: `empty` (the meter is corrected to 0). */
  async useRecharge(program: string, units = 1): Promise<string | null> {
    const r = await this.act(
      () => this.client.useRecharge(program, units),
      (n) => {
        const old = this.stateValue.recharge(program);
        this.setRecharge(old == null ? n : old.mergedWith(n));
      },
    );
    if (r === RewardsReason.empty) {
      const old = this.stateValue.recharge(program);
      if (old) {
        this.setRecharge(old.mergedWith(new RechargeState({ program, max: old.max, nextAt: old.nextAt })));
        this.notify();
      }
    }
    return r;
  }

  private setRecharge(r: RechargeState): void {
    this.stateValue = this.stateValue.copyWith({ recharges: mergeBy(this.stateValue.recharges, [r], (x) => x.program) });
  }

  /** Makes an invite code for a friend streak; read it with [invite] and hand it to the app's share sheet. */
  friendInvite(program: string): Promise<string | null> {
    return this.act(
      () => this.client.friendInvite(program),
      (i) => {
        this.invites = { ...this.invites, [program]: i };
      },
    );
  }

  /** Accepts a friend's code, then reloads so the new friend streak shows. */
  async friendAccept(code: string): Promise<string | null> {
    const r = await this.act(() => this.client.friendAccept(code), () => {});
    if (r == null) await this.refresh();
    return r;
  }

  /** Ends a friend streak: removed at once, then reloaded. */
  async friendRemove(pairId: string): Promise<string | null> {
    const r = await this.act(
      () => this.client.friendRemove(pairId),
      () => {
        this.stateValue = this.stateValue.copyWith({ friends: this.stateValue.friends.filter((f) => f.pairId !== pairId) });
      },
    );
    if (r == null) await this.refresh();
    return r;
  }

  /** Sends the link of the user's post for a pending social task. The task gets its `post_url`. */
  submitSocialLink(program: string, url: string): Promise<string | null> {
    return this.act(
      () => this.client.submitSocialLink(program, url),
      (t: SocialTaskState) => {
        const old = this.stateValue.socialTask(program);
        const merged =
          old == null
            ? t
            : old.copyWith({
                status: t.status === SocialTaskStatus.unknown ? null : t.status,
                postUrl: t.postUrl ?? url.trim(),
                code: t.code,
                expiresAt: t.expiresAt,
              });
        this.stateValue = this.stateValue.copyWith({ social: mergeBy(this.stateValue.social, [merged], (s) => s.program) });
      },
    );
  }

  /** Reloads today's quiz state into the state's quizzes. */
  quizToday(program: string): Promise<string | null> {
    return this.act(
      () => this.client.quizToday(program),
      (q) => {
        this.stateValue = this.stateValue.copyWith({ quizzes: mergeBy(this.stateValue.quizzes, [q], (x) => x.program) });
      },
    );
  }

  // ---- 0.4 (ADR 0002 §18.7) ----

  /** Call when the user opened a follow-up notification of [program]: tracks `followup_opened`, then reloads. */
  async followupOpened(program: string, now?: Date): Promise<string | null> {
    const r = await this.act(() => this.client.trackFollowupOpened(program, now), () => {});
    if (r == null) await this.refresh();
    return r;
  }

  // ---- 0.6 (ADR 0002 §18.10) ----

  private setLeague(l: LeagueState): void {
    this.clock.sync(l.serverTime);
    this.leagues = { ...this.leagues, [l.program]: l };
  }

  /** Loads this week's league; a newly closed week with rewards reloads the state so they reach the inbox. */
  async loadLeague(program: string): Promise<string | null> {
    const before = this.leagues[program]?.lastWeek?.week?.getTime();
    const r = await this.act(() => this.client.league(program), (l) => this.setLeague(l));
    const after = this.leagues[program]?.lastWeek;
    if (r == null && this.loadedValue && after != null && after.grants.length > 0 && after.week?.getTime() !== before) {
      await this.refresh();
    }
    return r;
  }

  /** Joins the league (opt-in) and loads its board. Refusals: `unknown_program`, `disabled`. */
  joinLeague(program: string): Promise<string | null> {
    return this.act(() => this.client.joinLeague(program), (l) => this.setLeague(l));
  }

  /** Leaves the league at once; the board empties for this user. */
  leaveLeague(program: string): Promise<string | null> {
    return this.act(() => this.client.leaveLeague(program), (l) => this.setLeague(l));
  }

  override dispose(): void {
    super.dispose();
    this.grants.close();
    this.moments.close();
  }
}
