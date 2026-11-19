import 'dart:async';

// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../client.dart';
import '../copy.dart';
import '../events.dart';
import '../models.dart';
import 'code_text.dart';

/// In-app card for rewards that landed (ADR 4.1 step 3, 4.2 step 5): reads `referral_pending` and calls
/// `referral_ack` when the user dismisses one, so each device shows each card once. Shows nothing when there is
/// nothing new or the call fails.
///
/// It asks again when the app comes back to the foreground and when it is given another [client], so a reward
/// granted while the app was in the background, or a card built before the user signed in, still appears without a
/// restart.
class ReferralRewardCard extends StatefulWidget {
  const ReferralRewardCard({
    super.key,
    required this.client,
    this.labels = const RewardLabels(),
    this.leading,
    this.actionLabel,
    this.onAction,
    this.onShown,
    this.onDismissed,
    this.labelsBuilder,
    this.onEvent,
  });

  final ReferralClient client;
  final RewardLabels labels;

  /// Shown before the sentence (an icon or small picture). Nothing when null.
  final Widget? leading;

  /// A second button next to Dismiss (e.g. "Read now"). Tapping it also dismisses the card.
  final String? actionLabel;
  final VoidCallback? onAction;

  /// Called once per reward when its card appears (e.g. to refresh the app's balance: the reward is already
  /// granted on the server by then).
  final ValueChanged<RewardItem>? onShown;

  /// Called when a card is dismissed (Dismiss or the action), after the ack call; `acknowledged` is false when the
  /// ack failed and the card will come back next launch.
  final void Function(RewardItem reward, bool acknowledged)? onDismissed;

  /// Labels built with a context (the app's own localisations). Wins over [labels].
  final RewardLabelsBuilder? labelsBuilder;

  /// Analytics events from this card; [ReferralClient.onEvent] when null.
  final ReferralEventSink? onEvent;

  @override
  State<ReferralRewardCard> createState() => _ReferralRewardCardState();
}

class _ReferralRewardCardState extends State<ReferralRewardCard> with WidgetsBindingObserver {
  List<RewardItem> _items = const [];

  /// Rewards already reported as shown by this card, so a reload does not report them again.
  final Set<String> _shown = {};

  /// Rewards dismissed here; kept hidden even if a reload races the ack.
  final Set<String> _dismissed = {};
  Future<void>? _loading;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _reload();
  }

  @override
  void didUpdateWidget(ReferralRewardCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.client, widget.client)) {
      _generation++;
      _items = const [];
      _shown.clear();
      _dismissed.clear();
      _loading = null;
      _reload();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _reload();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  void _reload() {
    if (_loading != null) return;
    final f = _load(_generation);
    _loading = f;
    unawaited(
      f.whenComplete(() {
        if (identical(_loading, f)) _loading = null;
      }),
    );
  }

  Future<void> _load(int generation) async {
    try {
      final all = await widget.client.pending();
      if (!mounted || generation != _generation) return;
      final items = all.where((r) => !_dismissed.contains(r.id)).toList(growable: false);
      setState(() => _items = items);
      for (final r in items) {
        if (!_shown.add(r.id)) continue;
        _emit(ReferralEvent(ReferralEventName.rewardShown, rewardEventProps(r)));
        _safe(() => widget.onShown?.call(r));
      }
    } catch (_) {
      // Nothing new shown; the rewards stay pending on the server and appear on the next resume or launch.
    }
  }

  void _emit(ReferralEvent e) => reportReferralEvent(widget.onEvent ?? widget.client.onEvent, e);

  void _safe(void Function() f) {
    try {
      f();
    } catch (_) {
      // The app's callback failed; the card keeps working.
    }
  }

  Future<void> _dismiss(RewardItem r) async {
    _dismissed.add(r.id);
    setState(() => _items = _items.where((x) => x.id != r.id).toList());
    var acked = true;
    try {
      await widget.client.ack([r.id]);
    } catch (_) {
      // Not acknowledged: the card comes back next launch, which is better than never showing it.
      acked = false;
    }
    _emit(ReferralEvent(ReferralEventName.rewardAcknowledged, {...rewardEventProps(r), 'acknowledged': acked}));
    _safe(() => widget.onDismissed?.call(r, acked));
  }

  @override
  Widget build(BuildContext context) {
    if (_items.isEmpty) return const SizedBox.shrink();
    final l10n = referralL10n(context);
    final labels = resolveRewardLabels(context, widget.labels, widget.labelsBuilder);
    final copy = ReferralCopy(l10n: l10n, terms: ReferralTerms.none, labels: labels);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final r in _items)
          Card(
            key: ValueKey('referral-reward-${r.id}'),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (widget.leading != null) ...[widget.leading!, const SizedBox(width: 12)],
                      Expanded(child: Semantics(liveRegion: true, child: Text(copy.rewardCard(r)))),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    alignment: WrapAlignment.end,
                    spacing: 8,
                    children: [
                      TextButton(
                        style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
                        onPressed: () => unawaited(_dismiss(r)),
                        child: Text(l10n.dismiss),
                      ),
                      if (widget.actionLabel != null && widget.onAction != null)
                        FilledButton(
                          key: ValueKey('referral-reward-action-${r.id}'),
                          style: FilledButton.styleFrom(minimumSize: const Size(48, 48)),
                          onPressed: () {
                            unawaited(_dismiss(r));
                            widget.onAction!();
                          },
                          child: Text(widget.actionLabel!),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
