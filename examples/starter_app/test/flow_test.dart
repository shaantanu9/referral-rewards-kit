// The whole flow a new app gets, against the fake server: entry points shown only when available, share without an
// invite page, a friend's code to "almost yours", the gift landing on Home, and the analytics funnel in order.
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
  late List<String> events;

  setUp(() {
    fake = FakeReferralServer()..latency = Duration.zero;
    setup = ReferralSetup(
      fake: fake,
      store: MemoryKeyValueStore(),
      installIds: const FixedInstallIdStore('3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'),
    );
    events = [];
  });

  Future<void> start(WidgetTester tester) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (_) async => null);
    await tester.pumpWidget(StarterApp(setup: setup));
    final previous = setup.onAnalytics;
    setup.onAnalytics = (e) {
      events.add(e.wireName);
      previous?.call(e);
    };
    await tester.pumpAndSettle();
  }

  testWidgets('from first open to the gift on Home', (tester) async {
    await start(tester);
    expect(find.byKey(const ValueKey('row-invite')), findsOneWidget);

    // Your code, Share without an invite page.
    await tester.tap(find.byKey(const ValueKey('row-invite')));
    await tester.pumpAndSettle();
    expect(find.text('K7QM-'), findsOneWidget);
    expect(find.text('Your friend gets Reader from the app store and types this code in.'), findsOneWidget);
    await tester.tap(find.text('Copy code'));
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();

    // A friend's code: gift, real days left, almost yours.
    await tester.tap(find.byKey(const ValueKey('row-code')));
    await tester.pumpAndSettle();
    expect(find.text('A gift is waiting for you: 4 free chapters'), findsOneWidget);
    expect(find.text('Only 3 days left to add a code'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('referral-code-field')), 'h4pz-8wne');
    await tester.tap(find.text('Add code'));
    await tester.pumpAndSettle();
    expect(find.text('Almost yours'), findsOneWidget);
    await tester.tap(find.text('Start reading'));
    await tester.pumpAndSettle();

    // You start using the app: the gift lands on Home, once.
    await tester.scrollUntilVisible(find.byKey(const ValueKey('demo-start-using')), 200);
    await tester.tap(find.byKey(const ValueKey('demo-start-using')));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView).first, const Offset(0, 3000));
    await tester.pumpAndSettle();
    expect(find.text('Welcome bonus: 4 free chapters, thanks to your invite.'), findsOneWidget);

    expect(events, containsAllInOrder(['invite_screen_viewed', 'invite_code_copied', 'invite_screen_viewed']));
    expect(events, containsAllInOrder(['code_submitted', 'code_claim_result', 'reward_granted', 'reward_shown']));
    expect(events.where((e) => e == 'reward_granted'), hasLength(1));
  });

  testWidgets('before the server side is deployed, the entry points are hidden', (tester) async {
    fake.deployed = false;
    await start(tester);
    expect(find.byKey(const ValueKey('row-invite')), findsNothing);
    expect(find.byKey(const ValueKey('row-code')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('demo-deployed')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('row-invite')), findsOneWidget);
  });
}
