// The optional slots an app uses to dress the kit's widgets: a header above the code, its own share sentence,
// hiding the window line it shows itself, and an action on the reward card. Each defaults to the old behaviour.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

import 'support/fake_rpc.dart';
import 'support/harness.dart';

void main() {
  testWidgets('InviteFriendsScreen: header above the code, app share sentence with the formatted code', (tester) async {
    final shared = <String>[];
    await tester.pumpWidget(
      harness(
        InviteFriendsScreen(
          client: clientFor(FakeRpc()),
          appName: 'App',
          inviteLink: (c) => Uri.parse('https://example.test/i/$c'),
          header: const Text('Give 4, get 4', key: ValueKey('hdr')),
          shareText: (code, link) => 'Use $code at $link',
          share: (text, origin) async => shared.add(text),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('hdr')), findsOneWidget);
    expect(
      tester.getTopLeft(find.byKey(const ValueKey('hdr'))).dy,
      lessThan(tester.getTopLeft(find.text('Your invite code')).dy),
    );
    await tester.tap(find.text('Share'));
    await tester.pump();
    expect(shared.single, 'Use ABCD-EFGH at https://example.test/i/ABCDEFGH');
  });

  group('InviteCodeEntry showWindow', () {
    final now = DateTime.utc(2026, 11, 12, 12);
    Widget entry(bool show, Duration since) {
      final rpc = FakeRpc();
      return harness(
        Scaffold(
          body: InviteCodeEntry(
            client: clientFor(rpc),
            queue: PendingClaimQueue(client: clientFor(rpc), store: MemoryKeyValueStore()),
            eligibleFrom: now.subtract(since),
            clock: () => now,
            showWindow: show,
            pastePlatform: TargetPlatform.android,
          ),
        ),
      );
    }

    testWidgets('false hides the open countdown', (tester) async {
      await tester.pumpWidget(entry(false, const Duration(days: 2)));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-window')), findsNothing);
      expect(find.byKey(const ValueKey('referral-code-field')), findsOneWidget);
    });

    testWidgets('false still states a closed window', (tester) async {
      await tester.pumpWidget(entry(false, const Duration(days: 30)));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-window')), findsOneWidget);
    });
  });

  testWidgets('ReferralRewardCard: leading and action; the action dismisses and acks', (tester) async {
    final rpc = FakeRpc();
    var opened = 0;
    await tester.pumpWidget(
      harness(
        Scaffold(
          body: SingleChildScrollView(
            child: ReferralRewardCard(
              client: clientFor(rpc),
              leading: const Icon(Icons.card_giftcard, key: ValueKey('lead')),
              actionLabel: 'Read now',
              onAction: () => opened++,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('lead')), findsWidgets);
    final before = find.text('Read now').evaluate().length;
    await tester.tap(find.text('Read now').first);
    await tester.pumpAndSettle();
    expect(opened, 1);
    expect(rpc.calls.last.$1, 'referral_ack');
    expect(find.text('Read now').evaluate().length, before - 1);
  });
}
