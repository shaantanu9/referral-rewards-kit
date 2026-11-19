// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../controller.dart';
import '../programs.dart';
import '../texts.dart';
import '../theme.dart';
import 'base.dart';

/// A streak's history as a weeks × 7 grid (Monday on top), oldest week on the left, today outlined. Five levels by
/// the day's count against the daily goal ([StreakHistory.levelOf]); days saved by a freeze are striped. Loads
/// `rewards_history` itself on first build (once per controller); a track updates today.
class ActivityHeatmap extends StatefulWidget {
  const ActivityHeatmap({
    super.key,
    required this.controller,
    this.program,
    this.weeks = 15,
    this.cellSize = 12,
    this.gap = 3,
    this.showLegend = true,
    this.texts = const RewardsTexts(),
    this.cellBuilder,
    this.builder,
  });

  final RewardsController controller;

  /// The streak program; null = the first streak.
  final String? program;
  final int weeks;
  final double cellSize;
  final double gap;
  final bool showLegend;
  final RewardsTexts texts;

  /// Your own cell; `level` is 0..4.
  final Widget Function(BuildContext context, HistoryDay day, int level, bool isToday)? cellBuilder;

  /// Your own look for the whole map.
  final Widget Function(BuildContext context, StreakHistory history)? builder;

  @override
  State<ActivityHeatmap> createState() => _ActivityHeatmapState();
}

class _ActivityHeatmapState extends State<ActivityHeatmap> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && widget.controller.history(widget.program) == null) {
        widget.controller.loadHistory(program: widget.program, weeks: widget.weeks);
      }
    });
  }

  Color? _color(RewardsTheme t, int level) => switch (level) {
    0 => t.muted?.withValues(alpha: 0.15),
    1 => t.accent?.withValues(alpha: 0.3),
    2 => t.accent?.withValues(alpha: 0.55),
    3 => t.accent?.withValues(alpha: 0.8),
    _ => t.accent,
  };

  Widget _cell(BuildContext context, RewardsTheme t, HistoryDay? day, int level, bool today) {
    final s = widget.cellSize;
    if (day == null) return SizedBox.square(dimension: s);
    final cb = widget.cellBuilder;
    if (cb != null) return SizedBox.square(dimension: s, child: cb(context, day, level, today));
    final box = Container(
      width: s,
      height: s,
      decoration: BoxDecoration(
        color: _color(t, level),
        borderRadius: BorderRadius.circular(s / 4),
        border: today ? Border.all(color: t.onSurface ?? Colors.black, width: 1.5) : null,
      ),
    );
    if (!day.frozen) return box;
    return CustomPaint(
      key: const ValueKey('heatmap-frozen'),
      foregroundPainter: _Stripes(t.accent ?? Colors.blue),
      child: box,
    );
  }

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: widget.controller,
    builder: (context) {
      final h = widget.controller.history(widget.program);
      if (h == null || h.days.isEmpty) return const SizedBox.shrink();
      final b = widget.builder;
      if (b != null) return b(context, h);
      final t = RewardsTheme.of(context);
      final offset = h.days.first.day.weekday - 1;
      final columns = ((offset + h.days.length) / 7).ceil();
      final g = widget.gap;
      Widget column(int col) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var row = 0; row < 7; row++)
            Padding(
              padding: EdgeInsets.only(bottom: row == 6 ? 0 : g),
              child: () {
                final i = col * 7 + row - offset;
                final day = i >= 0 && i < h.days.length ? h.days[i] : null;
                return _cell(context, t, day, day == null ? 0 : h.levelOf(day.count), i == h.days.length - 1);
              }(),
            ),
        ],
      );
      final x = widget.texts.programs;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        mainAxisSize: MainAxisSize.min,
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            reverse: true,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var col = 0; col < columns; col++)
                  Padding(
                    padding: EdgeInsets.only(right: col == columns - 1 ? 0 : g),
                    child: column(col),
                  ),
              ],
            ),
          ),
          if (widget.showLegend) ...[
            SizedBox(height: g * 2),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(x.heatmapLess, style: t.bodyStyle?.copyWith(color: t.muted, fontSize: 11)),
                for (var l = 0; l < 5; l++)
                  Padding(
                    padding: EdgeInsets.only(left: g),
                    child: Container(
                      width: widget.cellSize,
                      height: widget.cellSize,
                      decoration: BoxDecoration(
                        color: _color(t, l),
                        borderRadius: BorderRadius.circular(widget.cellSize / 4),
                      ),
                    ),
                  ),
                SizedBox(width: g),
                Text(x.heatmapMore, style: t.bodyStyle?.copyWith(color: t.muted, fontSize: 11)),
              ],
            ),
          ],
        ],
      );
    },
  );
}

class _Stripes extends CustomPainter {
  _Stripes(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = color.withValues(alpha: 0.7)
      ..strokeWidth = 1.2;
    canvas.save();
    canvas.clipRRect(RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(size.width / 4)));
    for (var x = -size.height; x < size.width; x += 4) {
      canvas.drawLine(Offset(x, size.height), Offset(x + size.height, 0), p);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_Stripes old) => old.color != color;
}
