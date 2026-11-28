// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../controller.dart';
import '../tasks.dart';
import '../texts.dart';
import '../theme.dart';
import 'base.dart';
import 'countdown.dart';

/// A timed offer: the reward, the real time left, and Claim. The deadline and any stock count come from the server
/// and never reset (ADR 0002 §8). The default look hides itself once the offer is claimed, expired or sold out;
/// a [builder] gets every state and decides.
class OfferBanner extends StatefulWidget {
  const OfferBanner({
    super.key,
    required this.controller,
    required this.program,
    this.title,
    this.texts = const RewardsTexts(),
    this.builder,
    this.onClaimed,
  });

  final RewardsController controller;
  final String program;
  final String? title;
  final RewardsTexts texts;

  /// Your own look. `claim` returns null on success or a reason.
  final Widget Function(BuildContext context, OfferState offer, Future<String?> Function() claim)? builder;
  final VoidCallback? onClaimed;

  @override
  State<OfferBanner> createState() => _OfferBannerState();
}

class _OfferBannerState extends State<OfferBanner> {
  bool _busy = false;
  String? _reason;
  bool _expiredLocally = false;

  Future<String?> _claim() async {
    if (_busy) return null;
    setState(() => _busy = true);
    final r = await widget.controller.claimOffer(widget.program);
    if (!mounted) return r;
    setState(() {
      _busy = false;
      _reason = r;
    });
    if (r == null) widget.onClaimed?.call();
    return r;
  }

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: widget.controller,
    builder: (context) {
      var o = widget.controller.state.offer(widget.program);
      if (o == null) return const SizedBox.shrink();
      if (_expiredLocally && o.status == OfferStatus.active) o = o.copyWith(status: OfferStatus.expired);
      final b = widget.builder;
      if (b != null) return b(context, o, _claim);
      if (o.status != OfferStatus.active) return const SizedBox.shrink();
      final t = RewardsTheme.of(context);
      final texts = widget.texts;
      return Container(
        decoration: t.card,
        padding: t.padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (widget.title != null) Text(widget.title!, style: t.titleStyle),
            Text(texts.rewards(o.rewards), style: t.numberStyle?.copyWith(color: t.onSurface)),
            const SizedBox(height: 4),
            Row(
              children: [
                Countdown(
                  endsAt: o.endsAt,
                  clock: widget.controller.clock,
                  prefix: texts.offerEndsIn,
                  hidden: widget.controller.state.hideTimers,
                  style: t.bodyStyle?.copyWith(color: t.warning),
                  onExpired: () => setState(() => _expiredLocally = true),
                ),
                if (o.stockLeft != null) ...[
                  const SizedBox(width: 12),
                  Text(texts.stockLeft(o.stockLeft!), style: t.bodyStyle?.copyWith(color: t.muted)),
                ],
              ],
            ),
            if (_reason != null) ...[
              const SizedBox(height: 4),
              Text(texts.error(_reason!), style: t.bodyStyle?.copyWith(color: t.warning)),
            ],
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _busy ? null : _claim,
              style: FilledButton.styleFrom(backgroundColor: t.accent, foregroundColor: t.onAccent),
              child: Text(texts.claim),
            ),
          ],
        ),
      );
    },
  );
}
