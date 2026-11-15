import 'package:flutter/material.dart' hide Badge;
import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';

Widget app(Widget child) => MaterialApp(
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

Map<String, Object?> sampleLeague({bool joined = true, bool live = true, Map<String, Object?>? lastWeek}) => {
  'program': 'weekly',
  'live': live,
  'joined': joined,
  'tier': 0,
  'tier_name': 'Bronze',
  'tiers': ['Bronze', 'Silver', '', 7],
  'week': '2026-11-09',
  'starts_at': '2026-11-09T00:00:00+00:00',
  'ends_at': iso(serverNow.add(const Duration(days: 2, hours: 3))),
  'server_time': iso(serverNow),
  'group_size': 20,
  'promote': 3,
  'demote': 2,
  'min_score': 1,
  'rank': joined ? 2 : null,
  'score': joined ? 5 : 0,
  'size': joined ? 4 : 0,
  'members': joined
      ? [
          {'rank': 1, 'name': 'Asha', 'score': 9, 'me': false},
          {'rank': 2, 'name': 'Ravi', 'score': 5, 'me': true},
          {'rank': 2, 'name': '  ', 'score': 5, 'me': false},
          {'rank': null, 'name': 'Mo', 'score': 0, 'me': false},
        ]
      : [],
  'rewards': [
    {'threshold': 1, 'kind': 'coins', 'amount': 100, 'params': {}},
    {'threshold': 3, 'kind': 'coins', 'amount': 30, 'params': {}},
  ],
  'last_week': lastWeek,
};

FakeRpc leagueRpc({bool joined = true, Map<String, Object?>? lastWeek}) {
  var j = joined;
  return FakeRpc({
    'rewards_state': (_) => sampleState()
      ..['programs'] = [
        {
          'key': 'weekly',
          'kind': 'league',
          'public': {'title': 'Reading league'},
        },
      ],
    'rewards_league': (_) => sampleLeague(joined: j, lastWeek: lastWeek),
    'rewards_league_join': (_) {
      j = true;
      return sampleLeague(lastWeek: lastWeek);
    },
    'rewards_league_leave': (_) {
      j = false;
      return sampleLeague(joined: false, lastWeek: lastWeek);
    },
  });
}

void main() {
  group('LeagueState', () {
    test('parses the board; empty names are null; bad tiers are skipped; never an id', () {
      final l = LeagueState.fromJson(
        sampleLeague(lastWeek: {'week': '2026-11-02', 'rank': 1, 'score': 12, 'tier_change': 'up'}),
      );
      expect(l.program, 'weekly');
      expect(l.tiers, ['Bronze', 'Silver']);
      expect(l.week, DateTime.utc(2026, 11, 9));
      expect(l.endsAt, serverNow.add(const Duration(days: 2, hours: 3)));
      expect(l.members.map((m) => m.name), ['Asha', 'Ravi', null, 'Mo']);
      expect(l.members[3].rank, isNull);
      expect(l.members.where((m) => m.me).single.score, 5);
      expect(l.rewards.map((r) => r.threshold), [1, 3]);
      expect(l.canMoveUp, isTrue);
      expect(l.nextTierName, 'Silver');
      expect(l.lastWeek!.tierChange, LeagueTierChange.up);
      expect(l.lastWeek!.week, DateTime.utc(2026, 11, 2));
    });

    test('tolerates a minimal answer', () {
      final l = LeagueState.fromJson({'program': 'p'});
      expect(l.joined, isFalse);
      expect(l.live, isTrue);
      expect(l.members, isEmpty);
      expect(l.lastWeek, isNull);
      expect(l.canMoveUp, isFalse);
      expect(LeagueTierChange.parse('sideways'), LeagueTierChange.same);
      expect(ProgramKind.fromWire('league'), ProgramKind.league);
    });

    test('ordinals', () {
      expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map((n) => '$n${ordinalSuffix(n)}'), [
        '1st',
        '2nd',
        '3rd',
        '4th',
        '11th',
        '12th',
        '13th',
        '21st',
        '22nd',
        '101st',
        '111th',
      ]);
    });
  });

  group('client and controller', () {
    test('calls the three RPCs with the program and reports join / leave without names', () async {
      final events = <RewardsEvent>[];
      final rpc = leagueRpc(joined: false);
      final c = RewardsClient(rpc: rpc.call, onEvent: events.add);
      expect((await c.league('weekly')).joined, isFalse);
      expect((await c.joinLeague('weekly')).joined, isTrue);
      expect((await c.leaveLeague('weekly')).joined, isFalse);
      expect(rpc.calls.map((x) => x.$1), ['rewards_league', 'rewards_league_join', 'rewards_league_leave']);
      expect(rpc.calls.every((x) => x.$2.length == 1 && x.$2['program'] == 'weekly'), isTrue);
      expect(events.map((e) => e.name.wire), ['rewards_league_joined', 'rewards_league_left']);
      expect(
        events.every((e) => e.props.keys.toSet().containsAll({'program', 'result'}) && e.props.length == 2),
        isTrue,
      );
    });

    test('a refusal is a reason, and the cached league stays', () async {
      final rpc = FakeRpc({
        'rewards_league': (_) => sampleLeague(joined: false),
        'rewards_league_join': (_) => throw Exception('rewards: unknown_program'),
      });
      final c = controllerOn(rpc);
      expect(await c.loadLeague('weekly'), isNull);
      expect(await c.joinLeague('weekly'), 'unknown_program');
      expect(c.league('weekly')!.joined, isFalse);
    });

    test('a newly closed week with rewards reloads the state once', () async {
      var states = 0;
      final rpc = FakeRpc({
        'rewards_state': (_) {
          states++;
          return sampleState();
        },
        'rewards_league': (_) => sampleLeague(
          lastWeek: {
            'week': '2026-11-02',
            'rank': 1,
            'score': 9,
            'tier_change': 'up',
            'grants': [
              {'id': 'g1', 'program': 'weekly', 'kind': 'coins', 'amount': 100, 'state': 'granted'},
            ],
          },
        ),
      });
      final c = controllerOn(rpc);
      await c.refresh();
      await c.loadLeague('weekly');
      await c.loadLeague('weekly');
      expect(states, 2, reason: 'reloaded after the first load only');
    });
  });

  group('LeagueBoard', () {
    testWidgets('not joined: the pitch says what is shared; Join loads the board', (t) async {
      final c = controllerOn(leagueRpc(joined: false));
      await t.pumpWidget(app(LeagueBoard(controller: c, program: 'weekly')));
      await t.pump();
      await t.pump();
      expect(find.text('Reading league'), findsOneWidget);
      expect(find.textContaining('Only your display name and score are shown'), findsOneWidget);
      expect(find.text('Asha'), findsNothing);
      await t.tap(find.text('Join'));
      await t.pump();
      await t.pump();
      expect(find.text('Asha'), findsOneWidget);
      expect(find.text('Ravi (You)'), findsOneWidget);
      expect(find.text('A member'), findsOneWidget, reason: 'no display name: a neutral word');
      expect(find.text('2nd'), findsNWidgets(2), reason: 'ties share a place');
      expect(find.text('–'), findsOneWidget, reason: 'unranked');
      expect(find.text('9 points'), findsOneWidget);
      expect(find.textContaining('Week ends in'), findsOneWidget);
      expect(find.text('Top 3 move up to Silver'), findsOneWidget);
      expect(find.text('1st: 100 coins'), findsOneWidget);
      expect(find.text('Top 3: 30 coins'), findsOneWidget);
      expect(find.textContaining('down'), findsNothing, reason: 'nothing marks who moves down');
      await t.tap(find.text('Leave league'));
      await t.pump();
      await t.pump();
      expect(find.text('Asha'), findsNothing);
      expect(find.text('Join'), findsOneWidget);
    });

    testWidgets('last week: own result and moving up; maxRows keeps the user'
        's own row', (t) async {
      final c = controllerOn(leagueRpc(lastWeek: {'week': '2026-11-02', 'rank': 1, 'score': 12, 'tier_change': 'up'}));
      await t.pumpWidget(app(LeagueBoard(controller: c, program: 'weekly', maxRows: 1)));
      await t.pump();
      await t.pump();
      expect(find.text('Last week: 1st with 12 points'), findsOneWidget);
      expect(find.text('You moved up to Bronze'), findsOneWidget);
      expect(find.text('Asha'), findsOneWidget);
      expect(find.text('Ravi (You)'), findsOneWidget);
      expect(find.text('Mo'), findsNothing);
    });

    testWidgets('builder replaces the look; not live hides Join', (t) async {
      final rpc = FakeRpc({
        'rewards_state': (_) => sampleState(),
        'rewards_league': (_) => sampleLeague(joined: false, live: false),
      });
      final c = controllerOn(rpc);
      await t.pumpWidget(app(LeagueBoard(controller: c, program: 'weekly')));
      await t.pump();
      await t.pump();
      expect(find.text('This league is not running right now.'), findsOneWidget);
      expect(find.text('Join'), findsNothing);
      await t.pumpWidget(
        app(LeagueBoard(controller: c, program: 'weekly', builder: (context, l, _) => Text('custom ${l.size}'))),
      );
      expect(find.text('custom 0'), findsOneWidget);
    });
  });

  group('RewardsRecapCard', () {
    final (from, to) = recapYear(2026);
    final recap = Recap(
      from: from,
      to: to,
      daysActive: 212,
      bestStreak: 31,
      events: const [
        RecapEvent(type: 'chapter_read', count: 840),
        RecapEvent(type: 'quiz_finished', count: 120),
        RecapEvent(type: 'clip_made', count: 9),
        RecapEvent(type: 'app_open', count: 3),
      ],
      grants: const [
        RecapGrant(kind: 'coins', amount: 4200, count: 80),
        RecapGrant(kind: 'badge', amount: 3, count: 3),
      ],
      badges: const [
        Badge(badge: 'night_owl'),
        Badge(badge: 'bookworm'),
      ],
    );

    testWidgets('a whole year: "Your 2026", the big numbers, the top 3 actions, what was earned', (t) async {
      await t.pumpWidget(
        app(
          SizedBox(
            width: 360,
            child: RewardsRecapCard(recap: recap, subtitle: 'Reader'),
          ),
        ),
      );
      expect(find.text('Your 2026'), findsOneWidget);
      expect(find.text('Reader'), findsOneWidget);
      expect(find.text('212'), findsOneWidget);
      expect(find.text('days active'), findsOneWidget);
      expect(find.text('31'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(find.text('badges'), findsOneWidget);
      expect(find.text('Chapter read: 840'), findsOneWidget);
      expect(find.text('Clip made: 9'), findsOneWidget);
      expect(find.text('App open: 3'), findsNothing, reason: 'maxEvents 3');
      expect(t.getSize(find.byType(RewardsRecapCard)), const Size(360, 450), reason: '4:5');
      expect(t.takeException(), isNull);
    });

    testWidgets('a range gets "Your recap"; the builder is wrapped in the share boundary and renders to PNG', (
      t,
    ) async {
      final key = RecapShareKey();
      final week = Recap(from: DateTime.utc(2026, 11, 9), to: DateTime.utc(2026, 11, 15), daysActive: 1);
      await t.pumpWidget(app(RewardsRecapCard(recap: week, aspectRatio: null)));
      expect(find.text('Your recap'), findsOneWidget);
      expect(find.text('day active'), findsOneWidget);
      expect(await key.toPngBytes(), isNull, reason: 'not on screen yet');
      await t.pumpWidget(
        app(
          SizedBox(
            width: 200,
            child: RewardsRecapCard(
              recap: week,
              shareKey: key,
              builder: (context, r) => ColoredBox(color: Colors.indigo, child: Text('${r.daysActive} day')),
            ),
          ),
        ),
      );
      expect(find.text('1 day'), findsOneWidget);
      final png = await t.runAsync(() => key.toPngBytes(pixelRatio: 1));
      expect(png, isNotNull);
      expect(png!.sublist(1, 4), 'PNG'.codeUnits);
    });
  });
}
