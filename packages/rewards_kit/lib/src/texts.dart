import 'models.dart';
import 'surprise_models.dart';
import 'texts_fair_play.dart';
import 'texts_followups.dart';
import 'texts_leagues.dart';
import 'texts_reveal.dart';
import 'texts_v2.dart';

/// Every string the default widgets show, in English. Override any of them per app:
/// `RewardsTexts(claim: 'Grab it', reward: (r) => '${r.amount} gems')`. Reward kinds are the app's own, so
/// [reward] is where an app names them; the default knows `entitlement_days`, `minutes`, `badge`, `streak_freeze`
/// and falls back to "amount kind" (`5 coins`); a reward with `params.amount_range` reads "5–50 coins". The 0.2
/// widgets read [quiz] and [programs], the 0.3 surprise widgets [reveal], the 0.4
/// `FollowupSettings` [followups], the 0.6 `LeagueBoard` [leagues] and `RewardsRecapCard` [recapCard], and the 0.7
/// choices, streak repair, personal best, head start and levels [fairPlay].
class RewardsTexts {
  const RewardsTexts({
    String Function(RewardSpec reward)? reward,
    String Function(int days)? streakDays,
    this.streakLongest = 'Best',
    this.streakDoneToday = 'Done for today',
    this.streakDoToday = 'Keep your streak: do it today',
    this.streakAtRisk = 'Your streak ends in',
    this.streakFreezes = 'Freezes',
    String Function(String reward, int left)? nextIn,
    String Function(int count, int target)? progress,
    this.allEarned = 'All rewards earned',
    this.offerEndsIn = 'Ends in',
    this.claim = 'Claim',
    this.claimed = 'Claimed',
    this.offerExpired = 'This offer has ended',
    this.soldOut = 'All gone',
    String Function(int left)? stockLeft,
    String Function(String account)? socialTitle,
    this.socialHandleLabel = 'Your Instagram username',
    this.socialStart = 'Get my code',
    String Function(String account)? socialSteps,
    this.socialDisclose = 'Say it is a rewarded post (for example #ad).',
    this.copyCode = 'Copy code',
    this.codeCopied = 'Code copied',
    this.openInstagram = 'Open Instagram',
    this.socialCheckingIn = 'We look for your post for',
    this.socialVerified = 'Thanks for the post! Reward added.',
    this.socialRejected = 'We could not match your post. You can try again.',
    this.socialExpired = 'We did not find your post in time. You can try again.',
    this.socialCooldown = 'You can post again in',
    String Function(String reward)? gotReward,
    this.gotIt = 'Got it',
    this.onItsWay = 'On its way',
    this.inboxEmpty = 'No new rewards',
    String Function(String reason)? error,
    this.quiz = const QuizTexts(),
    this.programs = const ProgramTexts(),
    this.reveal = const RevealTexts(),
    this.followups = const FollowupTexts(),
    this.leagues = const LeagueTexts(),
    this.recapCard = const RecapCardTexts(),
    this.fairPlay = const FairPlayTexts(),
  }) : _reward = reward,
       _streakDays = streakDays,
       _nextIn = nextIn,
       _progress = progress,
       _stockLeft = stockLeft,
       _socialTitle = socialTitle,
       _socialSteps = socialSteps,
       _gotReward = gotReward,
       _error = error;

  final String Function(RewardSpec)? _reward;
  final String Function(int)? _streakDays;
  final String Function(String, int)? _nextIn;
  final String Function(int, int)? _progress;
  final String Function(int)? _stockLeft;
  final String Function(String)? _socialTitle;
  final String Function(String)? _socialSteps;
  final String Function(String)? _gotReward;
  final String Function(String)? _error;

  final String streakLongest;
  final String streakDoneToday;
  final String streakDoToday;
  final String streakAtRisk;
  final String streakFreezes;
  final String allEarned;
  final String offerEndsIn;
  final String claim;
  final String claimed;
  final String offerExpired;
  final String soldOut;
  final String socialHandleLabel;
  final String socialStart;
  final String socialDisclose;
  final String copyCode;
  final String codeCopied;
  final String openInstagram;
  final String socialCheckingIn;
  final String socialVerified;
  final String socialRejected;
  final String socialExpired;
  final String socialCooldown;
  final String gotIt;
  final String onItsWay;
  final String inboxEmpty;

  /// Quiz card and screen strings.
  final QuizTexts quiz;

  /// Quests, recharges, windows, friends, heatmap, goal ring, odds, recap, post links, ads.
  final ProgramTexts programs;

  /// The surprise reveal and odds.
  final RevealTexts reveal;

  /// The follow-up settings (reminders, emails, reminder time).
  final FollowupTexts followups;

  /// The weekly league board.
  final LeagueTexts leagues;

  /// The shareable recap card.
  final RecapCardTexts recapCard;

  /// Streak / surprise / timer choices, streak repair, personal best, head start and levels (0.7).
  final FairPlayTexts fairPlay;

  String reward(RewardSpec r) {
    final f = _reward;
    if (f != null) return f(r);
    final range = r.amountRange;
    final n = range == null ? _num(r.amount) : '${range.$1}–${range.$2}';
    final one = range == null ? r.amount == 1 : range.$2 == 1;
    return switch (r.kind) {
      'entitlement_days' => '$n ${one ? 'day' : 'days'} of Premium',
      'minutes' => '$n ${one ? 'minute' : 'minutes'}',
      'badge' => '"${_title(r.badge ?? 'badge')}" badge',
      'streak_freeze' => '$n streak ${one ? 'freeze' : 'freezes'}',
      'mystery' => 'a mystery reward',
      'rc_currency' => '$n ${_optName(r.params['currency_name']) ?? _optName(r.params['currency_code']) ?? 'coins'}',
      _ => '$n ${r.kind.replaceAll('_', ' ')}',
    };
  }

  String rewards(List<RewardSpec> list) => list.map(reward).join(' + ');

  /// "1 in 10 chance of 5–50 coins" for one surprise rule.
  String surpriseOdds(SurpriseOdd s) => reveal.odds(reveal.chance(s.chance ?? 0), reward(s.spec));
  String streakDays(int d) => _streakDays?.call(d) ?? '$d-day streak';
  String nextIn(String reward, int left) =>
      _nextIn?.call(reward, left) ?? '$reward in $left more ${left == 1 ? 'day' : 'days'}';
  String progress(int count, int target) => _progress?.call(count, target) ?? '$count of $target';
  String stockLeft(int left) => _stockLeft?.call(left) ?? '$left left';
  String socialTitle(String account) => _socialTitle?.call(account) ?? 'Tag @$account on Instagram';
  String socialSteps(String account) =>
      _socialSteps?.call(account) ?? 'Post a photo, reel or story, tag @$account, and put this code in the caption.';
  String gotReward(String reward) => _gotReward?.call(reward) ?? 'You got $reward';

  /// A short line for a refusal reason from a controller action.
  String error(String reason) =>
      _error?.call(reason) ??
      switch (reason) {
        'offer_expired' => offerExpired,
        'sold_out' => soldOut,
        'offer_claimed' => claimed,
        'bad_handle' => 'That does not look like an Instagram username.',
        'handle_taken' => 'That username is already used for this reward.',
        'already_posted' => 'You already got this reward.',
        'too_soon' => 'You can do this again later.',
        'offline' => 'You are offline. Try again in a moment.',
        'empty' => 'None left. More come back soon.',
        'bad_code' => 'That code does not work. Check it and try again.',
        'own_code' => 'That is your own code. Send it to a friend.',
        'too_many_friends' => 'You already have the most friend streaks.',
        'already_friends' => 'You already have a streak with this friend.',
        'bad_link' => 'That does not look like a link to a post.',
        'no_pending_post' => 'Get your code first, then send the link.',
        'no_attempts_left' => quiz.comeBack,
        'not_enough_questions' => quiz.unavailable,
        'unavailable' => quiz.unavailable,
        _ => 'Something went wrong. Try again.',
      };
}

String? _optName(Object? v) => v is String && v.trim().isNotEmpty ? v.trim() : null;

String _num(num n) => n == n.roundToDouble() ? n.toInt().toString() : n.toString();
String _title(String s) {
  final t = s.replaceAll('_', ' ');
  return t.isEmpty ? t : t[0].toUpperCase() + t.substring(1);
}

/// "2d 4h", "3h 05m", "4m 09s", "9s".
String formatLeft(Duration d) {
  if (d.isNegative) d = Duration.zero;
  final days = d.inDays, h = d.inHours % 24, m = d.inMinutes % 60, s = d.inSeconds % 60;
  String two(int v) => v.toString().padLeft(2, '0');
  if (days > 0) return '${days}d ${h}h';
  if (d.inHours > 0) return '${h}h ${two(m)}m';
  if (d.inMinutes > 0) return '${m}m ${two(s)}s';
  return '${s}s';
}
