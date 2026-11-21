import 'dart:async';
import 'dart:math' as math;

// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../client.dart';
import '../copy.dart';
import '../events.dart';
import '../models.dart';
import '../prompt_policy.dart';
import '../storage.dart';
import 'code_text.dart';

/// The friend's in-app card (G2, G3), from `referral_my_claim`:
///
/// - **claimed**: "Your welcome gift of 4 free chapters is waiting: Read your first page. 12 days left." The step is
///   [activationStep] (or "Start using {app}"); the days are the server's.
/// - **joined**: once, "Pass it on: give a friend 4 free chapters when they join with your code and start using the
///   app." with "Invite a friend" ([onPassItOn], e.g. open the `InviteHub`). With a [policy] it shows only when
///   `shouldPromptFor(welcomeRewardReceived)` allows it (never in the first session, once ever).
/// - none / expired: nothing.
///
/// Not nagging: each state shows in at most one app session per day (the claimed card again the next day until the
/// friend starts; the pass-it-on card never again after its first session), and "Got it" hides it. Remembered in
/// [store]. In-app only: no push, no email. Nothing on a server without `referral_my_claim` or when offline.
class ReferralWelcomeCard extends StatefulWidget {
  const ReferralWelcomeCard({
    super.key,
    required this.client,
    required this.store,
    required this.appName,
    this.activationStep,
    this.onPassItOn,
    this.policy,
    this.labels = const RewardLabels(),
    this.labelsBuilder,
    this.leading,
    this.clock = DateTime.now,
    this.onEvent,
  });

  final ReferralClient client;
  final KeyValueStore store;
  final String appName;

  /// The app's words for the first real use, e.g. "Read your first page".
  final String? activationStep;

  /// Opens the invite hub from the pass-it-on card. Without it the card has only "Got it".
  final VoidCallback? onPassItOn;

  /// The app's prompt policy: the pass-it-on card is a prompt, so it follows [ReferralPromptMoment.welcomeRewardReceived].
  final ReferralPromptPolicy? policy;
  final RewardLabels labels;
  final RewardLabelsBuilder? labelsBuilder;
  final Widget? leading;
  final DateTime Function() clock;

  /// Analytics; [ReferralClient.onEvent] when null.
  final ReferralEventSink? onEvent;

  /// Identifies this app launch, so a card stays visible across rebuilds within one session but not in the next
  /// launch the same day. Tests set it to simulate a new launch.
  @visibleForTesting
  static String session = '${DateTime.now().microsecondsSinceEpoch}-${math.Random().nextInt(1 << 30)}';

  static const _claimedShownKey = 'welcome_card.claimed.shown';
  static const _claimedDismissedKey = 'welcome_card.claimed.dismissed';
  static const _joinedKey = 'welcome_card.joined';

  @override
  State<ReferralWelcomeCard> createState() => _ReferralWelcomeCardState();
}

class _ReferralWelcomeCardState extends State<ReferralWelcomeCard> {
  MyClaim? _claim;
  ReferralTerms _terms = ReferralTerms.none;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_load(_generation));
  }

  @override
  void didUpdateWidget(ReferralWelcomeCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.client, widget.client)) {
      _claim = null;
      unawaited(_load(++_generation));
    }
  }

  String _day() {
    final d = widget.clock().toLocal();
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }

  Future<void> _load(int generation) async {
    try {
      final claim = await widget.client.myClaim();
      final show = switch (claim.state) {
        MyClaimState.claimed => await _mayShowClaimed(),
        MyClaimState.joined => await _mayShowJoined(),
        _ => false,
      };
      if (!show) return;
      var terms = ReferralTerms.none;
      if (claim.state == MyClaimState.joined) {
        try {
          terms = await widget.client.terms();
        } catch (_) {
          // The plain "invite a friend to {app}" line then.
        }
      }
      if (!mounted || generation != _generation) return;
      setState(() {
        _claim = claim;
        _terms = terms;
      });
      _emit(ReferralEventName.welcomeCardShown, {'state': claim.state.name});
    } catch (_) {
      // Older server or offline: no card.
    }
  }

  Future<bool> _mayShowClaimed() async {
    final s = widget.store, today = _day(), session = ReferralWelcomeCard.session;
    if (await s.getString(ReferralWelcomeCard._claimedDismissedKey) == today) return false;
    final shown = await s.getString(ReferralWelcomeCard._claimedShownKey);
    if (shown != null && shown.startsWith('$today|') && shown != '$today|$session') return false;
    await s.setString(ReferralWelcomeCard._claimedShownKey, '$today|$session');
    return true;
  }

  Future<bool> _mayShowJoined() async {
    final s = widget.store, session = ReferralWelcomeCard.session;
    final v = await s.getString(ReferralWelcomeCard._joinedKey);
    if (v != null) return v == session;
    final policy = widget.policy;
    if (policy != null) {
      if (!await policy.shouldPromptFor(ReferralPromptMoment.welcomeRewardReceived)) return false;
      await policy.markPromptedFor(ReferralPromptMoment.welcomeRewardReceived);
    }
    await s.setString(ReferralWelcomeCard._joinedKey, session);
    return true;
  }

  void _emit(ReferralEventName name, Map<String, Object> props) =>
      reportReferralEvent(widget.onEvent ?? widget.client.onEvent, ReferralEvent(name, props));

  Future<void> _close(String action) async {
    final claim = _claim;
    if (claim == null) return;
    setState(() => _claim = null);
    _emit(ReferralEventName.welcomeCardDismissed, {'state': claim.state.name, 'action': action});
    if (claim.state == MyClaimState.claimed) {
      await widget.store.setString(ReferralWelcomeCard._claimedDismissedKey, _day());
    } else {
      await widget.store.setString(ReferralWelcomeCard._joinedKey, 'done');
    }
  }

  @override
  Widget build(BuildContext context) {
    final claim = _claim;
    if (claim == null) return const SizedBox.shrink();
    final l10n = referralL10n(context);
    final labels = resolveRewardLabels(context, widget.labels, widget.labelsBuilder);
    final copy = ReferralCopy(l10n: l10n, terms: _terms, labels: labels);
    final joined = claim.state == MyClaimState.joined;
    final text = joined
        ? copy.passItOn(appName: widget.appName)
        : copy.welcomeWaiting(claim, appName: widget.appName, activationStep: widget.activationStep);
    const target = Size(48, 48);
    return Card(
      key: ValueKey('referral-welcome-${claim.state.name}'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                widget.leading ?? Icon(joined ? Icons.favorite_outline : Icons.card_giftcard),
                const SizedBox(width: 12),
                Expanded(child: Semantics(liveRegion: true, child: Text(text))),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              alignment: WrapAlignment.end,
              spacing: 8,
              children: [
                TextButton(
                  key: const ValueKey('referral-welcome-dismiss'),
                  style: TextButton.styleFrom(minimumSize: target),
                  onPressed: () => unawaited(_close('dismiss')),
                  child: Text(l10n.dismiss),
                ),
                if (joined && widget.onPassItOn != null)
                  FilledButton(
                    key: const ValueKey('referral-welcome-invite'),
                    style: FilledButton.styleFrom(minimumSize: target),
                    onPressed: () {
                      unawaited(_close('invite'));
                      widget.onPassItOn!();
                    },
                    child: Text(l10n.inviteAFriend),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
