// Both sides of the referral journey against the fake server: a friend who arrives with an invite link (or the Play
// install referrer) before signing in, and the sharer who sees the friend use the code, then start.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';
import 'package:referral_kit_starter/fake_referral_server.dart';
import 'package:referral_kit_starter/invite_link.dart';
import 'package:referral_kit_starter/main.dart';
import 'package:referral_kit_starter/referral_setup.dart';

class _Referrer implements InstallReferrerSource {
  const _Referrer(this.raw);
  final String? raw;
  @override
  Future<String?> readReferrer() async => raw;
}

void main() {
  late FakeReferralServer fake;
  late MemoryKeyValueStore store;
  late List<ReferralEvent> events;

  ReferralSetup build({String? referrer}) => ReferralSetup(
    fake: fake,
    store: store,
    installIds: const FixedInstallIdStore('3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b'),
    referrerSource: _Referrer(referrer),
  );

  setUp(() {
    fake = FakeReferralServer(signedIn: false, boost: false)..latency = Duration.zero;
    store = MemoryKeyValueStore();
    events = [];
  });

  Future<ReferralSetup> start(WidgetTester tester, {String? referrer}) async {
    tester.view.physicalSize = const Size(400, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (_) async => null);
    final setup = build(referrer: referrer);
    await tester.pumpWidget(StarterApp(setup: setup));
    final previous = setup.onAnalytics;
    setup.onAnalytics = (e) {
      events.add(e);
      previous?.call(e);
    };
    await tester.pumpAndSettle();
    return setup;
  }

  List<String> names() => events.map((e) => e.wireName).toList();

  Future<void> tapKey(WidgetTester tester, String key) async {
    final f = find.byKey(ValueKey(key));
    await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).first);
    await tester.tap(f);
    await tester.pumpAndSettle();
  }

  testWidgets('a friend opens an invite link signed out, signs in there, and adds the code with one tap', (
    tester,
  ) async {
    final setup = await start(tester);
    expect(find.byKey(const ValueKey('row-invite')), findsNothing); // signed out: no entry points

    // The App Link arrives while the app runs: the route `/i/<CODE>`.
    await tester.binding.handlePushRoute('/i/H4PZ-8WNE');
    await tester.pumpAndSettle();
    expect(await setup.queue.linkCode(), 'H4PZ8WNE');
    expect(names(), contains('invite_link_opened'));
    expect(find.text('Sign in'), findsOneWidget);

    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
    expect(fake.signedIn, isTrue);
    expect(fake.claimed, isFalse, reason: 'a link code is never claimed by itself');
    expect(find.text('Use code H4PZ-8WNE'), findsOneWidget);

    await tester.tap(find.text('Use code H4PZ-8WNE'));
    await tester.pumpAndSettle();
    expect(fake.claimed, isTrue);
    expect(find.text('Almost yours'), findsOneWidget);
    expect(await setup.queue.linkCode(), isNull);
    final submitted = events.firstWhere((e) => e.wireName == 'code_submitted');
    expect(submitted.props['source'], 'prefilled');

    // Back on Home (only one code-entry screen was opened), then the gift lands once the friend starts.
    await tester.tap(find.text('Start reading'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('home-waiting-code')), findsNothing);
    await tapKey(tester, 'demo-start-using');
    await tester.scrollUntilVisible(
      find.text('Welcome bonus: 4 free chapters, thanks to your invite.'),
      -200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(names(), containsAllInOrder(['invite_link_opened', 'code_submitted', 'code_claim_result', 'reward_shown']));
  });

  testWidgets('a link opened before sign-in waits on Home; signing in there opens code entry once', (tester) async {
    final setup = await start(tester);
    expect(await setup.openedInviteLink('https://reader.example/i/h4pz-8wne'), 'H4PZ8WNE');
    await tapKey(tester, 'demo-deployed'); // any refresh; then on again
    await tapKey(tester, 'demo-deployed');
    expect(find.text('A friend\'s code H4PZ-8WNE is waiting for you'), findsOneWidget);

    await tapKey(tester, 'home-sign-in');
    expect(find.text('Use code H4PZ-8WNE'), findsOneWidget);
    expect(fake.claimed, isFalse);

    // The friend leaves without adding it: Home offers it quietly, and "Not now" forgets it.
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('home-use-code')), findsOneWidget);
    await tapKey(tester, 'home-forget-code');
    expect(await setup.queue.linkCode(), isNull);
    expect(find.byKey(const ValueKey('home-waiting-code')), findsNothing);
  });

  testWidgets('a code from the Play install referrer is kept at start and offered after sign-in', (tester) async {
    final setup = await start(tester, referrer: 'utm_source=invite&code=H4PZ8WNE');
    expect(await setup.queue.linkCode(), 'H4PZ8WNE');
    expect(find.byKey(const ValueKey('home-sign-in')), findsOneWidget);

    await tapKey(tester, 'demo-signed-in');
    expect(find.text('Use code H4PZ-8WNE'), findsOneWidget);
    expect(fake.claimed, isFalse);
  });

  testWidgets('the sharer sees a friend use the code on Home, then the reward when they start', (tester) async {
    fake.signedIn = true;
    await start(tester);
    expect(find.byKey(const ValueKey('home-friends')), findsNothing);

    await tapKey(tester, 'demo-friend-signs-up');
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('home-friends')),
      -200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('1 friend used your code. Your reward comes when they start using the app.'), findsOneWidget);

    await tapKey(tester, 'demo-friend-starts');
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('home-friends')),
      -200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('1 friend joined'), findsOneWidget);
    expect(find.textContaining('4 free chapters'), findsWidgets); // the sharer's reward card

    // The invite screen tells the same story.
    await tester.tap(find.byKey(const ValueKey('home-friends')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('referral-joined')), findsOneWidget);
  });

  test('codeFromInviteLink reads /i/<CODE> and ?code=, and nothing else', () {
    expect(codeFromInviteLink('https://reader.example/i/H4PZ-8WNE'), 'H4PZ8WNE');
    expect(codeFromInviteLink('/i/h4pz8wne'), 'H4PZ8WNE');
    expect(codeFromInviteLink('reader://invite?code=H4PZ-8WNE'), 'H4PZ8WNE');
    expect(codeFromInviteLink('/i/'), isNull);
    expect(codeFromInviteLink('/i/NOT-A-CODE-AT-ALL'), isNull);
    expect(codeFromInviteLink('/settings'), isNull);
  });
}
