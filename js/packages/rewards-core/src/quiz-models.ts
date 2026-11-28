/**
 * Daily quiz shapes (ADR 0002 §18.2 `quiz`, §18.3 `rewards_quiz_*`). The server never sends an answer before it is
 * given; every deadline is a server time.
 */
import { asList, boolOr, intOr, isMap, listOf, optInt, optMap, optStr, str, time, type JsonMap } from './json';
import { enumFromWire, RewardGrant } from './models';

/** Today's quiz for this user. `unknown` covers a state a newer server adds. */
export const QuizStatus = {
  notStarted: 'not_started',
  inProgress: 'in_progress',
  finished: 'finished',
  unknown: 'unknown',
} as const;
export type QuizStatus = (typeof QuizStatus)[keyof typeof QuizStatus];
export const quizStatusFromWire = (v: unknown): QuizStatus => enumFromWire(QuizStatus, v, QuizStatus.unknown);

/**
 * How a question is answered. Every kind is answered by picking one of `choices` by index; the kind only changes the
 * look. `unknown` (a kind a newer server adds) is shown as a plain choice list.
 */
export const QuizQuestionKind = {
  choice: 'choice',
  trueFalse: 'true_false',
  oddOneOut: 'odd_one_out',
  listen: 'listen',
  picture: 'picture',
  unknown: 'unknown',
} as const;
export type QuizQuestionKind = (typeof QuizQuestionKind)[keyof typeof QuizQuestionKind];
export function quizQuestionKindFromWire(v: unknown): QuizQuestionKind {
  if (v === 'multiple_choice' || v === 'mcq') return QuizQuestionKind.choice;
  return enumFromWire(QuizQuestionKind, v, QuizQuestionKind.unknown);
}

/** The score of a finished attempt and what it paid. */
export class QuizResult {
  constructor(
    readonly score: number = 0,
    readonly total: number = 0,
    readonly grants: readonly RewardGrant[] = [],
  ) {}
  static fromJson(m: JsonMap): QuizResult {
    return new QuizResult(intOr(m['score']), intOr(m['total']), listOf(m['grants'], (g) => RewardGrant.fromJson(g)));
  }
}

/** Today's quiz state. [endsAt] is when today's quiz closes; [current] is the index of the question being answered. */
export class QuizState {
  readonly program: string;
  readonly status: QuizStatus;
  /** The local day (`2026-11-14`) as sent. */
  readonly day: string | null;
  readonly endsAt: Date | null;
  readonly total: number;
  readonly current: number;
  readonly score: number;
  readonly attemptsLeft: number;
  /** The last finished attempt today, or null. */
  readonly lastResult: QuizResult | null;

  constructor(init: {
    program: string;
    status?: QuizStatus;
    day?: string | null;
    endsAt?: Date | null;
    total?: number;
    current?: number;
    score?: number;
    attemptsLeft?: number;
    lastResult?: QuizResult | null;
  }) {
    this.program = init.program;
    this.status = init.status ?? QuizStatus.notStarted;
    this.day = init.day ?? null;
    this.endsAt = init.endsAt ?? null;
    this.total = init.total ?? 0;
    this.current = init.current ?? 0;
    this.score = init.score ?? 0;
    this.attemptsLeft = init.attemptsLeft ?? 0;
    this.lastResult = init.lastResult ?? null;
  }

  static fromJson(m: JsonMap): QuizState {
    return new QuizState({
      program: str(m['program']),
      status: quizStatusFromWire(m['state'] ?? 'not_started'),
      day: optStr(m['day']),
      endsAt: time(m['ends_at']),
      total: intOr(m['total']),
      current: intOr(m['current']),
      score: intOr(m['score']),
      attemptsLeft: intOr(m['attempts_left']),
      lastResult: isMap(m['last_result']) ? QuizResult.fromJson(m['last_result']) : null,
    });
  }

  /** A new attempt can start now. */
  get canStart(): boolean {
    return this.status !== QuizStatus.inProgress && this.attemptsLeft > 0;
  }
}

/**
 * A served question. [endsAt] is the server deadline; the server grants a few seconds of grace for the network, so
 * the countdown is exact and never generous.
 */
export class QuizQuestion {
  /** 0-based position in the attempt. */
  readonly index: number;
  readonly total: number;
  readonly id: string;
  readonly kind: QuizQuestionKind;
  readonly kindWire: string;
  readonly prompt: string;
  /** The options, answered by index. A `true_false` question with no choices is answered 0 = true, 1 = false. */
  readonly choices: readonly string[];
  /** Kind-specific extras: [soundId] for `listen`, [imageUrl] for `picture`. */
  readonly media: JsonMap;
  /** `time_limit_s` in milliseconds, or null. */
  readonly timeLimitMs: number | null;
  readonly servedAt: Date | null;
  readonly endsAt: Date | null;

  constructor(init: {
    index: number;
    total: number;
    id: string;
    kind?: QuizQuestionKind;
    kindWire?: string;
    prompt?: string;
    choices?: readonly string[];
    media?: JsonMap;
    timeLimitMs?: number | null;
    servedAt?: Date | null;
    endsAt?: Date | null;
  }) {
    this.index = init.index;
    this.total = init.total;
    this.id = init.id;
    this.kind = init.kind ?? QuizQuestionKind.choice;
    this.kindWire = init.kindWire ?? 'choice';
    this.prompt = init.prompt ?? '';
    this.choices = init.choices ?? [];
    this.media = init.media ?? {};
    this.timeLimitMs = init.timeLimitMs ?? null;
    this.servedAt = init.servedAt ?? null;
    this.endsAt = init.endsAt ?? null;
  }

  static fromJson(m: JsonMap): QuizQuestion {
    const q = optMap(m['question']);
    const limit = optInt(m['time_limit_s']);
    return new QuizQuestion({
      index: intOr(m['index']),
      total: intOr(m['total']),
      id: str(q['id']),
      kind: quizQuestionKindFromWire(q['kind']),
      kindWire: str(q['kind']),
      prompt: str(q['prompt']),
      choices: asList(q['choices'], 'choices').map((c) => str(c)),
      media: optMap(q['media']),
      timeLimitMs: limit == null ? null : limit * 1000,
      servedAt: time(m['served_at']),
      endsAt: time(m['ends_at']),
    });
  }

  /** `media.sound_id` (or `sound`): handed to the app's `onPlaySound`. */
  get soundId(): string | null {
    return optStr(this.media['sound_id'] ?? this.media['sound']);
  }

  /** `media.image_url` (or `image`, `url`). */
  get imageUrl(): string | null {
    return optStr(this.media['image_url'] ?? this.media['image'] ?? this.media['url']);
  }

  /** The whole time allowed in ms, from [timeLimitMs] or `ends_at - served_at`. */
  get windowMs(): number | null {
    if (this.timeLimitMs != null) return this.timeLimitMs;
    const s = this.servedAt,
      e = this.endsAt;
    return s == null || e == null ? null : e.getTime() - s.getTime();
  }
}

/** `rewards_quiz_answer`: [answer] is the index of the right choice (sent only after answering). */
export class QuizAnswerResult {
  readonly correct: boolean;
  readonly answer: number | null;
  readonly explanation: string | null;
  readonly timedOut: boolean;
  /** The score so far in this attempt. */
  readonly score: number;
  /** This was the last question. */
  readonly finished: boolean;
  /** Rewards paid on finish (only the highest tier reached). */
  readonly grants: readonly RewardGrant[];

  constructor(init: { correct?: boolean; answer?: number | null; explanation?: string | null; timedOut?: boolean; score?: number; finished?: boolean; grants?: readonly RewardGrant[] } = {}) {
    this.correct = init.correct ?? false;
    this.answer = init.answer ?? null;
    this.explanation = init.explanation ?? null;
    this.timedOut = init.timedOut ?? false;
    this.score = init.score ?? 0;
    this.finished = init.finished ?? false;
    this.grants = init.grants ?? [];
  }

  static fromJson(m: JsonMap): QuizAnswerResult {
    const ex = m['explanation'];
    return new QuizAnswerResult({
      correct: boolOr(m['correct']),
      answer: optInt(m['answer']),
      explanation: typeof ex === 'string' && ex !== '' ? ex : null,
      timedOut: boolOr(m['timed_out']),
      score: intOr(m['score']),
      finished: boolOr(m['finished']),
      grants: listOf(m['grants'], (g) => RewardGrant.fromJson(g)),
    });
  }

  asTimedOut(): QuizAnswerResult {
    return new QuizAnswerResult({ ...this, correct: false, timedOut: true });
  }
}
