/// States of the 0.2 program kinds (ADR 0002 §18.2, §18.3): quests, recharges, windows, friend streaks, plus the
/// history and recap reads. Every `fromJson` tolerates missing optional fields and reads times as UTC.
library;

import 'json.dart';
import 'models.dart';

/// One task of a quest set: `{"key","event","count","progress","done","rewards":[spec]}`.
class QuestTask {
  const QuestTask({
    required this.key,
    this.event = '',
    this.count = 1,
    this.progress = 0,
    this.done = false,
    this.rewards = const [],
  });

  factory QuestTask.fromJson(Map<String, Object?> m) {
    final count = intOr(m['count'], 1);
    return QuestTask(
      key: str(m['key']),
      event: str(m['event']),
      count: count < 1 ? 1 : count,
      progress: intOr(m['progress']),
      done: boolOr(m['done']),
      rewards: listOf(m['rewards'], RewardSpec.fromJson),
    );
  }

  final String key;

  /// The event type it counts.
  final String event;

  /// How many are needed (at least 1).
  final int count;
  final int progress;
  final bool done;
  final List<RewardSpec> rewards;

  /// 0..1; 1 when [done].
  double get fraction => done ? 1 : (progress / count).clamp(0, 1).toDouble();
}

/// A quest set: `{"program","period","ends_at","done","tasks":[task],"bonus":[spec]}`. [endsAt] is when the period
/// resets (null for `never`).
class QuestState {
  const QuestState({
    required this.program,
    this.period = 'never',
    this.endsAt,
    this.done = false,
    this.tasks = const [],
    this.bonus = const [],
  });

  factory QuestState.fromJson(Map<String, Object?> m) => QuestState(
    program: str(m['program']),
    period: m['period'] == null ? 'never' : str(m['period']),
    endsAt: time(m['ends_at']),
    done: boolOr(m['done']),
    tasks: listOf(m['tasks'], QuestTask.fromJson),
    bonus: listOf(m['bonus'], RewardSpec.fromJson),
  );

  final String program;

  /// `daily`, `weekly` or `never` (as the server sent it).
  final String period;
  final DateTime? endsAt;

  /// Every task done.
  final bool done;
  final List<QuestTask> tasks;

  /// The reward for finishing every task; empty when none.
  final List<RewardSpec> bonus;

  int get doneCount => tasks.where((t) => t.done).length;
}

/// Units that refill over time ("3 hearts, one back every 4 hours"): `{"program","units","max","every_minutes",
/// "next_at"}`. [nextAt] is the server time the next unit comes back; null when full.
class RechargeState {
  const RechargeState({required this.program, this.units = 0, this.max = 0, this.everyMinutes = 0, this.nextAt});

  factory RechargeState.fromJson(Map<String, Object?> m) => RechargeState(
    program: str(m['program']),
    units: intOr(m['units']),
    max: intOr(m['max']),
    everyMinutes: intOr(m['every_minutes']),
    nextAt: time(m['next_at']),
  );

  final String program;
  final int units;
  final int max;
  final int everyMinutes;
  final DateTime? nextAt;

  bool get full => units >= max;
  bool get empty => units <= 0;

  /// Keeps fields the answer does not carry (`rewards_recharge_use` has no `every_minutes`).
  RechargeState mergedWith(RechargeState newer) => RechargeState(
    program: program,
    units: newer.units,
    max: newer.max == 0 ? max : newer.max,
    everyMinutes: newer.everyMinutes == 0 ? everyMinutes : newer.everyMinutes,
    nextAt: newer.nextAt,
  );
}

/// A time window ("Happy hour 21:00–22:00"): `{"program","active","starts_at","ends_at"}`, the current window or the
/// next one.
class WindowState {
  const WindowState({required this.program, this.active = false, this.startsAt, this.endsAt});

  factory WindowState.fromJson(Map<String, Object?> m) => WindowState(
    program: str(m['program']),
    active: boolOr(m['active']),
    startsAt: time(m['starts_at']),
    endsAt: time(m['ends_at']),
  );

  final String program;
  final bool active;
  final DateTime? startsAt;
  final DateTime? endsAt;

  /// Whether it is open at [now] (a server-corrected time), using the times rather than the [active] snapshot.
  bool activeAt(DateTime now) {
    final s = startsAt, e = endsAt;
    if (s == null || e == null) return active;
    return !now.isBefore(s) && now.isBefore(e);
  }
}

/// A streak kept with one friend: both must act each day. [friendName] is what the friend chose to show; shown
/// only to the pair.
class FriendStreakState {
  const FriendStreakState({
    required this.program,
    required this.pairId,
    this.friendId = '',
    this.friendName = '',
    this.current = 0,
    this.longest = 0,
    this.todayMe = false,
    this.todayFriend = false,
    this.breaksAt,
    this.nextReward,
  });

  factory FriendStreakState.fromJson(Map<String, Object?> m) => FriendStreakState(
    program: str(m['program']),
    pairId: str(m['pair_id']),
    friendId: str(m['friend_id']),
    friendName: str(m['friend_name']),
    current: intOr(m['current']),
    longest: intOr(m['longest']),
    todayMe: boolOr(m['today_me']),
    todayFriend: boolOr(m['today_friend']),
    breaksAt: time(m['breaks_at']),
    nextReward: m['next_reward'] is Map ? RewardSpec.fromJson(optMap(m['next_reward'])) : null,
  );

  final String program;
  final String pairId;
  final String friendId;
  final String friendName;
  final int current;
  final int longest;
  final bool todayMe;
  final bool todayFriend;
  final DateTime? breaksAt;
  final RewardSpec? nextReward;

  bool get todayBoth => todayMe && todayFriend;
}

/// What `rewards_friend_invite` returns: a code to share (`F` + 7 characters) valid until [expiresAt].
class FriendInvite {
  const FriendInvite({required this.code, this.expiresAt});

  factory FriendInvite.fromJson(Map<String, Object?> m) =>
      FriendInvite(code: str(m['code']), expiresAt: time(m['expires_at']));

  final String code;
  final DateTime? expiresAt;
}

/// What `rewards_friend_accept` returns.
class FriendAcceptResult {
  const FriendAcceptResult({required this.pairId, required this.program});

  factory FriendAcceptResult.fromJson(Map<String, Object?> m) =>
      FriendAcceptResult(pairId: str(m['pair_id']), program: str(m['program']));

  final String pairId;
  final String program;
}

/// One local day of a streak's history.
class HistoryDay {
  const HistoryDay({required this.day, this.count = 0, this.frozen = false});

  factory HistoryDay.fromJson(Map<String, Object?> m) =>
      HistoryDay(day: parseDay(m['day']) ?? DateTime.utc(1970), count: intOr(m['count']), frozen: boolOr(m['frozen']));

  /// The local day as a UTC date at midnight (`2026-11-14` → `DateTime.utc(2026, 11, 14)`); compare dates, not
  /// instants.
  final DateTime day;
  final int count;

  /// Missed but saved by a freeze.
  final bool frozen;

  HistoryDay copyWith({int? count}) => HistoryDay(day: day, count: count ?? this.count, frozen: frozen);
}

/// `rewards_history`: `{"program","daily_goal","days":[{"day","count","frozen"}]}`, oldest first, ending today.
class StreakHistory {
  const StreakHistory({required this.program, this.dailyGoal = 1, this.days = const []});

  factory StreakHistory.fromJson(Map<String, Object?> m) {
    final goal = intOr(m['daily_goal'], 1);
    return StreakHistory(
      program: str(m['program']),
      dailyGoal: goal < 1 ? 1 : goal,
      days: listOf(m['days'], HistoryDay.fromJson),
    );
  }

  final String program;
  final int dailyGoal;
  final List<HistoryDay> days;

  /// The last day (today), or null.
  HistoryDay? get today => days.isEmpty ? null : days.last;

  /// The same history with today's count replaced (after a track changed it).
  StreakHistory withTodayCount(int count) => days.isEmpty
      ? this
      : StreakHistory(
          program: program,
          dailyGoal: dailyGoal,
          days: [
            ...days.take(days.length - 1),
            days.last.copyWith(count: count),
          ],
        );

  /// Heatmap level 0..4 for [count] against [dailyGoal]: 0 none, 1 started (below the goal), 2 goal met, 3 twice the
  /// goal, 4 three times or more.
  int levelOf(int count) {
    if (count <= 0) return 0;
    if (count < dailyGoal) return 1;
    if (count < dailyGoal * 2) return 2;
    if (count < dailyGoal * 3) return 3;
    return 4;
  }
}

/// `YYYY-MM-DD` as a UTC date; null when it is not one.
DateTime? parseDay(Object? v) {
  if (v is! String || v.length < 10) return null;
  final d = DateTime.tryParse(v.substring(0, 10));
  return d == null ? null : DateTime.utc(d.year, d.month, d.day);
}

/// A date as `YYYY-MM-DD` (its year, month and day; no time zone change).
String formatDay(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// One line of a recap's event counts.
class RecapEvent {
  const RecapEvent({required this.type, this.count = 0});
  factory RecapEvent.fromJson(Map<String, Object?> m) => RecapEvent(type: str(m['type']), count: intOr(m['count']));
  final String type;
  final int count;
}

/// One line of a recap's grants: [count] grants of [kind] adding up to [amount].
class RecapGrant {
  const RecapGrant({required this.kind, this.amount = 0, this.count = 0});
  factory RecapGrant.fromJson(Map<String, Object?> m) =>
      RecapGrant(kind: str(m['kind']), amount: numOr(m['amount']), count: intOr(m['count']));
  final String kind;
  final num amount;
  final int count;

  RewardSpec get spec => RewardSpec(kind: kind, amount: amount);
}

/// `rewards_recap(from_day, to_day)`: `{"days_active","events","grants","best_streak","badges"}`.
class Recap {
  const Recap({
    this.from,
    this.to,
    this.daysActive = 0,
    this.events = const [],
    this.grants = const [],
    this.bestStreak = 0,
    this.badges = const [],
  });

  factory Recap.fromJson(Map<String, Object?> m, {DateTime? from, DateTime? to}) => Recap(
    from: from,
    to: to,
    daysActive: intOr(m['days_active']),
    events: listOf(m['events'], RecapEvent.fromJson),
    grants: listOf(m['grants'], RecapGrant.fromJson),
    bestStreak: intOr(m['best_streak']),
    badges: [
      if (m['badges'] is List)
        for (final b in m['badges'] as List)
          if (b is Map) Badge.fromJson(optMap(b)) else if (b is String) Badge(badge: b),
    ],
  );

  final DateTime? from;
  final DateTime? to;
  final int daysActive;
  final List<RecapEvent> events;
  final List<RecapGrant> grants;
  final int bestStreak;
  final List<Badge> badges;
}
