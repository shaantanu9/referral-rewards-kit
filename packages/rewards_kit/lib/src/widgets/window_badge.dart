// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../controller.dart';
import '../programs.dart';
import '../texts.dart';
import '../theme.dart';
import 'base.dart';
import 'countdown.dart';

/// A time window: "Happy hour: ends in 49m 59s" while open, "Happy hour: starts in 2h 00m" before. Both times are
/// the server's; at either edge the state is reloaded for the next window. With timers off (0.7
/// `state.choices.timersOff`) an open window shows just its name and a coming one shows nothing.
class WindowBadge extends StatefulWidget {
  const WindowBadge({
    super.key,
    required this.controller,
    required this.program,
    this.title,
    this.texts = const RewardsTexts(),
    this.builder,
  });

  final RewardsController controller;
  final String program;

  /// Default: the program's `public.title`, else [ProgramTexts.windowTitle].
  final String? title;
  final RewardsTexts texts;

  /// Your own look; `open` is whether the window is open now (server clock).
  final Widget Function(BuildContext context, WindowState window, bool open)? builder;

  @override
  State<WindowBadge> createState() => _WindowBadgeState();
}

class _WindowBadgeState extends State<WindowBadge> {
  void _edge() {
    if (!mounted) return;
    setState(() {});
    widget.controller.refresh();
  }

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: widget.controller,
    builder: (context) {
      final c = widget.controller;
      final w = c.state.window(widget.program);
      if (w == null) return const SizedBox.shrink();
      final open = w.activeAt(c.clock.now());
      final b = widget.builder;
      if (b != null) return b(context, w, open);
      final t = RewardsTheme.of(context);
      final x = widget.texts.programs;
      final name = widget.title ?? c.state.program(widget.program)?.public['title']?.toString() ?? x.windowTitle;
      final deadline = open ? w.endsAt : w.startsAt;
      if (deadline == null) return const SizedBox.shrink();
      final color = open ? t.accent : t.muted;
      final noTimer = c.state.hideTimers;
      if (noTimer && !open) return Countdown(endsAt: deadline, clock: c.clock, onExpired: _edge, hidden: true);
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: color?.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(t.radius ?? 16),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(open ? Icons.bolt : Icons.schedule, color: color, size: 18),
            const SizedBox(width: 6),
            Flexible(
              child: Countdown(
                endsAt: deadline,
                clock: c.clock,
                onExpired: _edge,
                builder: (context, left) => Text(
                  noTimer ? name : '$name: ${open ? x.windowEndsIn : x.windowStartsIn} ${formatLeft(left)}',
                  style: t.bodyStyle?.copyWith(color: t.onSurface),
                ),
              ),
            ),
          ],
        ),
      );
    },
  );
}
