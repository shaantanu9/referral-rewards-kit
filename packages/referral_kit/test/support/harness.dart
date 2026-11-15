import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

/// Wraps [child] the way an app would: the package's delegate plus the global ones. `ar` is not one of the
/// package's languages, so it exercises the English fallback under right-to-left layout.
Widget harness(Widget child, {Locale locale = const Locale('en'), double textScale = 1}) => MaterialApp(
  locale: locale,
  localizationsDelegates: const [
    referralKitLocalizationsDelegate,
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
  ],
  supportedLocales: const [...ReferralKitLocalizations.supportedLocales, Locale('ar')],
  builder: (context, c) => MediaQuery(
    data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
    child: c!,
  ),
  home: child,
);

/// A 320 dp wide phone.
void smallPhone(WidgetTester tester, {double height = 640}) {
  tester.view.physicalSize = Size(320, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

/// Records platform clipboard calls and returns [clipboardText] for reads.
class ClipboardSpy {
  ClipboardSpy(WidgetTester tester, {this.clipboardText = ''}) {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      calls.add(call.method);
      if (call.method == 'Clipboard.setData') written = (call.arguments as Map)['text'] as String?;
      if (call.method == 'Clipboard.getData') return {'text': clipboardText};
      return null;
    });
    tester.binding.defaultBinaryMessenger.setMockDecodedMessageHandler<Object?>(SystemChannels.accessibility, (
      m,
    ) async {
      announcements.add(m);
      return null;
    });
  }

  final String clipboardText;
  final List<String> calls = [];
  final List<Object?> announcements = [];
  String? written;
}
