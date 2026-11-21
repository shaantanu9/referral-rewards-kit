// The 0.5 growth pieces in the starter, against the fake server: the boost banner and invite page settings on the
// invite screen, the QR code once the invite page is live, and the friend's welcome card on Home.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';
import 'package:referral_kit_starter/fake_referral_server.dart';
import 'package:referral_kit_starter/main.dart';
import 'package:referral_kit_starter/referral_setup.dart';

void main() {
  late FakeReferralServer fake;
  late ReferralSetup setup;

  setUp(() {
    fake = FakeReferralServer()..latency = Duration.zero;
    setup = ReferralSetup(
      fake: fake,
      store: MemoryKeyValueStore(),
      installIds: const FixedInstallIdStore('3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'),
    );
    ReferralWelcomeCard.session = 'starter-test';
  });

  Future<void> start(WidgetTester tester) async {
    tester.view.physicalSize = const Size(400, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (_) async => null);
    await tester.pumpWidget(StarterApp(setup: setup));
    await tester.pumpAndSettle();
  }

  Future<void> tapKey(WidgetTester tester, String key) async {
    final f = find.byKey(ValueKey(key));
    await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).first);
    await tester.tap(f);
    await tester.pumpAndSettle();
  }

  testWidgets('invite screen: boost banner, QR with the invite page live, leave and join again', (tester) async {
    await start(tester);
    await tapKey(tester, 'demo-invite-page');
    await tapKey(tester, 'row-invite');
    expect(find.byKey(const ValueKey('referral-boost')), findsOneWidget);
    expect(find.textContaining('Double rewards until'), findsOneWidget);

    await tapKey(tester, 'referral-show-qr');
    expect(find.text('https://invite.example.com/i/K7QM2XRA'), findsOneWidget);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();

    await tapKey(tester, 'referral-leave');
    await tester.tap(find.byKey(const ValueKey('referral-leave-confirm')));
    await tester.pumpAndSettle();
    expect(fake.left, isTrue);
    expect(find.text('You left the invite program'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('referral-join-again')));
    await tester.pumpAndSettle();
    expect(fake.left, isFalse);
    expect(find.text('K7QM-'), findsOneWidget);
  });

  testWidgets('the friend sees the welcome gift waiting, then pass it on once', (tester) async {
    await start(tester);
    await tapKey(tester, 'row-code');
    await tester.enterText(find.byKey(const ValueKey('referral-code-field')), 'H4PZ8WNE');
    await tester.tap(find.text('Add code'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Start reading'));
    await tester.pumpAndSettle();
    expect(
      find.text('Your welcome gift of 8 free chapters is waiting: Read your first page. 30 days left.'),
      findsOneWidget,
      reason: 'the code was added during the boost',
    );

    await tapKey(tester, 'demo-start-using');
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('referral-welcome-joined')),
      -200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.textContaining('Pass it on: give a friend 4 free chapters'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('referral-welcome-invite')));
    await tester.pumpAndSettle();
    expect(find.text('K7QM-'), findsOneWidget, reason: 'the invite hub opened');
  });
}
