/// Typed pieces of the `rewards_state` object (ADR 0002 §11). Every `fromJson` tolerates missing optional fields
/// and reads times as UTC.
library;

import 'json.dart';

/// Program kinds (ADR 0002 §4). [unknown] covers a kind a newer server adds.
enum ProgramKind {
  streak('streak'),
  milestone('milestone'),
  socialTag('social_tag'),
  offer('offer'),
  quiz('quiz'),
  questSet('quest_set'),
  comeback('comeback'),
  recharge('recharge'),
  window('window'),
  friendStreak('friend_streak'),
  league('league'),
  unknown('unknown');

  const ProgramKind(this.wire);
  final String wire;

  static ProgramKind fromWire(Object? v) =>
      values.firstWhere((k) => k.wire == v && k != unknown, orElse: () => unknown);
}

/// One reward a rule gives: `{"threshold": 7, "kind": "coins", "amount": 50, "params": {}}`. Kinds are the app's
/// own (`coins`, `minutes`, `credits`, `entitlement_days`, `badge`, `streak_freeze`, ...). [threshold] is null for
/// offer and social rewards.
///
/// A `mystery` reward (ADR 0002 §18.1) carries its [odds]: what it can turn into and how likely each is. Show them
/// before it is earned ([MysteryOdds]); that honesty is a store rule, not a nicety.
class RewardSpec {
  const RewardSpec({required this.kind, this.amount = 0, this.threshold, this.params = const {}, this.odds = const []});

  factory RewardSpec.fromJson(Map<String, Object?> m) {
    final params = optMap(m['params']);
    return RewardSpec(
      kind: str(m['kind']),
      amount: numOr(m['amount']),
      threshold: optInt(m['threshold']),
      params: params,
      odds: MysteryOdd.listFrom(m['odds'] ?? params['table']),
    );
  }

  final String kind;
  final num amount;
  final int? threshold;
  final Map<String, Object?> params;

  /// For a `mystery` reward: each outcome with its chance (summing to 1). Empty for any other kind.
  final List<MysteryOdd> odds;

  /// `params.badge` for a `badge` reward.
  String? get badge => optStr(params['badge']);

  /// True for kind `mystery`.
  bool get isMystery => kind == 'mystery';

  /// `params.chance` (ADR 0002 §18.6): when the rule would pay, it pays only with this probability. Null when
  /// missing or not 0 < chance ≤ 1.
  double? get chance => optChance(params['chance']);

  /// `params.amount_range` `[min, max]` (§18.6): the amount is drawn between them; [amount] is the max. Null when
  /// missing or malformed (not two whole numbers with 0 ≤ min ≤ max).
  (int, int)? get amountRange => optRange(params['amount_range']);

  @override
  bool operator ==(Object other) =>
      other is RewardSpec &&
      other.kind == kind &&
      other.amount == amount &&
      other.threshold == threshold &&
      _sameMap(other.params, params);

  @override
  int get hashCode => Object.hash(kind, amount, threshold, params.length);

  @override
  String toString() => 'RewardSpec($kind, $amount, threshold: $threshold)';
}

/// One outcome of a `mystery` reward: `{"kind", "amount", "params", "chance"}`, [chance] from 0 to 1.
class MysteryOdd {
  const MysteryOdd({required this.kind, this.amount = 0, this.params = const {}, this.chance = 0});

  factory MysteryOdd.fromJson(Map<String, Object?> m) => MysteryOdd(
    kind: str(m['kind']),
    amount: numOr(m['amount']),
    params: optMap(m['params']),
    chance: numOr(m['chance']).toDouble(),
  );

  /// Reads `next_reward.odds`. Tolerates a server that sends the rule's `params.table` (`weight` instead of
  /// `chance`): weights are turned into chances that sum to 1. A chance above 1 is read as a percentage.
  static List<MysteryOdd> listFrom(Object? v) {
    if (v is! List) return const [];
    final maps = [
      for (final item in v)
        if (item is Map) optMap(item),
    ];
    if (maps.isEmpty) return const [];
    final hasChance = maps.every((m) => m['chance'] != null);
    if (hasChance) {
      final odds = maps.map(MysteryOdd.fromJson).toList();
      final percent = odds.any((o) => o.chance > 1);
      return percent ? [for (final o in odds) o._withChance(o.chance / 100)] : odds;
    }
    final weights = [for (final m in maps) numOr(m['weight']).toDouble()];
    final total = weights.fold<double>(0, (a, b) => a + (b > 0 ? b : 0));
    return [
      for (var i = 0; i < maps.length; i++)
        MysteryOdd.fromJson(maps[i])._withChance(total <= 0 || weights[i] <= 0 ? 0 : weights[i] / total),
    ];
  }

  final String kind;
  final num amount;
  final Map<String, Object?> params;
  final double chance;

  MysteryOdd _withChance(double c) => MysteryOdd(kind: kind, amount: amount, params: params, chance: c);

  /// The outcome as a [RewardSpec], for `RewardsTexts.reward`.
  RewardSpec get spec => RewardSpec(kind: kind, amount: amount, params: params);
}

bool _sameMap(Map<String, Object?> a, Map<String, Object?> b) =>
    a.length == b.length && a.keys.every((k) => b.containsKey(k) && b[k] == a[k]);

/// Grant states (ADR 0002 §5). Kept as strings on [RewardGrant.state]; these are the names.
abstract final class GrantState {
  static const queued = 'queued';
  static const granting = 'granting';
  static const granted = 'granted';
  static const failedRetryable = 'failed_retryable';
  static const failed = 'failed';
  static const cancelled = 'cancelled';
  static const skippedCap = 'skipped_cap';
}

/// One grant from `inbox`, `rewards_track` or `rewards_offer_claim`.
class RewardGrant {
  const RewardGrant({
    required this.id,
    required this.program,
    required this.kind,
    this.amount = 0,
    this.params = const {},
    this.state = GrantState.granted,
    this.createdAt,
  });

  factory RewardGrant.fromJson(Map<String, Object?> m) => RewardGrant(
    id: str(m['id']),
    program: str(m['program']),
    kind: str(m['kind']),
    amount: numOr(m['amount']),
    params: optMap(m['params']),
    state: m['state'] == null ? GrantState.granted : str(m['state']),
    createdAt: time(m['created_at']),
  );

  final String id;
  final String program;
  final String kind;
  final num amount;
  final Map<String, Object?> params;

  /// `granted`, `queued`, `granting`, `failed_retryable`, ... (see [GrantState]). Missing means `granted`.
  final String state;
  final DateTime? createdAt;

  /// The reward as a [RewardSpec], for `RewardsTexts.reward`.
  RewardSpec get spec => RewardSpec(kind: kind, amount: amount, params: params);

  /// Granted, or on its way (`queued` / `granting`, e.g. Premium days the Edge Function has not given yet).
  bool get isDeliveredOrOnTheWay =>
      state == GrantState.granted || state == GrantState.queued || state == GrantState.granting;

  /// Paid by a rule with `params.chance` (the grant's `params.surprise` is true).
  bool get isSurprise => boolOr(params['surprise']);

  /// Picked from a `mystery` table (the grant's `params.mystery` is set and not false).
  bool get isMystery => _set(params['mystery']);

  /// The `[min, max]` the amount was drawn from (`params.range`), or null.
  (int, int)? get range => optRange(params['range']);

  /// True when the grant deserves the reveal rather than a toast: its params have `surprise`, `mystery` or `range`
  /// (ADR 0002 §18.6).
  bool get shouldReveal => isSurprise || isMystery || _set(params['range']);

  static bool _set(Object? v) => v != null && v != false && v != 'false';

  @override
  String toString() => 'RewardGrant($id, $program, $kind $amount, $state)';
}

/// A badge the user holds.
class Badge {
  const Badge({required this.badge, this.program, this.grantedAt});

  factory Badge.fromJson(Map<String, Object?> m) =>
      Badge(badge: str(m['badge']), program: optStr(m['program']), grantedAt: time(m['granted_at']));

  final String badge;
  final String? program;
  final DateTime? grantedAt;
}

/// One live program: `{"key": "daily", "kind": "streak", "starts_at": null, "ends_at": null, "public": {}}`.
/// [public] is the app's own display JSON (an icon name, a title), passed through untouched.
class ProgramInfo {
  const ProgramInfo({
    required this.key,
    required this.kind,
    this.kindWire = '',
    this.startsAt,
    this.endsAt,
    this.public = const {},
  });

  factory ProgramInfo.fromJson(Map<String, Object?> m) => ProgramInfo(
    key: str(m['key']),
    kind: ProgramKind.fromWire(m['kind']),
    kindWire: str(m['kind']),
    startsAt: time(m['starts_at']),
    endsAt: time(m['ends_at']),
    public: optMap(m['public']),
  );

  final String key;
  final ProgramKind kind;

  /// The kind as the server sent it (useful when [kind] is [ProgramKind.unknown]).
  final String kindWire;
  final DateTime? startsAt;
  final DateTime? endsAt;
  final Map<String, Object?> public;
}

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
  const MilestoneState({required this.program, this.count = 0, this.nextReward});

  factory MilestoneState.fromJson(Map<String, Object?> m) => MilestoneState(
    program: str(m['program']),
    count: intOr(m['count']),
    nextReward: m['next_reward'] is Map ? RewardSpec.fromJson(optMap(m['next_reward'])) : null,
  );

  final String program;
  final int count;

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
