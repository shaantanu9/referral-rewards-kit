import 'package:flutter/material.dart';

import '../controller.dart';
import '../programs.dart';
import '../texts.dart';
import '../theme.dart';
import 'base.dart';
import 'countdown.dart';

/// Units that refill ("3 hearts"): filled and empty icons, and the real time until the next one comes back. When
/// that time is reached the state is reloaded from the server (the phone never adds a unit itself).
class RechargeMeter extends StatefulWidget {
  const RechargeMeter({
    super.key,
    required this.controller,
    required this.program,
    this.texts = const RewardsTexts(),
    this.icon = Icons.favorite,
    this.emptyIcon = Icons.favorite_border,
    this.showUseButton = false,
    this.builder,
  });

  final RewardsController controller;
  final String program;
  final RewardsTexts texts;
  final IconData icon;
  final IconData emptyIcon;

  /// Shows a "Use one" button (calls `useRecharge`). Off by default: apps usually spend units in their own flow.
  final bool showUseButton;

  /// Your own look. `use` spends one unit and returns null or a reason (`empty`).
  final Widget Function(BuildContext context, RechargeState recharge, Future<String?> Function() use)? builder;

  @override
  State<RechargeMeter> createState() => _RechargeMeterState();
}

class _RechargeMeterState extends State<RechargeMeter> {
  String? _reason;
  bool _busy = false;

  Future<String?> _use() async {
    if (_busy) return null;
    setState(() => _busy = true);
    final r = await widget.controller.useRecharge(widget.program);
    if (mounted) {
      setState(() {
        _busy = false;
        _reason = r;
      });
    }
    return r;
  }

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: widget.controller,
    builder: (context) {
      final r = widget.controller.state.recharge(widget.program);
      if (r == null) return const SizedBox.shrink();
      final b = widget.builder;
      if (b != null) return b(context, r, _use);
      final t = RewardsTheme.of(context);
      final x = widget.texts.programs;
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
                for (var i = 0; i < r.max; i++)
                  Icon(i < r.units ? widget.icon : widget.emptyIcon, color: i < r.units ? t.accent : t.muted),
                const SizedBox(width: 12),
                Expanded(
                  child: r.full || r.nextAt == null
                      ? Text(x.rechargeFull, style: muted)
                      : Countdown(
                          endsAt: r.nextAt,
                          clock: widget.controller.clock,
                          prefix: x.rechargeNextIn,
                          style: muted,
                          onExpired: widget.controller.refresh,
                        ),
                ),
              ],
            ),
            if (_reason != null) Text(widget.texts.error(_reason!), style: t.bodyStyle?.copyWith(color: t.warning)),
            if (widget.showUseButton) ...[
              const SizedBox(height: 8),
              OutlinedButton(onPressed: _busy || r.empty ? null : _use, child: Text(x.rechargeUse)),
            ],
          ],
        ),
      );
    },
  );
}
