import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';
import 'fakes_v2.dart';

Widget app(Widget child) => MaterialApp(
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

Future<RewardsController> loaded(FakeRpc rpc, {DateTime Function()? local}) async {
  rpc.handlers['rewards_state'] ??= (_) => sampleStateV2();
  final c = controllerOn(rpc, local: local);
  await c.refresh();
  return c;
}

void main() {
  testWidgets('QuestList: tasks, progress, rewards, bonus, reset countdown; builder', (t) async {
    final c = await loaded(FakeRpc());
    await t.pumpWidget(app(QuestList(controller: c, program: 'daily_quests')));
    expect(find.text('Quests'), findsOneWidget);
    expect(find.text('Read'), findsOneWidget);
    expect(find.text('5 coins'), findsOneWidget);
    expect(find.text('1 of 1'), findsOneWidget);
    expect(find.text('Finish all for 20 coins'), findsOneWidget);
    expect(find.text('Resets in 14h 00m'), findsOneWidget);
    expect(find.byIcon(Icons.check_circle), findsOneWidget);
    await t.pumpWidget(
      app(QuestList(controller: c, program: 'daily_quests', builder: (_, q, _) => Text('done ${q.doneCount}'))),
    );
    expect(find.text('done 1'), findsOneWidget);
  });

  testWidgets('RechargeMeter: units, next-in countdown, use; empty refusal; builder', (t) async {
    final rpc = FakeRpc({'rewards_recharge_use': (_) => throw Exception('rewards: empty')});
    final c = await loaded(rpc);
    await t.pumpWidget(app(RechargeMeter(controller: c, program: 'hearts', showUseButton: true)));
    expect(find.byIcon(Icons.favorite), findsNWidgets(2));
    expect(find.byIcon(Icons.favorite_border), findsOneWidget);
    expect(find.text('Next in 1h 05m'), findsOneWidget);
    await t.tap(find.text('Use one'));
    await t.pump();
    await t.pump();
    expect(find.text('None left. More come back soon.'), findsOneWidget);
    expect(find.byIcon(Icons.favorite), findsNothing);
    await t.pumpWidget(
      app(RechargeMeter(controller: c, program: 'hearts', builder: (_, r, _) => Text('${r.units}/${r.max}'))),
    );
    expect(find.text('0/3'), findsOneWidget);
  });

  testWidgets('RechargeMeter full says Full and has no countdown', (t) async {
    final c = await loaded(FakeRpc({'rewards_state': (_) => sampleStateV2(rechargeUnits: 3)}));
    await t.pumpWidget(app(RechargeMeter(controller: c, program: 'hearts')));
    expect(find.text('Full'), findsOneWidget);
  });

  testWidgets('WindowBadge: ends in while open, starts in before; refreshes at the edge; builder', (t) async {
    var now = serverNow;
    var states = 0;
    final rpc = FakeRpc({
      'rewards_state': (_) {
        states++;
        return sampleStateV2();
      },
    });
    final c = await loaded(rpc, local: () => now);
    await t.pumpWidget(app(WindowBadge(controller: c, program: 'happy')));
    expect(find.text('Happy hour: ends in 50m 00s'), findsOneWidget);
    now = now.add(const Duration(minutes: 51));
    await t.pump(const Duration(seconds: 1));
    await t.pump();
    expect(states, 2, reason: 'reloaded for the next window');

    final d = await loaded(FakeRpc({'rewards_state': (_) => sampleStateV2(windowActive: false)}));
    await t.pumpWidget(app(WindowBadge(controller: d, program: 'happy', title: 'Double coins')));
    expect(find.text('Double coins: starts in 2h 00m'), findsOneWidget);
    await t.pumpWidget(app(WindowBadge(controller: d, program: 'happy', builder: (_, w, open) => Text('open $open'))));
    expect(find.text('open false'), findsOneWidget);
  });

  group('FriendStreaks', () {
    testWidgets('lists friends; invite goes to the share callback; accept and remove', (t) async {
      final rpc = FakeRpc({
        'rewards_friend_invite': (_) => {'code': 'FAB12CDE'},
        'rewards_friend_accept': (_) => throw Exception('rewards: bad_code'),
        'rewards_friend_remove': (_) => true,
      });
      final c = await loaded(rpc);
      final shared = <String>[];
      await t.pumpWidget(app(FriendStreaks(controller: c, program: 'buddies', onShareInvite: shared.add)));
      expect(find.text('Asha  ·  4 days together'), findsOneWidget);
      expect(find.text('Waiting for Asha'), findsOneWidget);
      await t.tap(find.text('Invite a friend'));
      await t.pump();
      await t.pump();
      expect(shared, ['FAB12CDE']);
      expect(find.text('FAB12CDE'), findsNothing, reason: 'shared, not shown');
      await t.enterText(find.byType(TextField), 'fzzzz');
      await t.tap(find.text('Add'));
      await t.pump();
      await t.pump();
      expect(rpc.called('rewards_friend_accept').single, {'code': 'FZZZZ'});
      expect(find.text('That code does not work. Check it and try again.'), findsOneWidget);
      await t.tap(find.text('End streak'));
      await t.pump();
      await t.pump();
      expect(rpc.called('rewards_friend_remove').single, {'pair_id': 'p1'});
    });

    testWidgets('no share callback: the code is shown; empty list; builder', (t) async {
      final c = await loaded(
        FakeRpc({
          'rewards_state': (_) => sampleStateV2(friends: []),
          'rewards_friend_invite': (_) => {'code': 'FAB12CDE'},
        }),
      );
      await t.pumpWidget(app(FriendStreaks(controller: c, program: 'buddies')));
      expect(find.text('Keep a streak going with a friend.'), findsOneWidget);
      await t.tap(find.text('Invite a friend'));
      await t.pump();
      await t.pump();
      expect(find.text('FAB12CDE'), findsOneWidget);
      await t.pumpWidget(
        app(FriendStreaks(controller: c, program: 'buddies', builder: (_, f, _) => Text('friends ${f.length}'))),
      );
      expect(find.text('friends 0'), findsOneWidget);
    });
  });

  group('ActivityHeatmap', () {
    testWidgets('loads history itself; weeks × 7 cells; today outlined; frozen striped', (t) async {
      final rpc = FakeRpc({'rewards_history': (_) => historyJson()});
      final c = await loaded(rpc);
      final seen = <(String, int, bool)>[];
      await t.pumpWidget(
        app(
          ActivityHeatmap(
            controller: c,
            weeks: 2,
            cellBuilder: (_, d, level, today) {
              seen.add((formatDay(d.day), level, today));
              return const SizedBox();
            },
          ),
        ),
      );
      await t.pump();
      await t.pump();
      expect(rpc.called('rewards_history').single, {'program': null, 'weeks': 2});
      expect(seen, hasLength(14));
      expect(seen.where((s) => s.$3).single.$1, '2026-11-14');
      // count = i % 4 with goal 2 → levels 0,1,2,2 repeating backwards from today (i = 0 today).
      expect(seen.last, ('2026-11-14', 0, true));

      await t.pumpWidget(app(ActivityHeatmap(controller: c, weeks: 2)));
      expect(find.byKey(const ValueKey('heatmap-frozen')), findsOneWidget);
      expect(find.text('Less'), findsOneWidget);
      final outlined = t
          .widgetList<Container>(find.byType(Container))
          .where((w) => (w.decoration as BoxDecoration?)?.border != null);
      expect(outlined, hasLength(1));
    });

    testWidgets('builder gets the history', (t) async {
      final c = await loaded(FakeRpc({'rewards_history': (_) => historyJson(weeks: 3)}));
      await c.loadHistory();
      await t.pumpWidget(app(ActivityHeatmap(controller: c, builder: (_, h) => Text('${h.days.length} days'))));
      expect(find.text('21 days'), findsOneWidget);
    });
  });

  testWidgets('DailyGoalRing: count of goal, check when done; builder', (t) async {
    final c = await loaded(FakeRpc());
    await t.pumpWidget(app(DailyGoalRing(controller: c)));
    expect(find.text('1/2'), findsOneWidget);
    expect(t.widget<CircularProgressIndicator>(find.byType(CircularProgressIndicator)).value, 0.5);
    final d = await loaded(FakeRpc({'rewards_state': (_) => sampleState(todayDone: true)}));
    await t.pumpWidget(app(DailyGoalRing(controller: d, program: 'daily')));
    expect(find.byIcon(Icons.check), findsOneWidget);
    await t.pumpWidget(app(DailyGoalRing(controller: c, builder: (_, s) => Text('goal ${s.dailyGoal}'))));
    expect(find.text('goal 2'), findsOneWidget);
  });

  testWidgets('MysteryOdds shows every chance as a percentage; inside StreakCard; builder', (t) async {
    const odds = [
      MysteryOdd(kind: 'coins', amount: 10, chance: 0.7),
      MysteryOdd(kind: 'coins', amount: 100, chance: 0.295),
      MysteryOdd(kind: 'streak_freeze', amount: 1, chance: 0.005),
    ];
    await t.pumpWidget(
      app(
        const MysteryOdds(
          reward: RewardSpec(kind: 'mystery', odds: odds),
        ),
      ),
    );
    expect(find.text('What it can be'), findsOneWidget);
    expect(find.text('70%'), findsOneWidget);
    expect(find.text('30%'), findsOneWidget);
    expect(find.text('0.5%'), findsOneWidget);
    expect(find.text('1 streak freeze'), findsOneWidget);
    await t.pumpWidget(app(const MysteryOdds(reward: RewardSpec(kind: 'coins'))));
    expect(find.byType(Text), findsNothing);
    await t.pumpWidget(
      app(
        MysteryOdds(
          reward: const RewardSpec(kind: 'mystery', odds: odds),
          builder: (_, o) => Text('${o.length}'),
        ),
      ),
    );
    expect(find.text('3'), findsOneWidget);

    final s = sampleState();
    ((s['streaks'] as List).first as Map)['next_reward'] = {
      'threshold': 7,
      'kind': 'mystery',
      'amount': 1,
      'odds': [
        {'kind': 'coins', 'amount': 10, 'chance': 0.5},
        {'kind': 'coins', 'amount': 20, 'chance': 0.5},
      ],
    };
    final c = await loaded(FakeRpc({'rewards_state': (_) => s}));
    await t.pumpWidget(app(StreakCard(controller: c)));
    expect(find.text('a mystery reward in 4 more days'), findsOneWidget);
    expect(find.text('50%'), findsNWidgets(2));
  });

  testWidgets('RecapCard loads itself and shows totals; builder', (t) async {
    final rpc = FakeRpc({
      'rewards_recap': (_) => {
        'days_active': 5,
        'best_streak': 6,
        'events': [
          {'type': 'chapter_read', 'count': 9},
        ],
        'grants': [
          {'kind': 'coins', 'amount': 120, 'count': 4},
        ],
        'badges': ['bookworm'],
      },
    });
    final c = await loaded(rpc);
    final from = DateTime(2026, 11, 8), to = DateTime(2026, 11, 14);
    await t.pumpWidget(app(RecapCard(controller: c, from: from, to: to)));
    await t.pump();
    await t.pump();
    expect(rpc.called('rewards_recap').single, {'from_day': '2026-11-08', 'to_day': '2026-11-14'});
    expect(find.text('5 days active'), findsOneWidget);
    expect(find.text('Best streak: 6 days'), findsOneWidget);
    expect(find.text('120 coins'), findsOneWidget);
    expect(find.text('Chapter read: 9'), findsOneWidget);
    expect(find.text('"Bookworm" badge'), findsOneWidget);
    await t.pumpWidget(app(RecapCard(controller: c, from: from, to: to, builder: (_, r) => Text('${r.daysActive}'))));
    expect(find.text('5'), findsOneWidget);
    expect(rpc.called('rewards_recap'), hasLength(1), reason: 'cached');
  });
}
