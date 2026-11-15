import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';

class _PgError implements Exception {
  _PgError(this.message, [this.code]);
  final String message;
  final String? code;
  @override
  String toString() => 'PostgrestException(message: $message, code: $code)';
}

void main() {
  group('RewardsClient', () {
    test('state, track, claim, social, mark seen: function and parameter names', () async {
      final rpc = FakeRpc({
        'rewards_state': (_) => sampleState(),
        'rewards_track': (_) => {'duplicate': false, 'grants': [], 'streaks': []},
        'rewards_offer_claim': (_) => {
          'grants': [grant('g1')],
        },
        'rewards_social_start': (_) => {'code': 'MYAPP-K7Q2HX', 'account': 'myapp', 'expires_at': iso(serverNow)},
        'rewards_mark_seen': (_) => 1,
      });
      final c = RewardsClient(rpc: rpc.call, timezone: () => 'Asia/Kolkata');
      await c.state();
      await c.track('chapter_read', dedupeKey: 'ch:1', props: {'page': 3});
      expect(await c.claimOffer('welcome'), hasLength(1));
      expect((await c.startSocial('ig_tag', '@me')).code, 'MYAPP-K7Q2HX');
      expect(await c.markSeen(['g1']), 1);
      expect(await c.markSeen([]), 0);
      expect(rpc.calls.map((c) => c.$1), [
        'rewards_state',
        'rewards_track',
        'rewards_offer_claim',
        'rewards_social_start',
        'rewards_mark_seen',
      ]);
      expect(rpc.called('rewards_track').single, {
        'type': 'chapter_read',
        'dedupe_key': 'ch:1',
        'props': {'page': 3},
        'timezone': 'Asia/Kolkata',
      });
      expect(rpc.called('rewards_offer_claim').single, {'program': 'welcome'});
      expect(rpc.called('rewards_social_start').single, {'program': 'ig_tag', 'handle': '@me'});
      expect(rpc.called('rewards_mark_seen').single, {
        'grant_ids': ['g1'],
      });
    });

    test('no timezone function sends null', () async {
      final rpc = FakeRpc({'rewards_track': (_) => {}});
      await RewardsClient(rpc: rpc.call).track('x');
      expect(rpc.called('rewards_track').single['timezone'], isNull);
      expect(rpc.called('rewards_track').single['dedupe_key'], isNull);
    });

    test('a JSON string result is decoded', () async {
      final rpc = FakeRpc({'rewards_state': (_) => jsonEncode(sampleState())});
      expect((await RewardsClient(rpc: rpc.call).state()).enabled, isTrue);
    });

    Future<Object> errorOf(Object thrown) async {
      final rpc = FakeRpc({'rewards_offer_claim': (_) => throw thrown});
      try {
        await RewardsClient(rpc: rpc.call).claimOffer('x');
      } catch (e) {
        return e;
      }
      fail('no error');
    }

    test('error mapping', () async {
      expect((await errorOf(_PgError('rewards: offer_expired')) as RewardsException).reason, 'offer_expired');
      expect(
        (await errorOf(_PgError('rewards: not_signed_in')) as RewardsUnavailableException).reason,
        RewardsUnavailableReason.signedOut,
      );
      expect(
        (await errorOf(_PgError('Could not find the function', 'PGRST202')) as RewardsUnavailableException).reason,
        RewardsUnavailableReason.notDeployed,
      );
      expect(await errorOf(Exception('socket closed')), isA<RewardsNetworkError>());
      expect(await errorOf(const RewardsServerError('x', 500)), isA<RewardsServerError>());
      expect((await errorOf(const RewardsException('sold_out'))).toString(), contains('sold_out'));
    });

    test('a new server reason still arrives as RewardsException', () async {
      final e = await errorOf(_PgError('rewards: quest_locked')) as RewardsException;
      expect(e.reason, 'quest_locked');
      expect(e.isKnown, isFalse);
      expect(const RewardsException(RewardsReason.handleTaken).isKnown, isTrue);
    });

    test('events: loaded, tracked, claim results, social start; never a handle', () async {
      final events = <RewardsEvent>[];
      final rpc = FakeRpc({
        'rewards_state': (_) => sampleState(),
        'rewards_track': (_) => {'duplicate': true},
        'rewards_offer_claim': (_) => throw _PgError('rewards: sold_out'),
        'rewards_social_start': (_) => {'code': 'MYAPP-K7Q2HX'},
      });
      final c = RewardsClient(rpc: rpc.call, onEvent: events.add);
      await c.state();
      await c.track('chapter_read');
      await expectLater(c.claimOffer('flash'), throwsA(isA<RewardsException>()));
      await c.startSocial('ig_tag', 'secret.handle');
      expect(events.map((e) => e.name), [
        RewardsEventName.stateLoaded,
        RewardsEventName.tracked,
        RewardsEventName.offerClaimed,
        RewardsEventName.socialStarted,
      ]);
      expect(events[1].props, {'type': 'chapter_read', 'duplicate': true, 'grants': 0});
      expect(events[2].props, {'program': 'flash', 'result': 'sold_out'});
      expect(events.toString(), isNot(contains('secret.handle')));
      expect(events.toString(), isNot(contains('MYAPP-K7Q2HX')));
    });

    test('a throwing analytics sink never breaks a call', () async {
      final rpc = FakeRpc({'rewards_state': (_) => sampleState()});
      final c = RewardsClient(rpc: rpc.call, onEvent: (_) => throw StateError('analytics down'));
      expect((await c.state()).enabled, isTrue);
    });
  });

  group('ServerClock', () {
    test('learns the offset and corrects now and left', () {
      var phone = DateTime.utc(2026, 1, 1, 12);
      final clock = ServerClock(local: () => phone);
      expect(clock.offset, Duration.zero);
      clock.sync(DateTime.utc(2026, 1, 1, 12, 5));
      expect(clock.offset, const Duration(minutes: 5));
      expect(clock.now(), DateTime.utc(2026, 1, 1, 12, 5));
      expect(clock.left(DateTime.utc(2026, 1, 1, 12, 15)), const Duration(minutes: 10));
      phone = phone.add(const Duration(hours: 1));
      expect(clock.left(DateTime.utc(2026, 1, 1, 12, 15)), Duration.zero, reason: 'never negative');
      expect(clock.left(null), isNull);
      clock.sync(null);
      expect(clock.offset, const Duration(minutes: 5), reason: 'null server time ignored');
    });
  });

  group('RewardsHttpRpc', () {
    RewardsHttpRpc http(
      RewardsHttpResponse Function() answer, {
      String? token = 'jwt',
      String? url = 'https://x.supabase.co/',
    }) => RewardsHttpRpc(
      supabaseUrl: url,
      anonKey: 'anon',
      accessToken: () async => token,
      transport: (u, h, b, t) async {
        expect(u.toString(), 'https://x.supabase.co/rest/v1/rpc/rewards_state');
        expect(h['Authorization'], 'Bearer jwt');
        expect(h['apikey'], 'anon');
        return answer();
      },
    );

    test('ok body decoded, empty body null', () async {
      expect(await http(() => const RewardsHttpResponse(200, '{"enabled":true}')).call('rewards_state', {}), {
        'enabled': true,
      });
      expect(await http(() => const RewardsHttpResponse(200, ' ')).call('rewards_state', {}), isNull);
    });

    test('no project, signed out, not deployed', () async {
      await expectLater(http(() => const RewardsHttpResponse(200, '')).call('rewards_state', {}), completes);
      await expectLater(
        http(() => const RewardsHttpResponse(200, ''), url: '').call('rewards_state', {}),
        throwsA(
          isA<RewardsUnavailableException>().having((e) => e.reason, 'reason', RewardsUnavailableReason.noProject),
        ),
      );
      await expectLater(
        http(() => const RewardsHttpResponse(200, ''), token: null).call('rewards_state', {}),
        throwsA(
          isA<RewardsUnavailableException>().having((e) => e.reason, 'reason', RewardsUnavailableReason.signedOut),
        ),
      );
      await expectLater(
        http(() => const RewardsHttpResponse(404, '{"code":"PGRST202"}')).call('rewards_state', {}),
        throwsA(
          isA<RewardsUnavailableException>().having((e) => e.reason, 'reason', RewardsUnavailableReason.notDeployed),
        ),
      );
    });

    test('a raised reason becomes RewardsException; other errors keep no body', () async {
      await expectLater(
        http(
          () => const RewardsHttpResponse(400, '{"message":"rewards: daily_limit","code":"22023"}'),
        ).call('rewards_state', {}),
        throwsA(isA<RewardsException>().having((e) => e.reason, 'reason', 'daily_limit')),
      );
      try {
        await http(() => const RewardsHttpResponse(500, 'secret user data')).call('rewards_state', {});
        fail('no error');
      } on RewardsServerError catch (e) {
        expect(e.status, 500);
        expect(e.toString(), isNot(contains('secret')));
      }
      await expectLater(
        http(() => const RewardsHttpResponse(200, 'not json')).call('rewards_state', {}),
        throwsA(isA<RewardsServerError>()),
      );
    });

    test('a transport failure is a network error', () async {
      final rpc = RewardsHttpRpc(
        supabaseUrl: 'https://x.supabase.co',
        anonKey: 'anon',
        accessToken: () async => 'jwt',
        transport: (u, h, b, t) async => throw Exception('dns'),
      );
      await expectLater(rpc.call('rewards_state', {}), throwsA(isA<RewardsNetworkError>()));
    });
  });
}
