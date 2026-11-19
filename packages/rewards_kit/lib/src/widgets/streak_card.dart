// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../controller.dart';
import '../models.dart';
import '../texts.dart';
import '../theme.dart';
import 'base.dart';
import 'countdown.dart';
import 'mystery_odds.dart';

/// A daily streak: days in a row, best, freezes, and the next reward. When today is not done it shows the real
/// time left today (local midnight from the server), in the warning colour once [atRiskWithin] is reached.
class StreakCard extends StatelessWidget {
  const StreakCard({
    super.key,
    required this.controller,
    this.program,
    this.texts = const RewardsTexts(),
    this.atRiskWithin = const Duration(hours: 4),
    this.builder,
  });

  final RewardsController controller;

  /// The streak program key; null = the first streak.
  final String? program;
  final RewardsTexts texts;
  final Duration atRiskWithin;

  /// Your own look for the whole card.
  final Widget Function(BuildContext context, StreakState streak, RewardsController controller)? builder;

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: controller,
    builder: (context) {
      final s = program == null
          ? (controller.state.streaks.isEmpty ? null : controller.state.streaks.first)
          : controller.state.streak(program!);
      if (s == null) return const SizedBox.shrink();
      final b = builder;
      return b != null ? b(context, s, controller) : _DefaultStreak(s, controller, texts, atRiskWithin);
    },
  );
}

class _DefaultStreak extends StatelessWidget {
  const _DefaultStreak(this.s, this.c, this.texts, this.within);
  final StreakState s;
  final RewardsController c;
  final RewardsTexts texts;
  final Duration within;

  @override
  Widget build(BuildContext context) {
    final t = RewardsTheme.of(context);
    final risk = s.atRisk(c.clock.now(), within: within);
    final next = s.nextReward;
    final left = s.daysToNextReward;
    return Container(
      decoration: t.card,
      padding: t.padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Icon(Icons.local_fire_department, color: risk ? t.warning : t.accent, size: 32),
              const SizedBox(width: 8),
              Text(texts.streakDays(s.current), style: t.numberStyle?.copyWith(color: t.onSurface)),
            ],
          ),
          const SizedBox(height: 8),
          if (s.todayDone)
            Text(texts.streakDoneToday, style: t.bodyStyle?.copyWith(color: t.success))
          else if (risk)
            Countdown(
              endsAt: s.endsTodayAt,
              clock: c.clock,
              prefix: texts.streakAtRisk,
              style: t.bodyStyle?.copyWith(color: t.warning),
            )
          else
            Text(texts.streakDoToday, style: t.bodyStyle?.copyWith(color: t.muted)),
          const SizedBox(height: 4),
          Text(
            '${texts.streakLongest}: ${s.longest}  ·  ${texts.streakFreezes}: ${s.freezes}',
            style: t.bodyStyle?.copyWith(color: t.muted),
          ),
          if (next != null && left != null) ...[
            const SizedBox(height: 4),
            Text(texts.nextIn(texts.reward(next), left), style: t.bodyStyle?.copyWith(color: t.onSurface)),
            if (next.isMystery) MysteryOdds(reward: next, texts: texts),
          ],
        ],
      ),
    );
  }
}
