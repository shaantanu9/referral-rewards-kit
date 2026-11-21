// The demo's in-memory stand-in for the rewards database.
import 'dart:math';

import 'fake_followups.dart';
import 'fake_league.dart';

/// A tiny stand-in for the database: a streak (daily goal 2), a "read 5 chapters" milestone, a 30-minute offer with
/// stock, an Instagram task that verifies after you press "Simulate Meta webhook", a 4-question daily quiz, and a
/// surprise bonus: each chapter read pays 5–50 coins with [surpriseChance] (30 %), at most 3 a day (ADR 0002 §18.6).
/// 0.7: the milestone starts with a head start of 1 and has levels; a third event in a day is a personal best; the
/// Reminders tab's choices hide the streak, turn the surprise into a fixed 27 coins, and hide the timers.
class FakeServer {
  FakeServer({this.surpriseChance = 0.3, Random? random}) : random = random ?? Random();

  /// Like a rule with `params: {"chance": 0.3, "amount_range": [5, 50]}` and `amount: 50`.
  final double surpriseChance;
  final Random random;
  int surprisesToday = 0;
  static const surpriseDailyCap = 3;
  int streak = 2, longest = 4, chapters = 3, stock = 7, seq = 0, todayCount = 0, bestDay = 2;
  bool todayDone = false, claimed = false;
  final quiz = FakeQuiz();
  String social = 'none';
  final startedAt = DateTime.now().toUtc();
  final inbox = <Map<String, Object?>>[];
  final followups = FakeFollowups();
  final league = FakeLeague();

  Map<String, Object?> _grant(String program, String kind, num amount) => {
    'id': 'g${seq++}',
    'program': program,
    'kind': kind,
    'amount': amount,
    'params': {},
    'state': 'granted',
  };

  Future<Object?> call(String fn, Map<String, Object?> p) async {
    await Future<void>.delayed(const Duration(milliseconds: 150));
    final now = DateTime.now().toUtc();
    switch (fn) {
      case 'rewards_followups_plan':
        return followups.plan(now);
      case 'rewards_followup_prefs':
        return followups.applyPrefs((p['patch'] as Map?)?.cast<String, Object?>() ?? const {});
      case 'rewards_track':
        followups.lastActivity = now;
        final grants = <Map<String, Object?>>[];
        todayCount++;
        if (league.joined) league.score++;
        if (!todayDone && todayCount >= 2) {
          todayDone = true;
          streak++;
          if (streak == 3) grants.add(_grant('daily', 'coins', 20));
        }
        chapters++;
        final fixed = followups.prefs['surprises_off'] == true;
        if (fixed && chapters % 3 == 0) {
          // Like the engine with surprises off: no draw, the range's midpoint, marked fixed.
          grants.add(
            _grant('reader', 'coins', 27)
              ..['params'] = {
                'range': [5, 50],
                'fixed': true,
              },
          );
        } else if (!fixed && surprisesToday < surpriseDailyCap && random.nextDouble() < surpriseChance) {
          surprisesToday++;
          grants.add(
            _grant('reader', 'coins', 5 + random.nextInt(46))
              ..['params'] = {
                'surprise': true,
                'range': [5, 50],
              },
          );
        }
        if (chapters == 5) grants.add(_grant('reader', 'badge', 1)..['params'] = {'badge': 'bookworm'});
        inbox.insertAll(0, grants);
        return {
          'duplicate': false,
          'grants': grants,
          'streaks': [_streak(now)],
        };
      case 'rewards_offer_claim':
        if (claimed) throw Exception('rewards: offer_claimed');
        claimed = true;
        stock--;
        final g = _grant('welcome', 'coins', 100);
        inbox.insert(0, g);
        return {
          'grants': [g],
        };
      case 'rewards_social_start':
        social = 'pending';
        return {
          'code': 'DEMO-K7Q2HX',
          'account': 'myapp',
          'expires_at': now.add(const Duration(days: 7)).toIso8601String(),
        };
      case 'rewards_league':
      case 'rewards_league_join':
      case 'rewards_league_leave':
        return league.call(fn, now);
      case 'rewards_recap':
        return FakeLeague.recap();
      case 'rewards_history':
        return _history(p['weeks'] as int? ?? 15);
      case 'rewards_quiz_today':
      case 'rewards_quiz_start':
      case 'rewards_quiz_question':
      case 'rewards_quiz_answer':
        final r = quiz.call(fn, p, now, _endOfDay(now));
        final grants = r['grants'];
        if (grants is List) {
          for (final g in grants.cast<Map<String, Object?>>()) {
            g['id'] = 'g${seq++}';
            inbox.insert(0, g);
          }
        }
        return r;
      case 'rewards_mark_seen':
        final ids = (p['grant_ids'] as List).cast<String>();
        inbox.removeWhere((g) => ids.contains(g['id']));
        return ids.length;
      default:
        return _state(now);
    }
  }

  DateTime _endOfDay(DateTime now) => DateTime.utc(now.year, now.month, now.day + 1);

  Map<String, Object?> _history(int weeks) {
    final today = DateTime.utc(DateTime.now().year, DateTime.now().month, DateTime.now().day);
    final n = weeks * 7;
    return {
      'program': 'daily',
      'daily_goal': 2,
      'days': [
        for (var i = n - 1; i >= 0; i--)
          {
            'day': today.subtract(Duration(days: i)).toIso8601String().substring(0, 10),
            'count': i == 0 ? todayCount : (i * 7 + i ~/ 3) % 6,
            'frozen': i == 9 || i == 40,
          },
      ],
    };
  }

  Map<String, Object?> _streak(DateTime now) {
    final midnight = _endOfDay(now);
    return {
      'program': 'daily',
      'current': streak,
      'longest': longest,
      'today_done': todayDone,
      'daily_goal': 2,
      'today_count': todayCount,
      'freezes': 1,
      'ends_today_at': midnight.toIso8601String(),
      'next_reward': streak < 7 ? {'threshold': 7, 'kind': 'coins', 'amount': 50} : null,
      'hidden': followups.prefs['streaks_off'] == true,
      'best_day_count': todayCount > bestDay ? todayCount : bestDay,
      'record_today': todayCount > bestDay,
      'repair': null,
    };
  }

  Map<String, Object?> _state(DateTime now) => {
    'enabled': true,
    'server_time': now.toIso8601String(),
    'programs': [
      {'key': 'daily', 'kind': 'streak'},
      {
        'key': 'reader',
        'kind': 'milestone',
        'public': {'title': 'Read 5 chapters', 'head_start_label': 'Includes 1 chapter from us to get you going'},
      },
      {
        'key': 'welcome',
        'kind': 'offer',
        'public': {'title': 'Welcome gift'},
      },
      {'key': 'ig', 'kind': 'social_tag'},
      {'key': 'quiz', 'kind': 'quiz'},
    ],
    'streaks': [_streak(now)],
    'milestones': [
      {
        'program': 'reader',
        'count': chapters,
        'head_start': 1,
        'level': {
          'number': chapters < 3 ? 1 : (chapters < 6 ? 2 : 3),
          'name': chapters < 3 ? 'Reader' : (chapters < 6 ? 'Explorer' : 'Bookworm'),
          'at': chapters < 3 ? 1 : (chapters < 6 ? 3 : 6),
          'next_at': chapters < 3 ? 3 : (chapters < 6 ? 6 : null),
        },
        'next_reward': chapters < 5
            ? {
                'threshold': 5,
                'kind': 'badge',
                'amount': 1,
                'params': {'badge': 'bookworm'},
              }
            : null,
      },
    ],
    'offers': [
      {
        'program': 'welcome',
        'state': claimed ? 'claimed' : 'active',
        'stock_left': stock,
        'started_at': startedAt.toIso8601String(),
        'ends_at': startedAt.add(const Duration(minutes: 30)).toIso8601String(),
        'rewards': [
          {'kind': 'coins', 'amount': 100},
        ],
      },
    ],
    'social': [
      {
        'program': 'ig',
        'account': 'myapp',
        'state': social,
        'code': social == 'none' ? null : 'DEMO-K7Q2HX',
        'expires_at': now.add(const Duration(days: 7)).toIso8601String(),
        'rewards': [
          {'kind': 'coins', 'amount': 200},
        ],
      },
    ],
    'quizzes': [quiz.state(now, _endOfDay(now))],
    'surprises': [
      {
        'program': 'reader',
        'kind': 'coins',
        'amount': 50,
        'amount_range': [5, 50],
        'chance': surpriseChance,
        'params': {},
      },
    ],
    'inbox': inbox,
    'badges': [],
    'choices': followups.choices,
  };
}

/// Today's quiz: four questions (one true/false with its own labels, one with none), 15 s each, 30 coins for 3+.
class FakeQuiz {
  static const _questions = [
    {
      'kind': 'choice',
      'prompt': 'Which planet is called the red planet?',
      'choices': ['Venus', 'Mars', 'Jupiter'],
      'answer': 1,
      'explanation': 'Iron oxide dust makes Mars look red.',
    },
    {
      'kind': 'true_false',
      'prompt': 'The Pacific is the largest ocean.',
      'choices': ['True', 'False'],
      'answer': 0,
      'explanation': 'It covers about a third of the Earth.',
    },
    {
      'kind': 'odd_one_out',
      'prompt': 'Oak, pine, rose, maple',
      'choices': ['Oak', 'Pine', 'Rose', 'Maple'],
      'answer': 2,
      'explanation': 'A rose is a shrub; the others are trees.',
    },
    {'kind': 'true_false', 'prompt': 'Sound travels faster than light.', 'choices': <String>[], 'answer': 1},
  ];
  static const _limit = Duration(seconds: 15);

  String status = 'not_started';
  int current = 0, score = 0, attemptsLeft = 1;
  DateTime? servedAt;
  Map<String, Object?>? lastResult;

  Map<String, Object?> state(DateTime now, DateTime endOfDay) => {
    'program': 'quiz',
    'state': status,
    'day': now.toIso8601String().substring(0, 10),
    'ends_at': endOfDay.toIso8601String(),
    'total': _questions.length,
    'current': current,
    'score': score,
    'attempts_left': attemptsLeft,
    'last_result': lastResult,
  };

  Map<String, Object?> call(String fn, Map<String, Object?> p, DateTime now, DateTime endOfDay) {
    switch (fn) {
      case 'rewards_quiz_start':
        if (attemptsLeft <= 0) throw Exception('rewards: no_attempts_left');
        attemptsLeft--;
        status = 'in_progress';
        current = score = 0;
        servedAt = null;
        return state(now, endOfDay);
      case 'rewards_quiz_question':
        if (status != 'in_progress') throw Exception('rewards: no_attempt');
        final served = servedAt ??= now;
        final q = _questions[current];
        return {
          'index': current,
          'total': _questions.length,
          'question': {'id': 'q$current', 'kind': q['kind'], 'prompt': q['prompt'], 'choices': q['choices']},
          'time_limit_s': _limit.inSeconds,
          'served_at': served.toIso8601String(),
          'ends_at': served.add(_limit).toIso8601String(),
        };
      case 'rewards_quiz_answer':
        if (status != 'in_progress') throw Exception('rewards: no_attempt');
        final q = _questions[current];
        final late = now.isAfter(servedAt!.add(_limit + const Duration(seconds: 2)));
        final correct = !late && p['choice'] == q['answer'];
        if (correct) score++;
        current++;
        servedAt = null;
        final finished = current >= _questions.length;
        final grants = <Map<String, Object?>>[
          if (finished && score >= 3)
            {'program': 'quiz', 'kind': 'coins', 'amount': 30, 'params': {}, 'state': 'granted'},
        ];
        if (finished) {
          status = 'finished';
          lastResult = {'score': score, 'total': _questions.length, 'grants': grants};
        }
        return {
          'correct': correct,
          'answer': q['answer'],
          'explanation': q['explanation'],
          'timed_out': late,
          'score': score,
          'finished': finished,
          'grants': grants,
        };
      default:
        return state(now, endOfDay);
    }
  }
}
