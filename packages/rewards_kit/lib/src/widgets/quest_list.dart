import 'package:flutter/material.dart';

import '../controller.dart';
import '../programs.dart';
import '../texts.dart';
import '../theme.dart';
import 'base.dart';
import 'countdown.dart';

/// A quest set: each task with its progress and reward, the bonus for finishing all, and the real time until the
/// set resets. Task names come from [ProgramTexts.questTask] (override it to name your tasks).
class QuestList extends StatelessWidget {
  const QuestList({
    super.key,
    required this.controller,
    required this.program,
    this.title,
    this.texts = const RewardsTexts(),
    this.builder,
  });

  final RewardsController controller;
  final String program;

  /// Default: [ProgramTexts.questsTitle].
  final String? title;
  final RewardsTexts texts;
  final Widget Function(BuildContext context, QuestState quest, RewardsController controller)? builder;

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: controller,
    builder: (context) {
      final q = controller.state.quest(program);
      if (q == null) return const SizedBox.shrink();
      final b = builder;
      if (b != null) return b(context, q, controller);
      final t = RewardsTheme.of(context);
      final x = texts.programs;
      final muted = t.bodyStyle?.copyWith(color: t.muted);
      return Container(
        decoration: t.card,
        padding: t.padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Expanded(child: Text(title ?? x.questsTitle, style: t.titleStyle)),
                Countdown(
                  endsAt: q.endsAt,
                  clock: controller.clock,
                  prefix: x.questResetsIn,
                  style: muted,
                  onExpired: controller.refresh,
                ),
              ],
            ),
            const SizedBox(height: 8),
            for (final task in q.tasks)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Icon(
                      task.done ? Icons.check_circle : Icons.radio_button_unchecked,
                      color: task.done ? t.success : t.muted,
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(x.questTask(task), style: t.bodyStyle?.copyWith(color: t.onSurface)),
                          if (!task.done && task.count > 1)
                            LinearProgressIndicator(
                              value: task.fraction,
                              color: t.accent,
                              backgroundColor: t.muted?.withValues(alpha: 0.2),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      task.rewards.isEmpty ? texts.progress(task.progress, task.count) : texts.rewards(task.rewards),
                      style: muted,
                    ),
                  ],
                ),
              ),
            if (q.done)
              Text(x.questDone, style: t.bodyStyle?.copyWith(color: t.success))
            else if (q.bonus.isNotEmpty)
              Text(x.questBonus(texts.rewards(q.bonus)), style: t.bodyStyle?.copyWith(color: t.onSurface)),
          ],
        ),
      );
    },
  );
}
