import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'referral_kit_localizations_en.dart';
import 'referral_kit_localizations_hi.dart';
import 'referral_kit_localizations_id.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of ReferralKitLocalizations
/// returned by `ReferralKitLocalizations.of(context)`.
///
/// Applications need to include `ReferralKitLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'gen/referral_kit_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: ReferralKitLocalizations.localizationsDelegates,
///   supportedLocales: ReferralKitLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the ReferralKitLocalizations.supportedLocales
/// property.
abstract class ReferralKitLocalizations {
  ReferralKitLocalizations(String locale) : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static ReferralKitLocalizations of(BuildContext context) {
    return Localizations.of<ReferralKitLocalizations>(context, ReferralKitLocalizations)!;
  }

  static const LocalizationsDelegate<ReferralKitLocalizations> delegate = _ReferralKitLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates = <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[Locale('en'), Locale('hi'), Locale('id')];

  /// No description provided for @inviteTitle.
  ///
  /// In en, this message translates to:
  /// **'Invite friends'**
  String get inviteTitle;

  /// No description provided for @yourCode.
  ///
  /// In en, this message translates to:
  /// **'Your invite code'**
  String get yourCode;

  /// No description provided for @share.
  ///
  /// In en, this message translates to:
  /// **'Share'**
  String get share;

  /// No description provided for @copyCode.
  ///
  /// In en, this message translates to:
  /// **'Copy code'**
  String get copyCode;

  /// No description provided for @codeCopied.
  ///
  /// In en, this message translates to:
  /// **'Code copied'**
  String get codeCopied;

  /// No description provided for @termsLink.
  ///
  /// In en, this message translates to:
  /// **'Program terms'**
  String get termsLink;

  /// No description provided for @rewardsEarned.
  ///
  /// In en, this message translates to:
  /// **'Rewards earned'**
  String get rewardsEarned;

  /// No description provided for @pendingRewards.
  ///
  /// In en, this message translates to:
  /// **'On the way'**
  String get pendingRewards;

  /// No description provided for @pendingItem.
  ///
  /// In en, this message translates to:
  /// **'{reward}, around {date}'**
  String pendingItem(String reward, String date);

  /// No description provided for @bankedItem.
  ///
  /// In en, this message translates to:
  /// **'{reward}, added when your current plan ends.'**
  String bankedItem(String reward);

  /// No description provided for @skippedCap.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 reward was over the limit} other{{count} rewards were over the limit}}'**
  String skippedCap(int count);

  /// No description provided for @joinedCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 friend joined} other{{count} friends joined}}'**
  String joinedCount(int count);

  /// No description provided for @rulesJoinedEach.
  ///
  /// In en, this message translates to:
  /// **'You and your friend each get {reward} when they sign up and start using the app.'**
  String rulesJoinedEach(String reward);

  /// No description provided for @rulesJoinedBoth.
  ///
  /// In en, this message translates to:
  /// **'You get {sharerReward} and your friend gets {friendReward} when they sign up and start using the app.'**
  String rulesJoinedBoth(String sharerReward, String friendReward);

  /// No description provided for @rulesJoinedSharerOnly.
  ///
  /// In en, this message translates to:
  /// **'You get {reward} when a friend you invited signs up and starts using the app.'**
  String rulesJoinedSharerOnly(String reward);

  /// No description provided for @rulesJoinedFriendOnly.
  ///
  /// In en, this message translates to:
  /// **'Your friend gets {reward} when they sign up and start using the app.'**
  String rulesJoinedFriendOnly(String reward);

  /// No description provided for @rulesPaid.
  ///
  /// In en, this message translates to:
  /// **'You get {reward} when a friend you invited subscribes (after any free trial).'**
  String rulesPaid(String reward);

  /// No description provided for @capJoins.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Up to 1 friend a month counts.} other{Up to {count} friends a month count.}}'**
  String capJoins(int count);

  /// No description provided for @capPaid.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Up to 1 subscribing friend a year counts.} other{Up to {count} subscribing friends a year count.}}'**
  String capPaid(int count);

  /// No description provided for @paywallLine.
  ///
  /// In en, this message translates to:
  /// **'Or get {reward} free when a friend you invite subscribes.'**
  String paywallLine(String reward);

  /// No description provided for @friendDisclosureBoth.
  ///
  /// In en, this message translates to:
  /// **'Your inviter gets a reward when you start using the app, and another if you subscribe, so they\'ll know when that happens. They never see your email or what you bought.'**
  String get friendDisclosureBoth;

  /// No description provided for @friendDisclosureJoined.
  ///
  /// In en, this message translates to:
  /// **'Your inviter gets a reward when you start using the app, so they\'ll know when that happens. They never see your email or what you bought.'**
  String get friendDisclosureJoined;

  /// No description provided for @friendDisclosurePaid.
  ///
  /// In en, this message translates to:
  /// **'Your inviter gets a reward if you subscribe, so they\'ll know when that happens. They never see your email or what you bought.'**
  String get friendDisclosurePaid;

  /// No description provided for @friendWelcome.
  ///
  /// In en, this message translates to:
  /// **'Welcome bonus: {reward}, thanks to your invite.'**
  String friendWelcome(String reward);

  /// No description provided for @sharerJoinedReward.
  ///
  /// In en, this message translates to:
  /// **'A friend you invited started using the app. You got {reward}.'**
  String sharerJoinedReward(String reward);

  /// No description provided for @sharerPaidReward.
  ///
  /// In en, this message translates to:
  /// **'A friend you invited subscribed. You got {reward}.'**
  String sharerPaidReward(String reward);

  /// No description provided for @shareTextBoth.
  ///
  /// In en, this message translates to:
  /// **'I\'m using {app}. Join with my code {code} and we both get {reward}: {link}'**
  String shareTextBoth(String app, String code, String reward, String link);

  /// No description provided for @shareTextSharerOnly.
  ///
  /// In en, this message translates to:
  /// **'I\'m using {app}. Join with my code {code} and I get a bonus: {link}'**
  String shareTextSharerOnly(String app, String code, String link);

  /// No description provided for @shareTextFriendOnly.
  ///
  /// In en, this message translates to:
  /// **'I\'m using {app}. Join with my code {code} and you get {reward}: {link}'**
  String shareTextFriendOnly(String app, String code, String reward, String link);

  /// No description provided for @shareTextPlain.
  ///
  /// In en, this message translates to:
  /// **'I\'m using {app}. Join with my code {code}: {link}'**
  String shareTextPlain(String app, String code, String link);

  /// No description provided for @emptyEach.
  ///
  /// In en, this message translates to:
  /// **'No invites yet. Share your code: you each get {reward} when a friend starts using the app.'**
  String emptyEach(String reward);

  /// No description provided for @emptySharerOnly.
  ///
  /// In en, this message translates to:
  /// **'No invites yet. Share your code: you get {reward} when a friend starts using the app.'**
  String emptySharerOnly(String reward);

  /// No description provided for @emptyPlain.
  ///
  /// In en, this message translates to:
  /// **'No invites yet. Share your code with a friend.'**
  String get emptyPlain;

  /// No description provided for @paused.
  ///
  /// In en, this message translates to:
  /// **'Invites are paused right now. Rewards you\'ve earned are safe.'**
  String get paused;

  /// No description provided for @codeDisabled.
  ///
  /// In en, this message translates to:
  /// **'Your code is paused while we review it. Rewards you\'ve earned are safe.'**
  String get codeDisabled;

  /// No description provided for @loadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load your invites. Check your connection and try again.'**
  String get loadFailed;

  /// No description provided for @retry.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get retry;

  /// Referrals are not set up on the server yet (not deployed), or the user is signed out. No retry button.
  ///
  /// In en, this message translates to:
  /// **'Invites aren\'t available yet. Check back soon.'**
  String get notAvailable;

  /// A code was entered while referrals are not available; it is kept and sent later.
  ///
  /// In en, this message translates to:
  /// **'Invite codes aren\'t available yet. We saved your code and will add it when they are.'**
  String get notAvailableCodeKept;

  /// No description provided for @dismiss.
  ///
  /// In en, this message translates to:
  /// **'Got it'**
  String get dismiss;

  /// No description provided for @enterCodeTitle.
  ///
  /// In en, this message translates to:
  /// **'Have an invite code?'**
  String get enterCodeTitle;

  /// No description provided for @codeFieldLabel.
  ///
  /// In en, this message translates to:
  /// **'Invite code'**
  String get codeFieldLabel;

  /// No description provided for @addCode.
  ///
  /// In en, this message translates to:
  /// **'Add code'**
  String get addCode;

  /// No description provided for @useCode.
  ///
  /// In en, this message translates to:
  /// **'Use code {code}'**
  String useCode(String code);

  /// No description provided for @enterDifferentCode.
  ///
  /// In en, this message translates to:
  /// **'Enter a different code'**
  String get enterDifferentCode;

  /// No description provided for @paste.
  ///
  /// In en, this message translates to:
  /// **'Paste'**
  String get paste;

  /// No description provided for @windowCountdown.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =1{You can add an invite code for 1 more day} other{You can add an invite code for {days} more days}}'**
  String windowCountdown(int days);

  /// No description provided for @windowOver.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =1{Invite codes can only be added in your first day} other{Invite codes can only be added in your first {days} days}}'**
  String windowOver(int days);

  /// No description provided for @claimOk.
  ///
  /// In en, this message translates to:
  /// **'Code added.'**
  String get claimOk;

  /// No description provided for @offlineQueued.
  ///
  /// In en, this message translates to:
  /// **'We\'ll apply your code when you\'re back online.'**
  String get offlineQueued;

  /// No description provided for @errOwnCode.
  ///
  /// In en, this message translates to:
  /// **'That\'s your own code. Share it with a friend instead.'**
  String get errOwnCode;

  /// No description provided for @errAlreadyReferred.
  ///
  /// In en, this message translates to:
  /// **'You\'ve already used an invite code.'**
  String get errAlreadyReferred;

  /// No description provided for @errUnknownCode.
  ///
  /// In en, this message translates to:
  /// **'We couldn\'t find that code. Codes have 8 letters or numbers and never contain O, 0, I, 1 or L.'**
  String get errUnknownCode;

  /// No description provided for @errWindowClosed.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =1{Invite codes can be added in your first day.} other{Invite codes can be added in your first {days} days.}}'**
  String errWindowClosed(int days);

  /// No description provided for @errRateLimited.
  ///
  /// In en, this message translates to:
  /// **'{minutes, plural, =1{Too many tries. Try again in 1 min.} other{Too many tries. Try again in {minutes} min.}}'**
  String errRateLimited(int minutes);

  /// No description provided for @errNotVerified.
  ///
  /// In en, this message translates to:
  /// **'Confirm your email and we\'ll add your code then.'**
  String get errNotVerified;

  /// No description provided for @errSameInstall.
  ///
  /// In en, this message translates to:
  /// **'This code can\'t be used on this device.'**
  String get errSameInstall;

  /// No description provided for @errProgramPaused.
  ///
  /// In en, this message translates to:
  /// **'Invites are paused right now.'**
  String get errProgramPaused;

  /// No description provided for @errUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Invites aren\'t available for this account.'**
  String get errUnavailable;

  /// No description provided for @errGeneric.
  ///
  /// In en, this message translates to:
  /// **'We couldn\'t add that code right now. Try again later.'**
  String get errGeneric;

  /// No description provided for @rewardMinutes.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 min} other{{count} min}}'**
  String rewardMinutes(int count);

  /// No description provided for @rewardEntitlementDays.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 day of {name}} other{{count} days of {name}}}'**
  String rewardEntitlementDays(int count, String name);

  /// No description provided for @rewardOther.
  ///
  /// In en, this message translates to:
  /// **'{amount} {kind}'**
  String rewardOther(String amount, String kind);

  /// No description provided for @giftWaiting.
  ///
  /// In en, this message translates to:
  /// **'A gift is waiting for you: {reward}'**
  String giftWaiting(String reward);

  /// No description provided for @giftWaitingPlain.
  ///
  /// In en, this message translates to:
  /// **'A gift from a friend is waiting for you'**
  String get giftWaitingPlain;

  /// No description provided for @daysLeftToAdd.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Last day to add a code} other{Only {count} days left to add a code}}'**
  String daysLeftToAdd(int count);

  /// No description provided for @stepsTitle.
  ///
  /// In en, this message translates to:
  /// **'How you get it'**
  String get stepsTitle;

  /// No description provided for @stepAddCode.
  ///
  /// In en, this message translates to:
  /// **'Add your friend\'s code'**
  String get stepAddCode;

  /// No description provided for @stepStartUsing.
  ///
  /// In en, this message translates to:
  /// **'Start using {app}'**
  String stepStartUsing(String app);

  /// No description provided for @stepRewardYou.
  ///
  /// In en, this message translates to:
  /// **'{reward} lands in your account'**
  String stepRewardYou(String reward);

  /// No description provided for @stepRewardBoth.
  ///
  /// In en, this message translates to:
  /// **'{reward} lands for you, and for your friend'**
  String stepRewardBoth(String reward);

  /// No description provided for @stepGift.
  ///
  /// In en, this message translates to:
  /// **'Your gift unlocks'**
  String get stepGift;

  /// No description provided for @almostTitle.
  ///
  /// In en, this message translates to:
  /// **'Almost yours'**
  String get almostTitle;

  /// No description provided for @almostLine.
  ///
  /// In en, this message translates to:
  /// **'Start using the app and your {reward} unlocks.'**
  String almostLine(String reward);

  /// No description provided for @almostLineBoth.
  ///
  /// In en, this message translates to:
  /// **'Start using the app and your {reward} unlocks. Your friend gets theirs too.'**
  String almostLineBoth(String reward);

  /// No description provided for @almostLinePlain.
  ///
  /// In en, this message translates to:
  /// **'Start using the app and your gift unlocks.'**
  String get almostLinePlain;

  /// No description provided for @almostProgress.
  ///
  /// In en, this message translates to:
  /// **'1 of 2 done: code added'**
  String get almostProgress;

  /// No description provided for @cannotAddClosed.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =1{Codes are for your first day, and yours has passed.} other{Codes are for your first {days} days, and yours have passed.}}'**
  String cannotAddClosed(int days);

  /// No description provided for @cannotAddNotEligible.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =1{A friend\'s code can be added once, in your first day. This account can\'t add one now.} other{A friend\'s code can be added once, in your first {days} days. This account can\'t add one now.}}'**
  String cannotAddNotEligible(int days);

  /// No description provided for @noLinkHint.
  ///
  /// In en, this message translates to:
  /// **'Your friend gets {app} from the app store and types this code in.'**
  String noLinkHint(String app);

  /// No description provided for @shareTextNoLinkBoth.
  ///
  /// In en, this message translates to:
  /// **'I\'m using {app}. Get it, add my invite code {code} and we both get {reward}: {link}'**
  String shareTextNoLinkBoth(String app, String code, String reward, String link);

  /// No description provided for @shareTextNoLinkFriend.
  ///
  /// In en, this message translates to:
  /// **'I\'m using {app}. Get it, add my invite code {code} and you get {reward}: {link}'**
  String shareTextNoLinkFriend(String app, String code, String reward, String link);

  /// No description provided for @shareTextNoLinkPlain.
  ///
  /// In en, this message translates to:
  /// **'I\'m using {app}. Get it and add my invite code {code}: {link}'**
  String shareTextNoLinkPlain(String app, String code, String link);

  /// No description provided for @shareTextCodeOnly.
  ///
  /// In en, this message translates to:
  /// **'I\'m using {app}. Get it and add my invite code {code}.'**
  String shareTextCodeOnly(String app, String code);

  /// No description provided for @signInToInvite.
  ///
  /// In en, this message translates to:
  /// **'Sign in to get your invite code and to add a friend\'s code.'**
  String get signInToInvite;

  /// No description provided for @signIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get signIn;

  /// No description provided for @notInThisVersion.
  ///
  /// In en, this message translates to:
  /// **'Invites aren\'t part of this version of the app.'**
  String get notInThisVersion;
}

class _ReferralKitLocalizationsDelegate extends LocalizationsDelegate<ReferralKitLocalizations> {
  const _ReferralKitLocalizationsDelegate();

  @override
  Future<ReferralKitLocalizations> load(Locale locale) {
    return SynchronousFuture<ReferralKitLocalizations>(lookupReferralKitLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) => <String>['en', 'hi', 'id'].contains(locale.languageCode);

  @override
  bool shouldReload(_ReferralKitLocalizationsDelegate old) => false;
}

ReferralKitLocalizations lookupReferralKitLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return ReferralKitLocalizationsEn();
    case 'hi':
      return ReferralKitLocalizationsHi();
    case 'id':
      return ReferralKitLocalizationsId();
  }

  throw FlutterError(
    'ReferralKitLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
