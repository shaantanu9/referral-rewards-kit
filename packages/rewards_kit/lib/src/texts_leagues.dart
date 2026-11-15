/// Strings of the 0.6 widgets: `LeagueBoard` and `RewardsRecapCard`. Plain and calm on purpose (ADR 0002 §18.10):
/// no "hurry", no "you are falling behind", nothing about moving down.
library;

/// `LeagueBoard` strings.
class LeagueTexts {
  const LeagueTexts({
    this.title = 'Weekly league',
    this.pitch = _pitch,
    this.join = 'Join',
    this.leave = 'Leave league',
    this.weekEndsIn = 'Week ends in',
    this.member = 'A member',
    this.you = 'You',
    this.points = _points,
    this.place = _place,
    this.unranked = 'Not ranked yet',
    this.movesUp = _movesUp,
    this.placeReward = _placeReward,
    this.lastWeek = _lastWeek,
    this.movedUp = _movedUp,
    this.notLive = 'This league is not running right now.',
  });

  final String title;

  /// Shown before joining: what it is and what is shared.
  final String Function(int groupSize) pitch;
  final String join;
  final String leave;
  final String weekEndsIn;

  /// A member without a display name.
  final String member;

  /// Next to the user's own row.
  final String you;
  final String Function(int score) points;

  /// "1st", "2nd", "3rd", "4th".
  final String Function(int rank) place;
  final String unranked;

  /// "Top 3 move up to Silver" (`tier` null: "move up").
  final String Function(int count, String? tier) movesUp;

  /// "1st: 100 coins", "Top 3: 30 coins".
  final String Function(int threshold, String reward) placeReward;

  /// "Last week: 2nd with 12 points" (`rank` null: "Last week: 4 points").
  final String Function(int? rank, int score) lastWeek;

  /// "You moved up to Silver". Moving down is never announced: the tier name simply shows.
  final String Function(String? tier) movedUp;
  final String notLive;

  static String _pitch(int n) =>
      'Compete with up to $n people this week. Only your display name and score are shown. Leave any time.';
  static String _points(int s) => '$s ${s == 1 ? 'point' : 'points'}';
  static String _place(int r) => '$r${ordinalSuffix(r)}';
  static String _movesUp(int n, String? tier) => 'Top $n move up${tier == null ? '' : ' to $tier'}';
  static String _placeReward(int t, String reward) => t == 1 ? '1st: $reward' : 'Top $t: $reward';
  static String _lastWeek(int? rank, int score) =>
      rank == null ? 'Last week: ${_points(score)}' : 'Last week: ${_place(rank)} with ${_points(score)}';
  static String _movedUp(String? tier) => tier == null ? 'You moved up' : 'You moved up to $tier';
}

/// `RewardsRecapCard` strings.
class RecapCardTexts {
  const RecapCardTexts({
    this.yearTitle = _yearTitle,
    this.rangeTitle = 'Your recap',
    this.daysActive = _daysActive,
    this.bestStreak = _bestStreak,
    this.badges = _badges,
    this.earned = 'Earned',
    this.mostDone = 'Most done',
  });

  /// "Your 2026" when the recap covers one whole calendar year.
  final String Function(int year) yearTitle;
  final String rangeTitle;

  /// The labels under the big numbers.
  final String Function(int days) daysActive;
  final String Function(int days) bestStreak;
  final String Function(int count) badges;
  final String earned;
  final String mostDone;

  static String _yearTitle(int y) => 'Your $y';
  static String _daysActive(int d) => d == 1 ? 'day active' : 'days active';
  static String _bestStreak(int d) => d == 1 ? 'day best streak' : 'days best streak';
  static String _badges(int n) => n == 1 ? 'badge' : 'badges';
}

/// English ordinal suffix: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st.
String ordinalSuffix(int n) {
  final h = n % 100;
  if (h >= 11 && h <= 13) return 'th';
  return switch (n % 10) {
    1 => 'st',
    2 => 'nd',
    3 => 'rd',
    _ => 'th',
  };
}
