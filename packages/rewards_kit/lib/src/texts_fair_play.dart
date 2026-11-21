/// Strings of the 0.7 fair-play and progress features, English defaults, every one overridable:
/// `RewardsTexts(fairPlay: FairPlayTexts(showStreaks: 'Streaks'))`.
library;

/// The choices in `FollowupSettings`, streak repair and personal best on `StreakCard`, head start and levels on
/// `MilestoneProgress`.
class FairPlayTexts {
  const FairPlayTexts({
    this.choicesTitle = 'How rewards look',
    this.showStreaks = 'Show streaks',
    this.showStreaksHint = 'Off: your days still count, the streak is just not shown',
    this.surprises = 'Surprise rewards',
    this.surprisesHint = 'Off: every reward is a fixed amount, never a draw',
    this.showTimers = 'Show timers',
    this.showTimersHint = 'Off: no countdowns or deadlines',
    this.repairEndsIn = 'Ends in',
    this.repair = _repair,
    this.streakBack = _streakBack,
    this.personalBest = _personalBest,
    this.headStart = _headStart,
    this.level = _level,
    this.toNextLevel = _toNextLevel,
  });

  /// The heading above the three switches.
  final String choicesTitle;

  /// The streaks switch (on = `streaks_off` false).
  final String showStreaks;
  final String showStreaksHint;

  /// The surprises switch (on = `surprises_off` false).
  final String surprises;
  final String surprisesHint;

  /// The timers switch (on = `timers_off` false).
  final String showTimers;
  final String showTimersHint;

  /// Before the repair's countdown (hidden while timers are off).
  final String repairEndsIn;

  /// "Do 1 more today to bring back your 20-day streak", from the events still to do and the streak it restores.
  final String Function(int left, int restoresTo) repair;

  /// Shown the day a streak was brought back: "Your 21-day streak is back".
  final String Function(int days) streakBack;

  /// The chip on a record day: "New personal best: 4 today".
  final String Function(int count) personalBest;

  /// Under a milestone with a head start: the program's `public.head_start_label` when set, else
  /// "Includes a head start of 2 from us".
  final String Function(int headStart, String? label) headStart;

  /// "Level 3 · Explorer" (or "Level 3" without a name).
  final String Function(int number, String? name) level;

  /// "4 of 8 to the next level".
  final String Function(int count, int nextAt) toNextLevel;

  static String _repair(int left, int restoresTo) => 'Do $left more today to bring back your $restoresTo-day streak';
  static String _streakBack(int days) => 'Your $days-day streak is back';
  static String _personalBest(int count) => 'New personal best: $count today';
  static String _headStart(int headStart, String? label) =>
      label == null || label.trim().isEmpty ? 'Includes a head start of $headStart from us' : label.trim();
  static String _level(int number, String? name) => name == null ? 'Level $number' : 'Level $number · $name';
  static String _toNextLevel(int count, int nextAt) => '$count of $nextAt to the next level';
}
