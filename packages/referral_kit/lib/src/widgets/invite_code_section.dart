import 'dart:async';

import 'package:flutter/material.dart';

import '../availability.dart';
import '../client.dart';
import '../copy.dart';
import '../events.dart';
import '../models.dart';
import '../pending_claim.dart';
import '../texts.dart';
import 'code_text.dart';
import 'invite_code_entry.dart';
import 'message.dart';

/// The friend's side of a referral, built to make the gift and its real deadline clear (the first app's design,
/// docs/integration.md "Design rules"): every number comes from `referral_terms`, so nothing is promised that the
/// server does not give.
///
/// - Open: the gift a friend's code brings ("A gift is waiting for you: 4 free chapters", only when the friend rule
///   gives something), the server's days left as a chip ("Only 3 days left to add a code"), the code field
///   ([InviteCodeEntry]: paste, disclosure, every refusal reason, offline queue) and three steps.
/// - Code accepted: "Almost yours", a 1-of-2 progress bar, and the app's next step ([onAlmostAction]).
/// - Can't add a code (window over, or this account is not eligible): no field, one line saying why.
/// - Not deployed / signed out: [unavailableBuilder], or one sentence (Sign in with [onSignIn]).
///
/// Colours come from the app's `ThemeData`; art goes in [header] (above) and [leading] (beside the headline).
class InviteCodeSection extends StatefulWidget {
  const InviteCodeSection({
    super.key,
    required this.client,
    required this.queue,
    required this.appName,
    this.terms,
    this.labels = const RewardLabels(),
    this.labelsBuilder,
    this.texts,
    this.initialCode,
    this.eligibleFrom,
    this.onClaimed,
    this.onAlmostAction,
    this.header,
    this.leading,
    this.showSteps = true,
    this.onEvent,
    this.unavailableBuilder,
    this.onSignIn,
    this.pastePlatform,
    this.clock = DateTime.now,
  });

  final ReferralClient client;
  final PendingClaimQueue queue;
  final String appName;

  /// Loaded through [client] when null.
  final ReferralTerms? terms;
  final RewardLabels labels;
  final RewardLabelsBuilder? labelsBuilder;
  final ReferralTexts? texts;

  /// A code from a link or the install referrer: shown with one-tap confirm (reports `invite_link_opened`).
  final String? initialCode;

  /// See [InviteCodeEntry.eligibleFrom]; the server's `claim_days_left` wins.
  final DateTime? eligibleFrom;
  final ValueChanged<ClaimResult>? onClaimed;

  /// The button under "Almost yours" (e.g. go to the reader). Hidden when null.
  final VoidCallback? onAlmostAction;

  /// App art above the section.
  final Widget? header;

  /// App art beside the headline (e.g. a "+4" sticker).
  final Widget? leading;

  /// The three steps under the field (only when the friend gets a reward).
  final bool showSteps;
  final ReferralEventSink? onEvent;
  final ReferralUnavailableBuilder? unavailableBuilder;
  final VoidCallback? onSignIn;
  final TargetPlatform? pastePlatform;
  final DateTime Function() clock;

  @override
  State<InviteCodeSection> createState() => _InviteCodeSectionState();
}

class _InviteCodeSectionState extends State<InviteCodeSection> {
  ReferralTerms? _terms;
  bool _loading = false;
  ReferralUnavailableReason? _unavailable;

  /// The terms as they stood when the code went in (after a claim the server says no days are left).
  ReferralTerms? _claimedWith;
  bool _closedReported = false;

  @override
  void initState() {
    super.initState();
    _terms = widget.terms;
    if (_terms == null) unawaited(_load());
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final t = await widget.client.terms();
      if (mounted) setState(() => _terms = t);
    } on ReferralUnavailableException catch (e) {
      if (mounted) setState(() => _unavailable = e.reason);
    } catch (_) {
      // Offline: the entry still works (the code is kept); no numbers are named.
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _claimed(ClaimResult r, ReferralTerms terms) {
    widget.onClaimed?.call(r);
    if (r.isOk) setState(() => _claimedWith = terms);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = referralL10n(context);
    final texts = widget.texts;
    final title = texts?.entryTitle ?? l10n.enterCodeTitle;
    final unavailable = _unavailable;
    if (unavailable != null) {
      final custom = widget.unavailableBuilder;
      if (custom != null) return custom(context, unavailable);
      return ReferralEntryUnavailable(title: title, reason: unavailable, texts: texts, onSignIn: widget.onSignIn);
    }
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    final labels = resolveRewardLabels(context, widget.labels, widget.labelsBuilder);
    final terms = _claimedWith ?? _terms;
    final copy = ReferralCopy(l10n: l10n, terms: terms ?? ReferralTerms.none, labels: labels);
    final friendReward = terms == null ? null : copy.friendReward;
    final List<Widget> body;
    if (_claimedWith != null && friendReward != null) {
      body = _almost(context, copy, friendReward);
    } else if (terms != null && copy.cannotAddReason() != null) {
      body = _cannot(context, copy, title);
    } else {
      body = _open(context, copy, terms, friendReward, title);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.header != null) ...[widget.header!, const SizedBox(height: 12)],
        ...body,
      ],
    );
  }

  List<Widget> _open(
    BuildContext context,
    ReferralCopy copy,
    ReferralTerms? terms,
    String? friendReward,
    String title,
  ) {
    final theme = Theme.of(context);
    final texts = widget.texts;
    final headline = texts?.giftTitle?.call(friendReward) ?? (friendReward == null ? title : copy.giftTitle());
    final days = terms?.claimDaysLeft;
    final deadline = terms == null || days == null || days <= 0
        ? null
        : (texts?.deadline?.call(days) ?? copy.deadline());
    final steps =
        texts?.steps?.call(friendReward, copy.bothGetSame) ??
        copy.steps(appName: widget.appName, activationStep: texts?.activationStep);
    return [
      Row(
        children: [
          if (widget.leading != null) ...[widget.leading!, const SizedBox(width: 12)],
          Expanded(
            child: Text(headline, key: const ValueKey('referral-gift-title'), style: theme.textTheme.titleMedium),
          ),
        ],
      ),
      if (deadline != null) ...[
        const SizedBox(height: 8),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: ReferralDeadlineChip(text: deadline, lastDay: days == 1),
        ),
      ],
      const SizedBox(height: 12),
      InviteCodeEntry(
        client: widget.client,
        queue: widget.queue,
        terms: terms,
        eligibleFrom: widget.eligibleFrom,
        initialCode: widget.initialCode,
        labels: widget.labels,
        labelsBuilder: widget.labelsBuilder,
        onClaimed: (r) => _claimed(r, terms ?? ReferralTerms.none),
        clock: widget.clock,
        pastePlatform: widget.pastePlatform,
        // The chip shows the days left; the entry still states a closed window.
        showWindow: deadline == null,
        showTitle: false,
        texts: texts,
        onSignIn: widget.onSignIn,
        onEvent: widget.onEvent,
        unavailableBuilder: widget.unavailableBuilder,
      ),
      if (widget.showSteps && friendReward != null) ...[
        const SizedBox(height: 16),
        Text(texts?.stepsTitle ?? referralL10n(context).stepsTitle, style: theme.textTheme.titleSmall),
        const SizedBox(height: 8),
        for (final (i, step) in steps.indexed)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CircleAvatar(
                  radius: 12,
                  backgroundColor: theme.colorScheme.secondaryContainer,
                  foregroundColor: theme.colorScheme.onSecondaryContainer,
                  child: Text('${i + 1}', style: theme.textTheme.labelMedium),
                ),
                const SizedBox(width: 12),
                Expanded(child: Text(step, style: theme.textTheme.bodyMedium)),
              ],
            ),
          ),
      ],
    ];
  }

  List<Widget> _almost(BuildContext context, ReferralCopy copy, String friendReward) {
    final l10n = referralL10n(context);
    final theme = Theme.of(context);
    final texts = widget.texts;
    final progress = texts?.almostProgress ?? l10n.almostProgress;
    return [
      Text(
        texts?.almostTitle ?? l10n.almostTitle,
        key: const ValueKey('referral-almost'),
        style: theme.textTheme.titleMedium,
      ),
      const SizedBox(height: 8),
      Text(texts?.almostLine?.call(friendReward, copy.bothGetSame) ?? copy.almostLine()),
      const SizedBox(height: 12),
      Semantics(
        label: progress,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: const LinearProgressIndicator(value: 0.5, minHeight: 8),
        ),
      ),
      const SizedBox(height: 8),
      ExcludeSemantics(
        child: Text(progress, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
      ),
      if (widget.onAlmostAction != null) ...[
        const SizedBox(height: 16),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: FilledButton(
            key: const ValueKey('referral-almost-action'),
            style: FilledButton.styleFrom(minimumSize: const Size(48, 48)),
            onPressed: widget.onAlmostAction,
            child: Text(texts?.almostActionLabel ?? l10n.stepStartUsing(widget.appName)),
          ),
        ),
      ],
    ];
  }

  List<Widget> _cannot(BuildContext context, ReferralCopy copy, String title) {
    final theme = Theme.of(context);
    final closed = (copy.terms.claimDaysLeft ?? 1) <= 0;
    if (closed && !_closedReported) {
      _closedReported = true;
      unawaited(widget.client.reportHidden('window_closed', surface: 'entry'));
    }
    final why = widget.texts?.cannotAdd?.call(closed, copy.terms.claimWindowDays) ?? copy.cannotAddReason()!;
    return [
      Text(title, style: theme.textTheme.titleMedium),
      const SizedBox(height: 4),
      Text(
        why,
        key: const ValueKey('referral-cannot-add'),
        style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      ),
    ];
  }
}

/// The real days left as a chip, from the app's theme: the secondary container normally, the error container on the
/// last day.
class ReferralDeadlineChip extends StatelessWidget {
  const ReferralDeadlineChip({super.key, required this.text, this.lastDay = false});
  final String text;
  final bool lastDay;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final bg = lastDay ? scheme.errorContainer : scheme.secondaryContainer;
    final fg = lastDay ? scheme.onErrorContainer : scheme.onSecondaryContainer;
    return DecoratedBox(
      key: const ValueKey('referral-deadline'),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.schedule, size: 16, color: fg),
            const SizedBox(width: 6),
            Flexible(
              child: Text(text, style: Theme.of(context).textTheme.labelLarge?.copyWith(color: fg)),
            ),
          ],
        ),
      ),
    );
  }
}
