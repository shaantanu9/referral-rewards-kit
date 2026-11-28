import 'dart:async';

// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../attribution/attribution_config.dart';
import '../launcher.dart';

/// A small centered "Built with Myind referral kit" link (ADR 0003). `InviteHub` and `InviteFriendsScreen` show it at
/// the bottom of their content; `showAttribution: false` hides it there. Put it anywhere else yourself.
///
/// It opens the site with `utm_source`, `utm_medium=attribution` and `utm_campaign=v<variant>` added. Nothing is
/// sent at runtime.
class MyindAttribution extends StatelessWidget {
  const MyindAttribution({
    super.key,
    this.variant = 0,
    this.textStyle,
    this.padding = const EdgeInsets.symmetric(vertical: 8),
    this.source = MyindAttributionConfig.defaultSource,
    this.onOpen,
  });

  /// Which text and URL ([MyindAttributionConfig.variants]); any int, it wraps.
  final int variant;

  /// Merged over the default (11 sp, the theme's `onSurfaceVariant` at reduced emphasis).
  final TextStyle? textStyle;
  final EdgeInsetsGeometry padding;

  /// `utm_source` on the opened link.
  final String source;

  /// Opens the link; default: [UrlLauncherReferralLauncher] (outside the app). Inject one in tests.
  final Future<bool> Function(Uri uri)? onOpen;

  Uri get link => MyindAttributionConfig.link(variant, source: source);

  void _open() {
    final open = onOpen ?? const UrlLauncherReferralLauncher().launch;
    unawaited(open(link));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final text = MyindAttributionConfig.variant(variant).text;
    final style = theme.textTheme.bodySmall
        ?.copyWith(fontSize: 11, color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.8))
        .merge(textStyle);
    return Center(
      key: const ValueKey('myind-attribution'),
      child: Semantics(
        link: true,
        label: 'Opens myind.ai: $text',
        excludeSemantics: true,
        onTap: _open,
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            onTap: _open,
            borderRadius: BorderRadius.circular(8),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
              child: Padding(
                padding: padding,
                child: Center(
                  widthFactor: 1,
                  heightFactor: 1,
                  child: Text(text, style: style, textAlign: TextAlign.center),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
