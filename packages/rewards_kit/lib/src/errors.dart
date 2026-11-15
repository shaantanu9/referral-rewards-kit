/// Errors raised by the rewards client (ADR 0002 §11).
library;

/// Every `rewards: <reason>` the server raises (ADR 0002 §11). A reason a newer server adds still arrives as a
/// [RewardsException] with that string; switch on it with a default branch.
abstract final class RewardsReason {
  static const notSignedIn = 'not_signed_in';
  static const disabled = 'disabled';
  static const unknownProgram = 'unknown_program';
  static const unknownEvent = 'unknown_event';
  static const serverOnlyEvent = 'server_only_event';
  static const dailyLimit = 'daily_limit';
  static const badHandle = 'bad_handle';
  static const handleTaken = 'handle_taken';
  static const offerNotStarted = 'offer_not_started';
  static const offerExpired = 'offer_expired';
  static const offerClaimed = 'offer_claimed';
  static const soldOut = 'sold_out';
  static const alreadyPosted = 'already_posted';
  static const tooSoon = 'too_soon';

  // 0.2 (ADR 0002 §18.3)
  static const empty = 'empty';
  static const badCode = 'bad_code';
  static const ownCode = 'own_code';
  static const tooManyFriends = 'too_many_friends';
  static const alreadyFriends = 'already_friends';
  static const badLink = 'bad_link';
  static const noPendingPost = 'no_pending_post';
  static const noAttemptsLeft = 'no_attempts_left';
  static const notEnoughQuestions = 'not_enough_questions';
  static const noAttempt = 'no_attempt';

  /// All reasons this version knows.
  static const all = <String>{
    notSignedIn,
    disabled,
    unknownProgram,
    unknownEvent,
    serverOnlyEvent,
    dailyLimit,
    badHandle,
    handleTaken,
    offerNotStarted,
    offerExpired,
    offerClaimed,
    soldOut,
    alreadyPosted,
    tooSoon,
    empty,
    badCode,
    ownCode,
    tooManyFriends,
    alreadyFriends,
    badLink,
    noPendingPost,
    noAttemptsLeft,
    notEnoughQuestions,
    noAttempt,
  };
}

/// The server refused a call with `raise exception 'rewards: <reason>'`. [reason] is the bare reason
/// (`offer_expired`), never the rest of the message.
class RewardsException implements Exception {
  const RewardsException(this.reason);

  final String reason;

  /// True when [reason] is one of [RewardsReason.all].
  bool get isKnown => RewardsReason.all.contains(reason);

  @override
  String toString() => 'RewardsException: $reason';
}

/// Why rewards cannot work right now (as opposed to a refused call or being offline).
enum RewardsUnavailableReason {
  /// PostgREST answers 404 / `PGRST202`: the `rewards_*` functions are not deployed in this project.
  notDeployed('not_deployed'),

  /// No signed-in user (no token, or the server said `rewards: not_signed_in`).
  signedOut('signed_out'),

  /// No backend configured in this build (no URL or key).
  noProject('no_project');

  const RewardsUnavailableReason(this.wire);

  /// The value used in analytics events.
  final String wire;
}

/// Thrown when rewards are unavailable rather than failing. Widgets hide themselves.
class RewardsUnavailableException implements Exception {
  const RewardsUnavailableException(this.reason);
  final RewardsUnavailableReason reason;

  @override
  String toString() => 'RewardsUnavailableException: ${reason.wire}';
}

/// The server answered with an error status that carried no `rewards:` reason. Never carries the response body.
class RewardsServerError implements Exception {
  const RewardsServerError(this.fn, [this.status]);
  final String fn;
  final int? status;

  @override
  String toString() => 'RewardsServerError: $fn ${status ?? ''}'.trimRight();
}

/// No answer at all: no network, DNS failure, timeout.
class RewardsNetworkError implements Exception {
  const RewardsNetworkError(this.fn);
  final String fn;

  @override
  String toString() => 'RewardsNetworkError: $fn';
}

/// An RPC returned something that does not have the documented shape.
class RewardsFormatException implements Exception {
  const RewardsFormatException(this.message);
  final String message;

  @override
  String toString() => 'RewardsFormatException: $message';
}

final _reasonPattern = RegExp(r'rewards: ([a-z][a-z0-9_]*)');

/// The `<reason>` of a `rewards: <reason>` error, read from its text (a supabase_flutter `PostgrestException`, a
/// PostgREST error body's `message`, or anything whose `toString()` carries it). Null when there is none.
String? rewardsReasonOf(Object error) {
  if (error is RewardsException) return error.reason;
  return _reasonPattern.firstMatch(error.toString())?.group(1);
}

/// Whether [error] means "the rewards functions do not exist on this server": [RewardsUnavailableException] with
/// [RewardsUnavailableReason.notDeployed], or a PostgREST `PGRST202` (matched by text, so the package needs no
/// Supabase dependency).
bool isRewardsNotDeployed(Object error) {
  if (error is RewardsUnavailableException) return error.reason == RewardsUnavailableReason.notDeployed;
  return error.toString().contains('PGRST202');
}
