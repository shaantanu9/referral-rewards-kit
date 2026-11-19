import 'dart:async';

// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../controller.dart';
import '../models.dart';
import '../texts.dart';
import '../theme.dart';
import 'base.dart';
import 'reward_reveal.dart';

/// Rewards not yet seen. Granted ones get "Got it" (marks them seen); pending ones (e.g. Premium days the server
/// has not given yet) show "On its way" and stay until they land.
class RewardInbox extends StatelessWidget {
  const RewardInbox({
    super.key,
    required this.controller,
    this.texts = const RewardsTexts(),
    this.showEmpty = false,
    this.builder,
  });

  final RewardsController controller;
  final RewardsTexts texts;

  /// Show [RewardsTexts.inboxEmpty] when there is nothing; default: nothing.
  final bool showEmpty;

  /// Your own look for the whole list.
  final Widget Function(BuildContext context, List<RewardGrant> inbox, Future<String?> Function(List<String> ids) seen)?
  builder;

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: controller,
    builder: (context) {
      final inbox = controller.state.inbox;
      final b = builder;
      if (b != null) return b(context, inbox, controller.markSeen);
      final t = RewardsTheme.of(context);
      if (inbox.isEmpty) {
        return showEmpty
            ? Text(texts.inboxEmpty, style: t.bodyStyle?.copyWith(color: t.muted))
            : const SizedBox.shrink();
      }
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final g in inbox)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Container(
                decoration: t.card,
                padding: t.padding,
                child: Row(
                  children: [
                    Icon(Icons.card_giftcard, color: t.accent),
                    const SizedBox(width: 12),
                    Expanded(child: Text(texts.gotReward(texts.reward(g.spec)), style: t.bodyStyle)),
                    if (g.state == GrantState.granted)
                      TextButton(onPressed: () => controller.markSeen([g.id]), child: Text(texts.gotIt))
                    else
                      Text(texts.onItsWay, style: t.bodyStyle?.copyWith(color: t.muted)),
                  ],
                ),
              ),
            ),
        ],
      );
    },
  );
}

/// Wraps your screen and announces each new grant once: a SnackBar by default, or your [onGrant].
///
/// With [holdUntilMoment] grants are queued until the app calls `controller.celebrateNow()` (e.g. when a chapter
/// ends), so a reward never interrupts reading or a quiz question.
///
/// With [revealSurprises] (default true) a grant whose `shouldReveal` is true (a surprise, mystery or range reward,
/// ADR 0002 §18.6) opens `showRewardReveal` instead of the SnackBar, one dialog at a time: several are queued and
/// shown one after the other. Needs a `Navigator` above this widget; without one it falls back to the SnackBar.
/// [onGrant], when given, still replaces all of this.
class RewardToastListener extends StatefulWidget {
  const RewardToastListener({
    super.key,
    required this.controller,
    required this.child,
    this.texts = const RewardsTexts(),
    this.onGrant,
    this.holdUntilMoment = false,
    this.revealSurprises = true,
  });

  final RewardsController controller;
  final Widget child;

  /// Queue grants until `controller.celebrateNow()`. Default false: announce at once.
  final bool holdUntilMoment;

  /// Show surprise / mystery / range grants in the reveal dialog. Default true.
  final bool revealSurprises;
  final RewardsTexts texts;
  final void Function(BuildContext context, RewardGrant grant)? onGrant;

  @override
  State<RewardToastListener> createState() => _RewardToastListenerState();
}

class _RewardToastListenerState extends State<RewardToastListener> {
  StreamSubscription<RewardGrant>? _sub;
  StreamSubscription<void>? _moments;
  final _held = <RewardGrant>[];
  final _reveals = <RewardGrant>[];
  bool _revealing = false;

  @override
  void initState() {
    super.initState();
    _listen();
  }

  void _listen() {
    _sub = widget.controller.newGrants.listen(_arrived);
    _moments = widget.controller.moments.listen((_) => _flush());
  }

  @override
  void didUpdateWidget(RewardToastListener old) {
    super.didUpdateWidget(old);
    if (old.controller != widget.controller) {
      _sub?.cancel();
      _moments?.cancel();
      _listen();
    }
    if (old.holdUntilMoment && !widget.holdUntilMoment) _flush();
  }

  void _arrived(RewardGrant g) {
    if (widget.holdUntilMoment) {
      _held.add(g);
    } else {
      _show(g);
    }
  }

  void _flush() {
    final held = List.of(_held);
    _held.clear();
    held.forEach(_show);
  }

  void _show(RewardGrant g) {
    if (!mounted) return;
    final f = widget.onGrant;
    if (f != null) return f(context, g);
    if (widget.revealSurprises && g.shouldReveal && Navigator.maybeOf(context) != null) {
      _reveals.add(g);
      unawaited(_nextReveal());
      return;
    }
    ScaffoldMessenger.maybeOf(
      context,
    )?.showSnackBar(SnackBar(content: Text(widget.texts.gotReward(widget.texts.reward(g.spec)))));
  }

  Future<void> _nextReveal() async {
    if (_revealing) return;
    _revealing = true;
    try {
      while (_reveals.isNotEmpty && mounted) {
        final g = _reveals.removeAt(0);
        await showRewardReveal(context, g, texts: widget.texts, onEvent: widget.controller.client.report);
      }
    } finally {
      _revealing = false;
    }
  }

  @override
  void dispose() {
    _reveals.clear();
    _sub?.cancel();
    _moments?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
