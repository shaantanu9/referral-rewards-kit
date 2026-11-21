import 'dart:math' as math;

// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../copy.dart';
import '../events.dart';
import '../models.dart';
import 'code_text.dart';

/// The boost banner (G8): "Double rewards until Sun, 22 Nov for every friend who adds your code by then." The real
/// last day from the server's `ends_at`, in the user's locale; never a ticking timer. Nothing when [terms] has no
/// boost or it has ended at [clock]'s now. Colours from the app's theme (tertiary container).
class ReferralBoostBanner extends StatelessWidget {
  const ReferralBoostBanner({super.key, required this.terms, this.clock = DateTime.now});

  final ReferralTerms terms;
  final DateTime Function() clock;

  @override
  Widget build(BuildContext context) {
    final text = ReferralCopy(l10n: referralL10n(context), terms: terms).boostLine(clock());
    if (text == null) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      key: const ValueKey('referral-boost'),
      decoration: BoxDecoration(color: scheme.tertiaryContainer, borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.bolt, color: scheme.onTertiaryContainer),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                text,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: scheme.onTertiaryContainer),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Opens the "Show QR code" sheet for [link] (G6) and reports `invite_qr_shown`. Only an https invite link, never
/// an unlock token or a code to redeem (Apple 3.1.1): the friend lands on the same invite page as from a share.
Future<void> showReferralQrSheet(BuildContext context, {required Uri link, ReferralEventSink? onEvent}) {
  reportReferralEvent(onEvent, const ReferralEvent(ReferralEventName.inviteQrShown));
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => ReferralQrSheet(link: link),
  );
}

/// The QR code of an invite link with a short hint and the link itself. The code is always dark on white (with a
/// quiet zone) so it scans in dark mode too.
class ReferralQrSheet extends StatelessWidget {
  const ReferralQrSheet({super.key, required this.link});

  final Uri link;

  @override
  Widget build(BuildContext context) {
    final l10n = referralL10n(context);
    final theme = Theme.of(context);
    final width = MediaQuery.sizeOf(context).width;
    final size = math.min(240.0, width - 96);
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.qrTitle, style: theme.textTheme.titleLarge, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            Center(
              child: DecoratedBox(
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
                child: QrImageView(
                  key: const ValueKey('referral-qr'),
                  data: '$link',
                  size: size,
                  padding: const EdgeInsets.all(16),
                  backgroundColor: Colors.white,
                  semanticsLabel: l10n.qrSemantics,
                  eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: Colors.black),
                  dataModuleStyle: const QrDataModuleStyle(
                    dataModuleShape: QrDataModuleShape.square,
                    color: Colors.black,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(l10n.qrHint, textAlign: TextAlign.center, style: theme.textTheme.bodyMedium),
            const SizedBox(height: 8),
            Directionality(
              textDirection: TextDirection.ltr,
              child: Text(
                '$link',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ),
            const SizedBox(height: 8),
            Align(
              child: TextButton(
                style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
                onPressed: () => Navigator.of(context).maybePop(),
                child: Text(l10n.close),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
