import 'dart:async';

import 'package:flutter/foundation.dart';
// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'l10n/gen/referral_kit_localizations.dart';

/// The Paste control next to the code field (ADR 4.2).
///
/// - iOS 16+: Apple's `UIPasteControl` in a platform view (this package's Swift code). It reads the clipboard
///   without the "Allow Paste" prompt because the user tapped a system-drawn button.
/// - iOS below 16: nothing; the text field's own paste menu is used. `Clipboard.getData` is never called on iOS.
/// - Android and other platforms: a Material button that reads the clipboard.
class InviteCodePasteButton extends StatefulWidget {
  const InviteCodePasteButton({super.key, required this.onPasted, this.platform});

  final ValueChanged<String> onPasted;

  /// Overrides the platform, for tests.
  final TargetPlatform? platform;

  @override
  State<InviteCodePasteButton> createState() => _InviteCodePasteButtonState();
}

/// Asks the Swift side whether `UIPasteControl` exists (iOS 16+). Cached per process.
class PasteControlSupport {
  static const MethodChannel channel = MethodChannel('referral_kit/paste');
  static Future<bool>? _available;

  static Future<bool> available() => _available ??= () async {
    try {
      return await channel.invokeMethod<bool>('isPasteControlAvailable') ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }();

  @visibleForTesting
  static void reset() => _available = null;
}

class _InviteCodePasteButtonState extends State<InviteCodePasteButton> {
  static const viewType = 'referral_kit/paste_control';
  MethodChannel? _viewChannel;

  TargetPlatform get _platform => widget.platform ?? defaultTargetPlatform;

  @override
  void dispose() {
    _viewChannel?.setMethodCallHandler(null);
    super.dispose();
  }

  void _onViewCreated(int id) {
    _viewChannel = MethodChannel('$viewType/$id')
      ..setMethodCallHandler((call) async {
        if (call.method == 'pasted' && call.arguments is String) widget.onPasted(call.arguments as String);
        return null;
      });
  }

  Future<void> _pasteFromClipboard() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text;
    if (text != null && text.isNotEmpty) widget.onPasted(text);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = ReferralKitLocalizations.of(context);
    if (kIsWeb || _platform != TargetPlatform.iOS) {
      return OutlinedButton.icon(
        style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48)),
        onPressed: () => unawaited(_pasteFromClipboard()),
        icon: const Icon(Icons.content_paste),
        label: Text(l10n.paste),
      );
    }
    return FutureBuilder<bool>(
      future: PasteControlSupport.available(),
      builder: (context, snap) {
        if (snap.data != true) return const SizedBox.shrink();
        // Apple draws the control and its accessibility label; a fixed size keeps it at least 48 dp high.
        return SizedBox(
          width: 120,
          height: 48,
          child: UiKitView(
            viewType: viewType,
            onPlatformViewCreated: _onViewCreated,
            creationParams: const <String, Object?>{},
            creationParamsCodec: const StandardMessageCodec(),
          ),
        );
      },
    );
  }
}
