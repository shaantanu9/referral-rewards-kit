import type { RewardsClient } from './client';
import { ServerClock } from './clock';
import type { RewardsController } from './controller';
import { RewardsException, RewardsReason, RewardsServerError, RewardsUnavailableException, type RewardsUnavailableReason } from './errors';
import { clamp01 } from './json';
import type { RewardGrant } from './models';
import { QuizStatus, type QuizAnswerResult, type QuizQuestion, type QuizState } from './quiz-models';
import { SnapshotStore } from './store';

/** Where a quiz screen is. */
export const QuizPhase = {
  /** Nothing loaded yet: call `open`. */
  idle: 'idle',
  /** Waiting for the server. */
  loading: 'loading',
  /** Today's quiz before an attempt: rules and Start (when `canStart`). */
  intro: 'intro',
  /** A question is shown and its countdown runs. */
  question: 'question',
  /** An answer was sent; waiting for the result. */
  answering: 'answering',
  /** Right / wrong is shown; `next` (or the auto-advance) moves on. */
  reveal: 'reveal',
  /** The attempt is over: score and rewards. */
  finished: 'finished',
  /** Rewards are not deployed, signed out, or no project (`unavailable`). */
  unavailable: 'unavailable',
  /** Offline or refused (`reason`); `retry` repeats the last step. */
  error: 'error',
} as const;
export type QuizPhase = (typeof QuizPhase)[keyof typeof QuizPhase];

/** An immutable view of a [QuizController]; a new object on every change and every countdown tick. */
export interface QuizSnapshot {
  readonly phase: QuizPhase;
  /** Today's quiz state from the server, or null before `open`. */
  readonly quiz: QuizState | null;
  /** The question being shown (also during reveal), or null. */
  readonly question: QuizQuestion | null;
  /** The result of the last answer (during reveal and finished), or null. */
  readonly lastAnswer: QuizAnswerResult | null;
  /** The choice the user picked (null for a timeout). */
  readonly picked: number | null;
  /** The refusal or failure reason in the `error` phase. */
  readonly reason: string | null;
  readonly unavailable: RewardsUnavailableReason | null;
  readonly canStart: boolean;
  /** Time left on the current question (server clock) in ms, or null. */
  readonly timeLeftMs: number | null;
  /** 1 at the start of the question, 0 when its time is up. */
  readonly timeFraction: number;
  /** The grants of the finished attempt. */
  readonly finishedGrants: readonly RewardGrant[];
  readonly version: number;
}

/**
 * Runs one daily quiz program (ADR 0002 §18.2): today → start → question with a server countdown → answer → reveal →
 * next … → finished. Resumes from the server after a restart (the same question, the same deadline).
 *
 * Nothing runs in the constructor: call [open]. Pass the app's [RewardsController] as `rewards` so grants reach it
 * and the countdown uses its synced clock. When the time runs out the answer `-1` (no answer) is sent by itself.
 * Actions resolve to null or a reason. Call [dispose] when the screen closes (stops the timers).
 */
export class QuizController extends SnapshotStore<QuizSnapshot> {
  readonly client: RewardsClient;
  readonly program: string;
  readonly rewards: RewardsController | null;
  readonly clock: ServerClock;
  /** How long right / wrong stays before the next question; null = wait for [next]. Default 2000 ms. */
  readonly revealForMs: number | null;
  /** How often listeners hear the countdown move. Default 200 ms. */
  readonly tickEveryMs: number;

  private phaseValue: QuizPhase = QuizPhase.idle;
  private quizValue: QuizState | null = null;
  private questionValue: QuizQuestion | null = null;
  private answerValue: QuizAnswerResult | null = null;
  private pickedValue: number | null = null;
  private reasonValue: string | null = null;
  private unavailableValue: RewardsUnavailableReason | null = null;
  private retryStep: (() => Promise<void>) | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private advance: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: {
    client: RewardsClient;
    program: string;
    rewards?: RewardsController | null;
    clock?: ServerClock;
    revealForMs?: number | null;
    tickEveryMs?: number;
  }) {
    super();
    this.client = opts.client;
    this.program = opts.program;
    this.rewards = opts.rewards ?? null;
    this.clock = opts.clock ?? this.rewards?.clock ?? new ServerClock();
    this.revealForMs = opts.revealForMs === undefined ? 2000 : opts.revealForMs;
    this.tickEveryMs = opts.tickEveryMs ?? 200;
  }

  protected buildSnapshot(version: number): QuizSnapshot {
    return Object.freeze({
      phase: this.phaseValue,
      quiz: this.quizValue,
      question: this.questionValue,
      lastAnswer: this.answerValue,
      picked: this.pickedValue,
      reason: this.reasonValue,
      unavailable: this.unavailableValue,
      canStart: this.canStart,
      timeLeftMs: this.timeLeftMs,
      timeFraction: this.timeFraction,
      finishedGrants: this.finishedGrants,
      version,
    });
  }

  get phase(): QuizPhase {
    return this.phaseValue;
  }
  get quiz(): QuizState | null {
    return this.quizValue;
  }
  get question(): QuizQuestion | null {
    return this.questionValue;
  }
  get lastAnswer(): QuizAnswerResult | null {
    return this.answerValue;
  }
  get picked(): number | null {
    return this.pickedValue;
  }
  get reason(): string | null {
    return this.reasonValue;
  }
  get unavailable(): RewardsUnavailableReason | null {
    return this.unavailableValue;
  }
  get canStart(): boolean {
    return this.quizValue?.canStart ?? false;
  }

  /** Time left on the current question (server clock) in ms, or null. */
  get timeLeftMs(): number | null {
    return this.clock.leftMs(this.questionValue?.endsAt);
  }

  /** 1 at the start of the question, 0 when its time is up. */
  get timeFraction(): number {
    const left = this.timeLeftMs,
      window = this.questionValue?.windowMs;
    if (left == null || window == null || window <= 0) return 0;
    return clamp01(left / window);
  }

  /** The grants of the finished attempt (from the last answer, else today's last result). */
  get finishedGrants(): readonly RewardGrant[] {
    return this.answerValue?.grants ?? this.quizValue?.lastResult?.grants ?? [];
  }

  private set(p: QuizPhase): void {
    this.phaseValue = p;
    this.notify();
  }

  private setQuiz(q: QuizState): void {
    this.quizValue = q;
    this.rewards?.applyQuiz(q);
  }

  private async run(step: () => Promise<void>): Promise<string | null> {
    this.retryStep = step;
    try {
      await step();
      this.reasonValue = null;
      return null;
    } catch (e) {
      this.stopTimers();
      if (e instanceof RewardsUnavailableException) {
        this.unavailableValue = e.reason;
        this.set(QuizPhase.unavailable);
        return 'unavailable';
      }
      const r = e instanceof RewardsException ? e.reason : e instanceof RewardsServerError ? 'server_error' : 'offline';
      this.reasonValue = r;
      this.set(QuizPhase.error);
      return r;
    }
  }

  /** Loads today's quiz. In progress → loads the current question (resume after a restart). */
  open(): Promise<string | null> {
    return this.run(async () => {
      this.set(QuizPhase.loading);
      const q = await this.client.quizToday(this.program);
      this.setQuiz(q);
      if (q.status === QuizStatus.inProgress) return this.loadQuestion();
      this.set(q.status === QuizStatus.finished ? QuizPhase.finished : QuizPhase.intro);
    });
  }

  /** Starts a new attempt and shows its first question. `no_attempts_left` reloads today's state. */
  async start(): Promise<string | null> {
    const r = await this.run(async () => {
      this.set(QuizPhase.loading);
      this.setQuiz(await this.client.quizStart(this.program));
      this.answerValue = null;
      await this.loadQuestion();
    });
    if (r === RewardsReason.noAttemptsLeft) await this.open();
    return r;
  }

  private async loadQuestion(): Promise<void> {
    this.stopTimers();
    this.set(QuizPhase.loading);
    let q: QuizQuestion;
    try {
      q = await this.client.quizQuestion(this.program);
    } catch (e) {
      // `no_attempt`: the attempt ended elsewhere; show today's state again.
      if (!(e instanceof RewardsException) || e.reason !== RewardsReason.noAttempt) throw e;
      const today = await this.client.quizToday(this.program);
      this.setQuiz(today);
      this.set(today.status === QuizStatus.finished ? QuizPhase.finished : QuizPhase.intro);
      return;
    }
    this.questionValue = q;
    this.pickedValue = null;
    this.answerValue = null;
    this.set(QuizPhase.question);
    this.ticker = setInterval(() => this.tick(), this.tickEveryMs);
    this.tick();
  }

  /** Checks the countdown; sends "no answer" once the time is up. The timer calls it; tests may too. */
  tick(): void {
    if (this.phaseValue !== QuizPhase.question || this.disposed) return;
    if (this.timeLeftMs === 0) void this.send(-1, true);
    else this.notify();
  }

  /** Answers the current question with [choice] (an index into its choices). Resolves to `not_ready` otherwise. */
  answer(choice: number): Promise<string | null> {
    if (this.phaseValue !== QuizPhase.question) return Promise.resolve('not_ready');
    return this.send(choice, false);
  }

  private send(choice: number, timedOut: boolean): Promise<string | null> {
    const q = this.questionValue!;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.pickedValue = timedOut ? null : choice;
    this.set(QuizPhase.answering);
    return this.run(async () => {
      let a = await this.client.quizAnswer(this.program, q.index, choice);
      if (timedOut && !a.timedOut) a = a.asTimedOut();
      this.answerValue = a;
      this.rewards?.applyGrants(a.grants);
      this.set(QuizPhase.reveal);
      const wait = this.revealForMs;
      if (wait != null) this.advance = setTimeout(() => void this.next(), wait);
    });
  }

  /** Leaves the reveal: the next question, or the finished result. */
  async next(): Promise<string | null> {
    if (this.phaseValue !== QuizPhase.reveal) return null;
    if (this.advance) clearTimeout(this.advance);
    this.advance = null;
    if (this.answerValue?.finished ?? false) return this.run(() => this.finish());
    return this.run(() => this.loadQuestion());
  }

  private async finish(): Promise<void> {
    this.set(QuizPhase.loading);
    this.setQuiz(await this.client.quizToday(this.program));
    this.set(QuizPhase.finished);
    // `quiz_finished` may move a streak, milestone or quest.
    if (this.rewards) void this.rewards.refresh();
  }

  /** Repeats the step that failed. */
  retry(): Promise<string | null> {
    const step = this.retryStep;
    if (step == null) return this.open();
    return this.run(step);
  }

  private stopTimers(): void {
    if (this.ticker) clearInterval(this.ticker);
    if (this.advance) clearTimeout(this.advance);
    this.ticker = null;
    this.advance = null;
  }

  override dispose(): void {
    this.stopTimers();
    super.dispose();
  }
}
