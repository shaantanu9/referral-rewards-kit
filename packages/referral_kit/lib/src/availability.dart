/// Why referrals cannot work right now, as distinct from "offline" (ADR 11.6 retries) or a refused claim.
///
/// The widgets show a "not available yet" state for these (no Retry button, no "you're offline"), or whatever the
/// app passes as `unavailableBuilder` (return `SizedBox.shrink()` to hide the feature).
enum ReferralUnavailableReason {
  /// The server has no referral functions: PostgREST answers 404 / `PGRST202` for `rpc/referral_*`. The migrations
  /// are not applied in this project (yet).
  notDeployed('not_deployed'),

  /// No signed-in user, so no token to call with.
  signedOut('signed_out'),

  /// The app has no backend configured in this build (no URL or key).
  noProject('no_project');

  const ReferralUnavailableReason(this.wire);

  /// The value used in analytics events.
  final String wire;
}

/// Thrown by a [ReferralRpc] (or raised by `ReferralClient` from a recognised "function not found" error) when
/// referrals are unavailable rather than failing. Claims made while unavailable are kept by `PendingClaimQueue` and
/// sent again later, like offline ones.
class ReferralUnavailableException implements Exception {
  const ReferralUnavailableException(this.reason);
  final ReferralUnavailableReason reason;

  @override
  String toString() => 'ReferralUnavailableException: ${reason.wire}';
}

/// The server answered with an error status other than 404 (5xx, 401, 403, a body that is not JSON). Never carries
/// the response body. Treated like offline (the claim is kept), but reported as `server_error` in events.
class ReferralServerError implements Exception {
  const ReferralServerError(this.fn, [this.status]);
  final String fn;
  final int? status;

  @override
  String toString() => 'ReferralServerError: $fn ${status ?? ''}'.trimRight();
}

/// No answer at all: no network, DNS failure, timeout.
class ReferralNetworkError implements Exception {
  const ReferralNetworkError(this.fn);
  final String fn;

  @override
  String toString() => 'ReferralNetworkError: $fn';
}

/// What `ReferralClient.availability()` found.
enum ReferralAvailability {
  available,
  notDeployed,
  signedOut,
  noProject,

  /// No answer (network, timeout); try again later.
  offline,

  /// The server answered with an error; try again later.
  serverError;

  bool get isAvailable => this == available;

  /// True when retrying soon may help (offline or a server error), false when the app should hide or explain.
  bool get isTransient => this == offline || this == serverError;

  static ReferralAvailability fromReason(ReferralUnavailableReason r) => switch (r) {
    ReferralUnavailableReason.notDeployed => notDeployed,
    ReferralUnavailableReason.signedOut => signedOut,
    ReferralUnavailableReason.noProject => noProject,
  };
}

/// Whether [error] from an rpc call means "the referral functions do not exist on this server".
///
/// Recognises [ReferralUnavailableException] with [ReferralUnavailableReason.notDeployed], and supabase_flutter's
/// `PostgrestException` for a missing function (code `PGRST202`, which PostgREST sends with HTTP 404), by its text so
/// the package needs no Supabase dependency.
bool isNotDeployedError(Object error) {
  if (error is ReferralUnavailableException) return error.reason == ReferralUnavailableReason.notDeployed;
  return error.toString().contains('PGRST202');
}
