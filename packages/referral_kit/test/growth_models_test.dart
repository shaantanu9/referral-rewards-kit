import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

import 'support/fake_rpc.dart';
import 'support/growth_json.dart';

void main() {
  group('ReferralBoost in the terms', () {
    test('parsed from referral_terms().boost', () {
      final t = ReferralTerms.fromJson({...termsJson(), 'boost': boostJson()});
      final b = t.boost!;
      expect(b.multiplier, 2);
      expect(b.endsAt, DateTime.utc(2026, 11, 24));
      expect(b.startsAt, DateTime.utc(2026, 11, 17));
      expect(b.events, ['joined']);
      expect(b.forSharer && b.forFriend, isTrue);
    });

    test('null, absent or malformed boost → none', () {
      expect(ReferralTerms.fromJson(termsJson()).boost, isNull, reason: 'older server');
      expect(ReferralTerms.fromJson({...termsJson(), 'boost': null}).boost, isNull);
      expect(ReferralTerms.fromJson({...termsJson(), 'boost': 'x'}).boost, isNull);
      expect(
        ReferralTerms.fromJson({
          ...termsJson(),
          'boost': {'multiplier': 2},
        }).boost,
        isNull,
        reason: 'no end',
      );
      expect(ReferralTerms.fromJson({...termsJson(), 'boost': boostJson(multiplier: 1)}).boost, isNull);
    });

    test('boostAt hides an ended boost (end is exclusive)', () {
      final t = ReferralTerms.fromJson({...termsJson(), 'boost': boostJson()});
      expect(t.boostAt(DateTime.utc(2026, 11, 23, 23, 59)), isNotNull);
      expect(t.boostAt(DateTime.utc(2026, 11, 24)), isNull);
      expect(t.boostAt(DateTime.utc(2026, 11, 16)), isNull, reason: 'not started');
    });

    test('tolerant: string multiplier, missing lists', () {
      final b = ReferralBoost.tryParse({'ends_at': '2026-11-24T00:00:00Z', 'multiplier': '3'})!;
      expect(b.multiplier, 3);
      expect(b.who, ['sharer', 'friend']);
      expect(b.startsAt, isNull);
    });
  });

  group('ReferralPreferences', () {
    test('defaults and values', () {
      final p = ReferralPreferences.fromJson(prefsJson);
      expect(p.showName, isFalse);
      expect(p.displayName, isNull);
      expect(p.participating, isTrue);
      expect(p.isOk, isTrue);
      final q = ReferralPreferences.fromJson({'show_name': true, 'display_name': 'Priya', 'participating': false});
      expect(q.showName, isTrue);
      expect(q.displayName, 'Priya');
      expect(q.participating, isFalse);
    });

    test('a refusal carries its reason', () {
      for (final r in ['under_age', 'anonymous_user', 'invalid_name']) {
        final p = ReferralPreferences.fromJson({'reason': r});
        expect(p.reason, r);
        expect(p.isOk, isFalse);
      }
    });

    test('display names are checked like the server', () {
      expect(displayNameProblem('Priya'), isNull);
      expect(displayNameProblem('  Anaïs '), isNull);
      expect(displayNameProblem('प्रिया'), isNull);
      expect(displayNameProblem('   '), 'empty');
      expect(displayNameProblem('a' * 41), 'too_long');
      expect(displayNameProblem('a' * 40), isNull);
      expect(displayNameProblem('1234'), 'no_letter');
      expect(displayNameProblem('me@x.com'), 'email_or_link');
      expect(displayNameProblem('https://spam'), 'email_or_link');
    });
  });

  group('MyClaim', () {
    test('none', () => expect(MyClaim.fromJson(myClaimNone).state, MyClaimState.none));

    test('claimed with days left and a boosted reward', () {
      final c = MyClaim.fromJson(myClaimClaimed);
      expect(c.state, MyClaimState.claimed);
      expect(c.daysLeft, 12);
      expect(c.claimedAt, DateTime.utc(2026, 11, 20, 8));
      expect(c.activateBy, DateTime.utc(2026, 12, 2, 8));
      final r = c.rewards.single;
      expect((r.kind, r.amount, r.baseAmount, r.boosted), ('minutes', 60, 30, true));
    });

    test('joined and expired', () {
      expect(MyClaim.fromJson(myClaimJoined).state, MyClaimState.joined);
      expect(MyClaim.fromJson(myClaimJoined).joinedAt, DateTime.utc(2026, 11, 21, 9, 30));
      expect(MyClaim.fromJson(myClaimExpired).state, MyClaimState.expired);
    });

    test('later states map to joined; missing to none', () {
      for (final s in ['paid', 'void', 'something_new']) {
        expect(MyClaimState.fromWire(s), MyClaimState.joined, reason: s);
      }
      expect(MyClaim.fromJson(<String, Object?>{}).state, MyClaimState.none);
      expect(MyClaimState.fromWire('no_referral'), MyClaimState.none);
    });

    test('a reward without base_amount is not boosted and has base = amount', () {
      final r = MyClaimReward.fromJson({'kind': 'minutes', 'amount': 30});
      expect(r.baseAmount, 30);
      expect(r.boosted, isFalse);
    });
  });

  test('referral_my_code {left: true} has no code', () {
    final r = MyCodeResult.fromJson({'left': true});
    expect(r.left, isTrue);
    expect(r.code, isNull);
    expect(r.hasCode, isFalse);
    expect(MyCodeResult.fromJson({'code': 'ABCDEFGH', 'reason': 'ok'}).left, isFalse);
  });

  group('client calls send the install id', () {
    test('preferences, setPreferences (only given keys), myClaim', () async {
      final rpc = FakeRpc({
        'referral_preferences': prefsJson,
        'referral_preferences_set': (Map<String, Object?> p) => {
          'show_name': true,
          'display_name': 'Priya',
          'participating': true,
        },
        'referral_my_claim': myClaimClaimed,
      });
      final c = clientFor(rpc);
      expect((await c.preferences()).participating, isTrue);
      final saved = await c.setPreferences(showName: true, displayName: ' Priya ');
      expect(saved.displayName, 'Priya');
      await c.setPreferences(participating: false);
      await c.setPreferences(displayName: '');
      expect((await c.myClaim()).state, MyClaimState.claimed);
      expect(rpc.calls.every((call) => call.$2['install_id'] == testInstallId), isTrue);
      final sets = rpc.calls.where((call) => call.$1 == 'referral_preferences_set').map((call) => call.$2['prefs']);
      expect(sets, [
        {'show_name': true, 'display_name': 'Priya'},
        {'participating': false},
        {'display_name': null},
      ]);
    });

    test('an older server without the new RPCs is not reported as hidden', () async {
      final events = <ReferralEvent>[];
      final c = ReferralClient(
        rpc: (fn, p) async => throw const ReferralUnavailableException(ReferralUnavailableReason.notDeployed),
        installIds: const FixedInstallIdStore(testInstallId),
        onEvent: events.add,
      );
      await expectLater(c.myClaim(), throwsA(isA<ReferralUnavailableException>()));
      await expectLater(c.preferences(), throwsA(isA<ReferralUnavailableException>()));
      await Future<void>.delayed(Duration.zero);
      expect(events, isEmpty);
    });
  });

  // The real JSON from the SQL, written by the server side of the growth round (migration 23, local test DB).
  group('fixtures from the real SQL (test/fixtures/growth)', () {
    Object? fx(String name) => jsonDecode(File('test/fixtures/growth/$name.json').readAsStringSync());

    test('terms_boost', () {
      final t = ReferralTerms.fromJson(fx('terms_boost'));
      final b = t.boost!;
      expect(b.multiplier, 2);
      expect(b.startsAt, DateTime.parse('2026-11-20T12:38:26.218541+00:00'));
      expect(b.endsAt, DateTime.parse('2026-11-27T12:38:26.218541+00:00'));
      expect(b.events, ['joined']);
      expect(b.forSharer && b.forFriend, isTrue);
      expect(t.boostAt(DateTime.utc(2026, 11, 21)), isNotNull);
      expect(t.boostAt(DateTime.utc(2026, 11, 28)), isNull);
      expect(t.rule('joined', 'friend')!.amount, 30);
      expect(t.claimDaysLeft, 7);
    });

    test('my_claim_*', () {
      final c = MyClaim.fromJson(fx('my_claim_claimed'));
      expect(c.state, MyClaimState.claimed);
      expect(c.daysLeft, 30);
      expect(c.activateBy, DateTime.parse('2026-12-20T12:38:26.218541+00:00'));
      final r = c.rewards.single;
      expect((r.kind, r.amount, r.baseAmount, r.boosted), ('minutes', 60, 30, true));
      expect(MyClaim.fromJson(fx('my_claim_joined')).state, MyClaimState.joined);
      expect(MyClaim.fromJson(fx('my_claim_joined')).joinedAt, isNotNull);
      expect(MyClaim.fromJson(fx('my_claim_expired')).state, MyClaimState.expired);
      expect(MyClaim.fromJson(fx('my_claim_none')).state, MyClaimState.none);
    });

    test('preferences*', () {
      final p = ReferralPreferences.fromJson(fx('preferences'));
      expect((p.showName, p.displayName, p.participating, p.isOk), (true, 'Priya', true, true));
      final d = ReferralPreferences.fromJson(fx('preferences_default'));
      expect((d.showName, d.displayName, d.participating), (false, null, true));
      expect(ReferralPreferences.fromJson(fx('preferences_left')).participating, isFalse);
      expect(ReferralPreferences.fromJson(fx('preferences_invalid_name')).reason, 'invalid_name');
    });

    test('my_code_left', () {
      final r = MyCodeResult.fromJson(fx('my_code_left'));
      expect(r.left, isTrue);
      expect(r.code, isNull);
      expect(r.reason, 'left');
    });

    test('my_code under_age (server note) has no code and is not "left"', () {
      final r = MyCodeResult.fromJson({'code': null, 'reason': 'under_age'});
      expect((r.code, r.left, r.reason), (null, false, 'under_age'));
    });
  });
}
