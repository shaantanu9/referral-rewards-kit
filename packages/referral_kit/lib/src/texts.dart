import 'availability.dart';

/// The app's own words for the invite screens. Every field is optional: what you leave null comes from the
/// package's localisations (en, hi, id; `referralKitLocalizationsDelegate`), built from the live terms. Use it for
/// your app's voice ("Hear your first page read aloud" instead of "Start using YourApp") or for languages the
/// package lacks (build it from your own localisations in `textsBuilder`).
///
/// Keep overrides as honest as the defaults: name a reward only when the terms give it (the `friendReward` argument
/// is null when they do not), and use the server's days left, never a timer of your own.
class ReferralTexts {
  const ReferralTexts({
    this.title,
    this.entryTitle,
    this.giftTitle,
    this.deadline,
    this.stepsTitle,
    this.activationStep,
    this.steps,
    this.almostTitle,
    this.almostLine,
    this.almostProgress,
    this.almostActionLabel,
    this.cannotAdd,
    this.noLinkHint,
    this.shareTextNoLink,
    this.unavailable,
    this.signIn,
    this.waiting,
    this.inviteHeadline,
    this.activationStepForFriends,
  });

  /// The screen title ("Invite friends").
  final String? title;

  /// The friend's part when there is no reward to name ("Have an invite code?").
  final String? entryTitle;

  /// The friend's part headline. [friendReward] is the friend's reward label, null when the terms give none.
  final String Function(String? friendReward)? giftTitle;

  /// The deadline chip for the server's [daysLeft] (1 = last day).
  final String Function(int daysLeft)? deadline;

  /// Above the steps ("How you get it").
  final String? stepsTitle;

  /// Step 2 in the app's words, e.g. "Hear your first page read aloud".
  final String? activationStep;

  /// All the steps; wins over [activationStep]. [both]: the sharer gets the same reward.
  final List<String> Function(String? friendReward, bool both)? steps;

  /// After a code is accepted ("Almost yours").
  final String? almostTitle;
  final String Function(String? friendReward, bool both)? almostLine;

  /// "1 of 2 done: code added".
  final String? almostProgress;

  /// The button under "Almost yours" (shown only with `onAlmostAction`), e.g. "Start reading".
  final String? almostActionLabel;

  /// Why a code can't be added. [windowClosed]: the claim window is over; otherwise this account is not eligible.
  final String Function(bool windowClosed, int windowDays)? cannotAdd;

  /// Under Share when the app has no invite page ("Your friend gets {app} from the app store and types this code in.").
  final String Function(String appName)? noLinkHint;

  /// The share sentence without an invite page. [storeLink] is null when the app gave none.
  final String Function(String code, String? storeLink)? shareTextNoLink;

  /// The message when referrals cannot be used, per reason.
  final String Function(ReferralUnavailableReason reason)? unavailable;

  /// The Sign in button shown when signed out (with `onSignIn`).
  final String? signIn;

  /// The sharer's line for friends who used their code and have not started yet (`claimed_count` > 0). [count] is
  /// the server's number, [nextStep] is [activationStepForFriends] / [activationStep] (or "Start using {app}"), and
  /// [sharerReward] / [friendReward] are the joined rewards from the terms, null when the terms give none.
  final String Function(int count, String nextStep, String? sharerReward, String? friendReward)? waiting;

  /// The invite screen's give-first headline. Both rewards are null-able: name only what the terms give.
  final String? Function(String? friendReward, String? sharerReward)? inviteHeadline;

  /// The activation step as the sharer reads it about a friend ("Read their first page"); [activationStep] when
  /// null.
  final String? activationStepForFriends;
}
