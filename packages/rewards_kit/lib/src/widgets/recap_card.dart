// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../controller.dart';
import '../models.dart';
import '../programs.dart';
import '../texts.dart';
import '../theme.dart';
import 'base.dart';

/// A recap between two local days ("your week", "your year"): days active, best streak, what was earned, what was
/// done, badges. Loads `rewards_recap` itself on first build.
class RecapCard extends StatefulWidget {
  const RecapCard({
    super.key,
    required this.controller,
    required this.from,
    required this.to,
    this.title,
    this.texts = const RewardsTexts(),
    this.builder,
  });

  final RewardsController controller;

  /// First and last local day (dates; the time of day is ignored).
  final DateTime from;
  final DateTime to;
  final String? title;
  final RewardsTexts texts;
  final Widget Function(BuildContext context, Recap recap)? builder;

  @override
  State<RecapCard> createState() => _RecapCardState();
}

class _RecapCardState extends State<RecapCard> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && widget.controller.recap(widget.from, widget.to) == null) {
        widget.controller.loadRecap(widget.from, widget.to);
      }
    });
  }

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: widget.controller,
    builder: (context) {
      final r = widget.controller.recap(widget.from, widget.to);
      if (r == null) return const SizedBox.shrink();
      final b = widget.builder;
      if (b != null) return b(context, r);
      final t = RewardsTheme.of(context);
      final texts = widget.texts;
      final x = texts.programs;
      final body = t.bodyStyle?.copyWith(color: t.onSurface);
      final muted = t.bodyStyle?.copyWith(color: t.muted);
      return Container(
        decoration: t.card,
        padding: t.padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(widget.title ?? x.recapTitle, style: t.titleStyle),
            const SizedBox(height: 8),
            Text(x.recapDaysActive(r.daysActive), style: t.numberStyle?.copyWith(color: t.onSurface)),
            Text(x.recapBestStreak(r.bestStreak), style: body),
            if (r.grants.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(x.recapEarned, style: muted),
              for (final g in r.grants) Text(texts.reward(g.spec), style: body),
            ],
            if (r.events.isNotEmpty) ...[
              const SizedBox(height: 8),
              for (final e in r.events) Text(x.recapEvent(e.type, e.count), style: muted),
            ],
            if (r.badges.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final badge in r.badges)
                    Chip(
                      avatar: Icon(Icons.military_tech, color: t.accent, size: 18),
                      label: Text(texts.reward(RewardSpec(kind: 'badge', amount: 1, params: {'badge': badge.badge}))),
                    ),
                ],
              ),
            ],
          ],
        ),
      );
    },
  );
}
