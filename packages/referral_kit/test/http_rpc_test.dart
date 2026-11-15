// ReferralHttpRpc: the raw-HTTP adapter for apps without supabase_flutter.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

class _Transport {
  _Transport(this.answer);
  ReferralHttpResponse Function() answer;
  final List<(Uri, Map<String, String>, String)> sent = [];

  Future<ReferralHttpResponse> call(Uri url, Map<String, String> headers, String body, Duration timeout) async {
    sent.add((url, headers, body));
    return answer();
  }
}

void main() {
  ReferralHttpRpc rpc(
    _Transport t, {
    String? url = 'https://ref.supabase.co/',
    String? key = 'anon',
    String? token = 'jwt',
  }) => ReferralHttpRpc(supabaseUrl: url, anonKey: key, accessToken: () async => token, transport: t.call);

  test('POSTs the params to /rest/v1/rpc/<fn> with apikey and bearer token, and decodes the body', () async {
    final t = _Transport(() => const ReferralHttpResponse(200, '{"reason":"ok"}'));
    final r = await rpc(t).call('referral_claim', {'code': 'ABCDEFGH', 'install_id': 'x'});
    expect(r, {'reason': 'ok'});
    final (url, headers, body) = t.sent.single;
    expect(url.toString(), 'https://ref.supabase.co/rest/v1/rpc/referral_claim');
    expect(headers['apikey'], 'anon');
    expect(headers['Authorization'], 'Bearer jwt');
    expect(headers['Content-Type'], 'application/json');
    expect(jsonDecode(body), {'code': 'ABCDEFGH', 'install_id': 'x'});
  });

  test('empty body is null', () async {
    final t = _Transport(() => const ReferralHttpResponse(204, ''));
    expect(await rpc(t).call('referral_ack', {}), isNull);
  });

  test('404 is not deployed', () async {
    final t = _Transport(() => const ReferralHttpResponse(404, '{"code":"PGRST202"}'));
    await expectLater(
      rpc(t).call('referral_terms', {}),
      throwsA(
        isA<ReferralUnavailableException>().having((e) => e.reason, 'reason', ReferralUnavailableReason.notDeployed),
      ),
    );
  });

  test('other statuses and bad JSON are server errors without the body', () async {
    final t = _Transport(() => const ReferralHttpResponse(500, 'secret detail'));
    await expectLater(
      rpc(t).call('referral_terms', {}),
      throwsA(
        isA<ReferralServerError>()
            .having((e) => e.status, 'status', 500)
            .having((e) => e.toString(), 'text', isNot(contains('secret'))),
      ),
    );
    t.answer = () => const ReferralHttpResponse(200, '<html>');
    await expectLater(rpc(t).call('referral_terms', {}), throwsA(isA<ReferralServerError>()));
  });

  test('no answer is a network error', () async {
    final t = _Transport(() => throw Exception('SocketException'));
    await expectLater(rpc(t).call('referral_terms', {}), throwsA(isA<ReferralNetworkError>()));
  });

  test('no project or signed out: unavailable, nothing sent', () async {
    final t = _Transport(() => const ReferralHttpResponse(200, '{}'));
    await expectLater(
      rpc(t, url: null).call('referral_terms', {}),
      throwsA(
        isA<ReferralUnavailableException>().having((e) => e.reason, 'reason', ReferralUnavailableReason.noProject),
      ),
    );
    await expectLater(
      rpc(t, key: '').call('referral_terms', {}),
      throwsA(
        isA<ReferralUnavailableException>().having((e) => e.reason, 'reason', ReferralUnavailableReason.noProject),
      ),
    );
    await expectLater(
      rpc(t, token: null).call('referral_terms', {}),
      throwsA(
        isA<ReferralUnavailableException>().having((e) => e.reason, 'reason', ReferralUnavailableReason.signedOut),
      ),
    );
    expect(t.sent, isEmpty);
  });

  test('with ReferralClient: availability() reports not deployed', () async {
    final t = _Transport(() => const ReferralHttpResponse(404, ''));
    final client = ReferralClient(rpc: rpc(t).call, installIds: const FixedInstallIdStore('id'));
    expect(await client.availability(), ReferralAvailability.notDeployed);
    t.answer = () => ReferralHttpResponse(200, jsonEncode({'enabled': true, 'rules': []}));
    expect(await client.availability(), ReferralAvailability.available);
  });
}
