import 'dart:async';

// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../client.dart';
import '../copy.dart';
import '../events.dart';
import '../launcher.dart';
import '../models.dart';
import '../pending_claim.dart';
import '../share.dart';
import '../storage.dart';
import '../texts.dart';
import 'code_text.dart';
import 'invite_code_section.dart';
import 'invite_friends_screen.dart';
import 'message.dart';

/// The two parts of an [InviteHub].
enum InviteHubSection {
  /// "Your invite code" with Share and Copy, the rules, caps, joined count and what you earned.
  invite,

  /// The friend's code: the gift, the real days left, the field, the steps, "almost yours" after a code.
  enterCode,
}

/// The one invite screen an app needs: your code with Share / Copy on top, and a friend's code below. Built from
/// [InviteFriendsScreen] (embedded) and [InviteCodeSection], so every slot they have works here.
///
/// - Open on a part with [initialSection] (e.g. `enterCode` from a "Got a code?" row), or call
///   `GlobalKey<InviteHubState>().currentState!.scrollTo(...)`. Reports `invite_screen_viewed` once per open with
///   [from] and the focus.
/// - Hide a part with [showInvite] / [showEntry].
/// - [scrollable] false: a plain column to put inside the app's own `ListView` / `CustomScrollView` (no nested
///   scrolling); `scrollTo` then scrolls the app's scroll view.
/// - No invite page yet: leave [inviteLink] null (or return null) and give [storeLink]; Share sends the code and
///   the store link.
/// - Not deployed / signed out: one message (or [unavailableBuilder]) instead of two; Sign in with [onSignIn].
/// - Words: [texts] (the app's voice or language) over the package's localisations; colours: the app's ThemeData;
///   art: [header], [entryHeader], [entryLeading].
class InviteHub extends StatefulWidget {
  const InviteHub({
    super.key,
    required this.client,
    required this.queue,
    required this.appName,
    this.inviteLink,
    this.storeLink,
    this.labels = const RewardLabels(),
    this.labelsBuilder,
    this.texts,
    this.onOpenTerms,
    this.share,
    this.codeCache,
    this.header,
    this.shareText,
    this.onCopied,
    this.showInvite = true,
    this.showEntry = true,
    this.initialSection,
    this.from,
    this.eligibleFrom,
    this.initialCode,
    this.onClaimed,
    this.onAlmostAction,
    this.entryHeader,
    this.entryLeading,
    this.showSteps = true,
    this.entryTitle,
    this.onEvent,
    this.unavailableBuilder,
    this.onSignIn,
    this.showAppBar = true,
    this.title,
    this.scrollable = true,
    this.padding = const EdgeInsets.only(bottom: 24),
    this.pastePlatform,
    this.clock = DateTime.now,
    this.launcher = const UrlLauncherReferralLauncher(),
    this.showWhatsApp = true,
    this.showQrCode = true,
    this.showInvitePageSettings = true,
    @Deprecated('The friend part always shows the server count; use texts.deadline to change its words.')
    this.showWindow = true,
  });

  final ReferralClient client;
  final PendingClaimQueue queue;
  final String appName;

  /// See [InviteFriendsScreen.inviteLink]: null (or returning null) while there is no invite page.
  final Uri? Function(String code)? inviteLink;

  /// See [InviteFriendsScreen.storeLink].
  final Uri? storeLink;
  final RewardLabels labels;
  final RewardLabelsBuilder? labelsBuilder;

  /// The app's own words for both parts.
  final ReferralTexts? texts;
  final VoidCallback? onOpenTerms;

  /// The system share sheet when null.
  final ShareHandler? share;
  final KeyValueStore? codeCache;

  /// App art above the code (see [InviteFriendsScreen.header]).
  final Widget? header;

  /// The app's share sentence (see [InviteFriendsScreen.shareText]).
  final String Function(String code, String link)? shareText;

  /// Called after the code was copied.
  final ValueChanged<String>? onCopied;
  final bool showInvite;
  final bool showEntry;

  /// Scrolls to this part once it has loaded.
  final InviteHubSection? initialSection;

  /// Where the app opened the hub from (`invite_screen_viewed.from`): e.g. `you`, `settings`, `home`, `deeplink`.
  final String? from;

  /// See [InviteCodeEntry.eligibleFrom]; the server's `claim_days_left` wins when it sends one.
  final DateTime? eligibleFrom;

  /// A code from a link or the install referrer, shown with one-tap confirm.
  final String? initialCode;
  final ValueChanged<ClaimResult>? onClaimed;

  /// See [InviteCodeSection.onAlmostAction].
  final VoidCallback? onAlmostAction;

  /// App art above / beside the friend part's headline.
  final Widget? entryHeader;
  final Widget? entryLeading;
  final bool showSteps;

  /// Replaces "Have an invite code?" (wins over `texts.entryTitle`).
  final String? entryTitle;
  final ReferralEventSink? onEvent;
  final ReferralUnavailableBuilder? unavailableBuilder;
  final VoidCallback? onSignIn;

  /// An app bar with [title] ("Invite friends" when null). False when the app puts the hub in its own scaffold.
  final bool showAppBar;
  final String? title;

  /// False: no scroll view of its own, for an app that embeds the hub in its own scrolling page.
  final bool scrollable;
  final EdgeInsetsGeometry padding;
  final TargetPlatform? pastePlatform;
  final DateTime Function() clock;
  final bool showWindow;

  /// See [InviteFriendsScreen.launcher] (the WhatsApp button).
  final ReferralLauncher launcher;

  /// See [InviteFriendsScreen.showWhatsApp], [InviteFriendsScreen.showQrCode] and
  /// [InviteFriendsScreen.showInvitePageSettings].
  final bool showWhatsApp;
  final bool showQrCode;
  final bool showInvitePageSettings;

  @override
  State<InviteHub> createState() => InviteHubState();
}

class InviteHubState extends State<InviteHub> {
  final _inviteKey = GlobalKey(debugLabel: 'referral-hub-invite');
  final _entryKey = GlobalKey(debugLabel: 'referral-hub-entry');
  InviteHubSection? _pendingScroll;

  @override
  void initState() {
    super.initState();
    _pendingScroll = widget.initialSection;
    reportReferralEvent(
      widget.onEvent ?? widget.client.onEvent,
      ReferralEvent(ReferralEventName.inviteScreenViewed, {
        'from': widget.from ?? 'unknown',
        'focus': widget.initialSection == InviteHubSection.enterCode ? 'code' : 'share',
      }),
    );
    // With the invite part shown, wait for its data (onLoaded): it changes the height above the entry.
    if (!widget.showInvite) _scrollSoon();
  }

  void _scrollSoon() {
    final target = _pendingScroll;
    if (target == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _pendingScroll = null;
      unawaited(scrollTo(target, animate: false));
    });
  }

  /// Brings [section] into view. Does nothing when that part is hidden.
  Future<void> scrollTo(InviteHubSection section, {bool animate = true}) async {
    final key = section == InviteHubSection.invite ? _inviteKey : _entryKey;
    final ctx = key.currentContext;
    if (ctx == null || Scrollable.maybeOf(ctx) == null) return;
    await Scrollable.ensureVisible(
      ctx,
      duration: animate ? const Duration(milliseconds: 300) : Duration.zero,
      curve: Curves.easeOut,
      alignment: 0.05,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = referralL10n(context);
    final both = widget.showInvite && widget.showEntry;
    final texts = widget.entryTitle == null
        ? widget.texts
        : _withEntryTitle(widget.texts ?? const ReferralTexts(), widget.entryTitle!);
    // With both parts shown, the invite part explains "not available" once; the entry hides itself.
    final ReferralUnavailableBuilder? entryUnavailable = both
        ? (context, reason) => const SizedBox.shrink()
        : widget.unavailableBuilder;
    final column = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.showInvite)
          KeyedSubtree(
            key: _inviteKey,
            child: InviteFriendsScreen(
              client: widget.client,
              appName: widget.appName,
              inviteLink: widget.inviteLink,
              storeLink: widget.storeLink,
              labels: widget.labels,
              labelsBuilder: widget.labelsBuilder,
              onOpenTerms: widget.onOpenTerms,
              share: widget.share ?? systemShare,
              codeCache: widget.codeCache,
              header: widget.header,
              shareText: widget.shareText,
              onCopied: widget.onCopied,
              onEvent: widget.onEvent,
              unavailableBuilder: widget.unavailableBuilder,
              texts: texts,
              onSignIn: widget.onSignIn,
              embedded: true,
              onLoaded: _scrollSoon,
              launcher: widget.launcher,
              showWhatsApp: widget.showWhatsApp,
              showQrCode: widget.showQrCode,
              showInvitePageSettings: widget.showInvitePageSettings,
              clock: widget.clock,
            ),
          ),
        if (both) const Divider(height: 1, indent: 16, endIndent: 16),
        if (widget.showEntry)
          KeyedSubtree(
            key: _entryKey,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: InviteCodeSection(
                client: widget.client,
                queue: widget.queue,
                appName: widget.appName,
                labels: widget.labels,
                labelsBuilder: widget.labelsBuilder,
                texts: texts,
                initialCode: widget.initialCode,
                eligibleFrom: widget.eligibleFrom,
                onClaimed: widget.onClaimed,
                onAlmostAction: widget.onAlmostAction,
                header: widget.entryHeader,
                leading: widget.entryLeading,
                showSteps: widget.showSteps,
                onEvent: widget.onEvent,
                unavailableBuilder: entryUnavailable,
                onSignIn: widget.onSignIn,
                pastePlatform: widget.pastePlatform,
                clock: widget.clock,
              ),
            ),
          ),
      ],
    );
    final body = widget.scrollable
        ? SingleChildScrollView(key: const ValueKey('referral-hub-scroll'), padding: widget.padding, child: column)
        : Padding(padding: widget.padding, child: column);
    if (!widget.showAppBar || !widget.scrollable) return body;
    return Scaffold(
      appBar: AppBar(title: Text(widget.title ?? texts?.title ?? l10n.inviteTitle)),
      body: body,
    );
  }
}

ReferralTexts _withEntryTitle(ReferralTexts t, String entryTitle) => ReferralTexts(
  title: t.title,
  entryTitle: entryTitle,
  giftTitle: t.giftTitle,
  deadline: t.deadline,
  stepsTitle: t.stepsTitle,
  activationStep: t.activationStep,
  steps: t.steps,
  almostTitle: t.almostTitle,
  almostLine: t.almostLine,
  almostProgress: t.almostProgress,
  almostActionLabel: t.almostActionLabel,
  cannotAdd: t.cannotAdd,
  noLinkHint: t.noLinkHint,
  shareTextNoLink: t.shareTextNoLink,
  unavailable: t.unavailable,
  signIn: t.signIn,
  waiting: t.waiting,
  inviteHeadline: t.inviteHeadline,
  activationStepForFriends: t.activationStepForFriends,
);
