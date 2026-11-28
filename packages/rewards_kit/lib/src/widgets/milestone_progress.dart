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
///
/// 0.7: a head start is named under the line (the program's `public.head_start_label`, or [headStartLabel], else
/// "Includes a head start of 2 from us"); a milestone with levels shows "Level 3 · Explorer" and the way to the next
/// level. While surprises are off, a mystery or range reward is named by what it will really give.
class MilestoneProgress extends StatelessWidget {
  const MilestoneProgress({
    super.key,
    required this.controller,
    required this.program,
    this.title,
    this.texts = const RewardsTexts(),
    this.builder,
    this.headStartLabel,
  });

  final RewardsController controller;
  final String program;

  /// The app's own title ("Invite 3 friends"); none by default.
  final String? title;
  final RewardsTexts texts;
  final Widget Function(BuildContext context, MilestoneState milestone, RewardsController controller)? builder;

  /// Why the user got a head start; default the program's `public.head_start_label`.
  final String? headStartLabel;

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: controller,
    builder: (context) {
      final m = controller.state.milestone(program);
      if (m == null) return const SizedBox.shrink();
      final b = builder;
      if (b != null) return b(context, m, controller);
      final t = RewardsTheme.of(context);
      final surprisesOff = controller.state.hideSurprises;
      final next = surprisesOff ? m.nextReward?.fixed : m.nextReward;
      final x = texts.fairPlay;
      final level = m.level;
      final label = headStartLabel ?? controller.state.program(program)?.public['head_start_label']?.toString();
      final muted = t.bodyStyle?.copyWith(color: t.muted);
      return Container(
        decoration: t.card,
        padding: t.padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (title != null) ...[Text(title!, style: t.titleStyle), const SizedBox(height: 8)],
            if (level != null) ...[
              Text(x.level(level.number, level.name), style: t.bodyStyle?.copyWith(color: t.onSurface)),
              if (level.nextAt != null) Text(x.toNextLevel(m.count, level.nextAt!), style: muted),
              const SizedBox(height: 8),
            ],
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
              style: muted,
            ),
            if (m.headStart > 0) Text(x.headStart(m.headStart, label), style: muted),
            if (next != null && next.isMystery)
              MysteryOdds(
                reward: next,
                texts: texts,
                footer: controller.oddsFooterBuilder?.call(context, m.program, texts),
              ),
          ],
        ),
      );
    },
  );
}
