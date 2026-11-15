/// Weekly leagues (ADR 0002 §18.10): what `rewards_league`, `rewards_league_join` and `rewards_league_leave` return.
/// Other members arrive only as a display name (from the app's hook, or null), a score and a place; never an id.
library;

import 'json.dart';
import 'models.dart';

/// Where a member moved at last week's close.
enum LeagueTierChange {
  up('up'),
  same('same'),
  down('down');

  const LeagueTierChange(this.wire);
  final String wire;

  static LeagueTierChange parse(Object? v) =>
      LeagueTierChange.values.firstWhere((e) => e.wire == v, orElse: () => LeagueTierChange.same);
}

/// One row of this week's board.
class LeagueMember {
  const LeagueMember({this.rank, this.name, this.score = 0, this.me = false});

  factory LeagueMember.fromJson(Map<String, Object?> m) {
    final name = optStr(m['name'])?.trim();
    return LeagueMember(
      rank: optInt(m['rank']),
      name: name == null || name.isEmpty ? null : name,
      score: intOr(m['score']),
      me: boolOr(m['me']),
    );
  }

  /// The place (ties share one), or null while below the league's `min_score`.
  final int? rank;

  /// The app's display name for that member, or null (the widget shows a neutral word).
  final String? name;
  final int score;

  /// True on the signed-in user's own row.
  final bool me;
}

/// The member's own result of the last closed week.
class LeagueLastWeek {
  const LeagueLastWeek({
    this.week,
    this.rank,
    this.score = 0,
    this.tierChange = LeagueTierChange.same,
    this.grants = const [],
  });

  factory LeagueLastWeek.fromJson(Map<String, Object?> m) => LeagueLastWeek(
    week: _day(m['week']),
    rank: optInt(m['rank']),
    score: intOr(m['score']),
    tierChange: LeagueTierChange.parse(m['tier_change']),
    grants: listOf(m['grants'], RewardGrant.fromJson),
  );

  /// The week's first day (a date, UTC midnight).
  final DateTime? week;
  final int? rank;
  final int score;
  final LeagueTierChange tierChange;
  final List<RewardGrant> grants;
}

/// One league as the member sees it this week.
class LeagueState {
  const LeagueState({
    required this.program,
    this.live = true,
    this.joined = false,
    this.tier = 0,
    this.tierName,
    this.tiers = const [],
    this.week,
    this.startsAt,
    this.endsAt,
    this.serverTime,
    this.groupSize = 20,
    this.promote = 0,
    this.demote = 0,
    this.minScore = 1,
    this.rank,
    this.score = 0,
    this.size = 0,
    this.members = const [],
    this.rewards = const [],
    this.lastWeek,
  });

  factory LeagueState.fromJson(Map<String, Object?> m) => LeagueState(
    program: str(m['program']),
    live: boolOr(m['live'], true),
    joined: boolOr(m['joined']),
    tier: intOr(m['tier']),
    tierName: _optName(m['tier_name']),
    tiers: [
      if (m['tiers'] is List)
        for (final t in m['tiers'] as List) ?_optName(t),
    ],
    week: _day(m['week']),
    startsAt: time(m['starts_at']),
    endsAt: time(m['ends_at']),
    serverTime: time(m['server_time']),
    groupSize: intOr(m['group_size'], 20),
    promote: intOr(m['promote']),
    demote: intOr(m['demote']),
    minScore: intOr(m['min_score'], 1),
    rank: optInt(m['rank']),
    score: intOr(m['score']),
    size: intOr(m['size']),
    members: listOf(m['members'], LeagueMember.fromJson),
    rewards: listOf(m['rewards'], RewardSpec.fromJson),
    lastWeek: m['last_week'] is Map ? LeagueLastWeek.fromJson(optMap(m['last_week'])) : null,
  );

  final String program;

  /// False when the program is switched off or outside its season: no board, joining is refused.
  final bool live;

  /// True when the user opted in and has not left.
  final bool joined;

  /// The member's tier (0 = the first) and its name (null without named tiers).
  final int tier;
  final String? tierName;

  /// Tier names, lowest first (empty without named tiers).
  final List<String> tiers;

  /// This week's first day, and its real start and end on the server.
  final DateTime? week;
  final DateTime? startsAt;
  final DateTime? endsAt;
  final DateTime? serverTime;

  /// At most this many members share a board.
  final int groupSize;

  /// How many move up / down a tier at the weekly close (0 = none). Shown as rules, never as a zone on the board.
  final int promote;
  final int demote;

  /// Points needed to be ranked and rewarded.
  final int minScore;

  /// The member's own place (null while unranked), score, and how many share the board.
  final int? rank;
  final int score;
  final int size;

  /// The board, highest score first. Empty when not joined.
  final List<LeagueMember> members;

  /// What each place pays: `threshold` = a place ("top N"); only the best one reached is paid.
  final List<RewardSpec> rewards;

  /// The member's own last closed week, or null.
  final LeagueLastWeek? lastWeek;

  /// True when a tier above this one exists (promotion is possible).
  bool get canMoveUp => promote > 0 && tier < tiers.length - 1;

  /// The tier above this one, or null.
  String? get nextTierName => tier + 1 < tiers.length ? tiers[tier + 1] : null;
}

String? _optName(Object? v) => v is String && v.trim().isNotEmpty ? v.trim() : null;

DateTime? _day(Object? v) {
  if (v is! String || v.length < 10) return null;
  final d = DateTime.tryParse(v.substring(0, 10));
  return d == null ? null : DateTime.utc(d.year, d.month, d.day);
}
