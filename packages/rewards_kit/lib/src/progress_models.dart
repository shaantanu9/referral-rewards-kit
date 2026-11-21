/// Streak and milestone progress (ADR 0002 §6.1, §6.2), with the 0.7 fair-play fields. Exported by `models.dart`.
library;

import 'fair_play_models.dart';
import 'json.dart';
import 'models.dart';

/// A daily streak (ADR 0002 §6.1). [endsTodayAt] is local midnight tonight (the streak is at risk after it when
/// today is not done); [breaksAt] is when it really resets, counting freezes.
class StreakState {
  const StreakState({
    required this.program,
    this.current = 0,
    this.longest = 0,
    this.todayDone = false,
    this.freezes = 0,
    this.endsTodayAt,
    this.breaksAt,
    this.nextReward,
    this.dailyGoal = 1,
    this.todayCount = 0,
    this.weeklyFreeFreezesLeft = 0,
    this.hidden = false,
    this.repair,
    this.repairedAt,
    this.bestDayCount = 0,
    this.recordToday = false,
  });

  factory StreakState.fromJson(Map<String, Object?> m) {
    final done = boolOr(m['today_done']);
    final goal = intOr(m['daily_goal'], 1);
    return StreakState(
      program: str(m['program']),
      current: intOr(m['current']),
      longest: intOr(m['longest']),
      todayDone: done,
      freezes: intOr(m['freezes']),
      endsTodayAt: time(m['ends_today_at']),
      breaksAt: time(m['breaks_at']),
      nextReward: m['next_reward'] is Map ? RewardSpec.fromJson(optMap(m['next_reward'])) : null,
      dailyGoal: goal < 1 ? 1 : goal,
      // An older server sends no count: a done day counts as the goal reached.
      todayCount: optInt(m['today_count']) ?? (done ? (goal < 1 ? 1 : goal) : 0),
      weeklyFreeFreezesLeft: intOr(m['weekly_free_freezes_left']),
      hidden: boolOr(m['hidden']),
      repair: StreakRepair.fromJson(m['repair']),
      repairedAt: time(m['repaired_at']),
      bestDayCount: intOr(m['best_day_count']),
      recordToday: boolOr(m['record_today']),
    );
  }

  final String program;
  final int current;
  final int longest;
  final bool todayDone;
  final int freezes;
  final DateTime? endsTodayAt;
  final DateTime? breaksAt;

  /// Null when nothing is left to earn.
  final RewardSpec? nextReward;

  /// Matching events needed for a day to count (`config.daily_goal`, at least 1).
  final int dailyGoal;

  /// Matching events so far today (local day).
  final int todayCount;

  /// Missed days still forgiven for free this ISO week, before earned [freezes] are spent.
  final int weeklyFreeFreezesLeft;

  /// The user switched streaks off (0.7): it keeps counting, and the widgets do not show it.
  final bool hidden;

  /// The streak broke and can still be brought back (0.7), or null.
  final StreakRepair? repair;

  /// When the streak was last brought back (0.7), or null.
  final DateTime? repairedAt;

  /// Most events of this type on one day (0.7; counted from 0.7 on).
  final int bestDayCount;

  /// Today set a new [bestDayCount] of at least 2 (0.7).
  final bool recordToday;

  /// True when [repairedAt] is less than [within] before [now] (a server-corrected time).
  bool repairedRecently(DateTime now, {Duration within = const Duration(hours: 24)}) {
    final at = repairedAt;
    if (at == null) return false;
    final ago = now.difference(at);
    return !ago.isNegative && ago < within;
  }

  /// 0..1 towards today's [dailyGoal]; 1 once [todayDone].
  double get goalProgress => todayDone ? 1 : (todayCount / dailyGoal).clamp(0, 1).toDouble();

  /// Days still to go to [nextReward], or null when unknown (no reward, or a threshold not above [current]).
  int? get daysToNextReward {
    final t = nextReward?.threshold;
    if (t == null || t <= current) return null;
    return t - current;
  }

  /// True when today is not done, there is a streak to lose, and [endsTodayAt] is within [within] of [now]
  /// (a server-corrected time: `ServerClock.now()`).
  bool atRisk(DateTime now, {Duration within = const Duration(hours: 4)}) {
    final end = endsTodayAt;
    if (todayDone || current <= 0 || end == null) return false;
    final left = end.difference(now);
    return left <= within;
  }
}

/// Milestone progress (ADR 0002 §6.2): how many events counted, and the next reward.
class MilestoneState {
  const MilestoneState({required this.program, this.count = 0, this.nextReward, this.headStart = 0, this.level});

  factory MilestoneState.fromJson(Map<String, Object?> m) {
    final head = intOr(m['head_start']);
    return MilestoneState(
      program: str(m['program']),
      count: intOr(m['count']),
      nextReward: m['next_reward'] is Map ? RewardSpec.fromJson(optMap(m['next_reward'])) : null,
      headStart: head < 0 ? 0 : head,
      level: MilestoneLevel.fromJson(m['level']),
    );
  }

  final String program;

  /// Counted so far, [headStart] included.
  final int count;

  /// Given at the start (0.7): [count] began here. 0 when none.
  final int headStart;

  /// The level reached (0.7), or null when the milestone has no levels.
  final MilestoneLevel? level;

  /// Null when nothing is left to earn.
  final RewardSpec? nextReward;

  /// The next threshold, or null when there is none.
  int? get target => nextReward?.threshold;

  /// 0..1 towards [target]; 1 when nothing is left to earn.
  double get progress {
    final t = target;
    if (nextReward == null) return 1;
    if (t == null || t <= 0) return 0;
    return (count / t).clamp(0, 1).toDouble();
  }
}
