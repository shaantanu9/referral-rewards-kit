import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

import 'support/fake_rpc.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late FakeRpc rpc;
  late MemoryKeyValueStore store;
  late PendingClaimQueue queue;
  late List<(ClaimOutcome, RetryTrigger)> resolved;

  setUp(() {
    rpc = FakeRpc();
    store = MemoryKeyValueStore();
    resolved = [];
    queue = PendingClaimQueue(client: clientFor(rpc), store: store, onResolved: (o, t) => resolved.add((o, t)));
  });

  test('online ok: nothing kept', () async {
    final o = await queue.claim('abcd-efgh');
    expect(o.status, ClaimStatus.answered);
    expect(o.result!.isOk, isTrue);
    expect(await queue.pendingCode(), isNull);
  });

  test('offline: kept, normalised, retried on reconnect', () async {
    rpc.error = Exception('SocketException');
    final o = await queue.claim('\u2066abcd-efgh\u2069');
    expect(o.status, ClaimStatus.queuedOffline);
    expect(await queue.pendingCode(), 'ABCDEFGH');
    expect(await queue.pendingStatus(), ClaimStatus.queuedOffline);
    rpc.error = null;
    final r = await queue.retryPendingClaim(trigger: RetryTrigger.reconnect);
    expect(r.result!.isOk, isTrue);
    expect(await queue.pendingCode(), isNull);
    expect(resolved.single.$2, RetryTrigger.reconnect);
  });

  test('not_verified: kept until the server says something else', () async {
    rpc.responses['referral_claim'] = {'reason': 'not_verified'};
    expect((await queue.claim('ABCDEFGH')).status, ClaimStatus.queuedNotVerified);
    expect(await queue.pendingStatus(), ClaimStatus.queuedNotVerified);
    expect((await queue.retryPendingClaim()).status, ClaimStatus.queuedNotVerified);
    expect(resolved, isEmpty);
    rpc.responses['referral_claim'] = {'reason': 'window_closed'};
    final r = await queue.retryPendingClaim(trigger: RetryTrigger.tokenRefresh);
    expect(r.result!.reason, ClaimReason.windowClosed, reason: 'the claim window still applies; the server decides');
    expect(await queue.pendingCode(), isNull);
    expect(resolved.single.$2, RetryTrigger.tokenRefresh);
  });

  test('a kept code survives rate_limited and anonymous_user on retry, and is claimed later', () async {
    rpc.responses['referral_claim'] = {'reason': 'not_verified'};
    await queue.claim('ABCDEFGH');
    rpc.responses['referral_claim'] = {'reason': 'rate_limited', 'retry_after_seconds': 600};
    expect((await queue.retryPendingClaim(trigger: RetryTrigger.appResume)).isQueued, isTrue);
    expect(await queue.pendingCode(), 'ABCDEFGH', reason: 'an older server counts not_verified retries');
    rpc.responses['referral_claim'] = {'reason': 'anonymous_user'};
    expect((await queue.retryPendingClaim(trigger: RetryTrigger.appResume)).isQueued, isTrue);
    expect(await queue.pendingCode(), 'ABCDEFGH', reason: 'a guest may still create an account');
    expect(resolved, isEmpty);
    rpc.responses['referral_claim'] = {'reason': 'ok', 'days_left': 30};
    final r = await queue.retryPendingClaim(trigger: RetryTrigger.signInChange);
    expect(r.result!.isOk, isTrue);
    expect(await queue.pendingCode(), isNull);
  });

  test('a typed code refused as rate_limited is not kept (the user sees the answer)', () async {
    rpc.responses['referral_claim'] = {'reason': 'rate_limited', 'retry_after_seconds': 600};
    expect((await queue.claim('ABCDEFGH')).status, ClaimStatus.answered);
    expect(await queue.pendingCode(), isNull);
  });

  test('keep: a link code is stored before sign-in and is never claimed without a tap (ADR 4.2 step 3)', () async {
    expect(await queue.keep('\u2066abcd-efgh\u2069', source: 'link'), isTrue);
    expect(rpc.names, isEmpty, reason: 'nothing is sent');
    expect(await queue.linkCode(), 'ABCDEFGH');
    expect(await queue.pendingCode(), isNull, reason: 'not in the retry queue');
    expect(await queue.pendingStatus(), isNull);
    final r = await queue.retryPendingClaim(trigger: RetryTrigger.signInChange);
    expect(r.status, ClaimStatus.nothingPending, reason: 'the retrier never claims a link code');
    expect(rpc.names, isEmpty);
    // The friend taps "Use code" on the entry screen: the normal claim, which clears the link code.
    expect((await queue.claim('ABCDEFGH', source: 'prefilled')).result!.isOk, isTrue);
    expect(await queue.linkCode(), isNull);
  });

  test('keep ignores a malformed code and never replaces a kept one; a refused claim clears it', () async {
    expect(await queue.keep('nope'), isFalse);
    expect(await queue.linkCode(), isNull);
    expect(await queue.keep('ABCDEFGH'), isTrue);
    expect(await queue.keep('JKLMNPQR'), isFalse, reason: 'the first code the friend arrived with wins');
    expect(await queue.linkCode(), 'ABCDEFGH');
    rpc.responses['referral_claim'] = {'reason': 'own_code'};
    await queue.claim('ABCDEFGH', source: 'prefilled');
    expect(await queue.linkCode(), isNull, reason: 'answered: not offered again');
  });

  test('a link code survives an offline claim and moves into the retry queue', () async {
    await queue.keep('ABCDEFGH');
    rpc.error = Exception('offline');
    expect((await queue.claim('ABCDEFGH', source: 'prefilled')).status, ClaimStatus.queuedOffline);
    expect(await queue.pendingCode(), 'ABCDEFGH', reason: 'the friend tapped: now a normal kept claim');
    expect(await queue.linkCode(), isNull);
  });

  test('a final refusal is not kept', () async {
    rpc.responses['referral_claim'] = {'reason': 'unknown_code'};
    expect((await queue.claim('ABCDEFGH')).status, ClaimStatus.answered);
    expect(await queue.pendingCode(), isNull);
  });

  test('nothing pending: no call', () async {
    expect((await queue.retryPendingClaim()).status, ClaimStatus.nothingPending);
    expect(rpc.calls, isEmpty);
  });

  test('concurrent retries share one request', () async {
    await store.setString(PendingClaimQueue.storageKey, 'ABCDEFGH');
    await Future.wait([queue.retryPendingClaim(), queue.retryPendingClaim(), queue.retryPendingClaim()]);
    expect(rpc.names, ['referral_claim']);
  });

  group('PendingClaimRetrier triggers', () {
    Future<void> keepOne() => store.setString(PendingClaimQueue.storageKey, 'ABCDEFGH');

    for (final t in [RetryTrigger.reconnect, RetryTrigger.tokenRefresh, RetryTrigger.signInChange]) {
      test(t.name, () async {
        await keepOne();
        final c = StreamController<Object?>.broadcast();
        final r = PendingClaimRetrier(
          queue: queue,
          reconnects: t == RetryTrigger.reconnect ? c.stream : null,
          tokenRefreshes: t == RetryTrigger.tokenRefresh ? c.stream : null,
          signInChanges: t == RetryTrigger.signInChange ? c.stream : null,
          listenToAppResume: false,
        );
        c.add(null);
        await pumpEventQueue();
        expect(resolved.single.$2, t);
        r.dispose();
        await c.close();
      });
    }

    testWidgets('app resume', (tester) async {
      await tester.runAsync(keepOne);
      final r = PendingClaimRetrier(queue: queue);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.runAsync(pumpEventQueue);
      expect(resolved.single.$2, RetryTrigger.appResume);
      r.dispose();
    });
  });
}
