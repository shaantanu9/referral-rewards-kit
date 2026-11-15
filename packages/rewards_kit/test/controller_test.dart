import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';

void main() {
  test('nothing runs until refresh; refresh loads, syncs the clock and is shared while running', () async {
    final rpc = FakeRpc({'rewards_state': (_) => sampleState()});
    final c = controllerOn(rpc, local: () => serverNow.subtract(const Duration(minutes: 3)));
    expect(rpc.calls, isEmpty);
    expect(c.visible, isFalse);
    await Future.wait([c.refresh(), c.refresh()]);
    expect(rpc.called('rewards_state'), hasLength(1));
    expect(c.loaded && c.visible, isTrue);
    expect(c.clock.offset, const Duration(minutes: 3));
  });

  test('disabled engine: loaded but not visible', () async {
    final events = <RewardsEvent>[];
    final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleState(enabled: false)}), events: events);
    await c.refresh();
    expect(c.loaded, isTrue);
    expect(c.visible, isFalse);
    expect(events.any((e) => e.name == RewardsEventName.unavailable && e.props['reason'] == 'disabled'), isTrue);
  });

  test('not deployed: unavailable, hidden, reported', () async {
    final events = <RewardsEvent>[];
    final c = controllerOn(
      FakeRpc({'rewards_state': (_) => throw Exception('PGRST202 function not found')}),
      events: events,
    );
    await c.refresh();
    expect(c.unavailable, RewardsUnavailableReason.notDeployed);
    expect(c.visible, isFalse);
    expect(events.last.props['reason'], 'not_deployed');
  });

  test('offline: error kept, nothing thrown', () async {
    final c = controllerOn(FakeRpc({'rewards_state': (_) => throw Exception('socket')}));
    await c.refresh();
    expect(c.error, isA<RewardsNetworkError>());
    expect(c.loaded, isFalse);
  });

  test('newGrants emits each granted inbox item once, never pending ones', () async {
    final rpc = FakeRpc({
      'rewards_state': (_) => sampleState(
        inbox: [
          grant('g1'),
          grant('g2', state: 'queued'),
        ],
      ),
    });
    final c = controllerOn(rpc);
    final got = <String>[];
    c.newGrants.listen((g) => got.add(g.id));
    await c.refresh();
    await c.refresh();
    await Future<void>.delayed(Duration.zero);
    expect(got, ['g1']);
  });

  test('track merges the changed streak and new grants, then refreshes when something else may have moved', () async {
    var states = 0;
    final rpc = FakeRpc({
      'rewards_state': (_) {
        states++;
        return sampleState();
      },
      'rewards_track': (_) => {
        'duplicate': false,
        'grants': [grant('t1', amount: 50)],
        'streaks': [
          {'program': 'daily', 'current': 4, 'today_done': true},
        ],
      },
    });
    final c = controllerOn(rpc);
    await c.refresh();
    final got = <String>[];
    c.newGrants.listen((g) => got.add(g.id));
    expect(await c.track('chapter_read'), isNull);
    await Future<void>.delayed(Duration.zero);
    expect(got, ['t1']);
    expect(states, 2, reason: 'a grant landed: state refreshed');
  });

  test('duplicate track changes nothing and does not refresh', () async {
    var states = 0;
    final rpc = FakeRpc({
      'rewards_state': (_) {
        states++;
        return sampleState();
      },
      'rewards_track': (_) => {'duplicate': true},
    });
    final c = controllerOn(rpc);
    await c.refresh();
    await c.track('chapter_read');
    expect(states, 1);
    expect(c.state.streak('daily')!.current, 3);
  });

  test('track without a refresh needed merges locally', () async {
    final base = sampleState()
      ..['milestones'] = []
      ..['offers'] = [];
    var states = 0;
    final rpc = FakeRpc({
      'rewards_state': (_) {
        states++;
        return base;
      },
      'rewards_track': (_) => {
        'streaks': [
          {'program': 'daily', 'current': 4, 'today_done': true},
        ],
      },
    });
    final c = controllerOn(rpc);
    await c.refresh();
    await c.track('chapter_read');
    expect(states, 1);
    expect(c.state.streak('daily')!.current, 4);
    expect(c.state.streak('daily')!.todayDone, isTrue);
  });

  test('track refusal returns the reason', () async {
    final c = controllerOn(FakeRpc({'rewards_track': (_) => throw Exception('rewards: daily_limit')}));
    expect(await c.track('x'), 'daily_limit');
  });

  test('claimOffer: success marks claimed and emits; refusals correct the offer state', () async {
    final rpc = FakeRpc({
      'rewards_state': (_) => sampleState(),
      'rewards_offer_claim': (_) => {
        'grants': [grant('o1', amount: 100)],
      },
    });
    final c = controllerOn(rpc);
    await c.refresh();
    final got = <String>[];
    c.newGrants.listen((g) => got.add(g.id));
    expect(await c.claimOffer('welcome'), isNull);
    await Future<void>.delayed(Duration.zero);
    expect(c.state.offer('welcome')!.status, OfferStatus.claimed);
    expect(got, ['o1']);

    for (final (reason, status) in [
      ('offer_expired', OfferStatus.expired),
      ('sold_out', OfferStatus.soldOut),
      ('offer_claimed', OfferStatus.claimed),
    ]) {
      rpc.handlers['rewards_offer_claim'] = (_) => throw Exception('rewards: $reason');
      await c.refresh();
      expect(await c.claimOffer('welcome'), reason);
      expect(c.state.offer('welcome')!.status, status);
    }
  });

  test('startSocial makes the task pending with its code', () async {
    final rpc = FakeRpc({
      'rewards_state': (_) => sampleState(),
      'rewards_social_start': (_) => {'code': 'MYAPP-K7Q2HX', 'account': 'myapp', 'expires_at': iso(serverNow)},
    });
    final c = controllerOn(rpc);
    await c.refresh();
    expect(await c.startSocial('ig_tag', 'me'), isNull);
    final t = c.state.socialTask('ig_tag')!;
    expect(t.status, SocialTaskStatus.pending);
    expect(t.code, 'MYAPP-K7Q2HX');
    rpc.handlers['rewards_social_start'] = (_) => throw Exception('rewards: handle_taken');
    expect(await c.startSocial('ig_tag', 'me'), 'handle_taken');
  });

  test('markSeen sends only granted ids and removes them', () async {
    final rpc = FakeRpc({
      'rewards_state': (_) => sampleState(
        inbox: [
          grant('g1'),
          grant('g2', state: 'queued'),
        ],
      ),
      'rewards_mark_seen': (_) => 1,
    });
    final c = controllerOn(rpc);
    await c.refresh();
    await c.markSeen(['g1', 'g2']);
    expect(rpc.called('rewards_mark_seen').single, {
      'grant_ids': ['g1'],
    });
    expect(c.state.inbox.map((g) => g.id), ['g2']);
    expect(await c.markSeen(['g2']), isNull, reason: 'nothing granted to mark: no call');
    expect(rpc.called('rewards_mark_seen'), hasLength(1));
  });

  test('dispose stops notifications and closes the stream', () async {
    final c = controllerOn(FakeRpc({'rewards_state': (_) => sampleState()}));
    final done = c.newGrants.toList();
    c.dispose();
    expect(await done, isEmpty);
  });
}
