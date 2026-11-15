import 'dart:async';

import 'package:flutter/material.dart';

import '../controller.dart';
import '../events.dart';
import '../texts.dart';
import '../theme.dart';
import 'base.dart';

/// "Watch an ad for 10 coins". The app shows the ad through RevenueCat's AdMob adapter (ADR 0002 §18.5) in
/// [onShowAd] and returns true when RevenueCat reported a verified reward; the package depends on neither
/// RevenueCat nor AdMob. After a verified reward the rewards state is reloaded now and again after each of
/// [refreshAfter] (RevenueCat's webhook reaches the server a little later).
///
/// Hidden while rewards are not visible or [enabled] is false (pass your copy of `settings.ads_enabled` / your own
/// ad availability: the server switch is not in the state).
class RewardedAdButton extends StatefulWidget {
  const RewardedAdButton({
    super.key,
    required this.controller,
    required this.label,
    required this.onShowAd,
    this.enabled = true,
    this.refreshAfter = const [Duration(seconds: 5), Duration(seconds: 20)],
    this.texts = const RewardsTexts(),
    this.builder,
  });

  final RewardsController controller;

  /// The app's text, e.g. "Watch an ad for 10 coins".
  final String label;

  /// Shows the ad; true when RevenueCat verified the reward.
  final Future<bool> Function() onShowAd;
  final bool enabled;
  final List<Duration> refreshAfter;
  final RewardsTexts texts;

  /// Your own look. `show` is null while an ad is showing; `message` is the last not-verified / error line.
  final Widget Function(BuildContext context, VoidCallback? show, bool busy, String? message)? builder;

  @override
  State<RewardedAdButton> createState() => _RewardedAdButtonState();
}

class _RewardedAdButtonState extends State<RewardedAdButton> {
  bool _busy = false;
  String? _message;
  final _timers = <Timer>[];

  void _report(String result) =>
      widget.controller.client.report(RewardsEvent(RewardsEventName.adRewardShown, {'result': result}));

  Future<void> _show() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    bool ok;
    String? message;
    try {
      ok = await widget.onShowAd();
      _report(ok ? 'verified' : 'not_verified');
      if (!ok) message = widget.texts.programs.adNotVerified;
    } catch (_) {
      ok = false;
      _report('error');
      message = widget.texts.programs.adError;
    }
    if (ok) {
      unawaited(widget.controller.refresh());
      for (final t in _timers) {
        t.cancel();
      }
      _timers
        ..clear()
        ..addAll([for (final d in widget.refreshAfter) Timer(d, () => unawaited(widget.controller.refresh()))]);
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _message = message;
    });
  }

  @override
  void dispose() {
    for (final t in _timers) {
      t.cancel();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.enabled) return const SizedBox.shrink();
    return RewardsListener(
      controller: widget.controller,
      builder: (context) {
        final show = _busy ? null : _show;
        final b = widget.builder;
        if (b != null) return b(context, show, _busy, _message);
        final t = RewardsTheme.of(context);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            OutlinedButton.icon(
              onPressed: show,
              icon: _busy
                  ? const SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : Icon(Icons.ondemand_video, color: t.accent),
              label: Text(widget.label),
            ),
            if (_message != null) Text(_message!, style: t.bodyStyle?.copyWith(color: t.muted)),
          ],
        );
      },
    );
  }
}
