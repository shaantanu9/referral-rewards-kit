import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';

Widget app(Widget child) => MaterialApp(
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

/// [sampleState] with the daily streak, the milestone, the programs and the choices changed.
Map<String, Object?> state({
  Map<String, Object?> streak = const {},
  Map<String, Object?> milestone = const {},
  Map<String, Object?> choices = const {},
  Map<String, Object?> milestonePublic = const {},
  List<Map<String, Object?>> extraPrograms = const [],
  Map<String, Object?> extra = const {},
}) {
  final s = sampleState();
  final st = Map<String, Object?>.of((s['streaks']! as List).first as Map<String, Object?>)..addAll(streak);
  final ms = Map<String, Object?>.of((s['milestones']! as List).first as Map<String, Object?>)..addAll(milestone);
  final programs = [
    for (final p in (s['programs']! as List).cast<Map<String, Object?>>())
      p['key'] == 'invite3' ? {...p, 'public': milestonePublic} : p,
    ...extraPrograms,
  ];
  return {
    ...s,
    'programs': programs,
    'streaks': [st],
    'milestones': [ms],
    'choices': choices,
    ...extra,
  };
}

Future<RewardsController> pumpWith(
  WidgetTester t,
  Map<String, Object?> json,
  Widget Function(RewardsController) w,
) async {
  final c = controllerOn(FakeRpc({'rewards_state': (_) => json}));
  await c.refresh();
  await t.pumpWidget(app(w(c)));
  return c;
}

void main() {
  group('streak choices', () {
    testWidgets('a hidden streak shows no StreakCard and no DailyGoalRing', (t) async {
      await pumpWith(
        t,
        state(streak: {'hidden': true}),
        (c) => Column(
          children: [
            StreakCard(controller: c),
            DailyGoalRing(controller: c),
          ],
        ),
      );
      expect(find.text('3-day streak'), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });

    testWidgets('streaks_off hides the card even before the server marks it hidden', (t) async {
      await pumpWith(t, state(choices: {'streaks_off': true}), (c) => StreakCard(controller: c));
      expect(find.text('3-day streak'), findsNothing);
    });

    testWidgets('an older server (no choices, no hidden) shows the card as before', (t) async {
      await pumpWith(t, state(), (c) => StreakCard(controller: c));
      expect(find.text('3-day streak'), findsOneWidget);
      expect(find.text('Your streak ends in 2h 00m'), findsOneWidget);
    });
  });

  group('timers_off', () {
    testWidgets('no at-risk countdown on the streak card; the plain line in its place', (t) async {
      await pumpWith(t, state(choices: {'timers_off': true}), (c) => StreakCard(controller: c));
      expect(find.textContaining('ends in'), findsNothing);
      expect(find.text('Keep your streak: do it today'), findsOneWidget);
    });

    testWidgets('no offer countdown, the offer itself still shows', (t) async {
      await pumpWith(t, state(choices: {'timers_off': true}), (c) => OfferBanner(controller: c, program: 'welcome'));
      expect(find.text('100 coins'), findsOneWidget);
      expect(find.textContaining('Ends in'), findsNothing);
    });

    testWidgets('timers on: the offer countdown shows', (t) async {
      await pumpWith(t, state(), (c) => OfferBanner(controller: c, program: 'welcome'));
      expect(find.text('Ends in 30m 00s'), findsOneWidget);
    });

    testWidgets('an open window shows only its name; a coming one shows nothing', (t) async {
      Map<String, Object?> win(bool open) => state(
        choices: {'timers_off': true},
        extraPrograms: [
          {'key': 'hh', 'kind': 'window', 'public': {}},
        ],
        extra: {
          'windows': [
            {
              'program': 'hh',
              'starts_at': iso(serverNow.add(Duration(hours: open ? -1 : 1))),
              'ends_at': iso(serverNow.add(const Duration(hours: 2))),
            },
          ],
        },
      );
      await pumpWith(t, win(true), (c) => WindowBadge(controller: c, program: 'hh'));
      expect(find.text('Happy hour'), findsOneWidget);
      expect(find.textContaining('ends in'), findsNothing);
      await pumpWith(t, win(false), (c) => WindowBadge(controller: c, program: 'hh', key: const ValueKey(2)));
      expect(find.textContaining('Happy hour'), findsNothing);
    });

    testWidgets('Countdown(hidden) shows nothing and still fires onExpired', (t) async {
      var now = serverNow;
      var fired = 0;
      await t.pumpWidget(
        app(
          Countdown(
            endsAt: serverNow.add(const Duration(seconds: 2)),
            clock: ServerClock(local: () => now),
            prefix: 'Ends in',
            hidden: true,
            onExpired: () => fired++,
          ),
        ),
      );
      expect(find.byType(Text), findsNothing);
      now = now.add(const Duration(seconds: 3));
      await t.pump(const Duration(seconds: 1));
      await t.pump();
      expect(fired, 1);
    });
  });

  group('streak repair and personal best', () {
    final repair = {
      'current': 1,
      'repair': {'restores_to': 20, 'until': iso(serverNow.add(const Duration(hours: 5))), 'needed': 2, 'done': 1},
    };

    testWidgets('the repair line and its deadline', (t) async {
      await pumpWith(t, state(streak: repair), (c) => StreakCard(controller: c));
      expect(find.text('Do 1 more today to bring back your 20-day streak'), findsOneWidget);
      expect(find.text('Ends in 5h 00m'), findsOneWidget);
    });

    testWidgets('timers off: the repair line without a time', (t) async {
      await pumpWith(t, state(streak: repair, choices: {'timers_off': true}), (c) => StreakCard(controller: c));
      expect(find.text('Do 1 more today to bring back your 20-day streak'), findsOneWidget);
      expect(find.textContaining('Ends in'), findsNothing);
    });

    testWidgets('the day it came back says so', (t) async {
      await pumpWith(
        t,
        state(streak: {'current': 21, 'repaired_at': iso(serverNow.subtract(const Duration(minutes: 5)))}),
        (c) => StreakCard(controller: c),
      );
      expect(find.text('Your 21-day streak is back'), findsOneWidget);
    });

    testWidgets('a record day shows the personal best chip; other days do not', (t) async {
      await pumpWith(t, state(streak: {'best_day_count': 4, 'record_today': true}), (c) => StreakCard(controller: c));
      expect(find.text('New personal best: 4 today'), findsOneWidget);
      await pumpWith(t, state(streak: {'best_day_count': 4}), (c) => StreakCard(controller: c, key: const ValueKey(2)));
      expect(find.textContaining('personal best'), findsNothing);
    });
  });

  group('milestone head start and level', () {
    testWidgets('the head start with the program label, and the level line', (t) async {
      await pumpWith(
        t,
        state(
          milestone: {
            'count': 2,
            'head_start': 2,
            'level': {'number': 3, 'name': 'Explorer', 'at': 2, 'next_at': 5},
          },
          milestonePublic: {'head_start_label': 'a head start from us'},
        ),
        (c) => MilestoneProgress(controller: c, program: 'invite3'),
      );
      expect(find.text('2 of 3  ·  "Connector" badge'), findsOneWidget);
      expect(find.text('a head start from us'), findsOneWidget);
      expect(find.text('Level 3 · Explorer'), findsOneWidget);
      expect(find.text('2 of 5 to the next level'), findsOneWidget);
    });

    testWidgets('no label: the default head start line; no level: no level line', (t) async {
      await pumpWith(
        t,
        state(milestone: {'count': 2, 'head_start': 2}),
        (c) => MilestoneProgress(controller: c, program: 'invite3'),
      );
      expect(find.text('Includes a head start of 2 from us'), findsOneWidget);
      expect(find.textContaining('Level'), findsNothing);
    });

    testWidgets('an older server: no head start line', (t) async {
      await pumpWith(t, state(), (c) => MilestoneProgress(controller: c, program: 'invite3'));
      expect(find.textContaining('head start'), findsNothing);
    });
  });

  group('surprises_off', () {
    final mystery = {
      'next_reward': {
        'threshold': 7,
        'kind': 'mystery',
        'odds': [
          {'kind': 'coins', 'amount': 10, 'chance': 0.8},
          {'kind': 'coins', 'amount': 100, 'chance': 0.2},
        ],
      },
    };
    final surprises = {
      'surprises': [
        {'program': 'daily', 'kind': 'coins', 'amount': 50, 'chance': 0.1},
      ],
    };

    testWidgets('a mystery next reward is named by what it gives, with no odds', (t) async {
      await pumpWith(t, state(streak: mystery, choices: {'surprises_off': true}), (c) => StreakCard(controller: c));
      expect(find.text('10 coins in 4 more days'), findsOneWidget);
      expect(find.text('What it can be'), findsNothing);
    });

    testWidgets('surprises on: the mystery and its odds as before', (t) async {
      await pumpWith(t, state(streak: mystery), (c) => StreakCard(controller: c));
      expect(find.text('a mystery reward in 4 more days'), findsOneWidget);
      expect(find.text('What it can be'), findsOneWidget);
    });

    testWidgets('SurpriseOdds and the hub odds card are hidden', (t) async {
      await pumpWith(t, state(extra: surprises, choices: {'surprises_off': true}), (c) => SurpriseOdds(controller: c));
      expect(find.text('Surprises'), findsNothing);
      await pumpWith(
        t,
        state(extra: surprises, choices: {'surprises_off': true}),
        (c) => RewardsHub(controller: c, scrollable: false),
      );
      expect(find.byType(SurpriseOdds), findsNothing);
      await pumpWith(t, state(extra: surprises), (c) => SurpriseOdds(controller: c, key: const ValueKey(3)));
      expect(find.text('Surprises'), findsOneWidget);
    });
  });
}
