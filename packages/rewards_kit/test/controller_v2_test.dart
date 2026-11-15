import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';
import 'fakes_v2.dart';

void main() {
  test('useRecharge merges units and next time, keeps every_minutes; empty corrects to zero', () async {
    final rpc = FakeRpc({
      'rewards_state': (_) => sampleStateV2(),
      'rewards_recharge_use': (_) => {
        'program': 'hearts',
        'units': 1,
        'max': 3,
        'next_at': iso(serverNow.add(const Duration(minutes: 30))),
      },
    });
    final c = controllerOn(rpc);
    await c.refresh();
    expect(await c.useRecharge('hearts'), isNull);
    final r = c.state.recharge('hearts')!;
    expect([r.units, r.max, r.everyMinutes], [1, 3, 240]);
    expect(r.nextAt, serverNow.add(const Duration(minutes: 30)));

    rpc.handlers['rewards_recharge_use'] = (_) => throw Exception('rewards: empty');
    expect(await c.useRecharge('hearts'), 'empty');
    expect(c.state.recharge('hearts')!.units, 0);
  });

  test('friendInvite keeps the code for the share sheet; accept and remove reload the list', () async {
    var states = 0;
    final rpc = FakeRpc({
      'rewards_state': (_) {
        states++;
        return sampleStateV2();
      },
      'rewards_friend_invite': (_) => {'code': 'FAB12CDE', 'expires_at': iso(serverNow)},
      'rewards_friend_accept': (_) => {'pair_id': 'p2', 'program': 'buddies'},
      'rewards_friend_remove': (_) => true,
    });
    final c = controllerOn(rpc);
    await c.refresh();
    expect(c.invite('buddies'), isNull);
    expect(await c.friendInvite('buddies'), isNull);
    expect(c.invite('buddies')!.code, 'FAB12CDE');
    expect(await c.friendAccept('FXYZ1234'), isNull);
    expect(states, 2);

    rpc.handlers['rewards_state'] = (_) {
      states++;
      return sampleStateV2(friends: []);
    };
    final seen = <int>[];
    c.addListener(() => seen.add(c.state.friends.length));
    expect(await c.friendRemove('p1'), isNull);
    expect(seen.first, 0, reason: 'removed locally before the reload');
    expect(states, 3);

    rpc.handlers['rewards_friend_accept'] = (_) => throw Exception('rewards: already_friends');
    expect(await c.friendAccept('FXYZ1234'), 'already_friends');
    expect(states, 3, reason: 'no reload on a refusal');
  });

  test('submitSocialLink sets post_url on the task', () async {
    final rpc = FakeRpc({
      'rewards_state': (_) => sampleState(socialState: 'pending'),
      'rewards_social_submit_link': (_) => {
        'program': 'ig_tag',
        'state': 'pending',
        'post_url': 'https://instagram.com/p/abc',
      },
    });
    final c = controllerOn(rpc);
    await c.refresh();
    expect(await c.submitSocialLink('ig_tag', 'https://instagram.com/p/abc'), isNull);
    final t = c.state.socialTask('ig_tag')!;
    expect(t.postUrl, 'https://instagram.com/p/abc');
    expect(t.code, 'MYAPP-K7Q2HX', reason: 'kept from the old state');
    rpc.handlers['rewards_social_submit_link'] = (_) => throw Exception('rewards: bad_link');
    expect(await c.submitSocialLink('ig_tag', 'nope'), 'bad_link');
  });

  test('quizToday merges into quizzes; applyQuiz and applyGrants emit once', () async {
    final rpc = FakeRpc({
      'rewards_state': (_) => sampleStateV2(),
      'rewards_quiz_today': (_) => quizStateJson(state: 'finished', attemptsLeft: 0, score: 3),
    });
    final c = controllerOn(rpc);
    await c.refresh();
    expect(await c.quizToday('quiz'), isNull);
    expect(c.state.quiz('quiz')!.status, QuizStatus.finished);
    final got = <String>[];
    c.newGrants.listen((g) => got.add(g.id));
    c.applyGrants([RewardGrant.fromJson(grant('qz'))]);
    c.applyGrants([RewardGrant.fromJson(grant('qz'))]);
    await Future<void>.delayed(Duration.zero);
    expect(got, ['qz']);
    expect(c.state.inbox.where((g) => g.id == 'qz'), hasLength(1));
  });

  test('history and recap load into caches; a track updates today on the heatmap', () async {
    final rpc = FakeRpc({
      'rewards_state': (_) => sampleStateV2(),
      'rewards_history': (_) => historyJson(),
      'rewards_recap': (_) => {'days_active': 4, 'best_streak': 6},
      'rewards_track': (_) => {
        'streaks': [
          {'program': 'daily', 'current': 3, 'today_count': 7, 'daily_goal': 2},
        ],
      },
    });
    final c = controllerOn(rpc);
    await c.refresh();
    expect(c.history(), isNull);
    expect(await c.loadHistory(), isNull);
    expect(c.history()!.days, hasLength(14));
    expect(c.history('daily'), isNotNull, reason: 'also cached under its program');
    final from = DateTime(2026, 11, 1), to = DateTime(2026, 11, 14);
    expect(await c.loadRecap(from, to), isNull);
    expect(c.recap(from, to)!.bestStreak, 6);
    await c.track('chapter_read');
    expect(c.history()!.today!.count, 7);
    expect(c.history('daily')!.today!.count, 7);
  });

  test('history offline returns the reason and keeps nothing', () async {
    final c = controllerOn(FakeRpc({'rewards_history': (_) => throw Exception('socket')}));
    expect(await c.loadHistory(), 'offline');
    expect(c.history(), isNull);
  });

  test('celebrateNow fires moments; closed on dispose', () async {
    final c = controllerOn(FakeRpc());
    var n = 0;
    c.moments.listen((_) => n++);
    c.celebrateNow();
    await Future<void>.delayed(Duration.zero);
    expect(n, 1);
    final done = c.moments.toList();
    c.dispose();
    c.celebrateNow();
    expect(await done, isEmpty);
  });

  test('track merges quests and refreshes when quests exist', () async {
    var states = 0;
    final rpc = FakeRpc({
      'rewards_state': (_) {
        states++;
        return sampleStateV2();
      },
      'rewards_track': (_) => {
        'quests': [
          {'program': 'daily_quests', 'done': true},
        ],
      },
    });
    final c = controllerOn(rpc);
    await c.refresh();
    await c.track('chapter_read');
    expect(states, 2);
  });
}
