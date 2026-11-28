// The 0.8.1 extension hooks: generic places where a separate package adds its own server fields, events and widgets
// without changing this one.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';

Widget _app(Widget child) => MaterialApp(home: Scaffold(body: child));

class _ErrorTexts implements RewardsErrorTexts {
  const _ErrorTexts();
  @override
  String? errorLine(String reason) => reason == 'RW_SOME_CODE' ? 'A known code.' : null;
}

void main() {
  group('raw server fields', () {
    test('state, track answer, streak, plan item and prefs keep what the server sent', () {
      final s = RewardsState.fromJson({...sampleState(), 'newer_field': 7});
      expect(s.raw['newer_field'], 7);
      expect(s.copyWith(enabled: false).raw['newer_field'], 7);
      expect(s.streaks.single.raw['program'], 'daily');
      expect(TrackResult.fromJson({'enabled': true, 'extra': 1}).raw['extra'], 1);
      final plan = FollowupPlan.fromJson({
        'plan': [
          {'id': 1, 'program': 'daily', 'at': iso(serverNow), 'extra': true},
        ],
      });
      expect(plan.items.single.raw['extra'], isTrue);
      final p = FollowupPrefs.fromJson({'extra_off': true});
      expect(p.raw['extra_off'], isTrue);
      expect(p.patched({'extra_off': false}).raw['extra_off'], isFalse);
    });

    test('extras and hidden sections are carried by copyWith', () {
      final s = RewardsState.fromJson(sampleState()).copyWith(
        extras: {'mine': 1},
        hidden: {RewardsSection.timers, RewardsSection.surprises, RewardsSection.leagues},
      );
      final c = s.copyWith(enabled: false);
      expect(c.extras['mine'], 1);
      expect(c.hideTimers && c.hideSurprises && c.hideLeagues, isTrue);
      expect(RewardsState.fromJson(sampleState()).hideLeagues, isFalse);
    });
  });

  group('client', () {
    test('event decorator adds context; onceKey sends once; a throwing decorator is ignored', () {
      final events = <RewardsEvent>[];
      final client = RewardsClient(rpc: FakeRpc().call, onEvent: events.add);
      client.eventDecorator = (e) => e.withContext({'variant': 'B'});
      client.report(const RewardsEvent(RewardsEventName.stateLoaded));
      client.report(const RewardsEvent.custom('my_event', props: {'n': 1}, onceKey: 'k1'));
      client.report(const RewardsEvent.custom('my_event', props: {'n': 2}, onceKey: 'k1'));
      expect(events, hasLength(2));
      expect(events.first.context['variant'], 'B');
      expect(events.last.name, RewardsEventName.custom);
      expect(events.last.wire, 'my_event');
      expect(events.last.toJson(), {
        'event': 'my_event',
        'variant': 'B',
        'props': {'n': 1},
      });
      client.eventDecorator = (_) => throw StateError('analytics bug');
      client.report(const RewardsEvent(RewardsEventName.tracked));
      expect(events.last.name, RewardsEventName.tracked);
    });

    test('withContext keeps fields already set and writes a DateTime as ISO', () {
      final e = const RewardsEvent.custom(
        'x',
        context: {'variant': 'A'},
      ).withContext({'variant': 'B', 'at': serverNow});
      expect(e.context['variant'], 'A');
      expect(e.toJson()['at'], iso(serverNow));
    });

    test('answer listeners see every decoded answer; callRaw maps errors like the typed calls', () async {
      final seen = <String>[];
      final rpc = FakeRpc({
        'rewards_state': (_) => sampleState(),
        'my_fn': (_) => {'ok': true},
        'my_bad': (_) => throw Exception('rewards: RW_SOME_CODE something human'),
      });
      final client = RewardsClient(rpc: rpc.call)..addAnswerListener((fn, _) => seen.add(fn));
      await client.state();
      expect(await client.callRaw('my_fn', const {}), {'ok': true});
      expect(seen, ['rewards_state', 'my_fn']);
      await expectLater(
        client.callRaw('my_bad', const {}),
        throwsA(isA<RewardsException>().having((e) => e.reason, 'reason', 'RW_SOME_CODE')),
      );
    });

    test('an upper-case code is read from the message or only from the details', () {
      expect(rewardsReasonOf(Exception('rewards: RW_SOME_CODE text')), 'RW_SOME_CODE');
      expect(rewardsReasonOf(Exception('message, details: RW_OTHER_CODE')), 'RW_OTHER_CODE');
      expect(rewardsReasonOf(Exception('rewards: offer_expired')), 'offer_expired');
    });

    test('extra follow-up pref keys are sent; others are not', () async {
      final rpc = FakeRpc({'rewards_followup_prefs': (p) => (p['patch']! as Map).cast<String, Object?>()});
      final client = RewardsClient(rpc: rpc.call)..extraFollowupPrefKeys.add('extra_off');
      final p = await client.followupPrefs({'extra_off': true, 'other': 1});
      expect(rpc.called('rewards_followup_prefs').single['patch'], {'extra_off': true});
      expect(p.raw['extra_off'], isTrue);
    });
  });

  group('controller', () {
    test('state transforms run on load and after a track; load listeners after each refresh', () async {
      final rpc = FakeRpc({
        'rewards_state': (_) => sampleState(),
        'rewards_track': (_) => {
          'enabled': true,
          'duplicate': false,
          'grants': [],
          'streaks': [
            {'program': 'daily', 'current': 4, 'today_count': 1, 'daily_goal': 1},
          ],
        },
      });
      final c = controllerOn(rpc);
      var loads = 0;
      c
        ..addStateTransform(
          (s) => s.copyWith(
            hidden: {RewardsSection.leagues},
            streaks: [for (final st in s.streaks) st.withGoalOverride(3)],
          ),
        )
        ..addLoadListener((_) => loads++);
      await c.refresh();
      expect(c.state.hideLeagues, isTrue);
      expect(c.state.streak('daily')!.ringGoal, 3);
      await c.track('chapter_read');
      expect(c.state.streak('daily')!.ringGoal, 3);
      expect(loads, 2); // the track reloaded (a milestone may have moved)
    });

    test('a refresh condition reloads after a track; seen listeners get the grants marked seen', () async {
      final rpc = FakeRpc({
        'rewards_state': (_) => sampleState(inbox: [grant('g1')]),
        'rewards_track': (_) => {'enabled': true, 'duplicate': false, 'grants': [], 'streaks': [], 'more': true},
        'rewards_mark_seen': (_) => null,
      });
      final c = controllerOn(rpc);
      final seen = <String>[];
      c
        ..addRefreshCondition((r, _) => r.raw['more'] == true)
        ..addSeenListener((g) => seen.addAll(g.map((x) => x.id)));
      await c.refresh();
      await c.track('x');
      expect(rpc.called('rewards_state'), hasLength(2));
      await c.markSeen(['g1']);
      expect(seen, ['g1']);
    });

    test('runAction maps a refusal to its reason; updateState notifies', () async {
      final rpc = FakeRpc({'my_fn': (_) => throw Exception('rewards: RW_SOME_CODE x')});
      final c = controllerOn(rpc);
      var notified = 0;
      c.addListener(() => notified++);
      expect(await c.runAction(() => c.client.callRaw('my_fn', const {}), (_) {}), 'RW_SOME_CODE');
      c.updateState((s) => s.copyWith(extras: {'a': 1}));
      expect(c.state.extras['a'], 1);
      expect(notified, greaterThanOrEqualTo(2));
    });
  });

  group('texts', () {
    test('extensions are found by type and name reasons the kit does not know', () {
      const t = RewardsTexts(extensions: [_ErrorTexts()]);
      expect(t.extension<_ErrorTexts>(), isNotNull);
      expect(t.extension<String>(), isNull);
      expect(t.error('RW_SOME_CODE'), 'A known code.');
      expect(t.error('RW_NOT_MINE'), 'Something went wrong. Try again.');
      expect(t.error('offer_expired'), const RewardsTexts().offerExpired);
    });
  });

  group('widgets', () {
    testWidgets('hub: leading and extra sections, a builder for a new program kind', (tester) async {
      final rpc = FakeRpc({
        'rewards_state': (_) => {
          ...sampleState(),
          'programs': [
            ...(sampleState()['programs']! as List),
            {'key': 'pet', 'kind': 'brand_new', 'public': {}},
          ],
        },
      });
      final c = controllerOn(rpc);
      await c.refresh();
      await tester.pumpWidget(
        _app(
          RewardsHub(
            controller: c,
            leadingSections: (_) => [const Text('LEADING')],
            extraSections: (_) => [const Text('EXTRA')],
            kindBuilders: {'brand_new': (_, p) => Text('KIND ${p.key}')},
          ),
        ),
      );
      expect(find.text('LEADING'), findsOneWidget);
      expect(find.text('EXTRA'), findsOneWidget);
      expect(find.text('KIND pet'), findsOneWidget);
    });

    testWidgets('a hidden-surprises state hides the odds card; the odds footer shows under each program', (
      tester,
    ) async {
      final state = {
        ...sampleState(),
        'surprises': [
          {
            'program': 'daily',
            'chance': 0.1,
            'reward': {'kind': 'coins', 'amount': 5, 'params': {}},
          },
        ],
      };
      final c = controllerOn(FakeRpc({'rewards_state': (_) => state}));
      c.oddsFooterBuilder = (_, program, _) => Text('FOOTER $program');
      await c.refresh();
      await tester.pumpWidget(_app(SurpriseOdds(controller: c)));
      expect(find.text('FOOTER daily'), findsOneWidget);
      c.updateState((s) => s.copyWith(hidden: {RewardsSection.surprises}));
      await tester.pump();
      expect(find.text('FOOTER daily'), findsNothing);
    });

    testWidgets('DailyGoalRing shows the goal override', (tester) async {
      final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleState()}));
      await c.refresh();
      await tester.pumpWidget(_app(DailyGoalRing(controller: c, goal: 4)));
      expect(find.text('0/4'), findsOneWidget);
    });

    testWidgets('RewardReveal calls onRevealed once with the grant', (tester) async {
      final revealed = <String>[];
      final g = RewardGrant.fromJson(grant('g9'));
      await tester.pumpWidget(_app(RewardReveal(grant: g, autoOpen: true, onRevealed: (x) => revealed.add(x.id))));
      await tester.pumpAndSettle();
      expect(revealed, ['g9']);
    });
  });
}
