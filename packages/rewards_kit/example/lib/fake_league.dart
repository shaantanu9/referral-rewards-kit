// The demo's stand-in for a weekly league and the year recap (ADR 0002 §18.10). Other members arrive the way the
// server sends them: a display name (or none), a score and a place, never an id.

class FakeLeague {
  bool joined = false;

  /// Chapters read since joining this week (the demo's "Read a chapter" button adds one).
  int score = 0;

  static const _others = [('Asha', 9), ('Ravi', 6), (null, 4), ('Mo', 2), ('Lena', 0)];

  Map<String, Object?> call(String fn, DateTime now) {
    if (fn == 'rewards_league_join') joined = true;
    if (fn == 'rewards_league_leave') {
      joined = false;
      score = 0;
    }
    return state(now);
  }

  Map<String, Object?> state(DateTime now) {
    final today = DateTime.utc(now.year, now.month, now.day);
    final week = today.subtract(Duration(days: today.weekday - 1));
    final rows = <(String?, int, bool)>[for (final o in _others) (o.$1, o.$2, false), if (joined) ('You', score, true)]
      ..sort((a, b) => b.$2.compareTo(a.$2));
    int? rankOf(int s) => s < 1 ? null : rows.indexWhere((r) => r.$2 == s) + 1;
    return {
      'program': 'weekly',
      'live': true,
      'joined': joined,
      'tier': 0,
      'tier_name': 'Bronze',
      'tiers': ['Bronze', 'Silver', 'Gold'],
      'week': week.toIso8601String().substring(0, 10),
      'starts_at': week.toIso8601String(),
      'ends_at': week.add(const Duration(days: 7)).toIso8601String(),
      'server_time': now.toIso8601String(),
      'group_size': 20,
      'promote': 2,
      'demote': 0,
      'min_score': 1,
      'rank': joined ? rankOf(score) : null,
      'score': joined ? score : 0,
      'size': joined ? rows.length : 0,
      'members': joined
          ? [
              for (final r in rows) {'rank': rankOf(r.$2), 'name': r.$3 ? null : r.$1, 'score': r.$2, 'me': r.$3},
            ]
          : [],
      'rewards': [
        {'threshold': 1, 'kind': 'coins', 'amount': 100},
        {'threshold': 3, 'kind': 'coins', 'amount': 30},
      ],
      'last_week': null,
    };
  }

  /// `rewards_recap` for any range: made-up totals.
  static Map<String, Object?> recap() => {
    'days_active': 212,
    'best_streak': 31,
    'events': [
      {'type': 'chapter_read', 'count': 840},
      {'type': 'quiz_finished', 'count': 120},
      {'type': 'clip_made', 'count': 9},
    ],
    'grants': [
      {'kind': 'coins', 'amount': 4200, 'count': 80},
      {'kind': 'streak_freeze', 'amount': 3, 'count': 3},
    ],
    'badges': [
      {'badge': 'bookworm', 'granted_at': '2026-03-02T10:00:00Z'},
      {'badge': 'night_owl', 'granted_at': '2026-07-19T23:10:00Z'},
    ],
  };
}
