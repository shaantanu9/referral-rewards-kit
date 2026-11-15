import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';
import 'fakes_v2.dart';

void main() {
  test('0.2 RPCs: exact function and parameter names (ADR 0002 §18.3)', () async {
    final rpc = FakeRpc({
      'rewards_history': (_) => historyJson(),
      'rewards_recap': (_) => {'days_active': 3},
      'rewards_recharge_use': (_) => {'program': 'hearts', 'units': 1, 'max': 3, 'next_at': iso(serverNow)},
      'rewards_friend_invite': (_) => {'code': 'FAB12CDE', 'expires_at': iso(serverNow)},
      'rewards_friend_accept': (_) => {'pair_id': 'p9', 'program': 'buddies'},
      'rewards_friend_remove': (_) => true,
      'rewards_social_submit_link': (_) => {'program': 'ig', 'state': 'pending', 'post_url': 'https://i/p/1'},
      'rewards_quiz_today': (_) => quizStateJson(),
      'rewards_quiz_start': (_) => quizStateJson(state: 'in_progress'),
      'rewards_quiz_question': (_) => questionJson(0),
      'rewards_quiz_answer': (_) => {'correct': true, 'answer': 1, 'score': 1},
    });
    final c = RewardsClient(rpc: rpc.call);
    expect((await c.history(program: 'daily', weeks: 2)).days, hasLength(14));
    final recap = await c.recap(DateTime(2026, 11, 1, 22), DateTime(2026, 11, 14));
    expect(recap.daysActive, 3);
    expect(recap.from, DateTime.utc(2026, 11, 1));
    expect((await c.useRecharge('hearts', units: 2)).units, 1);
    expect((await c.friendInvite('buddies')).code, 'FAB12CDE');
    expect((await c.friendAccept(' fab12cde ')).pairId, 'p9');
    expect(await c.friendRemove('p9'), isTrue);
    expect((await c.submitSocialLink('ig', ' https://i/p/1 ')).postUrl, 'https://i/p/1');
    expect((await c.quizToday('quiz')).status, QuizStatus.notStarted);
    expect((await c.quizStart('quiz')).status, QuizStatus.inProgress);
    expect((await c.quizQuestion('quiz')).id, 'q0');
    expect((await c.quizAnswer('quiz', 0, 1)).correct, isTrue);

    final expected = <(String, Map<String, Object?>)>[
      ('rewards_history', {'program': 'daily', 'weeks': 2}),
      ('rewards_recap', {'from_day': '2026-11-01', 'to_day': '2026-11-14'}),
      ('rewards_recharge_use', {'program': 'hearts', 'units': 2}),
      ('rewards_friend_invite', {'program': 'buddies'}),
      ('rewards_friend_accept', {'code': 'FAB12CDE'}),
      ('rewards_friend_remove', {'pair_id': 'p9'}),
      ('rewards_social_submit_link', {'program': 'ig', 'url': 'https://i/p/1'}),
      ('rewards_quiz_today', {'program': 'quiz'}),
      ('rewards_quiz_start', {'program': 'quiz'}),
      ('rewards_quiz_question', {'program': 'quiz'}),
      ('rewards_quiz_answer', {'program': 'quiz', 'index': 0, 'choice': 1}),
    ];
    expect(rpc.calls.map((c) => c.$1), expected.map((e) => e.$1));
    for (var i = 0; i < expected.length; i++) {
      expect(rpc.calls[i].$2, expected[i].$2, reason: expected[i].$1);
    }
  });

  test('history defaults: null program, 15 weeks', () async {
    final rpc = FakeRpc({'rewards_history': (_) => historyJson()});
    await RewardsClient(rpc: rpc.call).history();
    expect(rpc.called('rewards_history').single, {'program': null, 'weeks': 15});
  });

  test('refusals arrive with their reason and are reported without codes or ids', () async {
    final events = <RewardsEvent>[];
    final rpc = FakeRpc({
      'rewards_friend_accept': (_) => throw Exception('rewards: own_code'),
      'rewards_recharge_use': (_) => throw Exception('rewards: empty'),
      'rewards_quiz_start': (_) => throw Exception('rewards: no_attempts_left'),
      'rewards_social_submit_link': (_) => throw Exception('rewards: bad_link'),
    });
    final c = RewardsClient(rpc: rpc.call, onEvent: events.add);
    await expectLater(c.friendAccept('FSECRET1'), throwsA(isA<RewardsException>()));
    await expectLater(c.useRecharge('hearts'), throwsA(predicate((e) => e is RewardsException && e.reason == 'empty')));
    await expectLater(c.quizStart('quiz'), throwsA(isA<RewardsException>()));
    await expectLater(c.submitSocialLink('ig', 'https://secret.link'), throwsA(isA<RewardsException>()));
    expect(events.map((e) => (e.name, e.props['result'])), [
      (RewardsEventName.friendAccepted, 'own_code'),
      (RewardsEventName.rechargeUsed, 'empty'),
      (RewardsEventName.quizStarted, 'no_attempts_left'),
      (RewardsEventName.socialLinkSubmitted, 'bad_link'),
    ]);
    expect(events.toString(), isNot(contains('FSECRET1')));
    expect(events.toString(), isNot(contains('secret.link')));
  });

  test('quiz answer reports answered, and finished on the last one', () async {
    final events = <RewardsEvent>[];
    final rpc = FakeRpc({
      'rewards_quiz_answer': (_) => {
        'correct': false,
        'timed_out': true,
        'score': 2,
        'finished': true,
        'grants': [grant('q1')],
      },
    });
    await RewardsClient(rpc: rpc.call, onEvent: events.add).quizAnswer('quiz', 2, -1);
    expect(events.first.name, RewardsEventName.quizAnswered);
    expect(events.first.props, {'program': 'quiz', 'index': 2, 'correct': false, 'timed_out': true});
    expect(events.last.name, RewardsEventName.quizFinished);
    expect(events.last.props, {'program': 'quiz', 'score': 2, 'total': 3, 'grants': 1});
  });
}
