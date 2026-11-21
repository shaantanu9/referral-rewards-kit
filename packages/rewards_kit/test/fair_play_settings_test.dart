import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';

void main() {
  group('FollowupSettings choices', () {
    late FakeRpc rpc;
    late Map<String, Object?> server;

    setUp(() {
      server = {'notifications_off': false, 'emails_off': false, 'streaks_off': false, 'timers_off': true};
      rpc = FakeRpc({
        'rewards_followup_prefs': (p) {
          server.addAll(p['patch']! as Map<String, Object?>);
          return {...server};
        },
        'rewards_state': (_) => {...sampleState(), 'choices': server},
      });
    });

    List<Object?> patches() => [for (final p in rpc.called('rewards_followup_prefs')) p['patch']];
    bool on(WidgetTester t, String label) => t
        .widget<Switch>(find.descendant(of: find.widgetWithText(SwitchListTile, label), matching: find.byType(Switch)))
        .value;

    Future<RewardsController> pump(WidgetTester t, {bool showChoices = true, RewardsTexts? texts}) async {
      final c = controllerOn(rpc);
      await c.refresh();
      await t.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FollowupSettings(controller: c, showChoices: showChoices, texts: texts ?? const RewardsTexts()),
            ),
          ),
        ),
      );
      await t.pump();
      await t.pump();
      return c;
    }

    testWidgets('off by default: the card is as before', (t) async {
      await pump(t, showChoices: false);
      expect(find.text('Show streaks'), findsNothing);
      expect(find.text('How rewards look'), findsNothing);
    });

    testWidgets('three switches show what the server holds', (t) async {
      await pump(t);
      expect(find.text('How rewards look'), findsOneWidget);
      expect(on(t, 'Show streaks'), isTrue);
      expect(on(t, 'Surprise rewards'), isTrue);
      expect(on(t, 'Show timers'), isFalse);
    });

    testWidgets('a toggle saves the inverted key and applies it to the controller', (t) async {
      final c = await pump(t);
      expect(c.state.choices.streaksOff, isFalse);
      await t.tap(find.text('Show streaks'));
      await t.pump();
      await t.pump();
      expect(patches().last, {'streaks_off': true});
      expect(on(t, 'Show streaks'), isFalse);
      expect(c.state.choices.streaksOff, isTrue);
      await t.tap(find.text('Surprise rewards'));
      await t.pump();
      await t.tap(find.text('Show timers'));
      await t.pump();
      expect(patches().skip(2), [
        {'surprises_off': true},
        {'timers_off': false},
      ]);
    });

    testWidgets('strings come from RewardsTexts.fairPlay', (t) async {
      await pump(
        t,
        texts: const RewardsTexts(
          fairPlay: FairPlayTexts(choicesTitle: 'Your way', showStreaks: 'Streaks', showTimers: 'Clocks'),
        ),
      );
      expect(find.text('Your way'), findsOneWidget);
      expect(find.text('Streaks'), findsOneWidget);
      expect(find.text('Clocks'), findsOneWidget);
    });
  });

  group('fixed grants', () {
    RewardGrant fixed() => RewardGrant.fromJson({
      'id': 'g1',
      'program': 'daily',
      'kind': 'coins',
      'amount': 25,
      'params': {
        'range': [0, 50],
        'fixed': true,
      },
    });

    testWidgets('RewardReveal shows a fixed grant plainly, no gift, opened once', (t) async {
      var opened = 0;
      final events = <RewardsEvent>[];
      await t.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: RewardReveal(grant: fixed(), onOpened: () => opened++, onEvent: events.add),
          ),
        ),
      );
      expect(find.text('You got 25 coins'), findsOneWidget);
      expect(find.text('Surprise!'), findsNothing);
      expect(find.text('Open'), findsNothing);
      await t.pump();
      expect(opened, 1);
      expect(events.single.name, RewardsEventName.revealOpened);
    });

    testWidgets('RewardToastListener shows a fixed grant as a toast, not the reveal dialog', (t) async {
      final rpc = FakeRpc({
        'rewards_state': (_) => sampleState(
          inbox: [
            {
              'id': 'g1',
              'program': 'daily',
              'kind': 'coins',
              'amount': 25,
              'params': {'surprise': true, 'fixed': true},
              'state': 'granted',
            },
          ],
        ),
      });
      final c = controllerOn(rpc);
      await t.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: RewardToastListener(controller: c, child: const SizedBox()),
          ),
        ),
      );
      await c.refresh();
      await t.pump();
      expect(find.byType(Dialog), findsNothing);
      expect(find.text('You got 25 coins'), findsOneWidget);
    });
  });
}
