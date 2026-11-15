import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

import 'support/fake_rpc.dart';
import 'support/harness.dart';

/// ADR 11.3 and 11.5: every screen at 320 dp wide, at 1.0 and 2.0 text scale, in English (LTR) and under an
/// Arabic locale (RTL): no overflow, the code stays left to right, ASCII and unshrunk, tap targets at least 48 dp.
void main() {
  final screens = <String, Widget Function()>{
    'InviteFriendsScreen': () => InviteFriendsScreen(
      client: clientFor(FakeRpc()),
      appName: 'App',
      inviteLink: (c) => Uri.parse('https://example.test/i/$c'),
      onOpenTerms: () {},
      share: (_, _) async {},
    ),
    'InviteFriendsScreen (empty)': () => InviteFriendsScreen(
      client: clientFor(FakeRpc({'referral_stats': statsJson(empty: true)})),
      appName: 'App',
      inviteLink: (c) => Uri.parse('https://example.test/i/$c'),
    ),
    'InviteFriendsScreen (paused)': () => InviteFriendsScreen(
      client: clientFor(FakeRpc({'referral_terms': termsJson(enabled: false)})),
      appName: 'App',
      inviteLink: (c) => Uri.parse('https://example.test/i/$c'),
    ),
    'InviteCodeEntry': () => _scroll(
      InviteCodeEntry(
        client: clientFor(FakeRpc()),
        queue: PendingClaimQueue(client: clientFor(FakeRpc()), store: MemoryKeyValueStore()),
        eligibleFrom: DateTime.now().subtract(const Duration(days: 2)),
        pastePlatform: TargetPlatform.android,
      ),
    ),
    'InviteCodeEntry (prefilled)': () => _scroll(
      InviteCodeEntry(
        client: clientFor(FakeRpc()),
        queue: PendingClaimQueue(client: clientFor(FakeRpc()), store: MemoryKeyValueStore()),
        initialCode: 'ABCDEFGH',
        pastePlatform: TargetPlatform.android,
      ),
    ),
    'ReferralRewardCard': () => _scroll(ReferralRewardCard(client: clientFor(FakeRpc()))),
  };

  for (final MapEntry(key: name, value: build) in screens.entries) {
    for (final locale in const [Locale('en'), Locale('ar'), Locale('hi'), Locale('id')]) {
      for (final scale in const [1.0, 2.0]) {
        testWidgets('$name · ${locale.languageCode} · ${scale}x · 320 dp', (tester) async {
          smallPhone(tester);
          await tester.pumpWidget(harness(build(), locale: locale, textScale: scale));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: 'no overflow or layout error');

          final rtl = locale.languageCode == 'ar';
          final anyText = find.byType(Text).first;
          expect(Directionality.of(tester.element(anyText)), rtl ? TextDirection.rtl : TextDirection.ltr);

          // The code: left to right, ASCII, never shrunk, inside the screen.
          for (final half in ['ABCD-', 'EFGH']) {
            final f = find.byKey(ValueKey('referral-code-$half'));
            if (f.evaluate().isEmpty) continue;
            expect(Directionality.of(tester.element(f)), TextDirection.ltr);
            final p = tester.renderObject<RenderParagraph>(find.descendant(of: f, matching: find.byType(RichText)));
            expect(p.text.toPlainText(), half);
            expect(p.text.style!.fontSize, 28);
            expect(p.textScaler, TextScaler.linear(scale));
            final box = tester.getRect(f);
            expect(box.left, greaterThanOrEqualTo(0));
            expect(box.right, lessThanOrEqualTo(320));
            expect(p.didExceedMaxLines, isFalse);
          }
          if (scale == 1.0) await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        });
      }
    }
  }

  testWidgets('the code field stays left to right under RTL', (tester) async {
    smallPhone(tester);
    await tester.pumpWidget(harness(screens['InviteCodeEntry']!(), locale: const Locale('ar'), textScale: 2));
    await tester.pumpAndSettle();
    final field = find.byKey(const ValueKey('referral-code-field'));
    expect(Directionality.of(tester.element(field)), TextDirection.ltr);
  });

  testWidgets('hi strings are used, with plurals', (tester) async {
    await tester.pumpWidget(harness(screens['InviteCodeEntry']!(), locale: const Locale('hi')));
    await tester.pumpAndSettle();
    expect(find.text('क्या आपके पास इनवाइट कोड है?'), findsOneWidget);
    expect(find.text('आप 5 और दिनों तक इनवाइट कोड जोड़ सकते हैं'), findsOneWidget);
  });
}

Widget _scroll(Widget child) => Scaffold(
  body: SingleChildScrollView(padding: const EdgeInsets.all(16), child: child),
);
