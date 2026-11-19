// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../quiz_controller.dart';
import '../quiz_models.dart';
import '../texts.dart';
import '../theme.dart';

/// The default quiz look for each [QuizPhase]. Used by `QuizScreen`; usable inside your own scaffold.
class QuizBody extends StatelessWidget {
  const QuizBody({
    super.key,
    required this.quiz,
    this.texts = const RewardsTexts(),
    this.onPlaySound,
    this.imageBuilder,
    this.onDone,
  });

  final QuizController quiz;
  final RewardsTexts texts;
  final void Function(String soundId)? onPlaySound;
  final Widget Function(BuildContext context, String url)? imageBuilder;
  final VoidCallback? onDone;

  @override
  Widget build(BuildContext context) {
    final t = RewardsTheme.of(context);
    final x = texts.quiz;
    final body = t.bodyStyle?.copyWith(color: t.onSurface);
    Widget button(String label, VoidCallback? onPressed) => FilledButton(
      onPressed: onPressed,
      style: FilledButton.styleFrom(backgroundColor: t.accent, foregroundColor: t.onAccent),
      child: Text(label),
    );
    final children = switch (quiz.phase) {
      QuizPhase.idle || QuizPhase.loading => [const Center(child: CircularProgressIndicator())],
      QuizPhase.unavailable => [Text(x.unavailable, style: body)],
      QuizPhase.error => [
        Text(texts.error(quiz.reason ?? 'offline'), style: t.bodyStyle?.copyWith(color: t.warning)),
        const SizedBox(height: 12),
        button(x.retry, quiz.retry),
      ],
      QuizPhase.intro => [
        Text(x.title, style: t.titleStyle),
        const SizedBox(height: 8),
        Text(quiz.canStart ? x.rules(quiz.quiz?.total ?? 0) : x.comeBack, style: body),
        const SizedBox(height: 16),
        if (quiz.canStart) button(x.start, quiz.start),
      ],
      QuizPhase.question || QuizPhase.answering || QuizPhase.reveal => [
        _QuestionView(quiz: quiz, texts: texts, onPlaySound: onPlaySound, imageBuilder: imageBuilder),
      ],
      QuizPhase.finished => _finished(t, button),
    };
    return SingleChildScrollView(
      padding: t.padding,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: children),
    );
  }

  List<Widget> _finished(RewardsTheme t, Widget Function(String, VoidCallback?) button) {
    final x = texts.quiz;
    final last = quiz.quiz?.lastResult;
    final score = last?.score ?? quiz.lastAnswer?.score ?? 0;
    final total = (last?.total ?? 0) > 0 ? last!.total : (quiz.quiz?.total ?? 0);
    final grants = quiz.finishedGrants;
    return [
      Text(
        x.score(score, total),
        style: t.numberStyle?.copyWith(color: t.onSurface),
        textAlign: TextAlign.center,
      ),
      const SizedBox(height: 12),
      if (grants.isEmpty)
        Text(
          x.noReward,
          style: t.bodyStyle?.copyWith(color: t.muted),
          textAlign: TextAlign.center,
        )
      else
        for (final g in grants)
          Text(
            texts.gotReward(texts.reward(g.spec)),
            style: t.bodyStyle?.copyWith(color: t.success),
            textAlign: TextAlign.center,
          ),
      const SizedBox(height: 16),
      if (quiz.canStart) ...[button(x.tryAgain, quiz.start), const SizedBox(height: 8)],
      OutlinedButton(onPressed: onDone, child: Text(x.done)),
    ];
  }
}

class _QuestionView extends StatelessWidget {
  const _QuestionView({required this.quiz, required this.texts, this.onPlaySound, this.imageBuilder});

  final QuizController quiz;
  final RewardsTexts texts;
  final void Function(String soundId)? onPlaySound;
  final Widget Function(BuildContext context, String url)? imageBuilder;

  @override
  Widget build(BuildContext context) {
    final q = quiz.question!;
    final t = RewardsTheme.of(context);
    final x = texts.quiz;
    final reveal = quiz.phase == QuizPhase.reveal;
    final a = quiz.lastAnswer;
    final fraction = quiz.timeFraction;
    final sound = q.soundId, image = q.imageUrl, play = onPlaySound, draw = imageBuilder;
    final labels = q.kind == QuizQuestionKind.trueFalse && q.choices.length < 2
        ? [x.trueLabel, x.falseLabel]
        : q.choices;

    Color? colorOf(int i) {
      if (!reveal || a == null) return null;
      if (i == a.answer) return t.success;
      if (i == quiz.picked) return t.warning;
      return null;
    }

    Widget choice(int i) {
      final c = colorOf(i);
      return OutlinedButton(
        key: ValueKey('quiz-choice-$i'),
        onPressed: quiz.phase == QuizPhase.question ? () => quiz.answer(i) : null,
        style: OutlinedButton.styleFrom(
          backgroundColor: c?.withValues(alpha: 0.15),
          side: c == null ? null : BorderSide(color: c, width: 2),
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
        ),
        child: Text(labels[i], style: t.bodyStyle?.copyWith(color: t.onSurface)),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(x.questionOf(q.index + 1, q.total), style: t.bodyStyle?.copyWith(color: t.muted)),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: reveal ? 0 : fraction,
            minHeight: 6,
            color: fraction < 0.25 ? t.warning : t.accent,
            backgroundColor: t.muted?.withValues(alpha: 0.2),
          ),
        ),
        const SizedBox(height: 16),
        if (q.kind == QuizQuestionKind.oddOneOut) Text(x.oddOneOut, style: t.bodyStyle?.copyWith(color: t.muted)),
        Text(q.prompt, style: t.titleStyle),
        if (q.kind == QuizQuestionKind.listen && sound != null && play != null) ...[
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => play(sound),
            icon: const Icon(Icons.volume_up),
            label: Text(x.playSound),
          ),
        ],
        if (q.kind == QuizQuestionKind.picture && image != null && draw != null) ...[
          const SizedBox(height: 8),
          draw(context, image),
        ],
        const SizedBox(height: 16),
        if (q.kind == QuizQuestionKind.trueFalse && labels.length == 2)
          Row(
            children: [
              Expanded(child: choice(0)),
              const SizedBox(width: 12),
              Expanded(child: choice(1)),
            ],
          )
        else
          for (var i = 0; i < labels.length; i++) Padding(padding: const EdgeInsets.only(bottom: 8), child: choice(i)),
        if (reveal && a != null) ...[
          const SizedBox(height: 8),
          Text(
            a.timedOut ? x.timeUp : (a.correct ? x.right : x.wrong),
            style: t.titleStyle?.copyWith(color: a.correct ? t.success : t.warning),
          ),
          if (a.explanation != null) Text(a.explanation!, style: t.bodyStyle?.copyWith(color: t.muted)),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: quiz.next,
            style: FilledButton.styleFrom(backgroundColor: t.accent, foregroundColor: t.onAccent),
            child: Text(x.next),
          ),
        ],
      ],
    );
  }
}
