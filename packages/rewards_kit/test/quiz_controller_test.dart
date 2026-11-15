import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';
import 'fakes_v2.dart';

/// A three-question fake server; the right answer is always choice 1.
class QuizServer {
  QuizServer({
    this.state = 'not_started',
    this.attemptsLeft = 1,
    this.current = 0,
    this.servedAt,
    DateTime Function()? clock,
  }) : clock = clock ?? (() => serverNow);
  final DateTime Function() clock;
  String state;
  int attemptsLeft, current, score = 0;
  DateTime? servedAt;
  final answers = <(int, int)>[];

  FakeRpc rpc() => FakeRpc({
    'rewards_state': (_) => sampleStateV2(),
    'rewards_quiz_today': (_) => quizStateJson(
      state: state,
      attemptsLeft: attemptsLeft,
      current: current,
      score: score,
      lastResult: state == 'finished'
          ? {
              'score': score,
              'total': 3,
              'grants': [grant('quiz-win', amount: 30)],
            }
          : null,
    ),
    'rewards_quiz_start': (_) {
      if (attemptsLeft == 0) throw Exception('rewards: no_attempts_left');
      attemptsLeft--;
      state = 'in_progress';
      current = 0;
      score = 0;
      servedAt = null;
      return quizStateJson(state: state, attemptsLeft: attemptsLeft);
    },
    'rewards_quiz_question': (_) {
      if (state != 'in_progress') throw Exception('rewards: no_attempt');
      servedAt ??= clock();
      return questionJson(current, kind: current == 1 ? 'true_false' : 'choice', servedAt: servedAt);
    },
    'rewards_quiz_answer': (p) {
      final index = p['index'] as int, choice = p['choice'] as int;
      answers.add((index, choice));
      final correct = choice == 1;
      if (correct) score++;
      current++;
      servedAt = null;
      final finished = current >= 3;
      if (finished) state = 'finished';
      return {
        'correct': correct,
        'answer': 1,
        'explanation': 'Because.',
        'timed_out': choice == -1,
        'score': score,
        'finished': finished,
        'grants': finished ? [grant('quiz-win', amount: 30)] : [],
      };
    },
  });
}

void main() {
  test('full flow: open → start → answer ×3 (one timeout) → finished; grants reach the rewards controller', () async {
    var now = serverNow;
    final server = QuizServer(clock: () => now);
    final rpc = server.rpc();
    final rewards = controllerOn(rpc, local: () => now);
    await rewards.refresh();
    final got = <String>[];
    rewards.newGrants.listen((g) => got.add(g.id));
    final quiz = QuizController(client: rewards.client, program: 'quiz', rewards: rewards, revealFor: null);
    expect(rpc.called('rewards_quiz_today'), isEmpty, reason: 'nothing in the constructor');

    expect(await quiz.open(), isNull);
    expect(quiz.phase, QuizPhase.intro);
    expect(quiz.canStart, isTrue);

    expect(await quiz.start(), isNull);
    expect(quiz.phase, QuizPhase.question);
    expect(quiz.question!.index, 0);
    expect(quiz.timeLeft, const Duration(seconds: 10));
    expect(quiz.timeFraction, 1);
    expect(rewards.state.quiz('quiz')!.status, QuizStatus.inProgress);

    expect(await quiz.answer(1), isNull);
    expect(quiz.phase, QuizPhase.reveal);
    expect(quiz.lastAnswer!.correct, isTrue);
    expect(quiz.picked, 1);
    expect(await quiz.answer(0), 'not_ready', reason: 'no double answer');
    await quiz.next();
    expect(quiz.question!.kind, QuizQuestionKind.trueFalse);

    now = now.add(const Duration(seconds: 4));
    quiz.tick();
    expect(quiz.timeFraction, closeTo(0.6, 1e-9));
    now = now.add(const Duration(seconds: 7));
    quiz.tick();
    await Future<void>.delayed(Duration.zero);
    expect(server.answers.last, (1, -1), reason: 'time up: "no answer" sent by itself');
    expect(quiz.phase, QuizPhase.reveal);
    expect(quiz.lastAnswer!.timedOut, isTrue);
    expect(quiz.picked, isNull);

    await quiz.next();
    await quiz.answer(1);
    expect(quiz.lastAnswer!.finished, isTrue);
    await quiz.next();
    expect(quiz.phase, QuizPhase.finished);
    expect(quiz.quiz!.lastResult!.score, 2);
    expect(quiz.finishedGrants.single.id, 'quiz-win');
    await Future<void>.delayed(Duration.zero);
    expect(got, contains('quiz-win'));
    expect(rewards.state.quiz('quiz')!.status, isNot(QuizStatus.inProgress));
    quiz.dispose();
  });

  test('resume after restart: same question, same deadline; an expired one times out at once', () async {
    var now = serverNow.add(const Duration(seconds: 6));
    final server = QuizServer(state: 'in_progress', current: 1, servedAt: serverNow);
    final rewards = controllerOn(server.rpc(), local: () => now);
    final quiz = QuizController(client: rewards.client, program: 'quiz', rewards: rewards, revealFor: null);
    await quiz.open();
    expect(quiz.phase, QuizPhase.question);
    expect(quiz.question!.index, 1);
    expect(quiz.timeLeft, const Duration(seconds: 4), reason: 'the deadline did not reset');
    quiz.dispose();

    now = serverNow.add(const Duration(seconds: 30));
    final again = QuizController(client: rewards.client, program: 'quiz', rewards: rewards, revealFor: null);
    await again.open();
    await Future<void>.delayed(Duration.zero);
    expect(server.answers.single, (1, -1));
    expect(again.lastAnswer!.timedOut, isTrue);
    again.dispose();
  });

  test('finished today, no attempts left: finished phase, start refused then reloaded', () async {
    final server = QuizServer(state: 'finished', attemptsLeft: 0);
    final quiz = QuizController(client: controllerOn(server.rpc()).client, program: 'quiz');
    await quiz.open();
    expect(quiz.phase, QuizPhase.finished);
    expect(quiz.canStart, isFalse);
    expect(await quiz.start(), 'no_attempts_left');
    expect(quiz.phase, QuizPhase.finished);
    quiz.dispose();
  });

  test('no_attempt on a question goes back to the intro', () async {
    final server = QuizServer(state: 'in_progress');
    final rpc = server.rpc();
    final quiz = QuizController(client: controllerOn(rpc).client, program: 'quiz');
    rpc.handlers['rewards_quiz_question'] = (_) {
      server.state = 'not_started';
      throw Exception('rewards: no_attempt');
    };
    expect(await quiz.open(), isNull);
    expect(quiz.phase, QuizPhase.intro);
    quiz.dispose();
  });

  test('offline: error phase with reason, retry repeats the step', () async {
    final server = QuizServer();
    final rpc = server.rpc();
    final ok = rpc.handlers['rewards_quiz_today']!;
    rpc.handlers['rewards_quiz_today'] = (_) => throw Exception('socket');
    final quiz = QuizController(client: controllerOn(rpc).client, program: 'quiz');
    expect(await quiz.open(), 'offline');
    expect(quiz.phase, QuizPhase.error);
    expect(quiz.reason, 'offline');
    rpc.handlers['rewards_quiz_today'] = ok;
    expect(await quiz.retry(), isNull);
    expect(quiz.phase, QuizPhase.intro);
    quiz.dispose();
  });

  test('not deployed: unavailable phase; not enough questions: error with reason', () async {
    final down = QuizController(
      client: controllerOn(FakeRpc({'rewards_quiz_today': (_) => throw Exception('PGRST202')})).client,
      program: 'quiz',
    );
    expect(await down.open(), 'unavailable');
    expect(down.phase, QuizPhase.unavailable);
    expect(down.unavailable, RewardsUnavailableReason.notDeployed);

    final server = QuizServer();
    final rpc = server.rpc();
    rpc.handlers['rewards_quiz_start'] = (_) => throw Exception('rewards: not_enough_questions');
    final quiz = QuizController(client: controllerOn(rpc).client, program: 'quiz');
    await quiz.open();
    expect(await quiz.start(), 'not_enough_questions');
    expect(quiz.phase, QuizPhase.error);
  });

  test('auto-advance after revealFor, with the real timer', () async {
    final server = QuizServer();
    final rewards = controllerOn(server.rpc());
    final quiz = QuizController(
      client: rewards.client,
      program: 'quiz',
      rewards: rewards,
      revealFor: const Duration(milliseconds: 10),
    );
    await quiz.open();
    await quiz.start();
    await quiz.answer(0);
    expect(quiz.lastAnswer!.correct, isFalse);
    await Future<void>.delayed(const Duration(milliseconds: 60));
    expect(quiz.phase, QuizPhase.question);
    expect(quiz.question!.index, 1);
    quiz.dispose();
  });
}
