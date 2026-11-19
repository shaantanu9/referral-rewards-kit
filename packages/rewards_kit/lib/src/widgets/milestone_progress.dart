// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../controller.dart';
import '../models.dart';
import '../texts.dart';
import '../theme.dart';
import 'base.dart';
import 'mystery_odds.dart';

/// Progress towards a milestone's next reward ("3 of 5 · 100 coins"), or "All rewards earned".
class MilestoneProgress extends StatelessWidget {
  const MilestoneProgress({
    super.key,
    required this.controller,
    required this.program,
    this.title,
    this.texts = const RewardsTexts(),
    this.builder,
  });

  final RewardsController controller;
  final String program;

  /// The app's own title ("Invite 3 friends"); none by default.
  final String? title;
  final RewardsTexts texts;
  final Widget Function(BuildContext context, MilestoneState milestone, RewardsController controller)? builder;

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: controller,
    builder: (context) {
      final m = controller.state.milestone(program);
      if (m == null) return const SizedBox.shrink();
      final b = builder;
      if (b != null) return b(context, m, controller);
      final t = RewardsTheme.of(context);
      final next = m.nextReward;
      return Container(
        decoration: t.card,
        padding: t.padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (title != null) ...[Text(title!, style: t.titleStyle), const SizedBox(height: 8)],
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: LinearProgressIndicator(
                value: m.progress,
                minHeight: 8,
                color: t.accent,
                backgroundColor: t.muted?.withValues(alpha: 0.2),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              next == null || m.target == null
                  ? texts.allEarned
                  : '${texts.progress(m.count, m.target!)}  ·  ${texts.reward(next)}',
              style: t.bodyStyle?.copyWith(color: t.muted),
            ),
            if (next != null && next.isMystery) MysteryOdds(reward: next, texts: texts),
          ],
        ),
      );
    },
  );
}
