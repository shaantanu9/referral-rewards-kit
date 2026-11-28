import 'dart:async';

// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';

import '../availability.dart';
import '../client.dart';
import '../code_format.dart';
import '../copy.dart';
import '../events.dart';
import '../launcher.dart';
import '../models.dart';
import '../share.dart';
import '../storage.dart';
import '../texts.dart';
import 'code_text.dart';
import 'invite_extras.dart';
import 'invite_page_settings.dart';
import 'message.dart';
import 'myind_attribution.dart';

/// The "Invite friends" screen (ADR 4.1): the code, Share, Copy, the rules with their conditions, caps, joined count,
/// rewards earned, pending rewards with dates, the terms link, and the empty and paused states. Every sentence comes
/// from `referral_terms()` through [ReferralCopy] (or the app's [texts]).
///
/// 0.5 (growth): a give-first headline ("Give a friend 30 min …"), the boost banner while a boost runs, a WhatsApp
/// button next to Share (hidden when it cannot open), "Show QR code" for the invite link, the waiting line with the
/// friend's next step and the reward, and "Your invite page" (first name on the page, leave the program). After
/// leaving, the screen says "You left the invite program" with "Join again".
///
/// Without an invite page ([inviteLink] null, or it returns null) Share still works: it sends the code to type in
/// and the app's [storeLink], and a line under the buttons says how the friend uses the code.
class InviteFriendsScreen extends StatefulWidget {
  const InviteFriendsScreen({
    super.key,
    required this.client,
    required this.appName,
    this.inviteLink,
    this.storeLink,
    this.labels = const RewardLabels(),
    this.onOpenTerms,
    this.share = systemShare,
    this.codeCache,
    this.showAppBar = true,
    this.header,
    this.shareText,
    this.labelsBuilder,
    this.onEvent,
    this.unavailableBuilder,
    this.embedded = false,
    this.onLoaded,
    this.onCopied,
    this.from,
    this.texts,
    this.onSignIn,
    this.launcher = const UrlLauncherReferralLauncher(),
    this.showWhatsApp = true,
    this.showQrCode = true,
    this.showInvitePageSettings = true,
    this.clock = DateTime.now,
    this.showAttribution = true,
    this.attributionVariant = 0,
  });

  final ReferralClient client;
  final String appName;

  /// The invite page link for a code, e.g. `(c) => Uri.parse('https://example.com/i/$c')`. Null (or returning null)
  /// while the app has no invite page: Share then sends the code and [storeLink].
  final Uri? Function(String code)? inviteLink;

  /// The app's store page, shared with the code when there is no invite link (one link that opens the right store,
  /// or the App Store / Play link for the platform the sharer is on).
  final Uri? storeLink;
  final RewardLabels labels;

  /// Opens the program terms page; the link is hidden when null.
  final VoidCallback? onOpenTerms;
  final ShareHandler share;

  /// Keeps the last code so it can still be shared offline (ADR 11.6).
  final KeyValueStore? codeCache;
  final bool showAppBar;

  /// Shown above the code (an app's own picture and headline). Nothing when null.
  final Widget? header;

  /// The app's own share sentence for a code and its link; the package's sentence (from the terms) when null.
  /// Keep it as honest as the default: name only rewards the terms really give.
  final String Function(String code, String link)? shareText;

  /// Labels built with a context (the app's own localisations). Wins over [labels].
  final RewardLabelsBuilder? labelsBuilder;

  /// Analytics events from this screen; [ReferralClient.onEvent] when null.
  final ReferralEventSink? onEvent;

  /// Shown instead of the screen's body when referrals are unavailable (e.g. not deployed).
  final ReferralUnavailableBuilder? unavailableBuilder;

  /// True: lays out as a non-scrolling column with no app bar, to sit inside the app's own scroll view (as in
  /// `InviteHub`). False: a scrolling list, with an app bar when [showAppBar].
  final bool embedded;

  /// Called after each load finishes, whether it worked or not.
  final VoidCallback? onLoaded;

  /// Called after the code was copied (formatted, `ABCD-EFGH`).
  final ValueChanged<String>? onCopied;

  /// Where the app opened this screen from, for `invite_screen_viewed` (`you`, `settings`, `home`, `deeplink`…).
  /// Reported only when not [embedded] (an `InviteHub` reports its own open).
  final String? from;

  /// The app's own words; the package's localisations otherwise.
  final ReferralTexts? texts;

  /// Shown as a Sign in button when the user is signed out.
  final VoidCallback? onSignIn;

  /// Opens the WhatsApp link; injectable for tests.
  final ReferralLauncher launcher;

  /// The WhatsApp button next to Share (`https://wa.me/?text=…`, the user picks the chat). Hidden anyway when the
  /// device cannot open the link.
  final bool showWhatsApp;

  /// "Show QR code" for the invite link (only when there is an https invite link).
  final bool showQrCode;

  /// The "Your invite page" block (first name on the page, leave the program). Hidden anyway on a server without
  /// `referral_preferences`.
  final bool showInvitePageSettings;

  /// Now, for the boost banner (a boost that has ended is not shown).
  final DateTime Function() clock;

  /// The small "Built with Myind" link at the bottom ([MyindAttribution]). Free to turn off: false hides it.
  final bool showAttribution;

  /// Which link text ([MyindAttribution.variant]).
  final int attributionVariant;

  @override
  State<InviteFriendsScreen> createState() => _InviteFriendsScreenState();
}

class _Data {
  const _Data({required this.code, required this.terms, required this.stats, this.offline = false, this.prefs});
  final MyCodeResult code;
  final ReferralTerms terms;
  final ReferralStats stats;
  final bool offline;

  /// Null on a server without `referral_preferences` (before migration 23) or when it could not load.
  final ReferralPreferences? prefs;
}

class _InviteFriendsScreenState extends State<InviteFriendsScreen> {
  static const _cacheKey = 'my_code';
  late Future<_Data> _data = _loadAndReport();
  final _shareKey = GlobalKey();
  bool _whatsApp = false;

  void _emit(ReferralEvent e) => reportReferralEvent(widget.onEvent ?? widget.client.onEvent, e);

  @override
  void initState() {
    super.initState();
    if (!widget.embedded) {
      _emit(ReferralEvent(ReferralEventName.inviteScreenViewed, {'from': widget.from ?? 'unknown', 'focus': 'share'}));
    }
    if (widget.showWhatsApp) unawaited(_checkWhatsApp());
  }

  @override
  void didUpdateWidget(InviteFriendsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.showWhatsApp && !identical(oldWidget.launcher, widget.launcher)) unawaited(_checkWhatsApp());
  }

  Future<void> _checkWhatsApp() async {
    bool ok;
    try {
      ok = await widget.launcher.canLaunch(whatsAppShareUri(''));
    } catch (_) {
      ok = false;
    }
    if (mounted && ok != _whatsApp) setState(() => _whatsApp = ok);
  }

  Uri? _link(String code) => resolveInviteLink(widget.inviteLink, code);

  Future<_Data> _loadAndReport() async {
    try {
      final d = await _load();
      final paused = !d.terms.enabled || d.code.reason == 'program_paused';
      if (paused || d.code.reason == 'code_disabled') {
        unawaited(widget.client.reportHidden(paused ? 'program_paused' : 'code_disabled', surface: 'invite'));
      } else if (d.code.code != null && _link(d.code.code!) == null) {
        unawaited(widget.client.reportHidden('no_invite_url', surface: 'invite'));
      }
      return d;
    } finally {
      widget.onLoaded?.call();
    }
  }

  Future<_Data> _load() async {
    try {
      // Loaded with the rest, so the block's height is known before an InviteHub scrolls to its code entry.
      final prefs = widget.showInvitePageSettings
          ? widget.client.preferences().then<ReferralPreferences?>((p) => p, onError: (_) => null)
          : Future<ReferralPreferences?>.value();
      final results = await Future.wait<Object>([widget.client.myCode(), widget.client.terms(), widget.client.stats()]);
      final code = results[0] as MyCodeResult;
      if (code.code != null) await widget.codeCache?.setString(_cacheKey, code.code!);
      // Left the program: no cached code may be shared offline either.
      if (code.left) await widget.codeCache?.remove(_cacheKey);
      return _Data(
        code: code,
        terms: results[1] as ReferralTerms,
        stats: results[2] as ReferralStats,
        prefs: await prefs,
      );
    } on ReferralUnavailableException {
      rethrow; // Not deployed or signed out: a cached code would promise something the server cannot do.
    } catch (_) {
      final cached = await widget.codeCache?.getString(_cacheKey);
      if (cached == null) rethrow;
      return _Data(
        code: MyCodeResult(code: cached, reason: 'ok'),
        terms: ReferralTerms.none,
        stats: ReferralStats.empty,
        offline: true,
      );
    }
  }

  void _reload() => setState(() {
    _data = _loadAndReport();
  });

  Future<void> _copy(String code) async {
    final l10n = referralL10n(context);
    final view = View.of(context);
    final dir = Directionality.of(context);
    final messenger = ScaffoldMessenger.maybeOf(context);
    final shown = formatCode(code);
    await Clipboard.setData(ClipboardData(text: shown));
    _emit(ReferralEvent(ReferralEventName.inviteCodeCopied, {'has_link': _link(code) != null}));
    widget.onCopied?.call(shown);
    await SemanticsService.sendAnnouncement(view, l10n.codeCopied, dir);
    messenger?.showSnackBar(SnackBar(content: Text(l10n.codeCopied)));
  }

  Future<void> _share(ReferralCopy copy, String code) async {
    final box = _shareKey.currentContext?.findRenderObject() as RenderBox?;
    final origin = box == null || !box.hasSize ? null : box.localToGlobal(Offset.zero) & box.size;
    final link = _link(code);
    final text = _shareTextFor(copy, code);
    Object? result;
    try {
      result = await runShareHandler(widget.share, text, origin);
    } catch (_) {
      result = null;
    }
    _emit(ReferralEvent(ReferralEventName.inviteShared, shareEventProps(result, hasLink: link != null)));
  }

  String _shareTextFor(ReferralCopy copy, String code) => inviteShareText(
    copy: copy,
    appName: widget.appName,
    code: code,
    link: _link(code),
    storeLink: widget.storeLink,
    shareText: widget.shareText,
    shareTextNoLink: widget.texts?.shareTextNoLink,
  );

  /// WhatsApp opens with the share text typed in; the user picks the chat and sends it (G5).
  Future<void> _shareWhatsApp(ReferralCopy copy, String code) async {
    bool opened;
    try {
      opened = await widget.launcher.launch(whatsAppShareUri(_shareTextFor(copy, code)));
    } catch (_) {
      opened = false;
    }
    _emit(
      ReferralEvent(ReferralEventName.inviteShared, {
        'channel': 'whatsapp_button',
        'status': opened ? 'opened' : 'unavailable',
        'has_link': _link(code) != null,
      }),
    );
  }

  Future<void> _rejoin() async {
    final messenger = ScaffoldMessenger.maybeOf(context);
    final failed = referralL10n(context).saveFailed;
    var result = 'failed';
    try {
      final p = await widget.client.setPreferences(participating: true);
      result = p.reason ?? 'ok';
    } catch (_) {
      // Shown below.
    }
    _emit(ReferralEvent(ReferralEventName.invitePreferencesChanged, {'participating': true, 'result': result}));
    if (result == 'ok') {
      if (mounted) _reload();
    } else {
      messenger?.showSnackBar(SnackBar(content: Text(failed)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = referralL10n(context);
    final body = FutureBuilder<_Data>(
      future: _data,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          const spinner = Center(child: CircularProgressIndicator());
          return widget.embedded ? const Padding(padding: EdgeInsets.all(24), child: spinner) : spinner;
        }
        final error = snap.error;
        if (error is ReferralUnavailableException) {
          final custom = widget.unavailableBuilder;
          if (custom != null) return custom(context, error.reason);
          return ReferralMessage.unavailable(
            context,
            error.reason,
            texts: widget.texts,
            onSignIn: widget.onSignIn,
            embedded: widget.embedded,
          );
        }
        if (snap.hasError || !snap.hasData) {
          return ReferralMessage(
            text: l10n.loadFailed,
            action: l10n.retry,
            onAction: _reload,
            embedded: widget.embedded,
          );
        }
        return _content(context, snap.data!);
      },
    );
    if (!widget.showAppBar || widget.embedded) return body;
    return Scaffold(
      appBar: AppBar(title: Text(widget.texts?.title ?? l10n.inviteTitle)),
      body: body,
    );
  }

  Widget _content(BuildContext context, _Data d) {
    final l10n = referralL10n(context);
    final labels = resolveRewardLabels(context, widget.labels, widget.labelsBuilder);
    final copy = ReferralCopy(l10n: l10n, terms: d.terms, labels: labels);
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    final paused = !d.terms.enabled || d.code.reason == 'program_paused';
    final code = d.code.code;
    const gap = SizedBox(height: 16);
    final buttonStyle = ButtonStyle(minimumSize: WidgetStateProperty.all(const Size(48, 48)));

    final children = <Widget>[
      if (widget.header != null && !paused) ...[widget.header!, gap],
    ];
    final link = code == null ? null : _link(code);
    if (paused) {
      children.add(Text(l10n.paused, key: const ValueKey('referral-paused'), style: theme.textTheme.titleMedium));
    } else if (d.code.left) {
      children.addAll([
        Text(l10n.leftTitle, key: const ValueKey('referral-left'), style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        Text(l10n.leftBody, style: muted),
        gap,
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: FilledButton(
            key: const ValueKey('referral-join-again'),
            style: buttonStyle,
            onPressed: () => unawaited(_rejoin()),
            child: Text(l10n.joinAgain),
          ),
        ),
      ]);
    } else if (code == null) {
      final text = d.code.reason == 'code_disabled' ? l10n.codeDisabled : l10n.errUnavailable;
      children.add(Text(text, key: const ValueKey('referral-unavailable'), style: theme.textTheme.titleMedium));
    } else {
      final headline =
          widget.texts?.inviteHeadline?.call(copy.friendReward, copy.sharerJoinedReward) ?? copy.inviteHeadline();
      children.addAll([
        if (!d.offline && d.terms.boostAt(widget.clock()) != null) ...[
          ReferralBoostBanner(terms: d.terms, clock: widget.clock),
          gap,
        ],
        if (headline != null && !d.offline) ...[
          Text(
            headline,
            key: const ValueKey('referral-invite-headline'),
            style: theme.textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          gap,
        ],
        Text(l10n.yourCode, style: theme.textTheme.labelLarge, textAlign: TextAlign.center),
        const SizedBox(height: 8),
        InviteCodeText(code),
        gap,
        Wrap(
          alignment: WrapAlignment.center,
          spacing: 12,
          runSpacing: 8,
          children: [
            FilledButton.icon(
              key: _shareKey,
              style: buttonStyle,
              onPressed: () => unawaited(_share(copy, code)),
              icon: const Icon(Icons.share),
              label: Text(l10n.share),
            ),
            if (_whatsApp && widget.showWhatsApp)
              OutlinedButton.icon(
                key: const ValueKey('referral-whatsapp'),
                style: buttonStyle,
                onPressed: () => unawaited(_shareWhatsApp(copy, code)),
                icon: const Icon(Icons.chat_outlined),
                label: Text(l10n.whatsApp),
              ),
            OutlinedButton.icon(
              key: const ValueKey('referral-copy-code'),
              style: buttonStyle,
              onPressed: () => unawaited(_copy(code)),
              icon: const Icon(Icons.copy),
              label: Text(l10n.copyCode),
            ),
          ],
        ),
        if (link != null && widget.showQrCode) ...[
          const SizedBox(height: 8),
          Align(
            child: TextButton.icon(
              key: const ValueKey('referral-show-qr'),
              style: buttonStyle,
              onPressed: () =>
                  unawaited(showReferralQrSheet(context, link: link, onEvent: widget.onEvent ?? widget.client.onEvent)),
              icon: const Icon(Icons.qr_code),
              label: Text(l10n.showQr),
            ),
          ),
        ],
        if (link == null) ...[
          const SizedBox(height: 8),
          Text(
            widget.texts?.noLinkHint?.call(widget.appName) ?? l10n.noLinkHint(widget.appName),
            key: const ValueKey('referral-no-link'),
            style: muted,
            textAlign: TextAlign.center,
          ),
        ],
        gap,
        for (final line in [...copy.rules(), ...copy.caps()])
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(line, style: theme.textTheme.bodyLarge),
          ),
      ]);
    }

    final s = d.stats;
    if (!paused && code != null && s.isEmpty && !d.offline) {
      children.addAll([gap, Text(copy.emptyState(), key: const ValueKey('referral-empty'))]);
    }
    final joined = s.joinedCount ?? 0;
    if (joined > 0) {
      children.addAll([gap, Text(l10n.joinedCount(joined), key: const ValueKey('referral-joined'))]);
    }
    final claimed = s.claimedCount ?? 0;
    if (claimed > 0 && !paused) {
      final t = widget.texts;
      final step = t?.activationStepForFriends ?? t?.activationStep;
      final line =
          t?.waiting?.call(
            claimed,
            copy.nextStep(appName: widget.appName, activationStep: step),
            copy.sharerJoinedReward,
            copy.friendReward,
          ) ??
          copy.waitingLine(claimed, appName: widget.appName, activationStep: step)!;
      children.addAll([gap, Text(line, key: const ValueKey('referral-claimed'))]);
    }
    if (s.rewardsGranted.isNotEmpty) {
      children.addAll([gap, Text(l10n.rewardsEarned, style: theme.textTheme.titleSmall)]);
      children.addAll(s.rewardsGranted.map((r) => _line(copy.itemReward(r))));
    }
    if (s.pending.isNotEmpty || s.banked.isNotEmpty) {
      children.addAll([gap, Text(l10n.pendingRewards, style: theme.textTheme.titleSmall)]);
      children.addAll(s.pending.map((r) => _line(copy.pendingLine(r))));
      children.addAll(s.banked.map((r) => _line(l10n.bankedItem(copy.itemReward(r)))));
    }
    if (s.skippedCap > 0) children.addAll([gap, Text(l10n.skippedCap(s.skippedCap))]);
    if (widget.showInvitePageSettings && !paused && code != null && !d.offline && d.prefs != null) {
      children.addAll([
        gap,
        const Divider(height: 1),
        gap,
        ReferralInvitePageSettings(
          client: widget.client,
          initialPreferences: d.prefs,
          sharerRewarded: copy.sharerJoined != null || copy.sharerPaid != null,
          onLeft: _reload,
          onEvent: widget.onEvent,
        ),
      ]);
    }
    if (widget.onOpenTerms != null) {
      children.addAll([
        gap,
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton(style: buttonStyle, onPressed: widget.onOpenTerms, child: Text(l10n.termsLink)),
        ),
      ]);
    }
    if (widget.showAttribution) {
      children.addAll([gap, MyindAttribution(variant: widget.attributionVariant, onOpen: widget.launcher.launch)]);
    }
    if (widget.embedded) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: children,
        ),
      );
    }
    return ListView(padding: const EdgeInsets.all(16), children: children);
  }

  Widget _line(String text) => Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Text(text));
}
