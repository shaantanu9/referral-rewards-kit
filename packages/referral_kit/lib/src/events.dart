import 'availability.dart';
import 'code_format.dart';
import 'models.dart';
import 'pending_claim.dart';
import 'sha256.dart';

/// Every analytics event the package reports: the whole referral funnel, so an app forwards `onEvent` to its
/// analytics and logs nothing of its own. Wire names and props match what the first app logged by hand
/// before 0.3.0, so an app can switch with no break in its data. Table with every prop: package README
/// ("Analytics events"). Wire names never change once shipped; a new event gets a new name.
enum ReferralEventName {
  /// The invite screen (or `InviteHub`) opened, once per open. Props: `from` (where the app opened it from, e.g.
  /// `you` | `settings` | `home` | `deeplink`; `unknown` when the app did not say), `focus` (`share` | `code`).
  inviteScreenViewed('invite_screen_viewed', 'referral_invite_viewed'),

  /// The user copied their code. Props: `has_link` (an invite page link exists for it).
  inviteCodeCopied('invite_code_copied', 'referral_code_copied'),

  /// The share sheet closed. Props: `status` (`success` | `dismissed` | `unavailable`), `channel` (a small bucket:
  /// `whatsapp`, `messages`, `mail`, … `other`, `unknown`, `dismissed`; see `shareChannel`), `has_link`.
  inviteShared('invite_shared', 'referral_invite_shared'),

  /// The entry was opened with a code from an invite link or the install referrer. Props: `code_hash`.
  inviteLinkOpened('invite_link_opened', null),

  /// The user started entering a friend's code (first keystroke, focus, paste or confirming a prefilled code). Once
  /// per entry widget. Props: `source` (`typed` | `focus` | `pasted` | `prefilled`).
  codeEntryStarted('code_entry_started', 'referral_code_entry_started'),

  /// A code was sent to the server through `PendingClaimQueue.claim`. Props: `code_hash`, `source`.
  codeSubmitted('code_submitted', 'referral_code_submitted'),

  /// A claim got its outcome. Props: `result` ([claimEventResult]: one name per server outcome, `other` for one a
  /// newer server adds), `via` (`entry` | `retry`), `code_hash`, and for retries `trigger` (`reconnect` |
  /// `appresume` | `tokenrefresh` | `signinchange` | `manual`). A retry that stays queued is not reported.
  codeClaimResult('code_claim_result', 'referral_claim_result'),

  /// A reward landed (from `referral_pending`), once per reward on this device. Props: `kind`, `amount`, `who`
  /// (`sharer` | `friend`), `event` (`joined` | `paid`). Banked rewards are reported once they are granted.
  rewardGranted('reward_granted', null),

  /// A reward card was shown. Props: `kind`, `event`, `who`, `state`.
  rewardShown('reward_shown', 'referral_reward_shown'),

  /// A reward card was dismissed (or its action tapped). Props: as [rewardShown], plus `acknowledged` (false when
  /// the ack call failed; the card then comes back next launch).
  rewardAcknowledged('reward_acknowledged', 'referral_reward_acknowledged'),

  /// Referrals are hidden or cannot be used, at most once a day per reason. Props: `reason` (`not_deployed` |
  /// `signed_out` | `no_project` | `offline` | `server_error` | `program_paused` | `code_disabled` |
  /// `window_closed` | `no_invite_url`, or an app's own reason), `surface` (`client` | `invite` | `entry` | `app`).
  referralFeatureHidden('referral_feature_hidden', 'referral_feature_unavailable');

  const ReferralEventName(this.wire, this.legacyWire);

  /// The event name to send.
  final String wire;

  /// The 0.2.0 name, for an app that already forwarded 0.2.0 events and wants to keep its old names; null for
  /// events that are new in 0.3.0.
  final String? legacyWire;
}

/// One analytics event: a typed name and a few small properties (strings, numbers, booleans). Never carries an
/// invite code, a user id or an install id; codes appear only as a hash (`ReferralClient.codeHash`).
class ReferralEvent {
  const ReferralEvent(this.name, [this.props = const {}]);

  final ReferralEventName name;
  final Map<String, Object> props;

  /// The event name to send, e.g. `invite_code_copied`.
  String get wireName => name.wire;

  /// The 0.2.0 name (or [wireName] for events new in 0.3.0).
  String get legacyWireName => name.legacyWire ?? name.wire;

  @override
  String toString() => 'ReferralEvent($wireName, $props)';
}

/// Receives every [ReferralEvent]. Forward them to your analytics (Firebase, PostHog, Amplitude, your own table):
/// `onEvent: (e) => analytics.logEvent(name: e.wireName, parameters: e.props)`.
typedef ReferralEventSink = void Function(ReferralEvent event);

/// Turns a normalised code into the `code_hash` sent in events. Default: [referralCodeHash] with the client's salt.
/// An app that already sent hashes of its own passes its function so old and new events join up.
typedef ReferralCodeHasher = String Function(String normalisedCode);

/// A short, stable, one-way id for an invite code: the first 12 hex characters of SHA-256(`salt:CODE`), on the
/// normalised code. Lets you join "submitted" to "claim result" without sending the code itself. Codes are short, so
/// anyone with the salt can test guesses: use an app-specific [salt] and keep the hash out of public places.
String referralCodeHash(String code, {String salt = 'referral_kit'}) =>
    sha256Hex('$salt:${normaliseCode(code)}').substring(0, 12);

/// Calls [sink] and swallows anything it throws: analytics must never break the referral flow.
void reportReferralEvent(ReferralEventSink? sink, ReferralEvent event) {
  if (sink == null) return;
  try {
    sink(event);
  } catch (_) {
    // An analytics failure is not the user's problem.
  }
}

/// Every value [claimEventResult] can return. Stable: names are never renamed or removed; a new server outcome
/// first arrives as `other` and gets its own name in a later version (added here, never replacing one).
const claimResultNames = <String>{
  'ok',
  'invalid',
  'expired',
  'own_code',
  'same_install',
  'already_used',
  'not_verified',
  'rate_limited',
  'paused',
  'under_age',
  'anonymous',
  'offline_queued',
  'not_deployed',
  'signed_out',
  'no_project',
  'server_error',
  'other',
};

/// The `result` of a claim, one name per outcome (see [claimResultNames]). Switch on the string with a default
/// branch, not on [ClaimReason]: a newer server's outcome then lands in your default as `other` instead of breaking
/// your build or your dashboard.
///
/// Server answers: `ok`, `invalid` (unknown code), `expired` (claim window closed), `own_code`, `same_install`,
/// `already_used` (already referred), `not_verified`, `rate_limited`, `paused` (program paused), `under_age`,
/// `anonymous` (anonymous account), `other` (a reason this version does not know). Kept codes: `offline_queued`,
/// `not_deployed`, `signed_out`, `no_project`, `server_error`.
String claimEventResult(ClaimOutcome outcome) {
  final error = outcome.error;
  if (outcome.status == ClaimStatus.queuedOffline) {
    if (error is ReferralUnavailableException) return error.reason.wire;
    if (error is ReferralServerError || error is ReferralFormatException) return 'server_error';
    return 'offline_queued';
  }
  final r = outcome.result;
  if (r == null) return 'server_error';
  return claimReasonName(r.reason);
}

/// The event name of a server claim reason ([claimEventResult] without the kept-code cases).
String claimReasonName(ClaimReason reason) => switch (reason) {
  ClaimReason.ok => 'ok',
  ClaimReason.unknownCode => 'invalid',
  ClaimReason.windowClosed => 'expired',
  ClaimReason.ownCode => 'own_code',
  ClaimReason.sameInstall => 'same_install',
  ClaimReason.alreadyReferred => 'already_used',
  ClaimReason.notVerified => 'not_verified',
  ClaimReason.rateLimited => 'rate_limited',
  ClaimReason.programPaused => 'paused',
  ClaimReason.underAge => 'under_age',
  ClaimReason.anonymousUser => 'anonymous',
  ClaimReason.unknown => 'other',
};

/// [claimEventResult] as a getter: `outcome.resultName`.
extension ClaimOutcomeResultName on ClaimOutcome {
  String get resultName => claimEventResult(this);
}

/// [claimReasonName] as a getter: `result.resultName`.
extension ClaimResultName on ClaimResult {
  String get resultName => claimReasonName(reason);
}

/// Props of a reward card event, without ids.
Map<String, Object> rewardEventProps(RewardItem r) => {
  'kind': r.kind,
  if (r.event != null) 'event': r.event!,
  if (r.who != null) 'who': r.who!,
  if (r.state != null) 'state': r.state!,
};

/// Props of `reward_granted`: what the first app logged (`kind`, `amount`, `who`) plus `event`.
Map<String, Object> rewardGrantedProps(RewardItem r) => {
  'kind': r.kind,
  'amount': r.amount,
  if (r.who != null) 'who': r.who!,
  if (r.event != null) 'event': r.event!,
};
