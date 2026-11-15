import 'package:flutter/material.dart';

import '../availability.dart';
import '../l10n/gen/referral_kit_localizations.dart';
import '../texts.dart';
import 'code_text.dart';

/// Builds what a widget shows when referrals are unavailable ([ReferralUnavailableException]). Return
/// `SizedBox.shrink()` to hide the feature, or your own explanation. Without a builder the package shows a plain
/// sentence per reason (signed out: with a Sign in button when the widget has `onSignIn`), with no Retry button.
typedef ReferralUnavailableBuilder = Widget Function(BuildContext context, ReferralUnavailableReason reason);

/// The sentence for [reason]: the app's [texts] first, then the package's localisation.
String unavailableMessage(
  ReferralKitLocalizations l10n,
  ReferralUnavailableReason reason, {
  ReferralTexts? texts,
  bool codeKept = false,
}) {
  final custom = texts?.unavailable?.call(reason);
  if (custom != null) return custom;
  return switch (reason) {
    ReferralUnavailableReason.signedOut => l10n.signInToInvite,
    ReferralUnavailableReason.noProject => l10n.notInThisVersion,
    ReferralUnavailableReason.notDeployed => codeKept ? l10n.notAvailableCodeKept : l10n.notAvailable,
  };
}

/// A sentence with an optional button, laid out as a scrolling list or, [embedded], as a plain column that sits
/// inside the app's own scroll view.
class ReferralMessage extends StatelessWidget {
  const ReferralMessage({super.key, required this.text, this.action, this.onAction, this.embedded = false});
  final String text;
  final String? action;
  final VoidCallback? onAction;
  final bool embedded;

  /// The unavailable state for [reason], with Sign in when signed out and [onSignIn] is given.
  factory ReferralMessage.unavailable(
    BuildContext context,
    ReferralUnavailableReason reason, {
    ReferralTexts? texts,
    VoidCallback? onSignIn,
    bool embedded = false,
    bool codeKept = false,
  }) {
    final l10n = referralL10n(context);
    final signIn = reason == ReferralUnavailableReason.signedOut ? onSignIn : null;
    return ReferralMessage(
      key: const ValueKey('referral-not-available'),
      text: unavailableMessage(l10n, reason, texts: texts, codeKept: codeKept),
      action: signIn == null ? null : (texts?.signIn ?? l10n.signIn),
      onAction: signIn,
      embedded: embedded,
    );
  }

  @override
  Widget build(BuildContext context) {
    final children = [
      Semantics(liveRegion: true, child: Text(text)),
      if (action != null && onAction != null) ...[
        const SizedBox(height: 16),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: OutlinedButton(
            style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48)),
            onPressed: onAction,
            child: Text(action!),
          ),
        ),
      ],
    ];
    if (embedded) {
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
}

/// The unavailable state of a code entry: its title and one sentence (Sign in when signed out and [onSignIn] given).
class ReferralEntryUnavailable extends StatelessWidget {
  const ReferralEntryUnavailable({
    super.key,
    required this.title,
    required this.reason,
    this.texts,
    this.onSignIn,
    this.codeKept = false,
  });

  final String? title;
  final ReferralUnavailableReason reason;
  final ReferralTexts? texts;
  final VoidCallback? onSignIn;
  final bool codeKept;

  @override
  Widget build(BuildContext context) {
    final l10n = referralL10n(context);
    final theme = Theme.of(context);
    final signIn = reason == ReferralUnavailableReason.signedOut ? onSignIn : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (title != null) ...[Text(title!, style: theme.textTheme.titleMedium), const SizedBox(height: 12)],
        Semantics(
          liveRegion: true,
          child: Text(
            unavailableMessage(l10n, reason, texts: texts, codeKept: codeKept),
            key: const ValueKey('referral-not-available'),
          ),
        ),
        if (signIn != null) ...[
          const SizedBox(height: 12),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: OutlinedButton(
              style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48)),
              onPressed: signIn,
              child: Text(texts?.signIn ?? l10n.signIn),
            ),
          ),
        ],
      ],
    );
  }
}
