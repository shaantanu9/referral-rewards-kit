import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';
import 'fakes_v2.dart';

Widget app(Widget child) => MaterialApp(
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

void main() {
  group('RewardedAdButton', () {
    testWidgets('verified: refreshes now, after 5 s and 20 s; reported; disabled while showing', (t) async {
      var states = 0;
      final events = <RewardsEvent>[];
      final rpc = FakeRpc({
        'rewards_state': (_) {
          states++;
          return sampleStateV2();
        },
      });
      final c = controllerOn(rpc, events: events);
      await c.refresh();
      var shows = 0;
      Future<bool> show() async {
        shows++;
        await Future<void>.delayed(const Duration(milliseconds: 100));
        return true;
      }

      await t.pumpWidget(app(RewardedAdButton(controller: c, label: 'Watch an ad for 10 coins', onShowAd: show)));
      await t.tap(find.text('Watch an ad for 10 coins'));
      await t.pump();
      await t.tap(find.text('Watch an ad for 10 coins'));
      await t.pump(const Duration(milliseconds: 150));
      expect(shows, 1, reason: 'disabled while showing');
      expect(states, 2);
      await t.pump(const Duration(seconds: 5));
      expect(states, 3);
      await t.pump(const Duration(seconds: 15));
      expect(states, 4);
      expect(events.where((e) => e.name == RewardsEventName.adRewardShown).map((e) => e.props), [
        {'result': 'verified'},
      ]);
    });

    testWidgets('not verified and error show a line, no refresh; hidden when not enabled; builder', (t) async {
      var states = 0;
      final events = <RewardsEvent>[];
      final c = controllerOn(
        FakeRpc({
          'rewards_state': (_) {
            states++;
            return sampleStateV2();
          },
        }),
        events: events,
      );
      await c.refresh();
      await t.pumpWidget(app(RewardedAdButton(controller: c, label: 'Ad', onShowAd: () async => false)));
      await t.tap(find.text('Ad'));
      await t.pump();
      expect(find.text('The ad did not finish, so there is no reward this time.'), findsOneWidget);
      await t.pumpWidget(app(RewardedAdButton(controller: c, label: 'Ad2', onShowAd: () async => throw 'no fill')));
      await t.tap(find.text('Ad2'));
      await t.pump();
      expect(find.text('The ad could not be shown. Try again later.'), findsOneWidget);
      expect(states, 1);
      expect(events.where((e) => e.name == RewardsEventName.adRewardShown).map((e) => e.props['result']), [
        'not_verified',
        'error',
      ]);

      await t.pumpWidget(app(RewardedAdButton(controller: c, label: 'Ad', enabled: false, onShowAd: () async => true)));
      expect(find.text('Ad'), findsNothing);
      await t.pumpWidget(
        app(
          RewardedAdButton(
            controller: c,
            label: 'Ad',
            onShowAd: () async => true,
            builder: (_, show, busy, msg) => Text('mine $busy'),
          ),
        ),
      );
      expect(find.text('mine false'), findsOneWidget);
    });
  });

  group('RewardToastListener holdUntilMoment', () {
    testWidgets('holds grants until celebrateNow; default shows at once', (t) async {
      final rpc = FakeRpc({'rewards_state': (_) => sampleState()});
      final c = controllerOn(rpc);
      await c.refresh();
      final seen = <String>[];
      await t.pumpWidget(
        MaterialApp(
          home: RewardToastListener(
            controller: c,
            holdUntilMoment: true,
            onGrant: (_, g) => seen.add(g.id),
            child: const SizedBox(),
          ),
        ),
      );
      c.applyGrants([RewardGrant.fromJson(grant('a')), RewardGrant.fromJson(grant('b'))]);
      await t.pump();
      expect(seen, isEmpty);
      c.celebrateNow();
      await t.pump();
      expect(seen, ['a', 'b']);
      c.celebrateNow();
      await t.pump();
      expect(seen, ['a', 'b'], reason: 'each once');

      final d = controllerOn(rpc);
      await d.refresh();
      await t.pumpWidget(
        MaterialApp(
          home: RewardToastListener(controller: d, onGrant: (_, g) => seen.add(g.id), child: const SizedBox()),
        ),
      );
      d.applyGrants([RewardGrant.fromJson(grant('c'))]);
      await t.pump();
      expect(seen.last, 'c');
    });
  });

  testWidgets('RewardsHub shows a widget for each 0.2 kind; comeback shows none', (t) async {
    final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleStateV2()}));
    await c.refresh();
    await t.pumpWidget(
      MaterialApp(
        home: Scaffold(body: RewardsHub(controller: c)),
      ),
    );
    expect(find.byType(QuizCard), findsOneWidget);
    expect(find.byType(QuestList), findsOneWidget);
    expect(find.byType(RechargeMeter), findsOneWidget);
    expect(find.byType(WindowBadge), findsOneWidget);
    expect(find.byType(FriendStreaks), findsOneWidget);
    expect(find.text('Today'), findsOneWidget, reason: 'quest title from public.title');
    expect(find.textContaining('Happy hour: ends in'), findsOneWidget);
  });

  testWidgets('SocialTagTask link field sends the post link, then says so', (t) async {
    final rpc = FakeRpc({
      'rewards_state': (_) => sampleState(socialState: 'pending'),
      'rewards_social_submit_link': (_) => {'program': 'ig_tag', 'state': 'pending', 'post_url': 'https://ig/p/1'},
    });
    final c = controllerOn(rpc);
    await c.refresh();
    await t.pumpWidget(app(SocialTagTask(controller: c, program: 'ig_tag', showLinkField: true)));
    await t.enterText(find.byType(TextField), 'https://ig/p/1');
    await t.tap(find.text('Send link'));
    await t.pump();
    await t.pump();
    expect(rpc.called('rewards_social_submit_link').single, {'program': 'ig_tag', 'url': 'https://ig/p/1'});
    expect(find.text('Link sent. We will check it.'), findsOneWidget);
  });

  test('reward texts for mystery and rc_currency; new reasons have lines', () {
    const x = RewardsTexts();
    expect(x.reward(const RewardSpec(kind: 'mystery', amount: 1)), 'a mystery reward');
    expect(x.reward(const RewardSpec(kind: 'rc_currency', amount: 10, params: {'currency_code': 'GEM'})), '10 GEM');
    expect(
      x.reward(
        const RewardSpec(kind: 'rc_currency', amount: 1, params: {'currency_code': 'GEM', 'currency_name': 'gems'}),
      ),
      '1 gems',
    );
    for (final r in ['empty', 'bad_code', 'own_code', 'too_many_friends', 'already_friends', 'bad_link']) {
      expect(x.error(r), isNot('Something went wrong. Try again.'), reason: r);
    }
    expect(const RewardsTexts(quiz: QuizTexts(start: 'Go')).quiz.start, 'Go');
    expect(RewardsTexts(programs: ProgramTexts(friendDays: (d) => '$d din')).programs.friendDays(3), '3 din');
    expect(formatPercent(1 / 3), '33%');
    expect(formatPercent(0.0004), '<0.1%');
    expect(formatPercent(0), '0%');
  });
}
