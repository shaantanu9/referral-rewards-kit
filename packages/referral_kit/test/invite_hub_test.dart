// InviteHub: your code on top, a friend's code below, each part hideable and scrollable-to; 320 and 430 dp at 1.3x.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

import 'support/fake_rpc.dart';
import 'support/harness.dart';

final _hubScroll = find
    .descendant(of: find.byKey(const ValueKey('referral-hub-scroll')), matching: find.byType(Scrollable))
    .first;

void main() {
  Widget hub(
    FakeRpc rpc, {
    bool showInvite = true,
    bool showEntry = true,
    InviteHubSection? initialSection,
    GlobalKey<InviteHubState>? key,
    List<ReferralEvent>? events,
  }) {
    final client = clientFor(rpc);
    return InviteHub(
      key: key,
      client: client,
      queue: PendingClaimQueue(client: client, store: MemoryKeyValueStore()),
      appName: 'App',
      inviteLink: (c) => Uri.parse('https://example.test/i/$c'),
      onOpenTerms: () {},
      share: (_, _) async {},
      header: const Text('Give a chapter, get a chapter', key: ValueKey('hdr')),
      showInvite: showInvite,
      showEntry: showEntry,
      initialSection: initialSection,
      pastePlatform: TargetPlatform.android,
      onEvent: events?.add,
    );
  }

  final withDays = {...termsJson(), 'claim_days_left': 5};

  testWidgets('both parts: code with Share/Copy above, entry with the server days-left below', (tester) async {
    await tester.pumpWidget(harness(hub(FakeRpc({'referral_terms': withDays}))));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('hdr')), findsOneWidget);
    expect(find.text('Share'), findsOneWidget);
    expect(find.text('Copy code'), findsOneWidget);
    await tester.scrollUntilVisible(find.byKey(const ValueKey('referral-code-field')), 200, scrollable: _hubScroll);
    // The friend gets 30 min: the headline names it, and the server's days left are a chip (said once).
    expect(find.text('A gift is waiting for you: 30 min'), findsOneWidget);
    expect(find.text('Only 5 days left to add a code'), findsOneWidget);
    expect(find.text('You can add an invite code for 5 more days'), findsNothing);
    expect(
      tester.getTopLeft(find.text('Your invite code')).dy,
      lessThan(tester.getTopLeft(find.text('A gift is waiting for you: 30 min')).dy),
    );
  });

  testWidgets('each part can be hidden', (tester) async {
    await tester.pumpWidget(harness(hub(FakeRpc(), showEntry: false)));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('referral-gift-title')), findsNothing);
    expect(find.text('Share'), findsOneWidget);

    await tester.pumpWidget(harness(hub(FakeRpc(), showInvite: false)));
    await tester.pumpAndSettle();
    expect(find.text('Share'), findsNothing);
    expect(find.byKey(const ValueKey('referral-code-field')), findsOneWidget);
  });

  testWidgets('initialSection enterCode scrolls the entry into view', (tester) async {
    smallPhone(tester, height: 480);
    await tester.pumpWidget(harness(hub(FakeRpc(), initialSection: InviteHubSection.enterCode)));
    await tester.pumpAndSettle();
    final field = tester.getRect(find.byKey(const ValueKey('referral-code-field')));
    expect(field.top, greaterThanOrEqualTo(0));
    expect(field.bottom, lessThanOrEqualTo(480));
  });

  testWidgets('scrollTo brings a part back into view', (tester) async {
    smallPhone(tester, height: 480);
    final key = GlobalKey<InviteHubState>();
    await tester.pumpWidget(harness(hub(FakeRpc(), key: key)));
    await tester.pumpAndSettle();
    unawaited(key.currentState!.scrollTo(InviteHubSection.enterCode));
    await tester.pumpAndSettle();
    expect(tester.getRect(find.byKey(const ValueKey('referral-code-field'))).bottom, lessThanOrEqualTo(480));
    unawaited(key.currentState!.scrollTo(InviteHubSection.invite));
    await tester.pumpAndSettle();
    expect(tester.getTopLeft(find.byKey(const ValueKey('hdr'))).dy, greaterThanOrEqualTo(0));
  });

  testWidgets('not deployed: one "not available yet" message, no field, no Retry', (tester) async {
    final events = <ReferralEvent>[];
    await tester.pumpWidget(
      harness(
        hub(
          FakeRpc()..error = const ReferralUnavailableException(ReferralUnavailableReason.notDeployed),
          events: events,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text("Invites aren't available yet. Check back soon."), findsOneWidget);
    expect(find.byKey(const ValueKey('referral-code-field')), findsNothing);
    expect(find.text('Try again'), findsNothing);
  });

  testWidgets('invite_screen_viewed once per open, with the focus', (tester) async {
    final events = <ReferralEvent>[];
    await tester.pumpWidget(harness(hub(FakeRpc(), events: events, initialSection: InviteHubSection.enterCode)));
    await tester.pumpAndSettle();
    final viewed = events.where((e) => e.name == ReferralEventName.inviteScreenViewed).toList();
    expect(viewed, hasLength(1));
    expect(viewed.single.props, {'from': 'unknown', 'focus': 'code'});
  });

  for (final width in const [320.0, 430.0]) {
    for (final locale in const [Locale('en'), Locale('hi'), Locale('ar')]) {
      testWidgets('no overflow at $width dp · 1.3x · ${locale.languageCode}', (tester) async {
        tester.view.physicalSize = Size(width, 700);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(harness(hub(FakeRpc({'referral_terms': withDays})), locale: locale, textScale: 1.3));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        // Scroll through the whole hub so every part is laid out on screen at least once.
        await tester.scrollUntilVisible(find.byKey(const ValueKey('referral-code-field')), 200, scrollable: _hubScroll);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final field = tester.getRect(find.byKey(const ValueKey('referral-code-field')));
        expect(field.left, greaterThanOrEqualTo(0));
        expect(field.right, lessThanOrEqualTo(width));
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    }
  }
}
