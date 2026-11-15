import 'fakes.dart';

/// The 0.1 sample state plus every 0.2 kind (ADR 0002 §18.2, §18.3).
Map<String, Object?> sampleStateV2({
  bool windowActive = true,
  int rechargeUnits = 2,
  String quizState = 'not_started',
  int attemptsLeft = 1,
  List<Map<String, Object?>>? friends,
}) {
  final s = sampleState();
  s['programs'] = <Object?>[
    ...(s['programs'] as List),
    {'key': 'quiz', 'kind': 'quiz', 'public': {}},
    {
      'key': 'daily_quests',
      'kind': 'quest_set',
      'public': {'title': 'Today'},
    },
    {'key': 'back', 'kind': 'comeback', 'public': {}},
    {'key': 'hearts', 'kind': 'recharge', 'public': {}},
    {
      'key': 'happy',
      'kind': 'window',
      'public': {'title': 'Happy hour'},
    },
    {'key': 'buddies', 'kind': 'friend_streak', 'public': {}},
  ];
  final streak = (s['streaks'] as List).first as Map<String, Object?>;
  streak
    ..['daily_goal'] = 2
    ..['today_count'] = 1
    ..['weekly_free_freezes_left'] = 1;
  s['quests'] = [
    {
      'program': 'daily_quests',
      'period': 'daily',
      'ends_at': iso(serverNow.add(const Duration(hours: 14))),
      'done': false,
      'tasks': [
        {
          'key': 'read',
          'event': 'chapter_read',
          'count': 3,
          'progress': 1,
          'done': false,
          'rewards': [
            {'kind': 'coins', 'amount': 5},
          ],
        },
        {'key': 'quiz', 'event': 'quiz_finished', 'count': 1, 'progress': 1, 'done': true, 'rewards': []},
      ],
      'bonus': [
        {'kind': 'coins', 'amount': 20},
      ],
    },
  ];
  s['recharges'] = [
    {
      'program': 'hearts',
      'units': rechargeUnits,
      'max': 3,
      'every_minutes': 240,
      'next_at': rechargeUnits >= 3 ? null : iso(serverNow.add(const Duration(hours: 1, minutes: 5))),
    },
  ];
  s['windows'] = [
    {
      'program': 'happy',
      'active': windowActive,
      'starts_at': iso(
        windowActive ? serverNow.subtract(const Duration(minutes: 10)) : serverNow.add(const Duration(hours: 2)),
      ),
      'ends_at': iso(serverNow.add(Duration(minutes: windowActive ? 50 : 180))),
    },
  ];
  s['friends'] =
      friends ??
      [
        {
          'program': 'buddies',
          'pair_id': 'p1',
          'friend_id': 'u2',
          'friend_name': 'Asha',
          'current': 4,
          'longest': 6,
          'today_me': true,
          'today_friend': false,
          'breaks_at': iso(serverNow.add(const Duration(hours: 14))),
          'next_reward': {'threshold': 7, 'kind': 'coins', 'amount': 30},
        },
      ];
  s['quizzes'] = [quizStateJson(state: quizState, attemptsLeft: attemptsLeft)];
  return s;
}

Map<String, Object?> quizStateJson({
  String state = 'not_started',
  int attemptsLeft = 1,
  int current = 0,
  int score = 0,
  Map<String, Object?>? lastResult,
}) => {
  'program': 'quiz',
  'state': state,
  'day': '2026-11-14',
  'ends_at': iso(serverNow.add(const Duration(hours: 14))),
  'total': 3,
  'current': current,
  'score': score,
  'attempts_left': attemptsLeft,
  'last_result': lastResult,
};

/// A served question; [kind] `choice` by default.
Map<String, Object?> questionJson(
  int index, {
  String kind = 'choice',
  List<String>? choices,
  Map<String, Object?> media = const {},
  DateTime? servedAt,
  int limitS = 10,
}) {
  final served = servedAt ?? serverNow;
  return {
    'index': index,
    'total': 3,
    'question': {
      'id': 'q$index',
      'kind': kind,
      'prompt': 'Question $index?',
      'choices': choices ?? ['Alpha', 'Beta', 'Gamma'],
      'media': media,
    },
    'time_limit_s': limitS,
    'served_at': iso(served),
    'ends_at': iso(served.add(Duration(seconds: limitS))),
  };
}

Map<String, Object?> historyJson({int weeks = 2, int dailyGoal = 2}) {
  final today = DateTime.utc(2026, 11, 14);
  final n = weeks * 7;
  return {
    'program': 'daily',
    'daily_goal': dailyGoal,
    'days': [
      for (var i = n - 1; i >= 0; i--)
        {'day': today.subtract(Duration(days: i)).toIso8601String().substring(0, 10), 'count': i % 4, 'frozen': i == 5},
    ],
  };
}
