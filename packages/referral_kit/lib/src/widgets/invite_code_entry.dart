import 'dart:async';

// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../availability.dart';
import '../client.dart';
import '../code_format.dart';
import '../copy.dart';
import '../events.dart';
import '../models.dart';
import '../paste.dart';
import '../pending_claim.dart';
import '../texts.dart';
import 'code_text.dart';
import 'message.dart';

/// Invite-code entry (ADR 4.2 step 3, 11.2, 11.6): a text field with Paste, the claim-window countdown, the
/// disclosure sentence before confirming, a message per claim reason, and one-tap confirm for a prefilled code.
///
/// Claims go through [queue], so an offline or `not_verified` claim is kept and retried.
class InviteCodeEntry extends StatefulWidget {
  const InviteCodeEntry({
    super.key,
    required this.client,
    required this.queue,
    this.terms,
    this.eligibleFrom,
    this.initialCode,
    this.labels = const RewardLabels(),
    this.onClaimed,
    this.clock = DateTime.now,
    this.pastePlatform,
    this.showWindow = true,
    this.labelsBuilder,
    this.onEvent,
    this.unavailableBuilder,
    this.title,
    this.texts,
    this.onSignIn,
    this.showTitle = true,
  });

  final ReferralClient client;
  final PendingClaimQueue queue;

  /// Loaded through [client] when null.
  final ReferralTerms? terms;

  /// When the account became verified (e.g. supabase_flutter `User.emailConfirmedAt`), for the countdown. The
  /// server keeps its own `members.eligible_from` and always decides; without this value no countdown is shown.
  final DateTime? eligibleFrom;

  /// A code from a link or the install referrer: shown with one-tap confirm.
  final String? initialCode;
  final RewardLabels labels;
  final ValueChanged<ClaimResult>? onClaimed;
  final DateTime Function() clock;

  /// Overrides the platform for the Paste control, for tests.
  final TargetPlatform? pastePlatform;

  /// Whether to show the "You can add an invite code for N more days" line. An app that shows the same count
  /// elsewhere on the screen sets false, so it is not on screen twice. The closed state still shows.
  final bool showWindow;

  /// Labels built with a context (the app's own localisations). Wins over [labels].
  final RewardLabelsBuilder? labelsBuilder;

  /// Analytics events from this widget; [ReferralClient.onEvent] when null. Claim results come from the [queue]'s
  /// client.
  final ReferralEventSink? onEvent;

  /// Shown instead of the entry when referrals are unavailable (not deployed, signed out). Without it the title and
  /// "Invite codes aren't available yet." are shown, with no field.
  final ReferralUnavailableBuilder? unavailableBuilder;

  /// Replaces the "Have an invite code?" title. Wins over `texts.entryTitle`.
  final String? title;

  /// The app's own words (title, unavailable messages, Sign in).
  final ReferralTexts? texts;

  /// Shown as a Sign in button when the user is signed out.
  final VoidCallback? onSignIn;

  /// False when the app (or `InviteCodeSection`) shows its own headline above the entry.
  final bool showTitle;

  @override
  State<InviteCodeEntry> createState() => _InviteCodeEntryState();
}

class _InviteCodeEntryState extends State<InviteCodeEntry> {
  final _controller = TextEditingController();
  ReferralTerms? _terms;
  String? _prefilled;
  String? _message;
  bool _busy = false;
  bool _done = false;
  bool _started = false;
  bool _closedReported = false;
  bool _codeKept = false;
  ReferralUnavailableReason? _unavailable;

  void _emit(ReferralEvent e) => reportReferralEvent(widget.onEvent ?? widget.client.onEvent, e);

  void _start(String source) {
    if (_started) return;
    _started = true;
    _emit(ReferralEvent(ReferralEventName.codeEntryStarted, {'source': source}));
  }

  @override
  void initState() {
    super.initState();
    _terms = widget.terms;
    final pre = normaliseCode(widget.initialCode);
    if (isWellFormedCode(pre)) {
      _prefilled = pre;
      widget.client.reportLinkOpened(pre);
    }
    if (_terms == null) {
      unawaited(_loadTerms());
    } else {
      _reportIfClosed(_terms!);
    }
    unawaited(_loadKept());
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _loadTerms() async {
    try {
      final t = await widget.client.terms();
      if (!mounted) return;
      setState(() => _terms = t);
      _reportIfClosed(t);
    } on ReferralUnavailableException catch (e) {
      if (mounted) setState(() => _unavailable = e.reason);
    } catch (_) {
      // Offline: the claim is still queued; the countdown and disclosure fall back (see build).
    }
  }

  Future<void> _loadKept() async {
    final code = await widget.queue.pendingCode();
    final status = await widget.queue.pendingStatus();
    if (!mounted || code == null || status == null) return;
    final l10n = referralL10n(context);
    setState(() {
      _codeKept = true;
      _controller.text = formatCode(code);
      _message = status == ClaimStatus.queuedNotVerified ? l10n.errNotVerified : l10n.offlineQueued;
    });
  }

  void _reportIfClosed(ReferralTerms terms) {
    if (_closedReported || _daysLeft(terms) != 0) return;
    _closedReported = true;
    unawaited(widget.client.reportHidden('window_closed', surface: 'entry'));
  }

  int? _daysLeft(ReferralTerms terms) {
    // The server's count wins; `eligibleFrom` is the fallback for servers without `claim_days_left`.
    if (terms.claimDaysLeft != null) return terms.claimDaysLeft;
    final from = widget.eligibleFrom;
    if (from == null) return null;
    final end = from.add(Duration(days: terms.claimWindowDays));
    final seconds = end.difference(widget.clock()).inSeconds;
    return seconds <= 0 ? 0 : (seconds + 86399) ~/ 86400;
  }

  Future<void> _submit(String raw, {String source = 'typed'}) async {
    final code = normaliseCode(raw);
    if (code.isEmpty || _busy) return;
    final l10n = referralL10n(context);
    final labels = resolveRewardLabels(context, widget.labels, widget.labelsBuilder);
    _start(source);
    setState(() => _busy = true);
    final outcome = await widget.queue.claim(code, source: source);
    if (!mounted) return;
    final copy = ReferralCopy(l10n: l10n, terms: _terms ?? ReferralTerms.none, labels: labels);
    setState(() {
      _busy = false;
      switch (outcome.status) {
        case ClaimStatus.queuedOffline:
          _codeKept = true;
          _unavailable = outcome.unavailable ?? _unavailable;
          _message = outcome.unavailable != null ? l10n.notAvailableCodeKept : l10n.offlineQueued;
        case ClaimStatus.queuedNotVerified:
          _message = l10n.errNotVerified;
        case ClaimStatus.answered:
        case ClaimStatus.nothingPending:
          final r = outcome.result!;
          _done = r.isOk;
          _message = r.isOk ? l10n.claimOk : copy.claimMessage(r);
          if (!r.isOk) _prefilled = null;
      }
    });
    if (outcome.result != null && outcome.status == ClaimStatus.answered) widget.onClaimed?.call(outcome.result!);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = referralL10n(context);
    final theme = Theme.of(context);
    final unavailable = _unavailable;
    final title = widget.title ?? widget.texts?.entryTitle ?? l10n.enterCodeTitle;
    if (unavailable != null) {
      final custom = widget.unavailableBuilder;
      if (custom != null) return custom(context, unavailable);
      return ReferralEntryUnavailable(
        title: widget.showTitle ? title : null,
        reason: unavailable,
        texts: widget.texts,
        onSignIn: widget.onSignIn,
        codeKept: _codeKept,
      );
    }
    final terms = _terms ?? ReferralTerms.none;
    final labels = resolveRewardLabels(context, widget.labels, widget.labelsBuilder);
    final copy = ReferralCopy(l10n: l10n, terms: terms, labels: labels);
    final daysLeft = _daysLeft(terms);
    final closed = daysLeft == 0;

    // Before terms load, name both events: never say less than the server may do.
    final disclosure = _terms == null ? l10n.friendDisclosureBoth : copy.friendDisclosure();
    final buttonStyle = ButtonStyle(minimumSize: WidgetStateProperty.all(const Size(48, 48)));
    const gap = SizedBox(height: 12);

    final children = <Widget>[if (widget.showTitle) Text(title, style: theme.textTheme.titleMedium)];
    if (daysLeft != null && (closed || widget.showWindow)) {
      children.addAll([
        const SizedBox(height: 4),
        Text(
          closed ? l10n.windowOver(terms.claimWindowDays) : l10n.windowCountdown(daysLeft),
          key: const ValueKey('referral-window'),
        ),
      ]);
    }
    if (!closed && !_done) {
      if (_prefilled != null) {
        children.addAll([
          gap,
          InviteCodeText(_prefilled!),
          gap,
          if (disclosure != null) ...[Text(disclosure, key: const ValueKey('referral-disclosure')), gap],
          Wrap(
            spacing: 12,
            runSpacing: 8,
            children: [
              FilledButton(
                style: buttonStyle,
                onPressed: _busy ? null : () => unawaited(_submit(_prefilled!, source: 'prefilled')),
                child: Text(l10n.useCode(formatCode(_prefilled!))),
              ),
              TextButton(
                style: buttonStyle,
                onPressed: _busy ? null : () => setState(() => _prefilled = null),
                child: Text(l10n.enterDifferentCode),
              ),
            ],
          ),
        ]);
      } else {
        children.addAll([
          gap,
          Directionality(
            textDirection: TextDirection.ltr,
            child: TextField(
              key: const ValueKey('referral-code-field'),
              controller: _controller,
              enabled: !_busy,
              autocorrect: false,
              enableSuggestions: false,
              textCapitalization: TextCapitalization.characters,
              style: codeTextStyle(context, fontSize: 22),
              decoration: InputDecoration(labelText: l10n.codeFieldLabel, border: const OutlineInputBorder()),
              onTap: () => _start('focus'),
              onChanged: (_) => _start('typed'),
              onSubmitted: (v) => unawaited(_submit(v)),
            ),
          ),
          gap,
          if (disclosure != null) ...[Text(disclosure, key: const ValueKey('referral-disclosure')), gap],
          Wrap(
            spacing: 12,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              FilledButton(
                style: buttonStyle,
                onPressed: _busy ? null : () => unawaited(_submit(_controller.text)),
                child: Text(l10n.addCode),
              ),
              InviteCodePasteButton(
                platform: widget.pastePlatform,
                onPasted: (text) {
                  _start('pasted');
                  setState(() => _controller.text = formatCode(normaliseCode(text)));
                },
              ),
            ],
          ),
        ]);
      }
    }
    if (_message != null) {
      children.addAll([
        gap,
        Semantics(liveRegion: true, child: Text(_message!, key: const ValueKey('referral-message'))),
      ]);
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: children);
  }
}
