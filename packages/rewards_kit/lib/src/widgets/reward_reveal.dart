import 'dart:async';
import 'dart:math' as math;

// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../events.dart';
import '../models.dart';
import '../texts.dart';
import '../theme.dart';

/// A surprise reward (ADR 0002 §18.6) as a closed gift: "Surprise!" / "Tap to open". A tap gives a haptic, a short
/// shake and scale-up (about 600 ms) and then the reward line pops in: "You got 23 coins".
///
/// With reduced motion (`MediaQuery.disableAnimationsOf`) there is no shake: it opens at once. It shows only what
/// was won, never what could have been ("almost", "so close" or the range's top are never shown). [onOpened] and
/// the `rewards_reveal_opened` event fire once.
///
/// A grant made while the user had surprises off (0.7, [RewardGrant.isFixed]) is not a gamble, so it is not shown as
/// one: no closed gift, no shake and no haptic; it shows the reward line at once ([onOpened] and the event still fire
/// once, after the first frame).
class RewardReveal extends StatefulWidget {
  const RewardReveal({
    super.key,
    required this.grant,
    this.texts = const RewardsTexts(),
    this.autoOpen = false,
    this.onOpened,
    this.onEvent,
    this.onRevealed,
    this.builder,
  });

  final RewardGrant grant;
  final RewardsTexts texts;

  /// Called once with [grant] when it is shown open, like [onOpened] (extension hook: an extension package's own
  /// reveal event).
  final void Function(RewardGrant grant)? onRevealed;

  /// Open by itself after the first frame (the same animation and haptic as a tap).
  final bool autoOpen;

  /// Called once, when the reward is shown.
  final VoidCallback? onOpened;

  /// Analytics sink, e.g. `controller.client.report`. Props: `program`, `kind`; never a user id.
  final RewardsEventSink? onEvent;

  /// Your own look. Call `open` to open (haptic, [onOpened] and the event still happen; the default animation does
  /// not, so animate on `opened` yourself).
  final Widget Function(BuildContext context, RewardGrant grant, bool opened, VoidCallback open)? builder;

  @override
  State<RewardReveal> createState() => _RewardRevealState();
}

class _RewardRevealState extends State<RewardReveal> with TickerProviderStateMixin {
  static const _openTime = Duration(milliseconds: 600);
  static const _shakeShare = 0.6;

  late final AnimationController _open = AnimationController(vsync: this, duration: _openTime)
    ..addStatusListener((s) {
      if (s == AnimationStatus.completed) _finish(pop: true);
    });
  late final AnimationController _pop = AnimationController(vsync: this, duration: const Duration(milliseconds: 450));
  bool _started = false;
  bool _opened = false;

  @override
  void initState() {
    super.initState();
    if (widget.grant.isFixed && widget.builder == null) {
      _started = true;
      _opened = true;
      _pop.value = 1;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _announce();
      });
      return;
    }
    if (widget.autoOpen) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _start();
      });
    }
  }

  void _start() {
    if (_started) return;
    _started = true;
    unawaited(HapticFeedback.mediumImpact());
    if (widget.builder != null || MediaQuery.disableAnimationsOf(context)) {
      _pop.value = 1;
      _finish(pop: false);
      return;
    }
    setState(() {});
    unawaited(_open.forward());
  }

  void _finish({required bool pop}) {
    if (_opened || !mounted) return;
    setState(() => _opened = true);
    if (pop) unawaited(_pop.forward());
    _announce();
  }

  void _announce() {
    widget.onOpened?.call();
    widget.onRevealed?.call(widget.grant);
    reportRewardsEvent(
      widget.onEvent,
      RewardsEvent(RewardsEventName.revealOpened, {'program': widget.grant.program, 'kind': widget.grant.kind}),
    );
  }

  @override
  void dispose() {
    _open.dispose();
    _pop.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.builder;
    if (b != null) return b(context, widget.grant, _opened, _start);
    final t = RewardsTheme.of(context);
    return Container(decoration: t.card, padding: t.padding, child: _opened ? _openedView(t) : _closedView(t));
  }

  Widget _closedView(RewardsTheme t) {
    final texts = widget.texts.reveal;
    return GestureDetector(
      onTap: _start,
      behavior: HitTestBehavior.opaque,
      child: AnimatedBuilder(
        animation: _open,
        builder: (context, child) {
          final v = _open.value;
          var angle = 0.0, scale = 1.0, opacity = 1.0;
          if (v < _shakeShare) {
            final p = v / _shakeShare;
            angle = math.sin(p * math.pi * 6) * 0.14 * (1 - p);
          } else {
            final p = (v - _shakeShare) / (1 - _shakeShare);
            scale = 1 + 0.35 * Curves.easeOut.transform(p);
            opacity = 1 - 0.6 * p;
          }
          return Opacity(
            opacity: opacity,
            child: Transform.scale(
              scale: scale,
              child: Transform.rotate(angle: angle, child: child),
            ),
          );
        },
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.card_giftcard, size: 64, color: t.accent),
            const SizedBox(height: 8),
            Text(texts.title, style: t.titleStyle, textAlign: TextAlign.center),
            Text(
              texts.tapToOpen,
              style: t.bodyStyle?.copyWith(color: t.muted),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            FilledButton(onPressed: _started ? null : _start, child: Text(texts.open)),
          ],
        ),
      ),
    );
  }

  Widget _openedView(RewardsTheme t) {
    final texts = widget.texts;
    return ScaleTransition(
      scale: CurvedAnimation(parent: _pop, curve: Curves.elasticOut),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.celebration, size: 56, color: t.accent),
          const SizedBox(height: 8),
          Text(
            texts.reveal.youGot(texts.reward(widget.grant.spec)),
            style: t.titleStyle?.copyWith(color: t.onSurface, fontWeight: FontWeight.w700),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

/// Shows [grant] in a [RewardReveal] inside a dialog with a close button ("Close", then "Nice!" once opened).
/// Completes when the dialog is closed. Pass `controller.client.report` as [onEvent] for analytics.
Future<void> showRewardReveal(
  BuildContext context,
  RewardGrant grant, {
  RewardsTexts texts = const RewardsTexts(),
  bool autoOpen = false,
  VoidCallback? onOpened,
  RewardsEventSink? onEvent,
}) => showDialog<void>(
  context: context,
  builder: (context) =>
      _RevealDialog(grant: grant, texts: texts, autoOpen: autoOpen, onOpened: onOpened, onEvent: onEvent),
);

class _RevealDialog extends StatefulWidget {
  const _RevealDialog({required this.grant, required this.texts, this.autoOpen = false, this.onOpened, this.onEvent});

  final RewardGrant grant;
  final RewardsTexts texts;
  final bool autoOpen;
  final VoidCallback? onOpened;
  final RewardsEventSink? onEvent;

  @override
  State<_RevealDialog> createState() => _RevealDialogState();
}

class _RevealDialogState extends State<_RevealDialog> {
  bool _opened = false;

  @override
  Widget build(BuildContext context) {
    final texts = widget.texts.reveal;
    void close() => Navigator.of(context).pop();
    return Dialog(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            RewardReveal(
              grant: widget.grant,
              texts: widget.texts,
              autoOpen: widget.autoOpen,
              onEvent: widget.onEvent,
              onOpened: () {
                setState(() => _opened = true);
                widget.onOpened?.call();
              },
            ),
            const SizedBox(height: 12),
            if (_opened)
              FilledButton.tonal(onPressed: close, child: Text(texts.nice))
            else
              TextButton(onPressed: close, child: Text(texts.close)),
          ],
        ),
      ),
    );
  }
}
