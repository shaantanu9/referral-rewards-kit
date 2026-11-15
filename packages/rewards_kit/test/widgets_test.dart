import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';

Widget app(Widget child, {ThemeData? theme}) => MaterialApp(
  theme: theme,
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

/// A controller whose phone clock moves with [now] (offset zero after sync).
(RewardsController, void Function(Duration)) clocked(FakeRpc rpc) {
  var now = serverNow;
  final c = controllerOn(rpc, local: () => now);
  return (c, (d) => now = now.add(d));
}

void main() {
  group('Countdown', () {
    testWidgets('ticks every second and fires onExpired once', (t) async {
      var now = serverNow;
      final clock = ServerClock(local: () => now);
      var fired = 0;
      await t.pumpWidget(
        app(
          Countdown(
            endsAt: serverNow.add(const Duration(seconds: 3)),
            clock: clock,
            prefix: 'Ends in',
            onExpired: () => fired++,
          ),
        ),
      );
      expect(find.text('Ends in 3s'), findsOneWidget);
      now = now.add(const Duration(seconds: 1));
      await t.pump(const Duration(seconds: 1));
      expect(find.text('Ends in 2s'), findsOneWidget);
      now = now.add(const Duration(seconds: 5));
      await t.pump(const Duration(seconds: 1));
      await t.pump();
      expect(find.text('Ends in 0s'), findsOneWidget, reason: 'never negative');
      await t.pump(const Duration(seconds: 3));
      expect(fired, 1);
    });

    testWidgets('no deadline: nothing shown; builder gets the time left', (t) async {
      final clock = ServerClock(local: () => serverNow);
      await t.pumpWidget(app(Countdown(endsAt: null, clock: clock)));
      expect(find.byType(Text), findsNothing);
      await t.pumpWidget(
        app(
          Countdown(
            endsAt: serverNow.add(const Duration(minutes: 2)),
            clock: clock,
            builder: (_, left) => Text('left ${left.inSeconds}'),
          ),
        ),
      );
      expect(find.text('left 120'), findsOneWidget);
    });
  });

  group('StreakCard', () {
    testWidgets('loads the state itself and shows the streak, risk countdown and next reward', (t) async {
      final rpc = FakeRpc({'rewards_state': (_) => sampleState()});
      final (c, _) = clocked(rpc);
      await t.pumpWidget(app(StreakCard(controller: c)));
      expect(find.text('3-day streak'), findsNothing, reason: 'nothing before the first load');
      await t.pump();
      await t.pump();
      expect(rpc.called('rewards_state'), hasLength(1));
      expect(find.text('3-day streak'), findsOneWidget);
      expect(find.text('Your streak ends in 2h 00m'), findsOneWidget);
      expect(find.text('50 coins in 4 more days'), findsOneWidget);
      expect(find.text('Best: 5  ·  Freezes: 1'), findsOneWidget);
    });

    testWidgets('done today, custom texts and theme colour', (t) async {
      final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleState(todayDone: true)}));
      await c.refresh();
      await t.pumpWidget(
        app(
          StreakCard(
            controller: c,
            texts: RewardsTexts(streakDays: (d) => '$d din', reward: (r) => '${r.amount} sikke'),
          ),
          theme: ThemeData(extensions: const [RewardsTheme(accent: Colors.pink)]),
        ),
      );
      expect(find.text('3 din'), findsOneWidget);
      expect(find.text('Done for today'), findsOneWidget);
      expect(find.text('50 sikke in 4 more days'), findsOneWidget);
      expect(t.widget<Icon>(find.byIcon(Icons.local_fire_department)).color, Colors.pink);
    });

    testWidgets('builder replaces the whole look', (t) async {
      final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleState()}));
      await c.refresh();
      await t.pumpWidget(app(StreakCard(controller: c, builder: (_, s, _) => Text('mine ${s.current}'))));
      expect(find.text('mine 3'), findsOneWidget);
      expect(find.byIcon(Icons.local_fire_department), findsNothing);
    });

    testWidgets('hidden when the engine is disabled or not deployed', (t) async {
      final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleState(enabled: false)}));
      await c.refresh();
      await t.pumpWidget(app(StreakCard(controller: c)));
      expect(find.byType(Text), findsNothing);
      final d = controllerOn(FakeRpc({'rewards_state': (_) => throw Exception('PGRST202')}));
      await d.refresh();
      await t.pumpWidget(app(StreakCard(controller: d)));
      expect(find.byType(Text), findsNothing);
    });
  });

  testWidgets('MilestoneProgress shows count, target, reward and title', (t) async {
    final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleState()}));
    await c.refresh();
    await t.pumpWidget(app(MilestoneProgress(controller: c, program: 'invite3', title: 'Invite 3 friends')));
    expect(find.text('Invite 3 friends'), findsOneWidget);
    expect(find.text('1 of 3  ·  "Connector" badge'), findsOneWidget);
    expect(t.widget<LinearProgressIndicator>(find.byType(LinearProgressIndicator)).value, closeTo(1 / 3, 1e-9));
  });

  group('OfferBanner', () {
    testWidgets('shows reward, real stock and time left; claim calls the server and hides it', (t) async {
      final rpc = FakeRpc({
        'rewards_state': (_) => sampleState(),
        'rewards_offer_claim': (_) => {
          'grants': [grant('o1', amount: 100)],
        },
      });
      final c = controllerOn(rpc);
      await c.refresh();
      var claimed = 0;
      await t.pumpWidget(app(OfferBanner(controller: c, program: 'welcome', onClaimed: () => claimed++)));
      expect(find.text('100 coins'), findsOneWidget);
      expect(find.text('12 left'), findsOneWidget);
      expect(find.text('Ends in 30m 00s'), findsOneWidget);
      await t.tap(find.text('Claim'));
      await t.pump();
      await t.pump();
      expect(rpc.called('rewards_offer_claim').single, {'program': 'welcome'});
      expect(claimed, 1);
      expect(find.text('Claim'), findsNothing);
    });

    testWidgets('sold out on claim: the default look hides it', (t) async {
      final rpc = FakeRpc({
        'rewards_state': (_) => sampleState(),
        'rewards_offer_claim': (_) => throw Exception('rewards: sold_out'),
      });
      final c = controllerOn(rpc);
      await c.refresh();
      await t.pumpWidget(app(OfferBanner(controller: c, program: 'welcome')));
      await t.tap(find.text('Claim'));
      await t.pump();
      await t.pump();
      expect(c.state.offer('welcome')!.status, OfferStatus.soldOut);
      expect(find.text('Claim'), findsNothing);
    });

    testWidgets('the deadline passing hides it without a server call', (t) async {
      final rpc = FakeRpc({'rewards_state': (_) => sampleState()});
      final (c, advance) = clocked(rpc);
      await c.refresh();
      await t.pumpWidget(app(OfferBanner(controller: c, program: 'welcome')));
      expect(find.text('Claim'), findsOneWidget);
      advance(const Duration(minutes: 31));
      await t.pump(const Duration(seconds: 1));
      await t.pump();
      expect(find.text('Claim'), findsNothing);
      expect(rpc.called('rewards_state'), hasLength(1));
    });

    testWidgets('builder gets every state', (t) async {
      final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleState(offerState: 'expired')}));
      await c.refresh();
      await t.pumpWidget(
        app(OfferBanner(controller: c, program: 'welcome', builder: (_, o, _) => Text(o.status.wire))),
      );
      expect(find.text('expired'), findsOneWidget);
    });
  });

  group('SocialTagTask', () {
    testWidgets('none: enter the username and get a code', (t) async {
      final rpc = FakeRpc({
        'rewards_state': (_) => sampleState(),
        'rewards_social_start': (_) => {
          'code': 'MYAPP-K7Q2HX',
          'account': 'myapp',
          'expires_at': iso(serverNow.add(const Duration(days: 7))),
        },
      });
      final c = controllerOn(rpc);
      await c.refresh();
      await t.pumpWidget(app(SocialTagTask(controller: c, program: 'ig_tag')));
      expect(find.text('Tag @myapp on Instagram'), findsOneWidget);
      expect(find.text('200 coins'), findsOneWidget);
      await t.enterText(find.byType(TextField), 'reader.one');
      await t.tap(find.text('Get my code'));
      await t.pump();
      await t.pump();
      expect(rpc.called('rewards_social_start').single, {'program': 'ig_tag', 'handle': 'reader.one'});
      expect(find.text('MYAPP-K7Q2HX'), findsOneWidget);
      expect(find.text('Say it is a rewarded post (for example #ad).'), findsOneWidget);
    });

    testWidgets('a refusal shows its line', (t) async {
      final rpc = FakeRpc({
        'rewards_state': (_) => sampleState(),
        'rewards_social_start': (_) => throw Exception('rewards: handle_taken'),
      });
      final c = controllerOn(rpc);
      await c.refresh();
      await t.pumpWidget(app(SocialTagTask(controller: c, program: 'ig_tag')));
      await t.enterText(find.byType(TextField), 'someone');
      await t.tap(find.text('Get my code'));
      await t.pump();
      await t.pump();
      expect(find.text('That username is already used for this reward.'), findsOneWidget);
    });

    testWidgets('pending: copy and open Instagram call the app, events have no code', (t) async {
      final events = <RewardsEvent>[];
      final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleState(socialState: 'pending')}), events: events);
      await c.refresh();
      String? copied;
      String? opened;
      await t.pumpWidget(
        app(
          SocialTagTask(
            controller: c,
            program: 'ig_tag',
            onCopy: (code) async => copied = code,
            onOpenInstagram: (a) => opened = a,
          ),
        ),
      );
      expect(find.text('We look for your post for 7d 0h'), findsOneWidget);
      await t.tap(find.text('Copy code'));
      await t.pump();
      expect(copied, 'MYAPP-K7Q2HX');
      expect(find.text('Code copied'), findsOneWidget);
      await t.tap(find.text('Open Instagram'));
      expect(opened, 'myapp');
      expect(
        events.map((e) => e.name),
        containsAll([RewardsEventName.socialCodeCopied, RewardsEventName.instagramOpened]),
      );
      expect(events.toString(), isNot(contains('MYAPP-K7Q2HX')));
    });

    testWidgets('default copy uses the system clipboard', (t) async {
      final calls = <MethodCall>[];
      t.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        calls.add(call);
        return null;
      });
      final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleState(socialState: 'pending')}));
      await c.refresh();
      await t.pumpWidget(app(SocialTagTask(controller: c, program: 'ig_tag')));
      expect(find.text('Open Instagram'), findsNothing, reason: 'hidden without onOpenInstagram');
      await t.tap(find.text('Copy code'));
      await t.pump();
      expect(
        calls.any((m) => m.method == 'Clipboard.setData' && (m.arguments as Map)['text'] == 'MYAPP-K7Q2HX'),
        isTrue,
      );
    });

    testWidgets('verified and rejected states', (t) async {
      final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleState(socialState: 'verified')}));
      await c.refresh();
      await t.pumpWidget(app(SocialTagTask(controller: c, program: 'ig_tag')));
      expect(find.text('Thanks for the post! Reward added.'), findsOneWidget);
      final r = controllerOn(FakeRpc({'rewards_state': (_) => sampleState(socialState: 'rejected')}));
      await r.refresh();
      await t.pumpWidget(app(SocialTagTask(controller: r, program: 'ig_tag')));
      expect(find.text('We could not match your post. You can try again.'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
    });
  });

  group('RewardInbox and RewardToastListener', () {
    testWidgets('granted items get Got it, pending ones On its way', (t) async {
      final rpc = FakeRpc({
        'rewards_state': (_) => sampleState(
          inbox: [
            grant('g1', amount: 50),
            grant('g2', state: 'queued', kind: 'entitlement_days', amount: 3),
          ],
        ),
        'rewards_mark_seen': (_) => 1,
      });
      final c = controllerOn(rpc);
      await c.refresh();
      await t.pumpWidget(app(RewardInbox(controller: c)));
      expect(find.text('You got 50 coins'), findsOneWidget);
      expect(find.text('You got 3 days of Premium'), findsOneWidget);
      expect(find.text('On its way'), findsOneWidget);
      await t.tap(find.text('Got it'));
      await t.pump();
      await t.pump();
      expect(find.text('You got 50 coins'), findsNothing);
    });

    testWidgets('toast listener shows a SnackBar for a new grant, or calls onGrant', (t) async {
      final rpc = FakeRpc({
        'rewards_state': (_) => sampleState(),
        'rewards_offer_claim': (_) => {
          'grants': [grant('o1', amount: 100)],
        },
      });
      final c = controllerOn(rpc);
      await c.refresh();
      await t.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: RewardToastListener(controller: c, child: const SizedBox()),
          ),
        ),
      );
      await c.claimOffer('welcome');
      await t.pump();
      await t.pump();
      expect(find.text('You got 100 coins'), findsOneWidget);

      final seen = <String>[];
      final d = controllerOn(rpc);
      await d.refresh();
      await t.pumpWidget(
        MaterialApp(
          home: RewardToastListener(controller: d, onGrant: (_, g) => seen.add(g.id), child: const SizedBox()),
        ),
      );
      await d.claimOffer('welcome');
      await t.pump();
      expect(seen, ['o1']);
    });
  });

  group('RewardsHub', () {
    testWidgets('one widget per live program, titles from public.title', (t) async {
      final c = controllerOn(
        FakeRpc({
          'rewards_state': (_) => sampleState(inbox: [grant('g1')]),
        }),
      );
      await c.refresh();
      await t.pumpWidget(
        MaterialApp(
          home: Scaffold(body: RewardsHub(controller: c)),
        ),
      );
      expect(find.byType(RewardInbox), findsOneWidget);
      expect(find.byType(StreakCard), findsOneWidget);
      expect(find.byType(MilestoneProgress), findsOneWidget);
      expect(find.byType(OfferBanner), findsOneWidget);
      expect(find.byType(SocialTagTask), findsOneWidget);
      expect(find.text('Invite 3 friends'), findsOneWidget);
    });

    testWidgets('programBuilders replace one program; scrollable false has no scroll view', (t) async {
      final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleState()}));
      await c.refresh();
      await t.pumpWidget(
        app(
          RewardsHub(controller: c, scrollable: false, programBuilders: {'daily': (_, p) => Text('custom ${p.key}')}),
        ),
      );
      expect(find.text('custom daily'), findsOneWidget);
      expect(find.byType(StreakCard), findsNothing);
      expect(find.byType(RefreshIndicator), findsNothing);
    });
  });
}
