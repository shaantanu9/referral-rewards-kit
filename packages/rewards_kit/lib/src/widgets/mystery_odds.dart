import 'package:flutter/material.dart';

import '../models.dart';
import '../texts.dart';
import '../texts_v2.dart';
import '../theme.dart';

/// What a `mystery` reward can turn into, with each chance as a percentage. Show it wherever a mystery reward is
/// offered: stating the odds before it is earned is required honesty (app store loot-box rules), and the kit keeps
/// mystery rewards free only, never sold. Shows nothing when [reward] carries no odds.
class MysteryOdds extends StatelessWidget {
  const MysteryOdds({super.key, required this.reward, this.texts = const RewardsTexts(), this.builder});

  final RewardSpec reward;
  final RewardsTexts texts;

  /// Your own look. Each odd's `chance` is 0..1; `formatPercent` gives the default text.
  final Widget Function(BuildContext context, List<MysteryOdd> odds)? builder;

  @override
  Widget build(BuildContext context) {
    final odds = reward.odds;
    if (odds.isEmpty) return const SizedBox.shrink();
    final b = builder;
    if (b != null) return b(context, odds);
    final t = RewardsTheme.of(context);
    final muted = t.bodyStyle?.copyWith(color: t.muted);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(texts.programs.oddsTitle, style: muted),
        for (final o in odds)
          Row(
            children: [
              SizedBox(
                width: 56,
                child: Text(formatPercent(o.chance), style: t.bodyStyle?.copyWith(color: t.onSurface)),
              ),
              Expanded(child: Text(texts.reward(o.spec), style: muted)),
            ],
          ),
      ],
    );
  }
}
