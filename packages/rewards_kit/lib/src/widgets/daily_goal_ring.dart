// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../controller.dart';
import '../models.dart';
import '../texts.dart';
import '../theme.dart';
import 'base.dart';

/// Today's progress towards a streak's daily goal ("1/2"), a check once the day counts. Shows nothing while the
/// streak is `hidden` or streaks are switched off (0.7).
class DailyGoalRing extends StatelessWidget {
  const DailyGoalRing({
    super.key,
    required this.controller,
    this.program,
    this.size = 56,
    this.strokeWidth = 6,
    this.texts = const RewardsTexts(),
    this.builder,
  });

  final RewardsController controller;

  /// The streak program; null = the first streak.
  final String? program;
  final double size;
  final double strokeWidth;
  final RewardsTexts texts;
  final Widget Function(BuildContext context, StreakState streak)? builder;

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: controller,
    builder: (context) {
      final st = controller.state;
      final s = program == null ? (st.streaks.isEmpty ? null : st.streaks.first) : st.streak(program!);
      if (s == null || s.hidden || st.choices.streaksOff) return const SizedBox.shrink();
      final b = builder;
      if (b != null) return b(context, s);
      final t = RewardsTheme.of(context);
      final x = texts.programs;
      return Semantics(
        label: s.todayDone ? x.goalDone : x.goal(s.todayCount, s.dailyGoal),
        child: SizedBox.square(
          dimension: size,
          child: Stack(
            alignment: Alignment.center,
            children: [
              SizedBox.square(
                dimension: size,
                child: CircularProgressIndicator(
                  value: s.goalProgress,
                  strokeWidth: strokeWidth,
                  color: s.todayDone ? t.success : t.accent,
                  backgroundColor: t.muted?.withValues(alpha: 0.2),
                ),
              ),
              if (s.todayDone)
                Icon(Icons.check, color: t.success, size: size * 0.45)
              else
                Text(x.goal(s.todayCount, s.dailyGoal), style: t.bodyStyle?.copyWith(color: t.onSurface)),
            ],
          ),
        ),
      );
    },
  );
}
