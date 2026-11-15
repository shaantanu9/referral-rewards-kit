import 'dart:async';

import 'package:flutter/widgets.dart';

import 'availability.dart';
import 'client.dart';
import 'code_format.dart';
import 'events.dart';
import 'models.dart';
import 'storage.dart';

/// What happened to a claim made through [PendingClaimQueue].
enum ClaimStatus {
  /// The server answered; see [ClaimOutcome.result].
  answered,

  /// The call failed (offline, timeout, server error, or referrals not deployed yet); the code is kept and retried.
  /// [ClaimOutcome.unavailable] tells "not deployed / signed out" apart from offline.
  queuedOffline,

  /// The server said `not_verified`; the code is kept and retried after the account is verified.
  queuedNotVerified,

  /// Nothing was pending.
  nothingPending,
}

class ClaimOutcome {
  const ClaimOutcome(this.status, {this.code, this.result, this.error});
  final ClaimStatus status;

  /// The normalised code.
  final String? code;
  final ClaimResult? result;
  final Object? error;

  bool get isQueued => status == ClaimStatus.queuedOffline || status == ClaimStatus.queuedNotVerified;

  /// Why referrals could not be used for this claim (not deployed, signed out, no project); null when it was an
  /// ordinary failure or an answer. The code is still kept.
  ReferralUnavailableReason? get unavailable {
    final e = error;
    return e is ReferralUnavailableException ? e.reason : null;
  }
}

/// Why a retry ran (ADR 11.6); passed through to [PendingClaimQueue.onResolved] for logging.
enum RetryTrigger { reconnect, appResume, tokenRefresh, signInChange, manual }

/// Keeps a code that was claimed offline, or refused only as `not_verified`, and retries it (ADR 11.6).
///
/// The app calls [retryPendingClaim] on reconnect, app resume, auth token refresh and any sign-in change, or uses
/// [PendingClaimRetrier] to wire those up. The claim window still applies: the server decides on every retry.
class PendingClaimQueue {
  PendingClaimQueue({required ReferralClient client, required KeyValueStore store, this.onResolved})
    : _client = client,
      _store = store;

  final ReferralClient _client;
  final KeyValueStore _store;

  /// Called when a kept code gets a final server answer (anything but `not_verified`), e.g. to show the result.
  final void Function(ClaimOutcome outcome, RetryTrigger trigger)? onResolved;

  static const storageKey = 'pending_claim_code';
  static const statusKey = 'pending_claim_status';
  Future<ClaimOutcome>? _inFlight;

  /// The kept code, if any.
  Future<String?> pendingCode() => _store.getString(storageKey);

  /// Why the code is kept: [ClaimStatus.queuedOffline] or [ClaimStatus.queuedNotVerified]; null when none is kept.
  Future<ClaimStatus?> pendingStatus() async {
    if (await pendingCode() == null) return null;
    return await _store.getString(statusKey) == 'not_verified'
        ? ClaimStatus.queuedNotVerified
        : ClaimStatus.queuedOffline;
  }

  Future<void> clear() async {
    await _store.remove(storageKey);
    await _store.remove(statusKey);
  }

  /// Claims [code] now; keeps it when the call fails or the answer is `not_verified`. Reports `code_submitted`
  /// (`source`: `typed` | `pasted` | `prefilled` | the app's own) and then `code_claim_result` (`via`: [via]) through
  /// the client's `onEvent`, so an app that calls this needs no logging of its own.
  Future<ClaimOutcome> claim(String code, {String source = 'typed', String via = 'entry'}) async {
    final norm = normaliseCode(code);
    if (norm.isNotEmpty) {
      _client.report(
        ReferralEvent(ReferralEventName.codeSubmitted, {'code_hash': _client.codeHash(norm), 'source': source}),
      );
    }
    final outcome = await _attempt(norm);
    if (!outcome.isQueued) await clear();
    _report(outcome, via);
    return outcome;
  }

  void _report(ClaimOutcome outcome, String via, [RetryTrigger? trigger]) {
    final code = outcome.code;
    _client.report(
      ReferralEvent(ReferralEventName.codeClaimResult, {
        'result': claimEventResult(outcome),
        'via': via,
        if (trigger != null) 'trigger': trigger.name.toLowerCase(),
        if (code != null && code.isNotEmpty) 'code_hash': _client.codeHash(code),
      }),
    );
  }

  /// Retries the kept code, if any. Safe to call often: concurrent calls share one request.
  Future<ClaimOutcome> retryPendingClaim({RetryTrigger trigger = RetryTrigger.manual}) {
    return _inFlight ??= _retry(trigger).whenComplete(() => _inFlight = null);
  }

  Future<ClaimOutcome> _retry(RetryTrigger trigger) async {
    final code = await pendingCode();
    if (code == null) return const ClaimOutcome(ClaimStatus.nothingPending);
    final outcome = await _attempt(code);
    if (!outcome.isQueued) {
      await clear();
      onResolved?.call(outcome, trigger);
      // A retry that is still queued is not reported: it would repeat on every resume while offline.
      _report(outcome, 'retry', trigger);
    }
    return outcome;
  }

  Future<ClaimOutcome> _attempt(String code) async {
    try {
      final result = await _client.claim(code);
      if (result.reason == ClaimReason.notVerified) {
        await _store.setString(storageKey, code);
        await _store.setString(statusKey, 'not_verified');
        return ClaimOutcome(ClaimStatus.queuedNotVerified, code: code, result: result);
      }
      return ClaimOutcome(ClaimStatus.answered, code: code, result: result);
    } catch (e) {
      await _store.setString(storageKey, code);
      await _store.setString(statusKey, 'offline');
      return ClaimOutcome(ClaimStatus.queuedOffline, code: code, error: e);
    }
  }
}

/// Wires [PendingClaimQueue.retryPendingClaim] to app resume, and to whatever streams the app has for connectivity,
/// token refresh and sign-in changes (e.g. supabase_flutter's `onAuthStateChange`, connectivity_plus).
class PendingClaimRetrier {
  PendingClaimRetrier({
    required PendingClaimQueue queue,
    Stream<Object?>? reconnects,
    Stream<Object?>? tokenRefreshes,
    Stream<Object?>? signInChanges,
    bool listenToAppResume = true,
  }) : _queue = queue {
    void on(Stream<Object?>? s, RetryTrigger t) {
      if (s != null) _subs.add(s.listen((_) => unawaited(_queue.retryPendingClaim(trigger: t))));
    }

    on(reconnects, RetryTrigger.reconnect);
    on(tokenRefreshes, RetryTrigger.tokenRefresh);
    on(signInChanges, RetryTrigger.signInChange);
    if (listenToAppResume) {
      // An app may build its referral setup before runApp; the listener needs the binding.
      WidgetsFlutterBinding.ensureInitialized();
      _lifecycle = AppLifecycleListener(
        onResume: () => unawaited(_queue.retryPendingClaim(trigger: RetryTrigger.appResume)),
      );
    }
  }

  final PendingClaimQueue _queue;
  final List<StreamSubscription<Object?>> _subs = [];
  AppLifecycleListener? _lifecycle;

  void dispose() {
    for (final s in _subs) {
      unawaited(s.cancel());
    }
    _lifecycle?.dispose();
  }
}
