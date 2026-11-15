// Analytics events without an SDK, the code hash, and the "not deployed" state in the client and the claim queue.
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';
import 'package:referral_kit/src/sha256.dart';

import 'support/fake_rpc.dart';

const _pgrst202 =
    'PostgrestException(message: Could not find the function public.referral_terms(install_id) in the schema cache, '
    'code: PGRST202, details: Searched for the function, hint: null)';

void main() {
  group('sha256Hex', () {
    test('FIPS 180-4 vectors', () {
      expect(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      expect(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      expect(
        sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
        '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
      );
    });
  });

  group('referralCodeHash', () {
    test('12 hex characters, same for every spelling of a code, never the code', () {
      final h = referralCodeHash('ABCDEFGH');
      expect(h, matches(RegExp(r'^[0-9a-f]{12}$')));
      expect(referralCodeHash('abcd-efgh'), h);
      expect(referralCodeHash(' ABCD EFGH '), h);
      expect(h.toUpperCase(), isNot(contains('ABCD')));
    });

    test('the salt changes it', () {
      expect(referralCodeHash('ABCDEFGH', salt: 'app-a'), isNot(referralCodeHash('ABCDEFGH', salt: 'app-b')));
    });
  });

  group('claimEventResult', () {
    ClaimOutcome answered(String reason) =>
        ClaimOutcome(ClaimStatus.answered, code: 'ABCDEFGH', result: ClaimResult.fromJson({'reason': reason}));

    test('server reasons', () {
      expect(claimEventResult(answered('ok')), 'ok');
      expect(claimEventResult(answered('unknown_code')), 'invalid');
      expect(claimEventResult(answered('window_closed')), 'expired');
      expect(claimEventResult(answered('own_code')), 'own_code');
      expect(claimEventResult(answered('already_referred')), 'already_used');
      expect(claimEventResult(answered('rate_limited')), 'rate_limited');
      expect(claimEventResult(answered('same_install')), 'same_install');
      expect(claimEventResult(answered('program_paused')), 'paused');
      expect(claimEventResult(answered('under_age')), 'under_age');
      expect(claimEventResult(answered('anonymous_user')), 'anonymous');
      expect(claimEventResult(answered('not_verified')), 'not_verified');
      expect(claimEventResult(answered('something_new')), 'other');
      expect(answered('own_code').resultName, 'own_code');
      expect(ClaimResult.fromJson({'reason': 'something_new'}).resultName, 'other');
    });

    test('every reason and kept state has a name in claimResultNames', () {
      for (final r in ClaimReason.values) {
        expect(claimResultNames, contains(claimReasonName(r)));
      }
      for (final reason in ReferralUnavailableReason.values) {
        final o = ClaimOutcome(ClaimStatus.queuedOffline, error: ReferralUnavailableException(reason));
        expect(claimResultNames, contains(claimEventResult(o)));
      }
    });

    test('kept codes', () {
      ClaimOutcome kept(Object error) => ClaimOutcome(ClaimStatus.queuedOffline, code: 'ABCDEFGH', error: error);
      expect(claimEventResult(kept(Exception('socket'))), 'offline_queued');
      expect(claimEventResult(kept(const ReferralNetworkError('referral_claim'))), 'offline_queued');
      expect(claimEventResult(kept(const ReferralServerError('referral_claim', 500))), 'server_error');
      expect(
        claimEventResult(kept(const ReferralUnavailableException(ReferralUnavailableReason.notDeployed))),
        'not_deployed',
      );
      expect(
        claimEventResult(kept(const ReferralUnavailableException(ReferralUnavailableReason.signedOut))),
        'signed_out',
      );
      expect(
        claimEventResult(
          ClaimOutcome(
            ClaimStatus.queuedNotVerified,
            code: 'ABCDEFGH',
            result: ClaimResult.fromJson({'reason': 'not_verified'}),
          ),
        ),
        'not_verified',
      );
    });
  });

  group('ReferralClient', () {
    test('a PGRST202 error becomes ReferralUnavailableException(notDeployed), reported once', () async {
      final events = <ReferralEvent>[];
      final rpc = FakeRpc()..error = Exception(_pgrst202);
      final client = ReferralClient(
        rpc: rpc.call,
        installIds: const FixedInstallIdStore(testInstallId),
        onEvent: events.add,
      );
      await expectLater(
        client.terms(),
        throwsA(
          isA<ReferralUnavailableException>().having((e) => e.reason, 'reason', ReferralUnavailableReason.notDeployed),
        ),
      );
      await expectLater(client.stats(), throwsA(isA<ReferralUnavailableException>()));
      await Future<void>.delayed(Duration.zero);
      expect(events.map((e) => e.wireName), ['referral_feature_hidden']);
      expect(events.single.props, {'reason': 'not_deployed', 'surface': 'client'});
    });

    test('other errors pass through unchanged (offline)', () async {
      final rpc = FakeRpc()..error = StateError('socket closed');
      await expectLater(clientFor(rpc).terms(), throwsA(isA<StateError>()));
    });

    test('a custom not-deployed check', () async {
      final rpc = FakeRpc()..error = ArgumentError('no such function');
      final client = ReferralClient(
        rpc: rpc.call,
        installIds: const FixedInstallIdStore(testInstallId),
        isNotDeployed: (e) => e is ArgumentError,
      );
      await expectLater(client.terms(), throwsA(isA<ReferralUnavailableException>()));
    });

    test('availability()', () async {
      expect(await clientFor(FakeRpc()).availability(), ReferralAvailability.available);
      expect(await clientFor(FakeRpc()..error = Exception(_pgrst202)).availability(), ReferralAvailability.notDeployed);
      expect(
        await clientFor(
          FakeRpc()..error = const ReferralUnavailableException(ReferralUnavailableReason.signedOut),
        ).availability(),
        ReferralAvailability.signedOut,
      );
      expect(
        await clientFor(FakeRpc()..error = const ReferralServerError('referral_terms', 503)).availability(),
        ReferralAvailability.serverError,
      );
      expect(await clientFor(FakeRpc()..error = Exception('offline')).availability(), ReferralAvailability.offline);
      expect(ReferralAvailability.offline.isTransient, isTrue);
      expect(ReferralAvailability.notDeployed.isTransient, isFalse);
    });

    test('a throwing event sink never breaks a call', () async {
      final rpc = FakeRpc()..error = Exception(_pgrst202);
      final client = ReferralClient(
        rpc: rpc.call,
        installIds: const FixedInstallIdStore(testInstallId),
        onEvent: (_) => throw StateError('analytics down'),
      );
      expect(await client.availability(), ReferralAvailability.notDeployed);
    });
  });

  group('PendingClaimQueue events', () {
    late List<ReferralEvent> events;
    ReferralClient client(FakeRpc rpc) => ReferralClient(
      rpc: rpc.call,
      installIds: const FixedInstallIdStore(testInstallId),
      onEvent: events.add,
      codeHashSalt: 'test',
    );
    setUp(() => events = []);

    test('claim reports the result with the hash, never the code', () async {
      final rpc = FakeRpc({
        'referral_claim': {'reason': 'own_code'},
      });
      await PendingClaimQueue(client: client(rpc), store: MemoryKeyValueStore()).claim('abcd-efgh', source: 'pasted');
      final hash = referralCodeHash('ABCDEFGH', salt: 'test');
      expect(events.map((e) => e.wireName), ['code_submitted', 'code_claim_result']);
      expect(events.first.props, {'code_hash': hash, 'source': 'pasted'});
      expect(events.last.props, {'result': 'own_code', 'via': 'entry', 'code_hash': hash});
      expect(events.expand((e) => e.props.values).join(), isNot(contains('ABCDEFGH')));
    });

    test('not deployed: the code is kept, the outcome says why', () async {
      final rpc = FakeRpc()..error = Exception(_pgrst202);
      final store = MemoryKeyValueStore();
      final outcome = await PendingClaimQueue(client: client(rpc), store: store).claim('ABCDEFGH');
      expect(outcome.status, ClaimStatus.queuedOffline);
      expect(outcome.unavailable, ReferralUnavailableReason.notDeployed);
      expect(store.values[PendingClaimQueue.storageKey], 'ABCDEFGH');
      expect(events.last.props['result'], 'not_deployed');
    });

    test('a retry is reported when it resolves, not while it stays queued', () async {
      final rpc = FakeRpc()..error = Exception('offline');
      final queue = PendingClaimQueue(client: client(rpc), store: MemoryKeyValueStore());
      await queue.claim('ABCDEFGH');
      expect(events.last.props['result'], 'offline_queued');
      await queue.retryPendingClaim(trigger: RetryTrigger.appResume);
      expect(events, hasLength(2));
      rpc.error = null;
      await queue.retryPendingClaim(trigger: RetryTrigger.appResume);
      expect(events.last.wireName, 'code_claim_result');
      expect(events.last.props, {
        'result': 'ok',
        'via': 'retry',
        'trigger': 'appresume',
        'code_hash': referralCodeHash('ABCDEFGH', salt: 'test'),
      });
    });
  });
}
