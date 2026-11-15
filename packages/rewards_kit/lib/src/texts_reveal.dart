/// Strings of the 0.3 surprise reveal and odds, English defaults, every one overridable:
/// `RewardsTexts(reveal: RevealTexts(title: 'Bonus!', youGot: (r) => '+$r'))`.
library;

import 'texts_v2.dart';

/// `RewardReveal`, `showRewardReveal` and `SurpriseOdds`. There is deliberately no "almost" / "so close" line:
/// the kit never shows a near miss.
class RevealTexts {
  const RevealTexts({
    this.title = 'Surprise!',
    this.tapToOpen = 'Tap to open',
    this.open = 'Open',
    this.nice = 'Nice!',
    this.close = 'Close',
    this.oddsTitle = 'Surprises',
    this.youGot = _youGot,
    this.chance = formatChance,
    this.odds = _odds,
  });

  /// The closed gift's heading.
  final String title;
  final String tapToOpen;

  /// The closed gift's button.
  final String open;

  /// Closes the reveal dialog once it is open.
  final String nice;

  /// Closes the reveal dialog before it is opened.
  final String close;

  /// The `SurpriseOdds` card's heading.
  final String oddsTitle;

  /// The opened line, from the reward's text: "You got 23 coins".
  final String Function(String reward) youGot;

  /// A chance 0..1 as text: "1 in 10" or "35 %" ([formatChance]).
  final String Function(double chance) chance;

  /// The odds line, from the [chance] text and the reward's text: "1 in 10 chance of 5–50 coins".
  final String Function(String chance, String reward) odds;

  static String _youGot(String reward) => 'You got $reward';
  static String _odds(String chance, String reward) => '$chance chance of $reward';
}

/// "1 in N" when 1/[chance] is within 0.05 of a whole number N ≥ 2 (0.1 → "1 in 10", 0.33 → "1 in 3"),
/// otherwise a percentage with a space ("35 %", "1.5 %", "100 %").
String formatChance(double chance) {
  if (chance > 0 && chance < 1) {
    final inverse = 1 / chance;
    final n = inverse.round();
    if (n >= 2 && (inverse - n).abs() <= 0.05) return '1 in $n';
  }
  return formatPercent(chance).replaceFirst('%', ' %');
}
