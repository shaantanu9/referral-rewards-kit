import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

import 'support/fake_rpc.dart';

void main() {
  test('every call sends install_id, claim sends the normalised code', () async {
    final rpc = FakeRpc();
    final c = clientFor(rpc);
    await c.myCode();
    await c.rotateCode();
    await c.claim('\u2066abcd-efgh\u2069');
    await c.terms();
    await c.checkActivation();
    await c.stats();
    await c.pending();
    await c.ack(['r1', 'r2']);
    expect(rpc.names, [
      'referral_my_code',
      'referral_rotate_code',
      'referral_claim',
      'referral_terms',
      'referral_check_activation',
      'referral_stats',
      'referral_pending',
      'referral_ack',
    ]);
    for (final (_, params) in rpc.calls) {
      expect(params['install_id'], testInstallId);
    }
    expect(rpc.calls[2].$2, {'code': 'ABCDEFGH', 'install_id': testInstallId});
    expect(rpc.calls[7].$2['reward_ids'], ['r1', 'r2']);
  });

  test('ack with no ids makes no call', () async {
    final rpc = FakeRpc();
    expect(await clientFor(rpc).ack([]), 0);
    expect(rpc.calls, isEmpty);
  });

  test('a JSON string result (raw HTTP) is decoded', () async {
    final rpc = FakeRpc({
      'referral_claim': jsonEncode({'reason': 'ok', 'days_left': 29}),
    });
    final r = await clientFor(rpc).claim('ABCDEFGH');
    expect(r.isOk, isTrue);
    expect(r.daysLeft, 29);
  });

  group('claim reasons (ADR 7)', () {
    const wire = {
      'ok': ClaimReason.ok,
      'own_code': ClaimReason.ownCode,
      'already_referred': ClaimReason.alreadyReferred,
      'unknown_code': ClaimReason.unknownCode,
      'window_closed': ClaimReason.windowClosed,
      'rate_limited': ClaimReason.rateLimited,
      'not_verified': ClaimReason.notVerified,
      'anonymous_user': ClaimReason.anonymousUser,
      'same_install': ClaimReason.sameInstall,
      'program_paused': ClaimReason.programPaused,
      'under_age': ClaimReason.underAge,
      'something_new': ClaimReason.unknown,
    };
    wire.forEach((w, reason) {
      test(w, () => expect(ClaimResult.fromJson({'reason': w}).reason, reason));
    });
    test('rate_limited carries retry_after_seconds', () {
      final r = ClaimResult.fromJson({'reason': 'rate_limited', 'retry_after_seconds': 3541});
      expect(r.retryAfterSeconds, 3541);
    });
    test('unknown keeps the raw reason', () => expect(ClaimResult.fromJson({'reason': 'x'}).rawReason, 'x'));
  });

  test('my_code shapes', () async {
    final paused = MyCodeResult.fromJson({'code': null, 'reason': 'program_paused'});
    expect(paused.hasCode, isFalse);
    expect(paused.reason, 'program_paused');
    final r = await clientFor(FakeRpc()).rotateCode();
    expect(r.reason, 'too_soon');
    expect(r.nextAllowedAt, DateTime.utc(2026, 12, 1));
  });

  test('terms', () async {
    final t = await clientFor(FakeRpc()).terms();
    expect(t.enabled, isTrue);
    expect(t.paidEnabled, isTrue);
    expect(t.ruleSetVersion, 1);
    expect(t.rules, hasLength(3));
    expect(t.rule('paid', 'sharer')!.params['entitlement_id'], 'premium');
    expect(t.rule('joined', 'friend')!.amount, 30);
    expect(t.claimWindowDays, 7);
    expect(t.activateWindowDays, 30);
    expect(t.paidWindowDays, 90);
    expect(t.holdHours, 72);
    expect(t.sharerJoinsPer30d, 10);
    expect(t.sharerPaidPer365d, 6);
    final off = ReferralTerms.fromJson(termsJson(paidEnabled: false));
    expect(off.rule('paid', 'sharer'), isNull, reason: 'paid rules count only while paid_enabled');
    final none = ReferralTerms.fromJson({...termsJson(), 'rule_set_version': null, 'rules': []});
    expect(none.rules, isEmpty);
  });

  test('stats', () async {
    final s = await clientFor(FakeRpc()).stats();
    expect(s.rewardsGranted.single.at, DateTime.parse('2026-11-10T08:15:30.123456Z'));
    expect(s.pending.single.availableAt, DateTime.utc(2026, 11, 15, 9));
    expect(s.banked.single.kind, 'entitlement_days');
    expect(s.skippedCap, 2);
    expect(s.joinedCount, 4);
    expect(s.paidCount, 1);
    final empty = ReferralStats.fromJson(statsJson(empty: true));
    expect(empty.isEmpty, isTrue);
    expect(empty.joinedCount, isNull, reason: 'null below stats_floor');
  });

  test('pending and ack', () async {
    final c = clientFor(FakeRpc());
    final p = await c.pending();
    expect(p.map((r) => r.state), ['granted', 'banked']);
    expect(p.first.params, isEmpty, reason: 'params null for app kinds');
    expect(p.last.params['entitlement_id'], 'premium');
    expect(await c.ack([p.first.id]), 1);
  });

  test('check_activation', () async {
    expect((await clientFor(FakeRpc()).checkActivation()).joined, isTrue);
    expect(ActivationResult.fromJson({'state': 'no_referral'}).joined, isFalse);
  });

  test('a wrong shape raises ReferralFormatException', () async {
    final rpc = FakeRpc({
      'referral_terms': [1, 2],
    });
    expect(clientFor(rpc).terms(), throwsA(isA<ReferralFormatException>()));
  });
}
