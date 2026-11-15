import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';

void main() {
  group('RewardsState.fromJson', () {
    test('reads the whole ADR example', () {
      final s = RewardsState.fromJson(sampleState(inbox: [grant('g1')]));
      expect(s.enabled, isTrue);
      expect(s.serverTime, serverNow);
      expect(s.programs.map((p) => p.kind), [
        ProgramKind.streak,
        ProgramKind.milestone,
        ProgramKind.offer,
        ProgramKind.socialTag,
      ]);
      expect(s.program('invite3')!.public['title'], 'Invite 3 friends');
      final st = s.streak('daily')!;
      expect([st.current, st.longest, st.freezes], [3, 5, 1]);
      expect(st.nextReward, const RewardSpec(kind: 'coins', amount: 50, threshold: 7));
      expect(st.daysToNextReward, 4);
      expect(s.milestone('invite3')!.target, 3);
      expect(s.milestone('invite3')!.nextReward!.badge, 'connector');
      expect(s.offer('welcome')!.status, OfferStatus.active);
      expect(s.offer('welcome')!.stockLeft, 12);
      expect(s.socialTask('ig_tag')!.status, SocialTaskStatus.none);
      expect(s.inbox.single.id, 'g1');
      expect(s.badges.single.badge, 'early');
    });

    test('accepts a JSON string through the client decode path', () {
      expect(() => RewardsState.fromJson(jsonDecode(jsonEncode(sampleState()))), returnsNormally);
    });

    test('missing lists and fields fall back, never throw', () {
      final s = RewardsState.fromJson({'enabled': true});
      expect(s.programs, isEmpty);
      expect(s.inbox, isEmpty);
      final st = StreakState.fromJson({'program': 'x'});
      expect([st.current, st.longest, st.freezes], [0, 0, 0]);
      expect(st.nextReward, isNull);
      expect(st.daysToNextReward, isNull);
    });

    test('a non-object state is a format error', () {
      expect(() => RewardsState.fromJson([1]), throwsA(isA<RewardsFormatException>()));
    });

    test('unknown kinds and states map to unknown', () {
      expect(ProgramKind.fromWire('quest'), ProgramKind.unknown);
      expect(OfferStatus.fromWire('paused'), OfferStatus.unknown);
      expect(SocialTaskStatus.fromWire('appealed'), SocialTaskStatus.unknown);
      expect(SocialTaskStatus.fromWire(null), SocialTaskStatus.unknown);
      expect(SocialTaskState.fromJson({'program': 'x'}).status, SocialTaskStatus.none);
    });

    test('times without a zone are read as UTC', () {
      final o = OfferState.fromJson({'program': 'x', 'ends_at': '2026-11-14T12:00:00'});
      expect(o.endsAt, DateTime.utc(2026, 11, 14, 12));
      expect(
        OfferState.fromJson({'program': 'x', 'ends_at': '2026-11-14T12:00:00+05:30'}).endsAt,
        DateTime.utc(2026, 11, 14, 6, 30),
      );
    });

    test('amounts may arrive as strings (numeric from Postgres)', () {
      expect(RewardSpec.fromJson({'kind': 'coins', 'amount': '12.5'}).amount, 12.5);
    });
  });

  group('MilestoneState.progress', () {
    test('fraction of the target, 1 when all earned', () {
      expect(
        MilestoneState.fromJson({
          'program': 'm',
          'count': 1,
          'next_reward': {'threshold': 4, 'kind': 'c'},
        }).progress,
        0.25,
      );
      expect(const MilestoneState(program: 'm', count: 9).progress, 1);
    });
  });

  group('StreakState.atRisk', () {
    final s = StreakState.fromJson(
      sampleState()['streaks'] is List ? ((sampleState()['streaks'] as List).first as Map).cast<String, Object?>() : {},
    );
    test('not done today and close to midnight', () {
      expect(s.atRisk(serverNow), isTrue, reason: '2 h left, within 4 h');
      expect(s.atRisk(serverNow, within: const Duration(hours: 1)), isFalse);
    });
    test('never at risk when done or no streak', () {
      expect(StreakState(program: 'd', current: 3, todayDone: true, endsTodayAt: serverNow).atRisk(serverNow), isFalse);
      expect(StreakState(program: 'd', current: 0, endsTodayAt: serverNow).atRisk(serverNow), isFalse);
    });
  });

  group('TrackResult', () {
    test('defaults enabled true, reads grants and streaks', () {
      final r = TrackResult.fromJson({
        'duplicate': false,
        'grants': [grant('g1')],
        'streaks': [
          {'program': 'daily', 'current': 4},
        ],
      });
      expect(r.enabled, isTrue);
      expect(r.grants.single.id, 'g1');
      expect(r.streaks.single.current, 4);
    });
    test('disabled engine', () {
      expect(TrackResult.fromJson({'enabled': false}).enabled, isFalse);
    });
  });

  test('mergeBy replaces by key, keeps order, appends new', () {
    expect(mergeBy([1, 2, 3], [20, 40], (int x) => '${x % 10 == 0 ? x ~/ 10 : x}'), [1, 20, 3, 40]);
  });

  group('texts', () {
    const t = RewardsTexts();
    test('reward kinds', () {
      expect(t.reward(const RewardSpec(kind: 'entitlement_days', amount: 5)), '5 days of Premium');
      expect(t.reward(const RewardSpec(kind: 'entitlement_days', amount: 1)), '1 day of Premium');
      expect(t.reward(const RewardSpec(kind: 'minutes', amount: 30)), '30 minutes');
      expect(t.reward(const RewardSpec(kind: 'badge', amount: 1, params: {'badge': 'three_day'})), '"Three day" badge');
      expect(t.reward(const RewardSpec(kind: 'streak_freeze', amount: 2)), '2 streak freezes');
      expect(t.reward(const RewardSpec(kind: 'bonus_coins', amount: 2.5)), '2.5 bonus coins');
    });
    test('every string can be replaced', () {
      final x = RewardsTexts(reward: (r) => '${r.amount} gems', claim: 'Grab it', error: (r) => 'E:$r');
      expect(x.reward(const RewardSpec(kind: 'coins', amount: 3)), '3 gems');
      expect(x.claim, 'Grab it');
      expect(x.error('sold_out'), 'E:sold_out');
    });
    test('formatLeft', () {
      expect(formatLeft(const Duration(days: 2, hours: 4, minutes: 9)), '2d 4h');
      expect(formatLeft(const Duration(hours: 3, minutes: 5)), '3h 05m');
      expect(formatLeft(const Duration(minutes: 4, seconds: 9)), '4m 09s');
      expect(formatLeft(const Duration(seconds: 9)), '9s');
      expect(formatLeft(const Duration(seconds: -5)), '0s');
    });
  });
}
