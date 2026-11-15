import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';
import 'fakes_v2.dart';
import 'quiz_controller_test.dart' show QuizServer;

Widget app(Widget child) => MaterialApp(
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

void main() {
  group('QuizCard', () {
    testWidgets('not started: rules, time left today, Start opens the app route', (t) async {
      final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleStateV2()}));
      await c.refresh();
      String? opened;
      await t.pumpWidget(app(QuizCard(controller: c, program: 'quiz', onOpen: (p) => opened = p)));
      expect(find.text('Daily quiz'), findsOneWidget);
      expect(find.text('3 questions. Answer each one before its timer runs out.'), findsOneWidget);
      expect(find.text('New quiz in 14h 00m'), findsOneWidget);
      await t.tap(find.text('Start'));
      expect(opened, 'quiz');
    });

    testWidgets('in progress: Resume; finished: score; no attempts: come back', (t) async {
      final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleStateV2(quizState: 'in_progress')}));
      await c.refresh();
      await t.pumpWidget(app(QuizCard(controller: c, program: 'quiz', onOpen: (_) {})));
      expect(find.text('Resume'), findsOneWidget);
      expect(find.text('Question 1 of 3'), findsOneWidget);

      c.applyQuiz(
        QuizState.fromJson(quizStateJson(state: 'finished', attemptsLeft: 0, lastResult: {'score': 2, 'total': 3})),
      );
      await t.pump();
      expect(find.text('2 of 3 right'), findsOneWidget);
      expect(find.text('See result'), findsOneWidget);

      c.applyQuiz(QuizState.fromJson(quizStateJson(attemptsLeft: 0)));
      await t.pump();
      expect(find.text('Come back tomorrow for a new quiz'), findsOneWidget);
      expect(find.byType(FilledButton), findsNothing);
    });

    testWidgets('builder replaces the look', (t) async {
      final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleStateV2()}));
      await c.refresh();
      await t.pumpWidget(
        app(QuizCard(controller: c, program: 'quiz', builder: (_, q, _) => Text('mine ${q.status.wire}'))),
      );
      expect(find.text('mine not_started'), findsOneWidget);
    });
  });

  group('QuizScreen', () {
    testWidgets('default flow: rules → question → reveal → … → result with rewards; listen and picture', (t) async {
      final server = QuizServer();
      final rpc = server.rpc();
      final ok = rpc.handlers['rewards_quiz_question']!;
      rpc.handlers['rewards_quiz_question'] = (p) {
        final q = ok(p) as Map<String, Object?>;
        if (server.current == 2) {
          (q['question'] as Map<String, Object?>)
            ..['kind'] = 'picture'
            ..['media'] = {'image_url': 'https://img/x.png'};
        }
        if (server.current == 0) {
          (q['question'] as Map<String, Object?>)
            ..['kind'] = 'listen'
            ..['media'] = {'sound_id': 'bird'};
        }
        return q;
      };
      final c = controllerOn(rpc);
      await c.refresh();
      final sounds = <String>[];
      await t.pumpWidget(
        MaterialApp(
          home: QuizScreen(
            controller: c,
            program: 'quiz',
            onPlaySound: sounds.add,
            imageBuilder: (_, url) => Text('img $url'),
          ),
        ),
      );
      await t.pump();
      await t.pump();
      expect(find.text('Start'), findsOneWidget);
      await t.tap(find.text('Start'));
      await t.pump();
      await t.pump();
      expect(find.text('Question 1 of 3'), findsOneWidget);
      expect(find.text('Question 0?'), findsOneWidget);
      await t.tap(find.text('Play sound'));
      expect(sounds, ['bird']);
      expect(t.widget<LinearProgressIndicator>(find.byType(LinearProgressIndicator)).value, 1);

      await t.tap(find.byKey(const ValueKey('quiz-choice-1')));
      await t.pump();
      await t.pump();
      expect(find.text('Right!'), findsOneWidget);
      expect(find.text('Because.'), findsOneWidget);
      await t.tap(find.text('Next'));
      await t.pump();
      await t.pump();
      expect(find.text('Question 2 of 3'), findsOneWidget);
      expect(find.text('Alpha'), findsOneWidget, reason: 'true_false with two-plus choices keeps the server labels');

      await t.tap(find.byKey(const ValueKey('quiz-choice-0')));
      await t.pump();
      await t.pump();
      expect(find.text('Not quite'), findsOneWidget);
      await t.pump(const Duration(seconds: 2));
      await t.pump();
      await t.pump();
      expect(find.text('img https://img/x.png'), findsOneWidget, reason: 'auto-advanced to the picture question');

      await t.tap(find.byKey(const ValueKey('quiz-choice-1')));
      await t.pump();
      await t.pump();
      await t.tap(find.text('Next'));
      await t.pump();
      await t.pump();
      expect(find.text('2 of 3 right'), findsOneWidget);
      expect(find.text('You got 30 coins'), findsOneWidget);
      expect(find.text('Done'), findsOneWidget);
      await t.pumpWidget(const SizedBox());
      await t.pump(const Duration(seconds: 3));
    });

    testWidgets('true/false with no choices shows True and False; timeout shows time is up', (t) async {
      var now = serverNow;
      final rpc = FakeRpc({
        'rewards_quiz_today': (_) => quizStateJson(state: 'in_progress'),
        'rewards_quiz_question': (_) => questionJson(0, kind: 'true_false', choices: []),
        'rewards_quiz_answer': (_) => {'correct': false, 'answer': 0, 'timed_out': true, 'score': 0},
      });
      final c = controllerOn(rpc, local: () => now);
      final quiz = QuizController(client: c.client, program: 'quiz', rewards: c, revealFor: null);
      await t.pumpWidget(
        MaterialApp(
          home: QuizScreen(controller: c, program: 'quiz', quiz: quiz),
        ),
      );
      await t.pump();
      await t.pump();
      expect(find.text('True'), findsOneWidget);
      expect(find.text('False'), findsOneWidget);
      now = now.add(const Duration(seconds: 11));
      await t.pump(const Duration(milliseconds: 250));
      await t.pump();
      expect(rpc.called('rewards_quiz_answer').single['choice'], -1);
      expect(find.text("Time's up"), findsOneWidget);
      quiz.dispose();
    });

    testWidgets('builder replaces the body; offline shows retry', (t) async {
      final rpc = FakeRpc({'rewards_quiz_today': (_) => throw Exception('socket')});
      final c = controllerOn(rpc);
      await t.pumpWidget(
        MaterialApp(
          home: QuizScreen(controller: c, program: 'quiz', builder: (_, q) => Text('phase ${q.phase.name}')),
        ),
      );
      await t.pump();
      await t.pump();
      expect(find.text('phase error'), findsOneWidget);

      await t.pumpWidget(
        MaterialApp(
          home: QuizScreen(controller: c, program: 'quiz'),
        ),
      );
      await t.pump();
      await t.pump();
      expect(find.text('You are offline. Try again in a moment.'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });
  });
}
