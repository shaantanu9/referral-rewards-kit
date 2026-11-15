import 'package:flutter/material.dart';

import '../code_format.dart';
import '../l10n/gen/referral_kit_localizations.dart';

/// The package's strings for [context]; English when the app did not add [ReferralKitLocalizations.delegate].
ReferralKitLocalizations referralL10n(BuildContext context) =>
    Localizations.of<ReferralKitLocalizations>(context, ReferralKitLocalizations) ??
    lookupReferralKitLocalizations(const Locale('en'));

/// Monospace style for codes. Falls back through common monospace families on each platform.
TextStyle codeTextStyle(BuildContext context, {double fontSize = 28}) =>
    (Theme.of(context).textTheme.headlineMedium ?? const TextStyle()).copyWith(
      fontFamily: 'monospace',
      fontFamilyFallback: const ['RobotoMono', 'Menlo', 'Courier New', 'Courier'],
      fontSize: fontSize,
      fontWeight: FontWeight.w600,
      letterSpacing: 2,
    );

/// A code shown as `ABCD-EFGH` in large monospace (ADR 4.1, 11.5): always left to right and ASCII, read out one
/// letter at a time, and wrapped onto two lines at large text sizes instead of being shrunk.
class InviteCodeText extends StatelessWidget {
  const InviteCodeText(this.code, {super.key, this.fontSize = 28});

  final String code;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    final c = normaliseCode(code);
    final style = codeTextStyle(context, fontSize: fontSize);
    final halves = c.length == 8 ? ['${c.substring(0, 4)}-', c.substring(4)] : [c];
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Semantics(
        label: spellCode(c),
        excludeSemantics: true,
        child: Wrap(
          alignment: WrapAlignment.center,
          children: [for (final h in halves) Text(h, key: ValueKey('referral-code-$h'), style: style)],
        ),
      ),
    );
  }
}
