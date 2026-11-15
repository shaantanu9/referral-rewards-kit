// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'referral_kit_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class ReferralKitLocalizationsEn extends ReferralKitLocalizations {
  ReferralKitLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get inviteTitle => 'Invite friends';

  @override
  String get yourCode => 'Your invite code';

  @override
  String get share => 'Share';

  @override
  String get copyCode => 'Copy code';

  @override
  String get codeCopied => 'Code copied';

  @override
  String get termsLink => 'Program terms';

  @override
  String get rewardsEarned => 'Rewards earned';

  @override
  String get pendingRewards => 'On the way';

  @override
  String pendingItem(String reward, String date) {
    return '$reward, around $date';
  }

  @override
  String bankedItem(String reward) {
    return '$reward, added when your current plan ends.';
  }

  @override
  String skippedCap(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count rewards were over the limit',
      one: '1 reward was over the limit',
    );
    return '$_temp0';
  }

  @override
  String joinedCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count friends joined',
      one: '1 friend joined',
    );
    return '$_temp0';
  }

  @override
  String rulesJoinedEach(String reward) {
    return 'You and your friend each get $reward when they sign up and start using the app.';
  }

  @override
  String rulesJoinedBoth(String sharerReward, String friendReward) {
    return 'You get $sharerReward and your friend gets $friendReward when they sign up and start using the app.';
  }

  @override
  String rulesJoinedSharerOnly(String reward) {
    return 'You get $reward when a friend you invited signs up and starts using the app.';
  }

  @override
  String rulesJoinedFriendOnly(String reward) {
    return 'Your friend gets $reward when they sign up and start using the app.';
  }

  @override
  String rulesPaid(String reward) {
    return 'You get $reward when a friend you invited subscribes (after any free trial).';
  }

  @override
  String capJoins(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Up to $count friends a month count.',
      one: 'Up to 1 friend a month counts.',
    );
    return '$_temp0';
  }

  @override
  String capPaid(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Up to $count subscribing friends a year count.',
      one: 'Up to 1 subscribing friend a year counts.',
    );
    return '$_temp0';
  }

  @override
  String paywallLine(String reward) {
    return 'Or get $reward free when a friend you invite subscribes.';
  }

  @override
  String get friendDisclosureBoth =>
      'Your inviter gets a reward when you start using the app, and another if you subscribe, so they\'ll know when that happens. They never see your email or what you bought.';

  @override
  String get friendDisclosureJoined =>
      'Your inviter gets a reward when you start using the app, so they\'ll know when that happens. They never see your email or what you bought.';

  @override
  String get friendDisclosurePaid =>
      'Your inviter gets a reward if you subscribe, so they\'ll know when that happens. They never see your email or what you bought.';

  @override
  String friendWelcome(String reward) {
    return 'Welcome bonus: $reward, thanks to your invite.';
  }

  @override
  String sharerJoinedReward(String reward) {
    return 'A friend you invited started using the app. You got $reward.';
  }

  @override
  String sharerPaidReward(String reward) {
    return 'A friend you invited subscribed. You got $reward.';
  }

  @override
  String shareTextBoth(String app, String code, String reward, String link) {
    return 'I\'m using $app. Join with my code $code and we both get $reward: $link';
  }

  @override
  String shareTextSharerOnly(String app, String code, String link) {
    return 'I\'m using $app. Join with my code $code and I get a bonus: $link';
  }

  @override
  String shareTextFriendOnly(String app, String code, String reward, String link) {
    return 'I\'m using $app. Join with my code $code and you get $reward: $link';
  }

  @override
  String shareTextPlain(String app, String code, String link) {
    return 'I\'m using $app. Join with my code $code: $link';
  }

  @override
  String emptyEach(String reward) {
    return 'No invites yet. Share your code: you each get $reward when a friend starts using the app.';
  }

  @override
  String emptySharerOnly(String reward) {
    return 'No invites yet. Share your code: you get $reward when a friend starts using the app.';
  }

  @override
  String get emptyPlain => 'No invites yet. Share your code with a friend.';

  @override
  String get paused => 'Invites are paused right now. Rewards you\'ve earned are safe.';

  @override
  String get codeDisabled => 'Your code is paused while we review it. Rewards you\'ve earned are safe.';

  @override
  String get loadFailed => 'Couldn\'t load your invites. Check your connection and try again.';

  @override
  String get retry => 'Try again';

  @override
  String get notAvailable => 'Invites aren\'t available yet. Check back soon.';

  @override
  String get notAvailableCodeKept =>
      'Invite codes aren\'t available yet. We saved your code and will add it when they are.';

  @override
  String get dismiss => 'Got it';

  @override
  String get enterCodeTitle => 'Have an invite code?';

  @override
  String get codeFieldLabel => 'Invite code';

  @override
  String get addCode => 'Add code';

  @override
  String useCode(String code) {
    return 'Use code $code';
  }

  @override
  String get enterDifferentCode => 'Enter a different code';

  @override
  String get paste => 'Paste';

  @override
  String windowCountdown(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'You can add an invite code for $days more days',
      one: 'You can add an invite code for 1 more day',
    );
    return '$_temp0';
  }

  @override
  String windowOver(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'Invite codes can only be added in your first $days days',
      one: 'Invite codes can only be added in your first day',
    );
    return '$_temp0';
  }

  @override
  String get claimOk => 'Code added.';

  @override
  String get offlineQueued => 'We\'ll apply your code when you\'re back online.';

  @override
  String get errOwnCode => 'That\'s your own code. Share it with a friend instead.';

  @override
  String get errAlreadyReferred => 'You\'ve already used an invite code.';

  @override
  String get errUnknownCode =>
      'We couldn\'t find that code. Codes have 8 letters or numbers and never contain O, 0, I, 1 or L.';

  @override
  String errWindowClosed(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'Invite codes can be added in your first $days days.',
      one: 'Invite codes can be added in your first day.',
    );
    return '$_temp0';
  }

  @override
  String errRateLimited(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: 'Too many tries. Try again in $minutes min.',
      one: 'Too many tries. Try again in 1 min.',
    );
    return '$_temp0';
  }

  @override
  String get errNotVerified => 'Confirm your email and we\'ll add your code then.';

  @override
  String get errSameInstall => 'This code can\'t be used on this device.';

  @override
  String get errProgramPaused => 'Invites are paused right now.';

  @override
  String get errUnavailable => 'Invites aren\'t available for this account.';

  @override
  String get errGeneric => 'We couldn\'t add that code right now. Try again later.';

  @override
  String rewardMinutes(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count min', one: '1 min');
    return '$_temp0';
  }

  @override
  String rewardEntitlementDays(int count, String name) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count days of $name',
      one: '1 day of $name',
    );
    return '$_temp0';
  }

  @override
  String rewardOther(String amount, String kind) {
    return '$amount $kind';
  }

  @override
  String giftWaiting(String reward) {
    return 'A gift is waiting for you: $reward';
  }

  @override
  String get giftWaitingPlain => 'A gift from a friend is waiting for you';

  @override
  String daysLeftToAdd(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Only $count days left to add a code',
      one: 'Last day to add a code',
    );
    return '$_temp0';
  }

  @override
  String get stepsTitle => 'How you get it';

  @override
  String get stepAddCode => 'Add your friend\'s code';

  @override
  String stepStartUsing(String app) {
    return 'Start using $app';
  }

  @override
  String stepRewardYou(String reward) {
    return '$reward lands in your account';
  }

  @override
  String stepRewardBoth(String reward) {
    return '$reward lands for you, and for your friend';
  }

  @override
  String get stepGift => 'Your gift unlocks';

  @override
  String get almostTitle => 'Almost yours';

  @override
  String almostLine(String reward) {
    return 'Start using the app and your $reward unlocks.';
  }

  @override
  String almostLineBoth(String reward) {
    return 'Start using the app and your $reward unlocks. Your friend gets theirs too.';
  }

  @override
  String get almostLinePlain => 'Start using the app and your gift unlocks.';

  @override
  String get almostProgress => '1 of 2 done: code added';

  @override
  String cannotAddClosed(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'Codes are for your first $days days, and yours have passed.',
      one: 'Codes are for your first day, and yours has passed.',
    );
    return '$_temp0';
  }

  @override
  String cannotAddNotEligible(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'A friend\'s code can be added once, in your first $days days. This account can\'t add one now.',
      one: 'A friend\'s code can be added once, in your first day. This account can\'t add one now.',
    );
    return '$_temp0';
  }

  @override
  String noLinkHint(String app) {
    return 'Your friend gets $app from the app store and types this code in.';
  }

  @override
  String shareTextNoLinkBoth(String app, String code, String reward, String link) {
    return 'I\'m using $app. Get it, add my invite code $code and we both get $reward: $link';
  }

  @override
  String shareTextNoLinkFriend(String app, String code, String reward, String link) {
    return 'I\'m using $app. Get it, add my invite code $code and you get $reward: $link';
  }

  @override
  String shareTextNoLinkPlain(String app, String code, String link) {
    return 'I\'m using $app. Get it and add my invite code $code: $link';
  }

  @override
  String shareTextCodeOnly(String app, String code) {
    return 'I\'m using $app. Get it and add my invite code $code.';
  }

  @override
  String get signInToInvite => 'Sign in to get your invite code and to add a friend\'s code.';

  @override
  String get signIn => 'Sign in';

  @override
  String get notInThisVersion => 'Invites aren\'t part of this version of the app.';
}
