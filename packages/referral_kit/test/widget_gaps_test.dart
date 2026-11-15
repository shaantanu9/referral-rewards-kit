// 0.2.0 widget additions: the "not deployed" state, events from every widget, reward card callbacks, labels built
// with a BuildContext.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';
import 'package:share_plus/share_plus.dart';

import 'support/fake_rpc.dart';
import 'support/harness.dart';

const _notDeployed = ReferralUnavailableException(ReferralUnavailableReason.notDeployed);

void main() {
  group('not deployed', () {
    testWidgets('InviteFriendsScreen: "not available yet", no Retry, not "check your connection"', (tester) async {
      await tester.pumpWidget(
        harness(
          InviteFriendsScreen(
            client: clientFor(FakeRpc()..error = _notDeployed),
            appName: 'App',
            inviteLink: (c) => Uri.parse('https://example.test/i/$c'),
            codeCache: MemoryKeyValueStore({'my_code': 'ABCDEFGH'}),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-not-available')), findsOneWidget);
      expect(find.text("Invites aren't available yet. Check back soon."), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
      expect(find.textContaining('connection'), findsNothing);
      expect(find.text('ABCD-'), findsNothing, reason: 'a cached code is not offered when the server has no kit');
    });

    testWidgets('InviteFriendsScreen: unavailableBuilder can hide it', (tester) async {
      await tester.pumpWidget(
        harness(
          InviteFriendsScreen(
            client: clientFor(FakeRpc()..error = _notDeployed),
            appName: 'App',
            inviteLink: (c) => Uri.parse('https://example.test/i/$c'),
            unavailableBuilder: (context, reason) => Text('hidden:${reason.wire}', key: const ValueKey('custom')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('hidden:not_deployed'), findsOneWidget);
    });

    testWidgets('an ordinary failure still offers Retry', (tester) async {
      await tester.pumpWidget(
        harness(
          InviteFriendsScreen(
            client: clientFor(FakeRpc()..error = Exception('offline')),
            appName: 'App',
            inviteLink: (c) => Uri.parse('https://example.test/i/$c'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Try again'), findsOneWidget);
    });

    testWidgets('InviteCodeEntry: terms not deployed → no field, "not available yet"', (tester) async {
      final rpc = FakeRpc()..error = _notDeployed;
      await tester.pumpWidget(
        harness(
          Scaffold(
            body: InviteCodeEntry(
              client: clientFor(rpc),
              queue: PendingClaimQueue(client: clientFor(rpc), store: MemoryKeyValueStore()),
              pastePlatform: TargetPlatform.android,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-code-field')), findsNothing);
      expect(find.text("Invites aren't available yet. Check back soon."), findsOneWidget);
      expect(find.textContaining('online'), findsNothing);
    });

    testWidgets('InviteCodeEntry: a claim while not deployed is kept and says so (not "offline")', (tester) async {
      final rpc = FakeRpc({'referral_claim': (Map<String, Object?> p) => throw _notDeployed});
      final store = MemoryKeyValueStore();
      await tester.pumpWidget(
        harness(
          Scaffold(
            body: InviteCodeEntry(
              client: clientFor(rpc),
              queue: PendingClaimQueue(client: clientFor(rpc), store: store),
              terms: ReferralTerms.fromJson(termsJson()),
              pastePlatform: TargetPlatform.android,
            ),
          ),
        ),
      );
      await tester.enterText(find.byKey(const ValueKey('referral-code-field')), 'ABCD-EFGH');
      await tester.tap(find.text('Add code'));
      await tester.pumpAndSettle();
      expect(
        find.text("Invite codes aren't available yet. We saved your code and will add it when they are."),
        findsOneWidget,
      );
      expect(store.values[PendingClaimQueue.storageKey], 'ABCDEFGH');
    });
  });

  group('events', () {
    testWidgets('invite screen: viewed, copied, shared', (tester) async {
      final events = <ReferralEvent>[];
      ClipboardSpy(tester);
      await tester.pumpWidget(
        harness(
          InviteFriendsScreen(
            client: clientFor(FakeRpc()),
            appName: 'App',
            inviteLink: (c) => Uri.parse('https://example.test/i/$c'),
            share: (text, origin) async {},
            onEvent: events.add,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Copy code'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Share'));
      await tester.pumpAndSettle();
      expect(events.map((e) => e.wireName), ['invite_screen_viewed', 'invite_code_copied', 'invite_shared']);
      expect(events[0].props, {'from': 'unknown', 'focus': 'share'});
      expect(events[1].props, {'has_link': true});
      expect(events[2].props, {'channel': 'unknown', 'status': 'unavailable', 'has_link': true});
      expect(events.map((e) => e.legacyWireName).first, 'referral_invite_viewed');
    });

    testWidgets('paused program: viewed as paused and feature unavailable', (tester) async {
      final events = <ReferralEvent>[];
      final client = ReferralClient(
        rpc: FakeRpc({'referral_terms': termsJson(enabled: false)}).call,
        installIds: const FixedInstallIdStore(testInstallId),
        onEvent: events.add,
      );
      await tester.pumpWidget(
        harness(
          InviteFriendsScreen(client: client, appName: 'App', inviteLink: (c) => Uri.parse('https://e.test/i/$c')),
        ),
      );
      await tester.pumpAndSettle();
      expect(events.map((e) => e.wireName), ['invite_screen_viewed', 'referral_feature_hidden']);
      expect(events[1].props, {'reason': 'program_paused', 'surface': 'invite'});
    });

    test('share results map to status and a channel bucket, never the raw string', () {
      expect(shareEventProps(const ShareResult('com.whatsapp', ShareResultStatus.success), hasLink: true), {
        'channel': 'whatsapp',
        'status': 'success',
        'has_link': true,
      });
      expect(shareEventProps(const ShareResult('', ShareResultStatus.dismissed), hasLink: false), {
        'channel': 'dismissed',
        'status': 'dismissed',
        'has_link': false,
      });
      expect(shareEventProps(ShareResult.unavailable, hasLink: true)['channel'], 'unknown');
      expect(shareEventProps(null, hasLink: true), {'channel': 'unknown', 'status': 'unavailable', 'has_link': true});
      ShareResult ok(String raw) => ShareResult(raw, ShareResultStatus.success);
      expect(shareChannel(ok('net.whatsapp.WhatsApp.ShareExtension')), 'whatsapp');
      expect(shareChannel(ok('com.apple.UIKit.activity.Message')), 'messages');
      expect(shareChannel(ok('com.google.android.gm')), 'mail');
      expect(shareChannel(ok('com.apple.UIKit.activity.CopyToPasteboard')), 'copy');
      expect(shareChannel(ok('org.example.secretapp')), 'other');
      expect(shareChannel(ok('dev.fluttercommunity.plus/share/unavailable')), 'unknown');
    });

    testWidgets('code entry: started once, submitted with hash, claim result from the queue', (tester) async {
      final events = <ReferralEvent>[];
      final client = ReferralClient(
        rpc: FakeRpc({
          'referral_claim': {'reason': 'unknown_code'},
        }).call,
        installIds: const FixedInstallIdStore(testInstallId),
        onEvent: events.add,
      );
      await tester.pumpWidget(
        harness(
          Scaffold(
            body: InviteCodeEntry(
              client: client,
              queue: PendingClaimQueue(client: client, store: MemoryKeyValueStore()),
              pastePlatform: TargetPlatform.android,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('referral-code-field')), 'ABCD');
      await tester.enterText(find.byKey(const ValueKey('referral-code-field')), 'ABCDEFGH');
      await tester.tap(find.text('Add code'));
      await tester.pumpAndSettle();
      expect(events.map((e) => e.wireName), ['code_entry_started', 'code_submitted', 'code_claim_result']);
      expect(events[0].props, {'source': 'typed'});
      expect(events[1].props, {'code_hash': referralCodeHash('ABCDEFGH'), 'source': 'typed'});
      expect(events[2].props, {'result': 'invalid', 'via': 'entry', 'code_hash': referralCodeHash('ABCDEFGH')});
    });

    testWidgets('code entry: a closed window is reported once', (tester) async {
      final events = <ReferralEvent>[];
      final rpc = FakeRpc({
        'referral_terms': {...termsJson(), 'claim_days_left': 0},
      });
      final client = ReferralClient(
        rpc: rpc.call,
        installIds: const FixedInstallIdStore(testInstallId),
        onEvent: events.add,
      );
      await tester.pumpWidget(
        harness(
          Scaffold(
            body: InviteCodeEntry(
              client: client,
              queue: PendingClaimQueue(client: client, store: MemoryKeyValueStore()),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox());
      expect(events.single.props, {'reason': 'window_closed', 'surface': 'entry'});
    });
  });

  group('ReferralRewardCard', () {
    testWidgets('onShown per reward, onDismissed after the ack, events', (tester) async {
      final rpc = FakeRpc();
      final shown = <String>[];
      final dismissed = <(String, bool)>[];
      final events = <ReferralEvent>[];
      await tester.pumpWidget(
        harness(
          Scaffold(
            body: SingleChildScrollView(
              child: ReferralRewardCard(
                client: clientFor(rpc),
                onShown: (r) => shown.add(r.id),
                onDismissed: (r, acked) => dismissed.add((r.id, acked)),
                onEvent: events.add,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(shown, ['0b9a3f4e-1111-4c2d-9a51-000000000004', '0b9a3f4e-1111-4c2d-9a51-000000000005']);
      await tester.tap(find.text('Got it').first);
      await tester.pumpAndSettle();
      expect(dismissed, [('0b9a3f4e-1111-4c2d-9a51-000000000004', true)]);
      expect(events.map((e) => e.wireName), ['reward_shown', 'reward_shown', 'reward_acknowledged']);
      expect(events.last.props, {
        'kind': 'minutes',
        'event': 'joined',
        'who': 'friend',
        'state': 'granted',
        'acknowledged': true,
      });
    });

    testWidgets('a failed ack is reported as not acknowledged', (tester) async {
      final rpc = FakeRpc({'referral_ack': (Map<String, Object?> p) => throw Exception('offline')});
      final dismissed = <bool>[];
      await tester.pumpWidget(
        harness(
          Scaffold(
            body: SingleChildScrollView(
              child: ReferralRewardCard(client: clientFor(rpc), onDismissed: (r, acked) => dismissed.add(acked)),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Got it').first);
      await tester.pumpAndSettle();
      expect(dismissed, [false]);
    });

    testWidgets('labelsBuilder gets a context (localised reward names) and wins over labels', (tester) async {
      await tester.pumpWidget(
        harness(
          Scaffold(
            body: SingleChildScrollView(
              child: ReferralRewardCard(
                client: clientFor(FakeRpc()),
                labels: const RewardLabels(byKind: {'minutes': _plain}),
                labelsBuilder: (context) {
                  final lang = Localizations.localeOf(context).languageCode;
                  return RewardLabels(byKind: {'minutes': (n) => '$n min ($lang)'});
                },
              ),
            ),
          ),
          locale: const Locale('id'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('30 min (id)'), findsOneWidget);
      expect(find.textContaining('plain'), findsNothing);
    });
  });
}

String _plain(num n) => '$n plain';
