/// Surprise odds from the `rewards_state` object (ADR 0002 §18.6).
library;

import 'json.dart';
import 'models.dart';

/// One active rule with a `chance` in a live program: `{"program", "kind", "amount", "amount_range", "chance",
/// "params"}` from the state's top-level `surprises`. Shown so the app can say "1 in 10 chance of 5–50 coins"
/// before anything is earned: surprises keep their odds visible.
///
/// Named `SurpriseOdd` (one entry, like `MysteryOdd`); the widget that lists them is `SurpriseOdds`.
class SurpriseOdd {
  const SurpriseOdd({
    required this.program,
    required this.kind,
    this.amount = 0,
    this.amountRange,
    this.chance,
    this.params = const {},
  });

  /// Tolerant: `chance` and `amount_range` are read from the top level, else from `params`; a bad value is null.
  factory SurpriseOdd.fromJson(Map<String, Object?> m) {
    final params = optMap(m['params']);
    return SurpriseOdd(
      program: str(m['program']),
      kind: str(m['kind']),
      amount: numOr(m['amount']),
      amountRange: optRange(m['amount_range']) ?? optRange(params['amount_range']),
      chance: optChance(m['chance']) ?? optChance(params['chance']),
      params: params,
    );
  }

  final String program;
  final String kind;

  /// The most it can pay (the rule's `amount`; with a range, its max).
  final num amount;
  final (int, int)? amountRange;

  /// 0 < chance ≤ 1, or null when the server sent none or a bad one (such entries are not listed in the state).
  final double? chance;
  final Map<String, Object?> params;

  /// The reward as a [RewardSpec] (range and chance in its params), for `RewardsTexts.reward`.
  RewardSpec get spec {
    final r = amountRange;
    return RewardSpec(
      kind: kind,
      amount: amount,
      params: {
        ...params,
        if (r != null) 'amount_range': [r.$1, r.$2],
        if (chance != null) 'chance': chance,
      },
    );
  }

  /// Reads the state's `surprises`: anything that is not a list is empty; entries without a valid chance are
  /// skipped (there are no honest odds to show for them).
  static List<SurpriseOdd> listFrom(Object? v) => [
    for (final s in listOf(v, SurpriseOdd.fromJson))
      if (s.chance != null) s,
  ];

  @override
  String toString() => 'SurpriseOdd($program, $kind $amount, range: $amountRange, chance: $chance)';
}
