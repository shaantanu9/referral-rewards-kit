import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

import 'support/fake_rpc.dart';
import 'support/harness.dart';

void main() {
  const labels = RewardLabels(byKind: {'minutes': _minutes}, entitlementNames: {'premium': 'Premium'});

  group('InviteFriendsScreen', () {
    Widget screen(FakeRpc rpc, {List<String>? shared, KeyValueStore? cache, VoidCallback? onTerms}) => harness(
      InviteFriendsScreen(
        client: clientFor(rpc),
        appName: 'App',
        inviteLink: (c) => Uri.parse('https://example.test/i/$c'),
        labels: labels,
        onOpenTerms: onTerms ?? () {},
        codeCache: cache,
        share: (text, origin) async => shared?.add(text),
      ),
    );

    testWidgets('code, rules, caps, rewards, pending with date, banked, cap, terms link', (tester) async {
      await tester.pumpWidget(screen(FakeRpc()));
      await tester.pumpAndSettle();
      expect(find.bySemanticsLabel('A B C D, E F G H'), findsOneWidget);
      expect(find.text('ABCD-'), findsOneWidget);
      expect(find.text('EFGH'), findsOneWidget);
      expect(
        find.text('You and your friend each get 30 min of natural voice when they sign up and start using the app.'),
        findsOneWidget,
      );
      expect(find.text('Up to 10 friends a month count.'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Rewards earned'), 100);
      expect(find.text('Rewards earned'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('5 days of Premium, around Nov 15, 2026'), 100);
      expect(find.text('5 days of Premium, around Nov 15, 2026'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('5 days of Premium, added when your current plan ends.'), 100);
      expect(find.text('5 days of Premium, added when your current plan ends.'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('2 rewards were over the limit'), 100);
      expect(find.text('2 rewards were over the limit'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('4 friends joined'), 100);
      expect(find.text('4 friends joined'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Program terms'), 100);
      expect(find.text('Program terms'), findsOneWidget);
    });

    testWidgets('Share sends the rules-built text with the isolated code', (tester) async {
      final shared = <String>[];
      await tester.pumpWidget(screen(FakeRpc(), shared: shared));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Share'));
      await tester.pump();
      expect(shared.single, contains('\u2066ABCD-EFGH\u2069'));
      expect(shared.single, contains('https://example.test/i/ABCDEFGH'));
      expect(shared.single, contains('we both get 30 min of natural voice'));
    });

    testWidgets('Copy writes the code and announces "Code copied"', (tester) async {
      final spy = ClipboardSpy(tester);
      await tester.pumpWidget(screen(FakeRpc()));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Copy code'));
      await tester.pumpAndSettle();
      expect(spy.written, 'ABCD-EFGH');
      expect(spy.announcements.toString(), contains('Code copied'));
      expect(find.text('Code copied'), findsOneWidget);
    });

    testWidgets('empty state', (tester) async {
      await tester.pumpWidget(screen(FakeRpc({'referral_stats': statsJson(empty: true)})));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-empty')), findsOneWidget);
      expect(find.textContaining('No invites yet.'), findsOneWidget);
    });

    testWidgets('the sharer sees a friend who used the code before they start (no empty state)', (tester) async {
      final one = {...statsJson(empty: true), 'claimed_count': 1, 'joined_count': 0};
      await tester.pumpWidget(screen(FakeRpc({'referral_stats': one})));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-empty')), findsNothing);
      await tester.scrollUntilVisible(find.byKey(const ValueKey('referral-claimed')), 100);
      expect(find.text('1 friend used your code. Your reward comes when they start using the app.'), findsOneWidget);
      expect(find.byKey(const ValueKey('referral-joined')), findsNothing, reason: 'no "0 friends joined" line');
    });

    testWidgets('the sharer sees their first joined friend', (tester) async {
      final one = {...statsJson(empty: true), 'claimed_count': 0, 'joined_count': 1};
      await tester.pumpWidget(screen(FakeRpc({'referral_stats': one})));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-empty')), findsNothing);
      await tester.scrollUntilVisible(find.text('1 friend joined'), 100);
      expect(find.text('1 friend joined'), findsOneWidget);
      expect(find.byKey(const ValueKey('referral-claimed')), findsNothing);
    });

    testWidgets('paused state keeps earned rewards visible', (tester) async {
      await tester.pumpWidget(screen(FakeRpc({'referral_terms': termsJson(enabled: false)})));
      await tester.pumpAndSettle();
      expect(find.text("Invites are paused right now. Rewards you've earned are safe."), findsOneWidget);
      expect(find.text('Share'), findsNothing);
      expect(find.text('Rewards earned'), findsOneWidget);
    });

    testWidgets('code disabled for review', (tester) async {
      await tester.pumpWidget(
        screen(
          FakeRpc({
            'referral_my_code': {'code': null, 'reason': 'code_disabled'},
          }),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Your code is paused while we review it.'), findsOneWidget);
    });

    testWidgets('load error, retry; offline falls back to the cached code', (tester) async {
      final rpc = FakeRpc()..error = Exception('offline');
      await tester.pumpWidget(screen(rpc));
      await tester.pumpAndSettle();
      expect(find.text('Try again'), findsOneWidget);
      rpc.error = null;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.text('ABCD-'), findsOneWidget);

      final cache = MemoryKeyValueStore({'my_code': 'HJKMNPQR'});
      final off = FakeRpc()..error = Exception('offline');
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(screen(off, cache: cache));
      await tester.pumpAndSettle();
      expect(find.text('HJKM-'), findsOneWidget);
      expect(find.text('Share'), findsOneWidget);
    });
  });

  group('InviteCodeEntry', () {
    final now = DateTime.utc(2026, 11, 12, 12);
    late FakeRpc rpc;
    late PendingClaimQueue queue;
    setUp(() {
      rpc = FakeRpc();
      queue = PendingClaimQueue(client: clientFor(rpc), store: MemoryKeyValueStore());
    });

    Widget entry({String? initial, DateTime? eligibleFrom, TargetPlatform? platform}) => harness(
      Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: InviteCodeEntry(
            client: clientFor(rpc),
            queue: queue,
            labels: labels,
            initialCode: initial,
            eligibleFrom: eligibleFrom,
            clock: () => now,
            pastePlatform: platform ?? TargetPlatform.android,
          ),
        ),
      ),
    );

    testWidgets('countdown, disclosure, typed code claimed', (tester) async {
      await tester.pumpWidget(entry(eligibleFrom: now.subtract(const Duration(days: 2, hours: 1))));
      await tester.pumpAndSettle();
      expect(find.text('You can add an invite code for 5 more days'), findsOneWidget);
      expect(find.byKey(const ValueKey('referral-disclosure')), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('referral-code-field')), 'abcd efgh');
      await tester.tap(find.text('Add code'));
      await tester.pumpAndSettle();
      expect(rpc.calls.last.$2['code'], 'ABCDEFGH');
      expect(find.text('Code added.'), findsOneWidget);
    });

    testWidgets('one day left uses the singular', (tester) async {
      await tester.pumpWidget(entry(eligibleFrom: now.subtract(const Duration(days: 6, hours: 1))));
      await tester.pumpAndSettle();
      expect(find.text('You can add an invite code for 1 more day'), findsOneWidget);
    });

    testWidgets('after the window: no field, the rule is stated', (tester) async {
      await tester.pumpWidget(entry(eligibleFrom: now.subtract(const Duration(days: 8))));
      await tester.pumpAndSettle();
      expect(find.text('Invite codes can only be added in your first 7 days'), findsOneWidget);
      expect(find.byKey(const ValueKey('referral-code-field')), findsNothing);
    });

    testWidgets('prefilled code: one tap to confirm', (tester) async {
      await tester.pumpWidget(entry(initial: 'code=abcd-efgh'.substring(5)));
      await tester.pumpAndSettle();
      expect(find.bySemanticsLabel('A B C D, E F G H'), findsOneWidget);
      await tester.tap(find.text('Use code ABCD-EFGH'));
      await tester.pumpAndSettle();
      expect(rpc.names.where((n) => n == 'referral_claim'), hasLength(1));
      expect(find.text('Code added.'), findsOneWidget);
    });

    testWidgets('per-reason message: rate_limited with minutes', (tester) async {
      rpc.responses['referral_claim'] = {'reason': 'rate_limited', 'retry_after_seconds': 3541};
      await tester.pumpWidget(entry());
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('referral-code-field')), 'ABCDEFGH');
      await tester.tap(find.text('Add code'));
      await tester.pumpAndSettle();
      expect(find.text('Too many tries. Try again in 60 min.'), findsOneWidget);
    });

    testWidgets('offline: kept and said so; shown again on the next visit', (tester) async {
      rpc.error = Exception('offline');
      await tester.pumpWidget(entry());
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('referral-code-field')), 'ABCDEFGH');
      await tester.tap(find.text('Add code'));
      await tester.pumpAndSettle();
      expect(find.text("We'll apply your code when you're back online."), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(entry());
      await tester.pumpAndSettle();
      expect(find.text("We'll apply your code when you're back online."), findsOneWidget);
      expect(find.text('ABCD-EFGH'), findsOneWidget);
    });

    testWidgets('Android Paste reads the clipboard and fills the field', (tester) async {
      final spy = ClipboardSpy(tester, clipboardText: '\u2066abcd-efgh\u2069');
      await tester.pumpWidget(entry());
      await tester.pumpAndSettle();
      await tester.tap(find.text('Paste'));
      await tester.pumpAndSettle();
      expect(spy.calls, contains('Clipboard.getData'));
      expect(find.text('ABCD-EFGH'), findsOneWidget);
    });

    group('iOS paste never calls Clipboard.getData', () {
      setUp(PasteControlSupport.reset);
      tearDown(PasteControlSupport.reset);

      testWidgets('below iOS 16: no button, the field menu is the way', (tester) async {
        final spy = ClipboardSpy(tester);
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          PasteControlSupport.channel,
          (call) async => false,
        );
        await tester.pumpWidget(entry(platform: TargetPlatform.iOS));
        await tester.pumpAndSettle();
        expect(find.text('Paste'), findsNothing);
        expect(find.byType(UiKitView), findsNothing);
        expect(spy.calls, isNot(contains('Clipboard.getData')));
      });

      testWidgets('iOS 16+: native UIPasteControl view; its text fills the field', (tester) async {
        final spy = ClipboardSpy(tester);
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          PasteControlSupport.channel,
          (call) async => true,
        );
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform_views,
          (call) async => null,
        );
        await tester.pumpWidget(entry(platform: TargetPlatform.iOS));
        await tester.pumpAndSettle();
        expect(find.byType(UiKitView), findsOneWidget);
        final message = const StandardMethodCodec().encodeMethodCall(const MethodCall('pasted', 'abcdefgh'));
        await tester.binding.defaultBinaryMessenger.handlePlatformMessage(
          'referral_kit/paste_control/0',
          message,
          (_) {},
        );
        await tester.pumpAndSettle();
        expect(find.text('ABCD-EFGH'), findsOneWidget);
        expect(spy.calls, isNot(contains('Clipboard.getData')));
      });
    });
  });

  group('ReferralRewardCard', () {
    testWidgets('shows each pending reward and acks on dismiss', (tester) async {
      final rpc = FakeRpc();
      await tester.pumpWidget(
        harness(
          Scaffold(
            body: ReferralRewardCard(client: clientFor(rpc), labels: labels),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Welcome bonus: 30 min of natural voice, thanks to your invite.'), findsOneWidget);
      expect(find.text('5 days of Premium, added when your current plan ends.'), findsOneWidget);
      await tester.tap(find.text('Got it').first);
      await tester.pumpAndSettle();
      expect(rpc.calls.last.$1, 'referral_ack');
      expect(rpc.calls.last.$2['reward_ids'], ['0b9a3f4e-1111-4c2d-9a51-000000000004']);
      expect(find.text('Got it'), findsOneWidget);
    });

    testWidgets('nothing pending, or an error: nothing shown', (tester) async {
      final rpc = FakeRpc({'referral_pending': []});
      await tester.pumpWidget(harness(Scaffold(body: ReferralRewardCard(client: clientFor(rpc)))));
      await tester.pumpAndSettle();
      expect(find.byType(Card), findsNothing);
      final failing = FakeRpc()..error = Exception('offline');
      await tester.pumpWidget(harness(Scaffold(body: ReferralRewardCard(client: clientFor(failing)))));
      await tester.pumpAndSettle();
      expect(find.byType(Card), findsNothing);
    });
  });
}

String _minutes(num n) => '${n.round()} min of natural voice';
