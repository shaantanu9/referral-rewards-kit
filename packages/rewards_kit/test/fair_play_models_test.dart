import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';

void main() {
  group('RewardsChoices', () {
    test('rewards_state choices are read; missing means all on', () {
      final s = RewardsState.fromJson({
        'enabled': true,
        'choices': {'streaks_off': true, 'surprises_off': false, 'timers_off': true},
      });
      expect(s.choices, const RewardsChoices(streaksOff: true, timersOff: true));
      expect(RewardsState.fromJson({'enabled': true}).choices, RewardsChoices.none);
      expect(RewardsState.fromJson({'enabled': true, 'choices': 'bad'}).choices, RewardsChoices.none);
    });

    test('follow-up prefs carry the three choices and patch them', () {
      final p = FollowupPrefs.fromJson({'notifications_off': false, 'surprises_off': true});
      expect(p.choices, const RewardsChoices(surprisesOff: true));
      expect(FollowupPrefs.fromJson(const {}).choices, RewardsChoices.none);
      final q = p.patched({'streaks_off': true, 'surprises_off': false});
      expect(q.choices, const RewardsChoices(streaksOff: true));
      expect(q, isNot(p));
      expect(FollowupPrefs.keys, containsAll(RewardsChoices.keys));
    });
  });

  group('StreakState 0.7', () {
    test('reads hidden, repair, repaired_at, best_day_count, record_today', () {
      final s = StreakState.fromJson({
        'program': 'daily',
        'current': 1,
        'hidden': true,
        'repair': {'restores_to': 20, 'until': iso(serverNow.add(const Duration(hours: 5))), 'needed': 2, 'done': 1},
        'repaired_at': iso(serverNow.subtract(const Duration(hours: 1))),
        'best_day_count': 4,
        'record_today': true,
      });
      expect(s.hidden, isTrue);
      expect(s.repair!.restoresTo, 20);
      expect(s.repair!.until, serverNow.add(const Duration(hours: 5)));
      expect(s.repair!.left, 1);
      expect(s.repairedAt, serverNow.subtract(const Duration(hours: 1)));
      expect(s.repairedRecently(serverNow), isTrue);
      expect(s.repairedRecently(serverNow.add(const Duration(days: 2))), isFalse);
      expect(s.bestDayCount, 4);
      expect(s.recordToday, isTrue);
    });

    test('an older server: no hidden, no repair, no record', () {
      final s = StreakState.fromJson({'program': 'daily', 'current': 3});
      expect(s.hidden, isFalse);
      expect(s.repair, isNull);
      expect(s.repairedAt, isNull);
      expect(s.repairedRecently(serverNow), isFalse);
      expect(s.bestDayCount, 0);
      expect(s.recordToday, isFalse);
    });

    test('a malformed repair is null; done above needed leaves 0', () {
      expect(StreakState.fromJson({'program': 'd', 'repair': 'x'}).repair, isNull);
      expect(StreakState.fromJson({'program': 'd', 'repair': <String, Object?>{}}).repair, isNull);
      final r = StreakRepair.fromJson({'restores_to': 9, 'needed': 2, 'done': 5})!;
      expect(r.left, 0);
      expect(r.until, isNull);
    });
  });

  group('MilestoneState 0.7', () {
    test('reads head_start and level', () {
      final m = MilestoneState.fromJson({
        'program': 'read',
        'count': 5,
        'head_start': 2,
        'level': {'number': 3, 'name': 'Explorer', 'at': 4, 'next_at': 8},
        'next_reward': {'threshold': 10, 'kind': 'coins', 'amount': 5},
      });
      expect(m.headStart, 2);
      expect(m.level!.number, 3);
      expect(m.level!.name, 'Explorer');
      expect(m.level!.at, 4);
      expect(m.level!.nextAt, 8);
      expect(m.level!.isTop, isFalse);
      expect(m.level!.progress(m.count), 0.25);
    });

    test('an older server: no head start, no level', () {
      final m = MilestoneState.fromJson({'program': 'read', 'count': 1});
      expect(m.headStart, 0);
      expect(m.level, isNull);
    });

    test('the top level has no next; a blank name is null; a bad level is null', () {
      final top = MilestoneLevel.fromJson({'number': 5, 'name': ' ', 'at': 50, 'next_at': null})!;
      expect(top.isTop, isTrue);
      expect(top.name, isNull);
      expect(top.progress(60), 1);
      expect(MilestoneLevel.fromJson({'name': 'x'}), isNull);
      expect(MilestoneState.fromJson({'program': 'p', 'head_start': -3}).headStart, 0);
    });
  });

  group('fixed rewards', () {
    test('a fixed grant is never revealed as a surprise', () {
      final g = RewardGrant.fromJson({
        'id': 'g1',
        'program': 'daily',
        'kind': 'coins',
        'amount': 25,
        'params': {
          'range': [0, 50],
          'fixed': true,
        },
      });
      expect(g.isFixed, isTrue);
      expect(g.shouldReveal, isFalse);
      final old = RewardGrant.fromJson({
        'id': 'g2',
        'program': 'daily',
        'kind': 'coins',
        'params': {'surprise': true},
      });
      expect(old.isFixed, isFalse);
      expect(old.shouldReveal, isTrue);
    });

    test('RewardSpec.fixed: a mystery gives its most likely entry, a range its midpoint', () {
      final mystery = RewardSpec.fromJson({
        'threshold': 7,
        'kind': 'mystery',
        'odds': [
          {'kind': 'coins', 'amount': 10, 'chance': 0.7},
          {'kind': 'coins', 'amount': 100, 'chance': 0.3},
        ],
      });
      expect(mystery.fixed.kind, 'coins');
      expect(mystery.fixed.amount, 10);
      expect(mystery.fixed.threshold, 7);
      final range = RewardSpec.fromJson({
        'kind': 'coins',
        'amount': 50,
        'params': {
          'amount_range': [5, 50],
        },
      });
      expect(range.fixed.amount, 27);
      expect(range.fixed.amountRange, isNull);
      const plain = RewardSpec(kind: 'coins', amount: 3);
      expect(plain.fixed, same(plain));
    });
  });
}
