/// Strings of the 0.2 widgets, English defaults, every one overridable:
/// `RewardsTexts(quiz: QuizTexts(start: 'Go'), programs: ProgramTexts(windowTitle: 'Double coins'))`.
library;

import 'programs.dart';

/// The quiz card and quiz screen.
class QuizTexts {
  const QuizTexts({
    this.title = 'Daily quiz',
    this.start = 'Start',
    this.resume = 'Resume',
    this.seeResult = 'See result',
    this.tryAgain = 'Try again',
    this.done = 'Done',
    this.next = 'Next',
    this.retry = 'Retry',
    this.closesIn = 'New quiz in',
    this.comeBack = 'Come back tomorrow for a new quiz',
    this.right = 'Right!',
    this.wrong = 'Not quite',
    this.timeUp = "Time's up",
    this.trueLabel = 'True',
    this.falseLabel = 'False',
    this.oddOneOut = 'Which one does not belong?',
    this.playSound = 'Play sound',
    this.noReward = 'No reward this time. Keep practising!',
    this.unavailable = 'The quiz is not available right now.',
    this.rules = _rules,
    this.questionOf = _questionOf,
    this.score = _score,
  });

  final String title;
  final String start;
  final String resume;
  final String seeResult;
  final String tryAgain;
  final String done;
  final String next;
  final String retry;

  /// Before the countdown to the end of today's quiz.
  final String closesIn;
  final String comeBack;
  final String right;
  final String wrong;
  final String timeUp;
  final String trueLabel;
  final String falseLabel;
  final String oddOneOut;
  final String playSound;
  final String noReward;
  final String unavailable;

  /// The intro line, from the number of questions.
  final String Function(int total) rules;

  /// "Question 2 of 10" (1-based).
  final String Function(int number, int total) questionOf;

  /// "7 of 10 right".
  final String Function(int score, int total) score;

  static String _rules(int total) =>
      '$total ${total == 1 ? 'question' : 'questions'}. Answer each one before its timer runs out.';
  static String _questionOf(int n, int total) => 'Question $n of $total';
  static String _score(int score, int total) => '$score of $total right';
}

/// Quests, recharges, windows, friend streaks, heatmap, daily goal, mystery odds, recap, post links and ads.
class ProgramTexts {
  const ProgramTexts({
    this.questsTitle = 'Quests',
    this.questResetsIn = 'Resets in',
    this.questBonus = _questBonus,
    this.questTask = _questTask,
    this.questDone = 'All done!',
    this.rechargeNextIn = 'Next in',
    this.rechargeFull = 'Full',
    this.rechargeUse = 'Use one',
    this.windowTitle = 'Happy hour',
    this.windowEndsIn = 'ends in',
    this.windowStartsIn = 'starts in',
    this.friendsTitle = 'Friend streaks',
    this.friendsEmpty = 'Keep a streak going with a friend.',
    this.friendInvite = 'Invite a friend',
    this.friendCodeLabel = "Friend's code",
    this.friendAccept = 'Add',
    this.friendRemove = 'End streak',
    this.friendYourTurn = 'Your turn today',
    this.friendBothDone = 'Both done today',
    this.friendWaiting = _friendWaiting,
    this.friendDays = _friendDays,
    this.heatmapLess = 'Less',
    this.heatmapMore = 'More',
    this.goal = _goal,
    this.goalDone = 'Goal met',
    this.oddsTitle = 'What it can be',
    this.recapTitle = 'Your recap',
    this.recapDaysActive = _recapDaysActive,
    this.recapBestStreak = _recapBestStreak,
    this.recapEarned = 'Earned',
    this.recapEvent = _recapEvent,
    this.postLinkLabel = 'Link to your post',
    this.postLinkSend = 'Send link',
    this.postLinkSent = 'Link sent. We will check it.',
    this.adNotVerified = 'The ad did not finish, so there is no reward this time.',
    this.adError = 'The ad could not be shown. Try again later.',
  });

  final String questsTitle;
  final String questResetsIn;
  final String Function(String reward) questBonus;

  /// A task's line; the default turns the task key into words (`read_3` → "Read 3").
  final String Function(QuestTask task) questTask;
  final String questDone;
  final String rechargeNextIn;
  final String rechargeFull;
  final String rechargeUse;

  /// The window's name when the program has no `public.title`.
  final String windowTitle;
  final String windowEndsIn;
  final String windowStartsIn;
  final String friendsTitle;
  final String friendsEmpty;
  final String friendInvite;
  final String friendCodeLabel;
  final String friendAccept;
  final String friendRemove;
  final String friendYourTurn;
  final String friendBothDone;
  final String Function(String name) friendWaiting;
  final String Function(int days) friendDays;
  final String heatmapLess;
  final String heatmapMore;

  /// The daily goal ring's centre: "1/2".
  final String Function(int count, int goal) goal;
  final String goalDone;
  final String oddsTitle;
  final String recapTitle;
  final String Function(int days) recapDaysActive;
  final String Function(int days) recapBestStreak;
  final String recapEarned;
  final String Function(String type, int count) recapEvent;
  final String postLinkLabel;
  final String postLinkSend;
  final String postLinkSent;
  final String adNotVerified;
  final String adError;

  static String _questBonus(String reward) => 'Finish all for $reward';
  static String _questTask(QuestTask t) => humanize(t.key);
  static String _friendWaiting(String name) => 'Waiting for ${name.isEmpty ? 'your friend' : name}';
  static String _friendDays(int d) => '$d ${d == 1 ? 'day' : 'days'} together';
  static String _goal(int count, int goal) => '$count/$goal';
  static String _recapDaysActive(int d) => '$d ${d == 1 ? 'day' : 'days'} active';
  static String _recapBestStreak(int d) => 'Best streak: $d ${d == 1 ? 'day' : 'days'}';
  static String _recapEvent(String type, int count) => '${humanize(type)}: $count';
}

/// `chapter_read` → "Chapter read".
String humanize(String key) {
  final t = key.replaceAll('_', ' ').trim();
  return t.isEmpty ? t : t[0].toUpperCase() + t.substring(1);
}

/// A chance 0..1 as an honest percentage: whole when it is whole, one decimal below 10 %, "<0.1%" for tiny ones.
String formatPercent(double chance) {
  final p = chance * 100;
  if (p <= 0) return '0%';
  if (p < 0.1) return '<0.1%';
  if (p == p.roundToDouble()) return '${p.toInt()}%';
  if (p < 10) return '${p.toStringAsFixed(1)}%';
  return '${p.round()}%';
}
