import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

import 'support/fake_rpc.dart';
import 'support/harness.dart';

/// The sharer's reward lands on the server while the app is in the background, or before the user signed in.
/// The card must ask again when the app comes back and when it is given a new client, not only when first built.
void main() {
  const labels = RewardLabels(byKind: {'minutes': _minutes}, entitlementNames: {'premium': 'Premium'});
  final card = find.byKey(const ValueKey('referral-reward-0b9a3f4e-1111-4c2d-9a51-000000000004'));

  testWidgets('a reward granted while the app was in the background shows on resume', (tester) async {
    final rpc = FakeRpc({'referral_pending': <Object?>[]});
    await tester.pumpWidget(harness(ReferralRewardCard(client: clientFor(rpc), labels: labels)));
    await tester.pumpAndSettle();
    expect(card, findsNothing);

    rpc.responses['referral_pending'] = pendingJson();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(card, findsOneWidget);
  });

  testWidgets('built before sign-in (call fails), shows the reward after sign-in on resume', (tester) async {
    final rpc = FakeRpc()..error = const ReferralUnavailableException(ReferralUnavailableReason.signedOut);
    await tester.pumpWidget(harness(ReferralRewardCard(client: clientFor(rpc), labels: labels)));
    await tester.pumpAndSettle();
    expect(card, findsNothing);

    rpc.error = null;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(card, findsOneWidget);
  });

  testWidgets('a new client (another user signed in) loads that user\'s rewards', (tester) async {
    final first = FakeRpc({'referral_pending': <Object?>[]});
    await tester.pumpWidget(harness(ReferralRewardCard(client: clientFor(first), labels: labels)));
    await tester.pumpAndSettle();
    expect(card, findsNothing);

    await tester.pumpWidget(harness(ReferralRewardCard(client: clientFor(FakeRpc()), labels: labels)));
    await tester.pumpAndSettle();
    expect(card, findsOneWidget);
  });

  testWidgets('a reward already on screen is not reported as shown twice on resume', (tester) async {
    final shown = <String>[];
    await tester.pumpWidget(
      harness(ReferralRewardCard(client: clientFor(FakeRpc()), labels: labels, onShown: (r) => shown.add(r.id))),
    );
    await tester.pumpAndSettle();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(shown, hasLength(2), reason: 'two rewards, each reported once');
  });
}

String _minutes(num n) => '$n min of natural voice';
