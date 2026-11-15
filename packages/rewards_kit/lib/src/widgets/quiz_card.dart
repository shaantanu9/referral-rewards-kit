import 'package:flutter/material.dart';

import '../controller.dart';
import '../quiz_models.dart';
import '../texts.dart';
import '../theme.dart';
import 'base.dart';
import 'countdown.dart';
import 'quiz_screen.dart';

/// The way into today's quiz: its state, the real time left today, and Start / Resume / See result. Tapping opens
/// [onOpen] (the app's own route) or, by default, a [QuizScreen].
class QuizCard extends StatelessWidget {
  const QuizCard({
    super.key,
    required this.controller,
    required this.program,
    this.title,
    this.texts = const RewardsTexts(),
    this.onOpen,
    this.onPlaySound,
    this.imageBuilder,
    this.builder,
  });

  final RewardsController controller;
  final String program;

  /// Default: [QuizTexts.title].
  final String? title;
  final RewardsTexts texts;

  /// Opens the quiz the app's way; default pushes a [QuizScreen].
  final void Function(String program)? onOpen;

  /// Passed to the default [QuizScreen].
  final void Function(String soundId)? onPlaySound;
  final Widget Function(BuildContext context, String url)? imageBuilder;

  /// Your own look. `open` runs [onOpen] or pushes the default screen.
  final Widget Function(BuildContext context, QuizState quiz, VoidCallback open)? builder;

  void _open(BuildContext context) {
    final f = onOpen;
    if (f != null) return f(program);
    Navigator.of(context).push(
      QuizScreen.route(
        controller: controller,
        program: program,
        title: title,
        texts: texts,
        onPlaySound: onPlaySound,
        imageBuilder: imageBuilder,
      ),
    );
  }

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: controller,
    builder: (context) {
      final q = controller.state.quiz(program);
      if (q == null) return const SizedBox.shrink();
      final b = builder;
      if (b != null) return b(context, q, () => _open(context));
      final t = RewardsTheme.of(context);
      final x = texts.quiz;
      final muted = t.bodyStyle?.copyWith(color: t.muted);
      final last = q.lastResult;
      final (String line, String? action) = switch (q.status) {
        QuizStatus.inProgress => (x.questionOf(q.current + 1, q.total), x.resume),
        QuizStatus.finished when last != null => (
          x.score(last.score, last.total == 0 ? q.total : last.total),
          q.canStart ? x.tryAgain : x.seeResult,
        ),
        _ when q.canStart => (x.rules(q.total), x.start),
        _ => (x.comeBack, null),
      };
      return Container(
        decoration: t.card,
        padding: t.padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Icon(Icons.quiz_outlined, color: t.accent),
                const SizedBox(width: 8),
                Expanded(child: Text(title ?? x.title, style: t.titleStyle)),
              ],
            ),
            const SizedBox(height: 8),
            Text(line, style: t.bodyStyle?.copyWith(color: t.onSurface)),
            const SizedBox(height: 4),
            Countdown(
              endsAt: q.endsAt,
              clock: controller.clock,
              prefix: x.closesIn,
              style: muted,
              onExpired: controller.refresh,
            ),
            if (action != null) ...[
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () => _open(context),
                style: FilledButton.styleFrom(backgroundColor: t.accent, foregroundColor: t.onAccent),
                child: Text(action),
              ),
            ],
          ],
        ),
      );
    },
  );
}
