/// Fair play and progress (0.7, roadmap §9): the user's own choices about streaks, surprises and timers, a streak's
/// repair offer, and a milestone's level. Every reader is tolerant: an older server sends none of it, and then every
/// choice is off, there is no repair and no level.
library;

import 'json.dart';

/// What the user chose (`rewards_state().choices`, the follow-up prefs answer). All false by default and from an
/// older server.
///
/// - [streaksOff]: streaks keep counting, but no streak is shown (each streak in state is `hidden`).
/// - [surprisesOff]: no chance bonus, a mystery gives its most likely entry, a range its midpoint (`fixed` grants).
/// - [timersOff]: no countdowns or deadline chips in the widgets.
class RewardsChoices {
  const RewardsChoices({this.streaksOff = false, this.surprisesOff = false, this.timersOff = false});

  factory RewardsChoices.fromJson(Object? v) {
    final m = optMap(v);
    return RewardsChoices(
      streaksOff: boolOr(m[streaksOffKey]),
      surprisesOff: boolOr(m[surprisesOffKey]),
      timersOff: boolOr(m[timersOffKey]),
    );
  }

  static const streaksOffKey = 'streaks_off';
  static const surprisesOffKey = 'surprises_off';
  static const timersOffKey = 'timers_off';
  static const keys = {streaksOffKey, surprisesOffKey, timersOffKey};

  /// Nothing switched off.
  static const none = RewardsChoices();

  final bool streaksOff;
  final bool surprisesOff;
  final bool timersOff;

  Map<String, bool> toJson() => {streaksOffKey: streaksOff, surprisesOffKey: surprisesOff, timersOffKey: timersOff};

  RewardsChoices copyWith({bool? streaksOff, bool? surprisesOff, bool? timersOff}) => RewardsChoices(
    streaksOff: streaksOff ?? this.streaksOff,
    surprisesOff: surprisesOff ?? this.surprisesOff,
    timersOff: timersOff ?? this.timersOff,
  );

  @override
  bool operator ==(Object other) =>
      other is RewardsChoices &&
      other.streaksOff == streaksOff &&
      other.surprisesOff == surprisesOff &&
      other.timersOff == timersOff;

  @override
  int get hashCode => Object.hash(streaksOff, surprisesOff, timersOff);

  @override
  String toString() => 'RewardsChoices(streaks: ${!streaksOff}, surprises: ${!surprisesOff}, timers: ${!timersOff})';
}

/// A broken streak that can still be brought back (`streak.repair`): reach [needed] events in one day, [done] so
/// far today, before [until], and the streak returns to [restoresTo] days.
class StreakRepair {
  const StreakRepair({required this.restoresTo, this.until, this.needed = 0, this.done = 0});

  /// Null when [v] is not an object or has no `restores_to` above 0.
  static StreakRepair? fromJson(Object? v) {
    if (v is! Map) return null;
    final m = optMap(v);
    final to = optInt(m['restores_to']);
    if (to == null || to <= 0) return null;
    return StreakRepair(restoresTo: to, until: time(m['until']), needed: intOr(m['needed']), done: intOr(m['done']));
  }

  /// The streak length it comes back to.
  final int restoresTo;

  /// The last moment the repair is possible (UTC), or null when the server sent none.
  final DateTime? until;

  /// Events needed in one day.
  final int needed;

  /// Events so far today.
  final int done;

  /// Events still to do today (never negative).
  int get left => needed - done < 0 ? 0 : needed - done;
}

/// A milestone's level (`milestone.level`): level [number] (1-based) named [name], reached at [at], the next one at
/// [nextAt] (null at the top level).
class MilestoneLevel {
  const MilestoneLevel({required this.number, this.name, this.at = 0, this.nextAt});

  /// Null when [v] is not an object or has no whole `number`.
  static MilestoneLevel? fromJson(Object? v) {
    if (v is! Map) return null;
    final m = optMap(v);
    final n = optInt(m['number']);
    if (n == null) return null;
    final name = optStr(m['name'])?.trim();
    return MilestoneLevel(
      number: n,
      name: name == null || name.isEmpty ? null : name,
      at: intOr(m['at']),
      nextAt: optInt(m['next_at']),
    );
  }

  final int number;
  final String? name;

  /// The count this level starts at.
  final int at;

  /// The count of the next level, or null at the top.
  final int? nextAt;

  /// True at the last level.
  bool get isTop => nextAt == null;

  /// 0..1 from [at] to [nextAt] for [count]; 1 at the top level.
  double progress(int count) {
    final next = nextAt;
    if (next == null) return 1;
    if (next <= at) return 0;
    return ((count - at) / (next - at)).clamp(0, 1).toDouble();
  }
}
