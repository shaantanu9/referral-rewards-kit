import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:referral_kit/referral_kit.dart';

import 'support/fake_rpc.dart';
import 'support/growth_json.dart';
import 'support/harness.dart';

class FakeLauncher implements ReferralLauncher {
  FakeLauncher({this.can = true, this.opens = true});
  final bool can;
  final bool opens;
  final List<Uri> launched = [];
  @override
  Future<bool> canLaunch(Uri uri) async => can;
  @override
  Future<bool> launch(Uri uri) async {
    launched.add(uri);
    return opens;
  }
}

final now = DateTime.utc(2026, 11, 20, 12);
DateTime clock() => now;

/// A server with every 0.5 RPC: boost running, preferences that can be changed, leave and rejoin.
FakeRpc growthRpc({Map<String, Object?>? boost, Map<String, Object?>? extra}) {
  var prefs = <String, Object?>{...prefsJson};
  return FakeRpc({
    'referral_terms': {
      ...termsJson(),
      'boost': boost ?? boostJson(endsAt: DateTime(2026, 11, 23).toUtc().toIso8601String()),
    },
    'referral_stats': {...statsJson(empty: true), 'claimed_count': 2, 'joined_count': 0},
    'referral_my_code': (Map<String, Object?> _) => prefs['participating'] == false
        ? {'code': null, 'reason': 'left', 'left': true}
        : {'code': 'ABCDEFGH', 'reason': 'ok'},
    'referral_preferences': (Map<String, Object?> _) => prefs,
    'referral_preferences_set': (Map<String, Object?> p) {
      final change = (p['prefs']! as Map).cast<String, Object?>();
      final name = change['display_name'];
      if (name is String && displayNameProblem(name) != null) return {'reason': 'invalid_name'};
      prefs = {...prefs, ...change};
      return prefs;
    },
    ...?extra,
  });
}

void main() {
  late List<ReferralEvent> events;
  setUp(() => events = []);

  ReferralClient client(FakeRpc rpc) =>
      ReferralClient(rpc: rpc.call, installIds: const FixedInstallIdStore(testInstallId), onEvent: events.add);

  Widget screen(FakeRpc rpc, {FakeLauncher? launcher, bool link = true, DateTime Function()? at}) =>
      InviteFriendsScreen(
        client: client(rpc),
        appName: 'App',
        inviteLink: link ? (c) => Uri.parse('https://example.test/i/$c') : null,
        share: (_, _) async {},
        launcher: launcher ?? FakeLauncher(),
        clock: at ?? clock,
      );

  Future<void> scrollTo(WidgetTester tester, Finder f) async {
    await tester.scrollUntilVisible(f, 120, scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
  }

  group('InviteFriendsScreen 0.5', () {
    testWidgets('give-first headline and the boost banner with its real last day', (tester) async {
      await tester.pumpWidget(harness(screen(growthRpc())));
      await tester.pumpAndSettle();
      expect(
        find.text('Give a friend 30 min, and get the same, when they join with your code and start using the app'),
        findsOneWidget,
      );
      final banner = find.byKey(const ValueKey('referral-boost'));
      expect(banner, findsOneWidget);
      expect(
        find.descendant(of: banner, matching: find.textContaining('Double rewards until Sun, 22 Nov')),
        findsOneWidget,
      );
      expect(find.textContaining(RegExp(r'\d+:\d+')), findsNothing, reason: 'never a ticking timer');
    });

    testWidgets('an ended boost is not shown', (tester) async {
      await tester.pumpWidget(harness(screen(growthRpc(), at: () => DateTime(2026, 11, 23, 1))));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-boost')), findsNothing);
    });

    testWidgets('WhatsApp opens wa.me with the share text and reports channel whatsapp_button', (tester) async {
      final launcher = FakeLauncher();
      await tester.pumpWidget(harness(screen(growthRpc(), launcher: launcher)));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('referral-whatsapp')));
      await tester.pumpAndSettle();
      final uri = launcher.launched.single;
      expect('${uri.scheme}://${uri.host}${uri.path}', 'https://wa.me/');
      final text = uri.queryParameters['text']!;
      expect(text, startsWith("Here's 30 min in App, on me"));
      expect(text, contains('https://example.test/i/ABCDEFGH'));
      expect(uri.toString(), isNot(contains(' ')), reason: 'encoded');
      final shared = events.lastWhere((e) => e.wireName == 'invite_shared');
      expect(shared.props, {'channel': 'whatsapp_button', 'status': 'opened', 'has_link': true});
    });

    testWidgets('WhatsApp hidden when it cannot launch; unavailable when the launch fails', (tester) async {
      await tester.pumpWidget(harness(screen(growthRpc(), launcher: FakeLauncher(can: false))));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-whatsapp')), findsNothing);
      expect(find.text('Share'), findsOneWidget);

      await tester.pumpWidget(
        harness(screen(growthRpc(), launcher: FakeLauncher(opens: false)), locale: const Locale('hi')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('referral-whatsapp')));
      await tester.pump();
      expect(events.last.props['status'], 'unavailable');
    });

    testWidgets('Show QR code: the https invite link, a semantic label, an event', (tester) async {
      await tester.pumpWidget(harness(screen(growthRpc())));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('referral-show-qr')));
      await tester.pumpAndSettle();
      final qr = tester.widget<QrImageView>(find.byType(QrImageView));
      expect(find.text('https://example.test/i/ABCDEFGH'), findsOneWidget);
      expect(qr.semanticsLabel, 'QR code of your invite link');
      expect(find.bySemanticsLabel('QR code of your invite link'), findsOneWidget);
      expect(events.map((e) => e.wireName), contains('invite_qr_shown'));
      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();
      expect(find.byType(QrImageView), findsNothing);
    });

    testWidgets('no QR without an invite link', (tester) async {
      await tester.pumpWidget(harness(screen(growthRpc(), link: false)));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-show-qr')), findsNothing);
    });

    testWidgets('QR sheet in dark mode keeps a white background', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.dark(),
          localizationsDelegates: const [referralKitLocalizationsDelegate],
          home: Scaffold(body: ReferralQrSheet(link: Uri.parse('https://x.test/i/A'))),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(tester.widget<QrImageView>(find.byType(QrImageView)).backgroundColor, Colors.white);
    });

    testWidgets('waiting line with the next step and the reward on claimedCount', (tester) async {
      await tester.pumpWidget(harness(screen(growthRpc())));
      await tester.pumpAndSettle();
      await scrollTo(tester, find.byKey(const ValueKey('referral-claimed')));
      expect(
        find.text(
          '2 friends used your code. Their next step: Start using App. For each friend who does it, you both get '
          '30 min.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('first name: validated like the server, saved, and withdrawn at once', (tester) async {
      final rpc = growthRpc();
      await tester.pumpWidget(harness(screen(rpc)));
      await tester.pumpAndSettle();
      await scrollTo(tester, find.byKey(const ValueKey('referral-show-name')));
      expect(
        find.text(
          'Your first name is shown to friends who open your link, with a note that you get a reward if they join.',
        ),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('referral-show-name')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('referral-name-field')), 'me@x.com');
      await scrollTo(tester, find.byKey(const ValueKey('referral-name-save')));
      await tester.tap(find.byKey(const ValueKey('referral-name-save')));
      await tester.pumpAndSettle();
      expect(find.text("A name can't contain @ or a link."), findsOneWidget);
      expect(rpc.names, isNot(contains('referral_preferences_set')), reason: 'checked before sending');

      await tester.enterText(find.byKey(const ValueKey('referral-name-field')), 'Priya');
      await scrollTo(tester, find.byKey(const ValueKey('referral-name-save')));
      await tester.tap(find.byKey(const ValueKey('referral-name-save')));
      await tester.pumpAndSettle();
      expect(rpc.calls.last.$2['prefs'], {'show_name': true, 'display_name': 'Priya'});
      expect(find.text('Saved'), findsOneWidget);
      final changed = events.lastWhere((e) => e.wireName == 'invite_preferences_changed');
      expect(changed.props, {'show_name': true, 'result': 'ok'});
      expect(changed.props.values.join(), isNot(contains('Priya')));

      await scrollTo(tester, find.byKey(const ValueKey('referral-show-name')));
      await tester.tap(find.byKey(const ValueKey('referral-show-name')));
      await tester.pumpAndSettle();
      expect(rpc.calls.last.$2['prefs'], {'show_name': false});
    });

    testWidgets('leave with a confirm, then "You left" and Join again', (tester) async {
      final rpc = growthRpc();
      await tester.pumpWidget(harness(screen(rpc)));
      await tester.pumpAndSettle();
      await scrollTo(tester, find.byKey(const ValueKey('referral-leave')));
      await tester.tap(find.byKey(const ValueKey('referral-leave')));
      await tester.pumpAndSettle();
      expect(find.text('Leave the invite program?'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('referral-leave-cancel')));
      await tester.pumpAndSettle();
      expect(rpc.names, isNot(contains('referral_preferences_set')));

      await tester.tap(find.byKey(const ValueKey('referral-leave')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('referral-leave-confirm')));
      await tester.pumpAndSettle();
      expect(rpc.calls.lastWhere((c) => c.$1 == 'referral_preferences_set').$2['prefs'], {'participating': false});
      expect(find.text('You left the invite program'), findsOneWidget);
      expect(find.text('Share'), findsNothing);
      expect(find.byKey(const ValueKey('referral-whatsapp')), findsNothing);

      await tester.tap(find.byKey(const ValueKey('referral-join-again')));
      await tester.pumpAndSettle();
      expect(find.text('Share'), findsOneWidget);
      expect(find.text('ABCD-'), findsOneWidget, reason: 'the same code');
    });

    testWidgets('an older server (no new RPCs) shows no invite page block and no boost', (tester) async {
      await tester.pumpWidget(harness(screen(FakeRpc())));
      await tester.pumpAndSettle();
      await scrollTo(tester, find.text('4 friends joined'));
      expect(find.byKey(const ValueKey('referral-invite-page')), findsNothing);
      expect(find.byKey(const ValueKey('referral-boost')), findsNothing);
    });
  });

  group('ReferralWelcomeCard', () {
    late MemoryKeyValueStore store;
    setUp(() {
      store = MemoryKeyValueStore();
      ReferralWelcomeCard.session = 'launch-1';
    });

    Widget card(FakeRpc rpc, {VoidCallback? onPassItOn, ReferralPromptPolicy? policy, DateTime Function()? at}) =>
        Scaffold(
          body: ListView(
            children: [
              ReferralWelcomeCard(
                client: client(rpc),
                store: store,
                appName: 'Reader',
                activationStep: 'Read your first page',
                onPassItOn: onPassItOn,
                policy: policy,
                clock: at ?? clock,
              ),
            ],
          ),
        );

    testWidgets('claimed: the gift, the step and the days left; dismiss hides it for the day', (tester) async {
      final rpc = FakeRpc({'referral_my_claim': myClaimClaimed});
      await tester.pumpWidget(harness(card(rpc)));
      await tester.pumpAndSettle();
      expect(find.text('Your welcome gift of 60 min is waiting: Read your first page. 12 days left.'), findsOneWidget);
      expect(events.single.props, {'state': 'claimed'});
      await tester.tap(find.byKey(const ValueKey('referral-welcome-dismiss')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-welcome-claimed')), findsNothing);
      expect(events.last.props, {'state': 'claimed', 'action': 'dismiss'});

      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(harness(card(rpc)));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-welcome-claimed')), findsNothing, reason: 'dismissed today');

      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(harness(card(rpc, at: () => now.add(const Duration(days: 1)))));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-welcome-claimed')), findsOneWidget, reason: 'the next day');
    });

    testWidgets('claimed: once per day across launches, kept within a launch', (tester) async {
      final rpc = FakeRpc({'referral_my_claim': myClaimClaimed});
      await tester.pumpWidget(harness(card(rpc)));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(harness(card(rpc)));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-welcome-claimed')), findsOneWidget, reason: 'same launch');

      ReferralWelcomeCard.session = 'launch-2';
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(harness(card(rpc)));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-welcome-claimed')), findsNothing, reason: 'a second launch today');
    });

    testWidgets('joined: pass it on once, opening the invite hub', (tester) async {
      var opened = 0;
      final rpc = FakeRpc({'referral_my_claim': myClaimJoined});
      await tester.pumpWidget(harness(card(rpc, onPassItOn: () => opened++)));
      await tester.pumpAndSettle();
      expect(
        find.text('Pass it on: give a friend 30 min when they join with your code and start using the app.'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('referral-welcome-invite')));
      await tester.pumpAndSettle();
      expect(opened, 1);
      expect(events.last.props, {'state': 'joined', 'action': 'invite'});

      ReferralWelcomeCard.session = 'launch-2';
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(harness(card(rpc, onPassItOn: () {}, at: () => now.add(const Duration(days: 3)))));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-welcome-joined')), findsNothing, reason: 'once');
    });

    testWidgets('joined with a policy: never in the first session', (tester) async {
      final policy = ReferralPromptPolicy(store: store, clock: clock);
      await policy.startSession();
      await tester.pumpWidget(harness(card(FakeRpc({'referral_my_claim': myClaimJoined}), policy: policy)));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('referral-welcome-joined')), findsNothing);
    });

    testWidgets('none, expired and an older server show nothing', (tester) async {
      for (final rpc in [
        FakeRpc({'referral_my_claim': myClaimNone}),
        FakeRpc({'referral_my_claim': myClaimExpired}),
        FakeRpc()..error = const ReferralUnavailableException(ReferralUnavailableReason.notDeployed),
      ]) {
        await tester.pumpWidget(harness(card(rpc)));
        await tester.pumpAndSettle();
        expect(find.byType(Card), findsNothing);
      }
      expect(events, isEmpty);
    });
  });

  group('layout: 320 dp, 2.0 text, RTL (ar), hi', () {
    final builds = <String, Widget Function(ReferralClient Function(FakeRpc) c)>{
      'InviteFriendsScreen (growth)': (c) => InviteFriendsScreen(
        client: c(growthRpc()),
        appName: 'App',
        inviteLink: (code) => Uri.parse('https://example.test/i/$code'),
        share: (_, _) async {},
        launcher: FakeLauncher(),
        clock: clock,
        onOpenTerms: () {},
      ),
      'welcome card (claimed)': (c) => Scaffold(
        body: ListView(
          children: [
            ReferralWelcomeCard(
              client: c(FakeRpc({'referral_my_claim': myClaimClaimed})),
              store: MemoryKeyValueStore(),
              appName: 'App',
              clock: clock,
            ),
          ],
        ),
      ),
      'welcome card (joined)': (c) => Scaffold(
        body: ListView(
          children: [
            ReferralWelcomeCard(
              client: c(FakeRpc({'referral_my_claim': myClaimJoined})),
              store: MemoryKeyValueStore(),
              appName: 'App',
              onPassItOn: () {},
              clock: clock,
            ),
          ],
        ),
      ),
      'QR sheet': (c) => Scaffold(body: ReferralQrSheet(link: Uri.parse('https://x.test/i/ABCDEFGH'))),
    };
    for (final MapEntry(key: name, value: build) in builds.entries) {
      for (final locale in const [Locale('en'), Locale('ar'), Locale('hi'), Locale('id')]) {
        for (final scale in const [1.0, 2.0]) {
          testWidgets('$name · ${locale.languageCode} · ${scale}x', (tester) async {
            smallPhone(tester);
            ReferralWelcomeCard.session = 'layout-$name-$locale-$scale';
            await tester.pumpWidget(harness(build(client), locale: locale, textScale: scale));
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull, reason: 'no overflow');
            final rtl = locale.languageCode == 'ar';
            expect(
              Directionality.of(tester.element(find.byType(Text).first)),
              rtl ? TextDirection.rtl : TextDirection.ltr,
            );
            if (scale == 1.0) await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          });
        }
      }
    }

    testWidgets('the invite page block and the leave dialog at 2.0 in RTL', (tester) async {
      smallPhone(tester);
      await tester.pumpWidget(
        harness(builds['InviteFriendsScreen (growth)']!(client), locale: const Locale('ar'), textScale: 2),
      );
      await tester.pumpAndSettle();
      await scrollTo(tester, find.byKey(const ValueKey('referral-leave')));
      await tester.tap(find.byKey(const ValueKey('referral-leave')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.byKey(const ValueKey('referral-leave-confirm')), findsOneWidget);
    });
  });
}
