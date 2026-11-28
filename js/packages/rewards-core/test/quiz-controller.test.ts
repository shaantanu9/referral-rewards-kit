// Port of packages/rewards_kit/test/quiz_controller_test.dart.
import { expect, it } from 'vitest';
import { QuizController, QuizPhase, QuizQuestionKind, QuizStatus } from '../src';
import { controllerOn, FakeRpc, grant, plus, questionJson, quizStateJson, sampleStateV2, serverNow, tick } from './fakes';

/** A three-question fake server; the right answer is always choice 1. */
class QuizServer {
  state: string;
  attemptsLeft: number;
  current: number;
  score = 0;
  servedAt: Date | null;
  readonly answers: Array<[number, number]> = [];
  readonly clock: () => Date;

  constructor(o: { state?: string; attemptsLeft?: number; current?: number; servedAt?: Date | null; clock?: () => Date } = {}) {
    this.state = o.state ?? 'not_started';
    this.attemptsLeft = o.attemptsLeft ?? 1;
    this.current = o.current ?? 0;
    this.servedAt = o.servedAt ?? null;
    this.clock = o.clock ?? (() => serverNow);
  }

  rpc(): FakeRpc {
    return new FakeRpc({
      rewards_state: () => sampleStateV2(),
      rewards_quiz_today: () =>
        quizStateJson({
          state: this.state,
          attemptsLeft: this.attemptsLeft,
          current: this.current,
          score: this.score,
          lastResult: this.state === 'finished' ? { score: this.score, total: 3, grants: [grant('quiz-win', { amount: 30 })] } : null,
        }),
      rewards_quiz_start: () => {
        if (this.attemptsLeft === 0) throw new Error('rewards: no_attempts_left');
        this.attemptsLeft--;
        this.state = 'in_progress';
        this.current = 0;
        this.score = 0;
        this.servedAt = null;
        return quizStateJson({ state: this.state, attemptsLeft: this.attemptsLeft });
      },
      rewards_quiz_question: () => {
        if (this.state !== 'in_progress') throw new Error('rewards: no_attempt');
        this.servedAt ??= this.clock();
        return questionJson(this.current, { kind: this.current === 1 ? 'true_false' : 'choice', servedAt: this.servedAt });
      },
      rewards_quiz_answer: (p) => {
        const index = p['index'] as number,
          choice = p['choice'] as number;
        this.answers.push([index, choice]);
        const correct = choice === 1;
        if (correct) this.score++;
        this.current++;
        this.servedAt = null;
        const finished = this.current >= 3;
        if (finished) this.state = 'finished';
        return {
          correct,
          answer: 1,
          explanation: 'Because.',
          timed_out: choice === -1,
          score: this.score,
          finished,
          grants: finished ? [grant('quiz-win', { amount: 30 })] : [],
        };
      },
    });
  }
}

const SLOW = 1e9; // the tests call tick() themselves

it('full flow: open → start → answer ×3 (one timeout) → finished; grants reach the rewards controller', async () => {
  let now = serverNow;
  const server = new QuizServer({ clock: () => now });
  const rpc = server.rpc();
  const rewards = controllerOn(rpc, { local: () => now });
  await rewards.refresh();
  const got: string[] = [];
  rewards.onGrant((g) => got.push(g.id));
  const quiz = new QuizController({ client: rewards.client, program: 'quiz', rewards, revealForMs: null, tickEveryMs: SLOW });
  expect(rpc.called('rewards_quiz_today')).toHaveLength(0);

  expect(await quiz.open()).toBeNull();
  expect(quiz.phase).toBe(QuizPhase.intro);
  expect(quiz.canStart).toBe(true);

  expect(await quiz.start()).toBeNull();
  expect(quiz.phase).toBe(QuizPhase.question);
  expect(quiz.question!.index).toBe(0);
  expect(quiz.timeLeftMs).toBe(10000);
  expect(quiz.timeFraction).toBe(1);
  expect(rewards.state.quiz('quiz')!.status).toBe(QuizStatus.inProgress);

  expect(await quiz.answer(1)).toBeNull();
  expect(quiz.phase).toBe(QuizPhase.reveal);
  expect(quiz.lastAnswer!.correct).toBe(true);
  expect(quiz.picked).toBe(1);
  expect(await quiz.answer(0)).toBe('not_ready');
  await quiz.next();
  expect(quiz.question!.kind).toBe(QuizQuestionKind.trueFalse);

  now = plus(now, 4000);
  quiz.tick();
  expect(quiz.timeFraction).toBeCloseTo(0.6, 9);
  expect(quiz.getSnapshot().timeLeftMs).toBe(6000);
  now = plus(now, 7000);
  quiz.tick();
  await tick();
  expect(server.answers.at(-1)).toEqual([1, -1]);
  expect(quiz.phase).toBe(QuizPhase.reveal);
  expect(quiz.lastAnswer!.timedOut).toBe(true);
  expect(quiz.picked).toBeNull();

  await quiz.next();
  await quiz.answer(1);
  expect(quiz.lastAnswer!.finished).toBe(true);
  await quiz.next();
  expect(quiz.phase).toBe(QuizPhase.finished);
  expect(quiz.quiz!.lastResult!.score).toBe(2);
  expect(quiz.finishedGrants[0]!.id).toBe('quiz-win');
  expect(got).toContain('quiz-win');
  expect(rewards.state.quiz('quiz')!.status).not.toBe(QuizStatus.inProgress);
  quiz.dispose();
});

it('resume after restart: same question, same deadline; an expired one times out at once', async () => {
  let now = plus(serverNow, 6000);
  const server = new QuizServer({ state: 'in_progress', current: 1, servedAt: serverNow });
  const rewards = controllerOn(server.rpc(), { local: () => now });
  const quiz = new QuizController({ client: rewards.client, program: 'quiz', rewards, revealForMs: null, tickEveryMs: SLOW });
  await quiz.open();
  expect(quiz.phase).toBe(QuizPhase.question);
  expect(quiz.question!.index).toBe(1);
  expect(quiz.timeLeftMs).toBe(4000);
  quiz.dispose();

  now = plus(serverNow, 30000);
  const again = new QuizController({ client: rewards.client, program: 'quiz', rewards, revealForMs: null, tickEveryMs: SLOW });
  await again.open();
  await tick();
  expect(server.answers).toEqual([[1, -1]]);
  expect(again.lastAnswer!.timedOut).toBe(true);
  again.dispose();
});

it('finished today, no attempts left: finished phase, start refused then reloaded', async () => {
  const server = new QuizServer({ state: 'finished', attemptsLeft: 0 });
  const quiz = new QuizController({ client: controllerOn(server.rpc()).client, program: 'quiz', tickEveryMs: SLOW });
  await quiz.open();
  expect(quiz.phase).toBe(QuizPhase.finished);
  expect(quiz.canStart).toBe(false);
  expect(await quiz.start()).toBe('no_attempts_left');
  expect(quiz.phase).toBe(QuizPhase.finished);
  quiz.dispose();
});

it('no_attempt on a question goes back to the intro', async () => {
  const server = new QuizServer({ state: 'in_progress' });
  const rpc = server.rpc();
  const quiz = new QuizController({ client: controllerOn(rpc).client, program: 'quiz', tickEveryMs: SLOW });
  rpc.handlers['rewards_quiz_question'] = () => {
    server.state = 'not_started';
    throw new Error('rewards: no_attempt');
  };
  expect(await quiz.open()).toBeNull();
  expect(quiz.phase).toBe(QuizPhase.intro);
  quiz.dispose();
});

it('offline: error phase with reason, retry repeats the step', async () => {
  const rpc = new QuizServer().rpc();
  const ok = rpc.handlers['rewards_quiz_today']!;
  rpc.handlers['rewards_quiz_today'] = () => {
    throw new Error('socket');
  };
  const quiz = new QuizController({ client: controllerOn(rpc).client, program: 'quiz', tickEveryMs: SLOW });
  expect(await quiz.open()).toBe('offline');
  expect(quiz.phase).toBe(QuizPhase.error);
  expect(quiz.reason).toBe('offline');
  rpc.handlers['rewards_quiz_today'] = ok;
  expect(await quiz.retry()).toBeNull();
  expect(quiz.phase).toBe(QuizPhase.intro);
  quiz.dispose();
});

it('not deployed: unavailable phase; not enough questions: error with reason', async () => {
  const down = new QuizController({
    client: controllerOn(
      new FakeRpc({
        rewards_quiz_today: () => {
          throw new Error('PGRST202');
        },
      }),
    ).client,
    program: 'quiz',
  });
  expect(await down.open()).toBe('unavailable');
  expect(down.phase).toBe(QuizPhase.unavailable);
  expect(down.unavailable).toBe('not_deployed');
  const rpc = new QuizServer().rpc();
  rpc.handlers['rewards_quiz_start'] = () => {
    throw new Error('rewards: not_enough_questions');
  };
  const quiz = new QuizController({ client: controllerOn(rpc).client, program: 'quiz', tickEveryMs: SLOW });
  await quiz.open();
  expect(await quiz.start()).toBe('not_enough_questions');
  expect(quiz.phase).toBe(QuizPhase.error);
  quiz.dispose();
});

it('auto-advance after revealFor, with the real timer', async () => {
  const rewards = controllerOn(new QuizServer().rpc());
  const quiz = new QuizController({ client: rewards.client, program: 'quiz', rewards, revealForMs: 10, tickEveryMs: SLOW });
  await quiz.open();
  await quiz.start();
  await quiz.answer(0);
  expect(quiz.lastAnswer!.correct).toBe(false);
  await new Promise((r) => setTimeout(r, 60));
  expect(quiz.phase).toBe(QuizPhase.question);
  expect(quiz.question!.index).toBe(1);
  quiz.dispose();
});

it('snapshots change with every phase and countdown tick, and are stable in between', async () => {
  let now = serverNow;
  const rewards = controllerOn(new QuizServer({ clock: () => now }).rpc(), { local: () => now });
  const quiz = new QuizController({ client: rewards.client, program: 'quiz', rewards, revealForMs: null, tickEveryMs: SLOW });
  const phases: string[] = [];
  quiz.subscribe(() => phases.push(quiz.getSnapshot().phase));
  await quiz.open();
  await quiz.start();
  const a = quiz.getSnapshot();
  expect(quiz.getSnapshot()).toBe(a);
  now = plus(now, 1000);
  quiz.tick();
  const b = quiz.getSnapshot();
  expect(b).not.toBe(a);
  expect(b.timeLeftMs).toBe(9000);
  expect(a.timeLeftMs).toBe(10000);
  expect(phases).toEqual(['loading', 'intro', 'loading', 'loading', 'question', 'question', 'question']);
  quiz.dispose();
});
