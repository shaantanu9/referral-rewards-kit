import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';

RewardSpec spec(Map<String, Object?> params, {String kind = 'coins', num amount = 50}) =>
    RewardSpec.fromJson({'kind': kind, 'amount': amount, 'params': params});

RewardGrant grantWith(Map<String, Object?> params, {String kind = 'coins', num amount = 23}) =>
    RewardGrant.fromJson({'id': 'g', 'program': 'reader', 'kind': kind, 'amount': amount, 'params': params});

void main() {
  group('RewardSpec chance and amountRange', () {
    test('read from params', () {
      final s = spec({
        'chance': 0.1,
        'amount_range': [5, 50],
      });
      expect(s.chance, 0.1);
      expect(s.amountRange, (5, 50));
      expect(
        spec({
          'chance': '0.25',
          'amount_range': ['5', 50.0],
        }).chance,
        0.25,
      );
      expect(
        spec({
          'amount_range': ['5', 50.0],
        }).amountRange,
        (5, 50),
      );
      expect(spec({'chance': 1}).chance, 1.0);
    });

    test('bad values are null, never a throw', () {
      for (final bad in <Object?>[null, 0, -0.2, 1.5, 10, 'x', double.nan, true, <int>[], {}]) {
        expect(spec({'chance': bad}).chance, isNull, reason: '$bad');
      }
      for (final bad in <Object?>[
        null,
        5,
        'x',
        [5],
        [5, 50, 60],
        [50, 5],
        [-1, 5],
        [5.5, 10],
        ['a', 10],
        [5, double.infinity],
        {'min': 5},
      ]) {
        expect(spec({'amount_range': bad}).amountRange, isNull, reason: '$bad');
      }
      expect(spec({}).chance, isNull);
      expect(spec({}).amountRange, isNull);
      expect(
        spec({
          'amount_range': [7, 7],
        }).amountRange,
        (7, 7),
      );
    });

    test('next_reward in the state carries them as they are', () {
      final s = sampleState();
      ((s['streaks'] as List).first as Map)['next_reward'] = {
        'threshold': 7,
        'kind': 'coins',
        'amount': 50,
        'params': {
          'chance': 0.5,
          'amount_range': [10, 50],
        },
      };
      final r = RewardsState.fromJson(s).streak('daily')!.nextReward!;
      expect(r.chance, 0.5);
      expect(r.amountRange, (10, 50));
    });
  });

  group('RewardGrant reveal flags', () {
    test('surprise, mystery and range', () {
      final g = grantWith({
        'surprise': true,
        'range': [5, 50],
      });
      expect(g.isSurprise, isTrue);
      expect(g.range, (5, 50));
      expect(g.shouldReveal, isTrue);
      expect(grantWith({'mystery': true}).isMystery, isTrue);
      expect(grantWith({'mystery': 'gold_table'}).shouldReveal, isTrue);
      expect(
        grantWith({
          'range': [1, 3],
        }).shouldReveal,
        isTrue,
      );
      expect(grantWith({'surprise': 'true'}).isSurprise, isTrue);
    });

    test('plain grants and false / null flags do not reveal', () {
      expect(grantWith({}).shouldReveal, isFalse);
      expect(grantWith({'surprise': false, 'mystery': null, 'range': null}).shouldReveal, isFalse);
      expect(grantWith({'mystery': false}).isMystery, isFalse);
      expect(grantWith({'range': 'oops'}).range, isNull);
      expect(RewardGrant.fromJson(grant('a')).shouldReveal, isFalse);
    });
  });

  group('RewardsState.surprises', () {
    test('parsed from the top level; chance / range also from params; bad chance skipped', () {
      final s = sampleState()
        ..['surprises'] = [
          {
            'program': 'reader',
            'kind': 'coins',
            'amount': 50,
            'amount_range': [5, 50],
            'chance': 0.1,
            'params': {'note': 'x'},
          },
          {
            'program': 'daily',
            'kind': 'minutes',
            'amount': 10,
            'params': {'chance': 0.35},
          },
          {'program': 'bad', 'kind': 'coins', 'amount': 5, 'chance': 3},
          'not an object',
        ];
      final state = RewardsState.fromJson(s);
      expect(state.surprises, hasLength(2));
      final a = state.surprises.first;
      expect((a.program, a.kind, a.amount, a.amountRange, a.chance), ('reader', 'coins', 50, (5, 50), 0.1));
      expect(a.spec.amountRange, (5, 50));
      expect(a.spec.chance, 0.1);
      expect(a.spec.params['note'], 'x');
      expect(state.surprises.last.chance, 0.35);
      expect(state.surprisesOf('daily').single.kind, 'minutes');
      expect(state.surprisesOf('nope'), isEmpty);
      expect(state.copyWith().surprises, hasLength(2));
    });

    test('missing or not a list is empty', () {
      expect(RewardsState.fromJson(sampleState()).surprises, isEmpty);
      expect(RewardsState.fromJson(sampleState()..['surprises'] = {'x': 1}).surprises, isEmpty);
      expect(RewardsState.fromJson(sampleState()..['surprises'] = 'x').surprises, isEmpty);
    });
  });

  group('texts', () {
    const x = RewardsTexts();

    test('a range reads "5–50 coins"', () {
      expect(
        x.reward(
          spec({
            'amount_range': [5, 50],
          }),
        ),
        '5–50 coins',
      );
      expect(
        x.reward(
          spec(
            {
              'amount_range': [1, 3],
            },
            kind: 'entitlement_days',
            amount: 3,
          ),
        ),
        '1–3 days of Premium',
      );
      expect(
        x.reward(
          spec({
            'amount_range': [5, 50],
          }, kind: 'rc_currency'),
        ),
        '5–50 coins',
      );
      expect(x.reward(spec({'amount_range': 'bad'})), '50 coins');
      expect(
        x.reward(
          grantWith({
            'range': [5, 50],
          }).spec,
        ),
        '23 coins',
        reason: 'a grant shows what was won',
      );
    });

    test('chance: "1 in N" near a whole number, else a percentage', () {
      expect(formatChance(0.1), '1 in 10');
      expect(formatChance(1 / 3), '1 in 3');
      expect(formatChance(0.5), '1 in 2');
      expect(formatChance(0.35), '35 %');
      expect(formatChance(0.3), '30 %');
      expect(formatChance(0.025), '1 in 40');
      expect(formatChance(0.015), '1.5 %');
      expect(formatChance(1), '100 %');
    });

    test('odds line and reveal strings; overridable', () {
      const odd = SurpriseOdd(program: 'reader', kind: 'coins', amount: 50, amountRange: (5, 50), chance: 0.1);
      expect(x.surpriseOdds(odd), '1 in 10 chance of 5–50 coins');
      expect(
        x.surpriseOdds(const SurpriseOdd(program: 'p', kind: 'minutes', amount: 10, chance: 0.35)),
        '35 % chance of 10 minutes',
      );
      expect(
        (x.reveal.title, x.reveal.tapToOpen, x.reveal.open, x.reveal.nice),
        ('Surprise!', 'Tap to open', 'Open', 'Nice!'),
      );
      expect(x.reveal.youGot('23 coins'), 'You got 23 coins');
      final y = RewardsTexts(
        reveal: RevealTexts(title: 'Bonus!', chance: (c) => '${(c * 100).round()} in 100', odds: (c, r) => '$r: $c'),
      );
      expect(y.reveal.title, 'Bonus!');
      expect(y.surpriseOdds(odd), '5–50 coins: 10 in 100');
    });
  });
}
