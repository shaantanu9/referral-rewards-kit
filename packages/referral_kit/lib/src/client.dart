import 'dart:async';
import 'dart:convert';

import 'availability.dart';
import 'code_format.dart';
import 'event_memory.dart';
import 'events.dart';
import 'install_id.dart';
import 'models.dart';
import 'storage.dart';

/// Calls one Postgres function through PostgREST and returns its JSON result.
///
/// With supabase_flutter: `(fn, params) => Supabase.instance.client.rpc(fn, params: params)`.
/// With raw HTTP: [ReferralHttpRpc] (`ReferralHttpRpc(...).call`), or your own POST to `/rest/v1/rpc/<fn>` with the
/// user's JWT that returns the decoded body (a JSON string is accepted too).
///
/// Throw [ReferralUnavailableException] when referrals cannot work (not deployed, signed out, no project); anything else is
/// treated as offline. A supabase_flutter `PostgrestException` with code `PGRST202` is recognised as not deployed.
typedef ReferralRpc = Future<Object?> Function(String fn, Map<String, Object?> params);

/// Typed client for the user RPCs in ADR 7. Every call sends the install id.
///
/// It is also the one source of analytics: give it [onEvent] and every widget and queue built on it reports the
/// whole funnel (see `ReferralEventName`); an app never logs referral events of its own.
class ReferralClient {
  ReferralClient({
    required ReferralRpc rpc,
    required InstallIdStore installIds,
    this.onEvent,
    this.codeHashSalt = 'referral_kit',
    ReferralCodeHasher? codeHasher,
    KeyValueStore? eventStore,
    DateTime Function()? clock,
    bool Function(Object error)? isNotDeployed,
  }) : _rpc = rpc,
       _installIds = installIds,
       _codeHasher = codeHasher,
       _memory = ReferralEventMemory(store: eventStore, clock: clock),
       _isNotDeployed = isNotDeployed ?? isNotDeployedError;

  final ReferralRpc _rpc;
  final InstallIdStore _installIds;
  final bool Function(Object error) _isNotDeployed;
  final ReferralCodeHasher? _codeHasher;
  final ReferralEventMemory _memory;

  /// Receives analytics events from this client, its [PendingClaimQueue]s, and every widget given this client
  /// (unless the widget has its own `onEvent`). Null: no events.
  final ReferralEventSink? onEvent;

  /// Salt for `code_hash` in events ([referralCodeHash]). Set an app-specific value. Ignored with a `codeHasher`.
  final String codeHashSalt;

  /// Sends [event] to [onEvent]; exceptions from the sink are swallowed.
  void report(ReferralEvent event) => reportReferralEvent(onEvent, event);

  /// The `code_hash` for [code] (normalised first): the app's `codeHasher`, or [referralCodeHash] with
  /// [codeHashSalt].
  String codeHash(String code) {
    final hasher = _codeHasher;
    if (hasher == null) return referralCodeHash(code, salt: codeHashSalt);
    return hasher(normaliseCode(code));
  }

  /// Reports `referral_feature_hidden` for [reason], at most once a day per reason (remembered in `eventStore`).
  /// The widgets and [availability] call it; an app calls it for its own reasons (`surface: 'app'`).
  Future<void> reportHidden(String reason, {String surface = 'app'}) async {
    if (onEvent == null || !await _memory.firstToday(reason)) return;
    report(ReferralEvent(ReferralEventName.referralFeatureHidden, {'reason': reason, 'surface': surface}));
  }

  /// Reports `invite_link_opened` for a code that arrived from an invite link or the install referrer. The entry
  /// widgets call it for their `initialCode`; call it yourself if the app handles the link elsewhere.
  void reportLinkOpened(String code) {
    final norm = normaliseCode(code);
    if (!isWellFormedCode(norm)) return;
    report(ReferralEvent(ReferralEventName.inviteLinkOpened, {'code_hash': codeHash(norm)}));
  }

  Future<Object?> _call(String fn, [Map<String, Object?> extra = const {}]) async {
    final id = await _installIds.installId();
    final Object? result;
    try {
      result = await _rpc(fn, {...extra, 'install_id': id});
    } on ReferralUnavailableException catch (e) {
      unawaited(reportHidden(e.reason.wire, surface: 'client'));
      rethrow;
    } catch (e) {
      if (_isNotDeployed(e)) {
        unawaited(reportHidden(ReferralUnavailableReason.notDeployed.wire, surface: 'client'));
        throw const ReferralUnavailableException(ReferralUnavailableReason.notDeployed);
      }
      rethrow;
    }
    return result is String ? jsonDecode(result) : result;
  }

  /// Whether referrals work for this user right now, by asking for the terms. Use it to hide an "Invite friends"
  /// entry point when the server has no referral functions ([ReferralAvailability.notDeployed]) instead of showing a
  /// screen that can only fail. Never throws. Anything but `available` is reported as `referral_feature_hidden`
  /// (once a day per reason).
  Future<ReferralAvailability> availability() async {
    final ReferralAvailability a;
    try {
      await terms();
      return ReferralAvailability.available;
    } on ReferralUnavailableException catch (e) {
      return ReferralAvailability.fromReason(e.reason); // reported by _call
    } on ReferralServerError {
      a = ReferralAvailability.serverError;
    } on ReferralFormatException {
      a = ReferralAvailability.serverError;
    } catch (_) {
      a = ReferralAvailability.offline;
    }
    await reportHidden(a == ReferralAvailability.offline ? 'offline' : 'server_error', surface: 'client');
    return a;
  }

  /// `referral_my_code`: the caller's active code, created once.
  Future<MyCodeResult> myCode() async => MyCodeResult.fromJson(await _call('referral_my_code'));

  /// `referral_rotate_code`: retires the code and issues a new one, at most once per 30 days (`too_soon`).
  Future<MyCodeResult> rotateCode() async =>
      MyCodeResult.fromJson(await _call('referral_rotate_code'), 'referral_rotate_code');

  /// `referral_claim`. The code is normalised here as well as on the server. Use [PendingClaimQueue.claim] in apps:
  /// it keeps the code when offline and reports `code_submitted` / `code_claim_result`; this method reports nothing.
  Future<ClaimResult> claim(String code) async =>
      ClaimResult.fromJson(await _call('referral_claim', {'code': normaliseCode(code)}));

  /// `referral_terms`: active rules, caps and windows.
  Future<ReferralTerms> terms() async => ReferralTerms.fromJson(await _call('referral_terms'));

  /// `referral_check_activation`: asks the server to evaluate the app's activation hook now.
  Future<ActivationResult> checkActivation() async =>
      ActivationResult.fromJson(await _call('referral_check_activation'));

  /// `referral_stats`.
  Future<ReferralStats> stats() async => ReferralStats.fromJson(await _call('referral_stats'));

  /// `referral_pending`: granted or banked rewards this device has not shown yet. Reports `reward_granted` once per
  /// granted reward (remembered in `eventStore`), whoever shows it.
  Future<List<RewardItem>> pending() async {
    final items = asList(
      await _call('referral_pending'),
      'referral_pending',
    ).map(RewardItem.fromJson).toList(growable: false);
    if (onEvent != null) {
      final granted = items.where((r) => r.state != 'banked' && r.id.isNotEmpty).toList();
      final fresh = (await _memory.newRewards(granted.map((r) => r.id))).toSet();
      for (final r in granted.where((r) => fresh.contains(r.id))) {
        report(ReferralEvent(ReferralEventName.rewardGranted, rewardGrantedProps(r)));
      }
    }
    return items;
  }

  /// `referral_ack`: marks rewards as shown on this device. Returns how many were newly recorded.
  Future<int> ack(List<String> rewardIds) async {
    if (rewardIds.isEmpty) return 0;
    final m = asMap(await _call('referral_ack', {'reward_ids': rewardIds}), 'referral_ack');
    final n = m['acknowledged'];
    return n is num ? n.toInt() : 0;
  }
}
