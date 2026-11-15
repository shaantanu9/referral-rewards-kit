import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';
import 'fakes_v2.dart';

void main() {
  group('0.2 state', () {
    test('reads every new kind, list and finder', () {
      final s = RewardsState.fromJson(sampleStateV2());
      expect(s.programs.map((p) => p.kind).skip(4), [
        ProgramKind.quiz,
        ProgramKind.questSet,
        ProgramKind.comeback,
        ProgramKind.recharge,
        ProgramKind.window,
        ProgramKind.friendStreak,
      ]);
      final st = s.streak('daily')!;
      expect([st.dailyGoal, st.todayCount, st.weeklyFreeFreezesLeft], [2, 1, 1]);
      expect(st.goalProgress, 0.5);

      final q = s.quest('daily_quests')!;
      expect(q.period, 'daily');
      expect(q.endsAt, serverNow.add(const Duration(hours: 14)));
      expect(q.tasks.first.fraction, closeTo(1 / 3, 1e-9));
      expect(q.doneCount, 1);
      expect(q.bonus.single.amount, 20);

      final r = s.recharge('hearts')!;
      expect([r.units, r.max, r.everyMinutes], [2, 3, 240]);
      expect(r.full, isFalse);
      expect(r.nextAt, serverNow.add(const Duration(hours: 1, minutes: 5)));

      final w = s.window('happy')!;
      expect(w.active, isTrue);
      expect(w.activeAt(serverNow), isTrue);
      expect(w.activeAt(serverNow.add(const Duration(hours: 1))), isFalse);

      final f = s.friendsOf('buddies').single;
      expect([f.pairId, f.friendName, f.current], ['p1', 'Asha', 4]);
      expect(f.todayBoth, isFalse);
      expect(f.nextReward!.threshold, 7);
      expect(s.friendsOf('nope'), isEmpty);

      final quiz = s.quiz('quiz')!;
      expect(quiz.status, QuizStatus.notStarted);
      expect(quiz.canStart, isTrue);
      expect([quiz.total, quiz.attemptsLeft], [3, 1]);
    });

    test('old server: no new keys, defaults are safe', () {
      final s = RewardsState.fromJson(sampleState());
      expect(s.quests, isEmpty);
      expect(s.quizzes, isEmpty);
      final st = s.streak('daily')!;
      expect([st.dailyGoal, st.todayCount, st.weeklyFreeFreezesLeft], [1, 0, 0]);
      final done = StreakState.fromJson({'program': 'd', 'today_done': true, 'daily_goal': 0});
      expect([done.dailyGoal, done.todayCount], [1, 1]);
      expect(done.goalProgress, 1);
    });

    test('unknown kinds and states become unknown, never throw', () {
      expect(ProgramKind.fromWire('raffle'), ProgramKind.unknown);
      expect(ProgramKind.fromWire('unknown'), ProgramKind.unknown);
      expect(QuizStatus.fromWire('paused'), QuizStatus.unknown);
      expect(QuizQuestionKind.fromWire('drag_drop'), QuizQuestionKind.unknown);
      expect(QuizQuestionKind.fromWire('multiple_choice'), QuizQuestionKind.choice);
      expect(QuizState.fromJson({'program': 'q'}).status, QuizStatus.notStarted);
    });

    test('copyWith keeps the new lists', () {
      final s = RewardsState.fromJson(sampleStateV2()).copyWith(enabled: false);
      expect(s.quests, hasLength(1));
      expect(s.recharges, hasLength(1));
      expect(s.windows, hasLength(1));
      expect(s.friends, hasLength(1));
      expect(s.quizzes, hasLength(1));
    });

    test('social post_url', () {
      expect(SocialTaskState.fromJson({'program': 'ig', 'post_url': 'https://instagram.com/p/x'}).postUrl, isNotNull);
      expect(SocialTaskState.fromJson({'program': 'ig'}).postUrl, isNull);
    });

    test('track result reads quests', () {
      final r = TrackResult.fromJson({
        'quests': [
          {'program': 'daily_quests', 'done': true},
        ],
      });
      expect(r.quests.single.done, isTrue);
    });
  });

  group('mystery odds', () {
    test('chances as sent', () {
      final r = RewardSpec.fromJson({
        'threshold': 7,
        'kind': 'mystery',
        'amount': 1,
        'odds': [
          {'kind': 'coins', 'amount': 10, 'chance': 0.75},
          {'kind': 'streak_freeze', 'amount': 1, 'chance': 0.25},
        ],
      });
      expect(r.isMystery, isTrue);
      expect(r.odds.map((o) => o.chance), [0.75, 0.25]);
      expect(r.odds.first.spec.amount, 10);
    });

    test('weights from params.table become chances; percentages become fractions', () {
      final w = RewardSpec.fromJson({
        'kind': 'mystery',
        'params': {
          'table': [
            {'kind': 'coins', 'amount': 5, 'weight': 3},
            {'kind': 'coins', 'amount': 50, 'weight': 1},
          ],
        },
      });
      expect(w.odds.map((o) => o.chance), [0.75, 0.25]);
      final p = MysteryOdd.listFrom([
        {'kind': 'a', 'chance': 90},
        {'kind': 'b', 'chance': 10},
      ]);
      expect(p.map((o) => o.chance), [closeTo(0.9, 1e-9), closeTo(0.1, 1e-9)]);
      expect(MysteryOdd.listFrom('nope'), isEmpty);
      expect(RewardSpec.fromJson({'kind': 'coins'}).odds, isEmpty);
    });
  });

  group('history and recap', () {
    test('history days, levels and today', () {
      final h = StreakHistory.fromJson(historyJson());
      expect(h.days, hasLength(14));
      expect(h.days.first.day, DateTime.utc(2026, 11, 1));
      expect(h.today!.day, DateTime.utc(2026, 11, 14));
      expect(h.days.where((d) => d.frozen), hasLength(1));
      expect([0, 1, 2, 3, 4, 5, 6, 9].map(h.levelOf), [0, 1, 2, 2, 3, 3, 4, 4]);
      expect(h.withTodayCount(5).today!.count, 5);
      expect(HistoryDay.fromJson({'day': 'bad'}).day, DateTime.utc(1970));
      expect(formatDay(DateTime(2026, 3, 7, 23)), '2026-03-07');
    });

    test('recap tolerates badge strings and objects', () {
      final r = Recap.fromJson({
        'days_active': 5,
        'events': [
          {'type': 'chapter_read', 'count': 9},
        ],
        'grants': [
          {'kind': 'coins', 'amount': 120, 'count': 4},
        ],
        'best_streak': 6,
        'badges': [
          'bookworm',
          {'badge': 'night_owl', 'program': 'owl'},
          3,
        ],
      });
      expect(r.daysActive, 5);
      expect(r.events.single.count, 9);
      expect(r.grants.single.spec.amount, 120);
      expect(r.badges.map((b) => b.badge), ['bookworm', 'night_owl']);
    });
  });

  group('quiz shapes', () {
    test('question, media and window', () {
      final q = QuizQuestion.fromJson(questionJson(1, kind: 'listen', media: {'sound_id': 'bird'}, limitS: 12));
      expect([q.index, q.total], [1, 3]);
      expect(q.kind, QuizQuestionKind.listen);
      expect(q.soundId, 'bird');
      expect(q.window, const Duration(seconds: 12));
      expect(q.endsAt, serverNow.add(const Duration(seconds: 12)));
      final p = QuizQuestion.fromJson({
        'question': {
          'kind': 'picture',
          'media': {'image': 'https://x/y.png'},
        },
        'served_at': iso(serverNow),
        'ends_at': iso(serverNow.add(const Duration(seconds: 8))),
      });
      expect(p.imageUrl, 'https://x/y.png');
      expect(p.window, const Duration(seconds: 8));
    });

    test('answer result and last result', () {
      final a = QuizAnswerResult.fromJson({
        'correct': true,
        'answer': 2,
        'explanation': '',
        'score': 3,
        'finished': true,
        'grants': [grant('q1')],
      });
      expect(a.explanation, isNull);
      expect(a.grants.single.id, 'q1');
      expect(a.asTimedOut().timedOut, isTrue);
      final s = QuizState.fromJson(
        quizStateJson(
          state: 'finished',
          attemptsLeft: 0,
          lastResult: {
            'score': 2,
            'total': 3,
            'grants': [grant('q1')],
          },
        ),
      );
      expect(s.canStart, isFalse);
      expect(s.lastResult!.score, 2);
    });
  });

  test('new reasons are known', () {
    for (final r in [
      'empty',
      'bad_code',
      'own_code',
      'too_many_friends',
      'already_friends',
      'bad_link',
      'no_pending_post',
      'no_attempts_left',
      'not_enough_questions',
      'no_attempt',
    ]) {
      expect(RewardsException(r).isKnown, isTrue, reason: r);
    }
  });
}
