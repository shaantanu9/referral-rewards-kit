// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../controller.dart';
import '../surprise_models.dart';
import '../texts.dart';
import '../theme.dart';
import 'base.dart';

/// The odds of every surprise reward (`state.surprises`, ADR 0002 §18.6): "1 in 10 chance of 5–50 coins". Show it
/// wherever surprises can happen: the odds are always shown, surprises are free only, and the server caps them per
/// day. Shows nothing when there are none (or none for [program]), or when the user switched surprises off (0.7
/// `state.choices.surprisesOff`: no surprise is drawn for them, so there are no odds to show).
class SurpriseOdds extends StatelessWidget {
  const SurpriseOdds({
    super.key,
    required this.controller,
    this.program,
    this.title,
    this.texts = const RewardsTexts(),
    this.builder,
  });

  final RewardsController controller;

  /// Only this program's surprises; null for all of them.
  final String? program;

  /// The heading; default `texts.reveal.oddsTitle` ("Surprises").
  final String? title;
  final RewardsTexts texts;

  /// Your own look. `texts.surpriseOdds(s)` gives the default line.
  final Widget Function(BuildContext context, List<SurpriseOdd> surprises)? builder;

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: controller,
    builder: (context) {
      final state = controller.state;
      final p = program;
      final list = p == null ? state.surprises : state.surprisesOf(p);
      if (list.isEmpty || state.choices.surprisesOff) return const SizedBox.shrink();
      final b = builder;
      if (b != null) return b(context, list);
      final t = RewardsTheme.of(context);
      return Container(
        decoration: t.card,
        padding: t.padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          spacing: 6,
          children: [
            Text(title ?? texts.reveal.oddsTitle, style: t.titleStyle),
            for (final s in list)
              Row(
                children: [
                  Icon(Icons.card_giftcard, size: 18, color: t.accent),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(texts.surpriseOdds(s), style: t.bodyStyle?.copyWith(color: t.muted)),
                  ),
                ],
              ),
          ],
        ),
      );
    },
  );
}
