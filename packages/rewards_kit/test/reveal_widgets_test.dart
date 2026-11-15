import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';

RewardGrant surprise(String id, {num amount = 23, String program = 'reader'}) => RewardGrant.fromJson({
  'id': id,
  'program': program,
  'kind': 'coins',
  'amount': amount,
  'params': {
    'surprise': true,
    'range': [5, 50],
  },
});

Widget app(Widget child, {bool reduceMotion = false}) => MaterialApp(
  home: Builder(
    builder: (context) => MediaQuery(
      data: MediaQuery.of(context).copyWith(disableAnimations: reduceMotion),
      child: Scaffold(body: Center(child: child)),
    ),
  ),
);

/// Records platform calls (haptics go through `SystemChannels.platform`).
List<MethodCall> recordPlatform(WidgetTester t) {
  final calls = <MethodCall>[];
  t.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
    calls.add(call);
    return null;
  });
  addTearDown(() => t.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
  return calls;
}

bool isHaptic(MethodCall c) => c.method == 'HapticFeedback.vibrate' && c.arguments == 'HapticFeedbackType.mediumImpact';

const surpriseState = [
  {
    'program': 'reader',
    'kind': 'coins',
    'amount': 50,
    'amount_range': [5, 50],
    'chance': 0.1,
    'params': {},
  },
  {'program': 'daily', 'kind': 'minutes', 'amount': 10, 'chance': 0.35, 'params': {}},
];

void main() {
  group('RewardReveal', () {
    testWidgets('closed → tap → shake → opened; haptic; onOpened and the event once; no near-miss', (t) async {
      final platform = recordPlatform(t);
      final events = <RewardsEvent>[];
      var opened = 0;
      await t.pumpWidget(app(RewardReveal(grant: surprise('a'), onOpened: () => opened++, onEvent: events.add)));
      expect(find.text('Surprise!'), findsOneWidget);
      expect(find.text('Tap to open'), findsOneWidget);
      expect(find.text('You got 23 coins'), findsNothing);

      await t.tap(find.text('Tap to open'));
      await t.pump();
      expect(platform.where(isHaptic), hasLength(1));
      await t.pump(const Duration(milliseconds: 300));
      expect(find.text('Surprise!'), findsOneWidget, reason: 'still shaking');
      expect(opened, 0);
      await t.tap(find.text('Open'), warnIfMissed: false);
      await t.pump(const Duration(milliseconds: 320));
      await t.pumpAndSettle();
      expect(find.text('You got 23 coins'), findsOneWidget);
      expect(find.text('Surprise!'), findsNothing);
      expect(opened, 1);
      expect(platform.where(isHaptic), hasLength(1), reason: 'a second tap while opening does nothing');
      expect(events.map((e) => e.name), [RewardsEventName.revealOpened]);
      expect(events.single.props, {'program': 'reader', 'kind': 'coins'});
      for (final w in ['almost', 'Almost', 'close', '50']) {
        expect(find.textContaining(w), findsNothing, reason: 'never a near miss: $w');
      }
    });

    testWidgets('the Open button opens it too', (t) async {
      recordPlatform(t);
      await t.pumpWidget(app(RewardReveal(grant: surprise('a'))));
      await t.tap(find.text('Open'));
      await t.pumpAndSettle();
      expect(find.text('You got 23 coins'), findsOneWidget);
    });

    testWidgets('reduced motion opens at once, with the haptic and no animation', (t) async {
      final platform = recordPlatform(t);
      var opened = 0;
      await t.pumpWidget(app(RewardReveal(grant: surprise('a'), onOpened: () => opened++), reduceMotion: true));
      await t.tap(find.text('Tap to open'));
      await t.pump();
      expect(find.text('You got 23 coins'), findsOneWidget);
      expect(opened, 1);
      expect(platform.where(isHaptic), hasLength(1));
      expect(t.binding.hasScheduledFrame, isFalse, reason: 'nothing is animating');
    });

    testWidgets('autoOpen opens by itself', (t) async {
      recordPlatform(t);
      var opened = 0;
      await t.pumpWidget(app(RewardReveal(grant: surprise('a'), autoOpen: true, onOpened: () => opened++)));
      await t.pumpAndSettle();
      expect(find.text('You got 23 coins'), findsOneWidget);
      expect(opened, 1);
    });

    testWidgets('builder replaces the look; open still fires once', (t) async {
      final platform = recordPlatform(t);
      var opened = 0;
      await t.pumpWidget(
        app(
          RewardReveal(
            grant: surprise('a'),
            onOpened: () => opened++,
            builder: (context, g, isOpen, open) =>
                TextButton(onPressed: open, child: Text(isOpen ? 'mine ${g.amount}' : 'mine closed')),
          ),
        ),
      );
      expect(find.text('Surprise!'), findsNothing);
      await t.tap(find.text('mine closed'));
      await t.pump();
      expect(find.text('mine 23'), findsOneWidget);
      await t.tap(find.text('mine 23'));
      await t.pump();
      expect(opened, 1);
      expect(platform.where(isHaptic), hasLength(1));
    });

    testWidgets('texts are overridable', (t) async {
      recordPlatform(t);
      await t.pumpWidget(
        app(
          RewardReveal(
            grant: surprise('a'),
            texts: RewardsTexts(
              reveal: RevealTexts(title: 'Bonus!', youGot: (r) => '+$r'),
            ),
          ),
          reduceMotion: true,
        ),
      );
      expect(find.text('Bonus!'), findsOneWidget);
      await t.tap(find.text('Open'));
      await t.pump();
      expect(find.text('+23 coins'), findsOneWidget);
    });
  });

  testWidgets('showRewardReveal: a dialog, Close then Nice!, completes when closed', (t) async {
    recordPlatform(t);
    var done = false;
    var opened = 0;
    await t.pumpWidget(
      app(
        Builder(
          builder: (context) => TextButton(
            onPressed: () async {
              await showRewardReveal(context, surprise('a'), onOpened: () => opened++);
              done = true;
            },
            child: const Text('go'),
          ),
        ),
      ),
    );
    await t.tap(find.text('go'));
    await t.pumpAndSettle();
    expect(find.byType(Dialog), findsOneWidget);
    expect(find.text('Close'), findsOneWidget);
    await t.tap(find.text('Tap to open'));
    await t.pumpAndSettle();
    expect(find.text('You got 23 coins'), findsOneWidget);
    expect(find.text('Close'), findsNothing);
    expect(done, isFalse);
    await t.tap(find.text('Nice!'));
    await t.pumpAndSettle();
    expect(find.byType(Dialog), findsNothing);
    expect(done, isTrue);
    expect(opened, 1);
  });

  group('RewardToastListener reveals', () {
    Future<RewardsController> pumpListener(
      WidgetTester t, {
      bool reveal = true,
      bool hold = false,
      void Function(BuildContext, RewardGrant)? onGrant,
      List<RewardsEvent>? events,
    }) async {
      final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleState()}), events: events);
      await c.refresh();
      await t.pumpWidget(
        MaterialApp(
          home: RewardToastListener(
            controller: c,
            revealSurprises: reveal,
            holdUntilMoment: hold,
            onGrant: onGrant,
            child: const Scaffold(body: SizedBox()),
          ),
        ),
      );
      return c;
    }

    testWidgets('surprises open the reveal one at a time; plain grants keep the snackbar', (t) async {
      recordPlatform(t);
      final events = <RewardsEvent>[];
      final c = await pumpListener(t, events: events);
      c.applyGrants([surprise('s1', amount: 7), RewardGrant.fromJson(grant('p1')), surprise('s2', amount: 41)]);
      await t.pumpAndSettle();
      expect(find.byType(Dialog), findsOneWidget, reason: 'one at a time');
      expect(find.text('You got 10 coins'), findsOneWidget, reason: 'the plain grant is a snackbar');
      await t.tap(find.text('Tap to open'));
      await t.pumpAndSettle();
      expect(find.text('You got 7 coins'), findsOneWidget);
      await t.tap(find.text('Nice!'));
      await t.pumpAndSettle();
      expect(find.byType(Dialog), findsOneWidget, reason: 'the queued one');
      await t.tap(find.text('Tap to open'));
      await t.pumpAndSettle();
      expect(find.text('You got 41 coins'), findsOneWidget);
      await t.tap(find.text('Nice!'));
      await t.pumpAndSettle();
      expect(find.byType(Dialog), findsNothing);
      expect(events.where((e) => e.name == RewardsEventName.revealOpened), hasLength(2));
    });

    testWidgets('revealSurprises false keeps the snackbar', (t) async {
      final c = await pumpListener(t, reveal: false);
      c.applyGrants([surprise('s1', amount: 7)]);
      await t.pump();
      expect(find.byType(Dialog), findsNothing);
      expect(find.text('You got 7 coins'), findsOneWidget);
    });

    testWidgets('holdUntilMoment holds the reveal until celebrateNow', (t) async {
      recordPlatform(t);
      final c = await pumpListener(t, hold: true);
      c.applyGrants([surprise('s1', amount: 7)]);
      await t.pumpAndSettle();
      expect(find.byType(Dialog), findsNothing);
      c.celebrateNow();
      await t.pumpAndSettle();
      expect(find.byType(Dialog), findsOneWidget);
    });

    testWidgets('onGrant still overrides everything', (t) async {
      final seen = <String>[];
      final c = await pumpListener(t, onGrant: (_, g) => seen.add(g.id));
      c.applyGrants([surprise('s1')]);
      await t.pumpAndSettle();
      expect(seen, ['s1']);
      expect(find.byType(Dialog), findsNothing);
    });
  });

  group('SurpriseOdds', () {
    Future<RewardsController> loaded() async {
      final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleState()..['surprises'] = surpriseState}));
      await c.refresh();
      return c;
    }

    testWidgets('lists every odds line; filtered by program; builder; nothing when none', (t) async {
      final c = await loaded();
      await t.pumpWidget(app(SurpriseOdds(controller: c)));
      expect(find.text('Surprises'), findsOneWidget);
      expect(find.text('1 in 10 chance of 5–50 coins'), findsOneWidget);
      expect(find.text('35 % chance of 10 minutes'), findsOneWidget);

      await t.pumpWidget(app(SurpriseOdds(controller: c, program: 'daily', title: 'Bonus odds')));
      expect(find.text('Bonus odds'), findsOneWidget);
      expect(find.text('1 in 10 chance of 5–50 coins'), findsNothing);
      expect(find.text('35 % chance of 10 minutes'), findsOneWidget);

      await t.pumpWidget(app(SurpriseOdds(controller: c, builder: (context, list) => Text('mine ${list.length}'))));
      expect(find.text('mine 2'), findsOneWidget);

      await t.pumpWidget(app(SurpriseOdds(controller: c, program: 'nope')));
      expect(find.text('Surprises'), findsNothing);
    });

    testWidgets('RewardsHub shows one Surprises card under the inbox; showSurprises false hides it', (t) async {
      final c = await loaded();
      await t.pumpWidget(
        MaterialApp(
          home: Scaffold(body: RewardsHub(controller: c)),
        ),
      );
      expect(find.byType(SurpriseOdds), findsOneWidget);
      expect(find.text('1 in 10 chance of 5–50 coins'), findsOneWidget);
      await t.pumpWidget(
        MaterialApp(
          home: Scaffold(body: RewardsHub(controller: c, showSurprises: false)),
        ),
      );
      expect(find.byType(SurpriseOdds), findsNothing);

      final plain = controllerOn(FakeRpc({'rewards_state': (_) => sampleState()}));
      await plain.refresh();
      await t.pumpWidget(
        MaterialApp(
          home: Scaffold(body: RewardsHub(controller: plain)),
        ),
      );
      expect(find.byType(SurpriseOdds), findsNothing);
    });
  });
}
