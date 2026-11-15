import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'errors.dart';

/// One HTTP answer: status and body text.
class RewardsHttpResponse {
  const RewardsHttpResponse(this.status, this.body);
  final int status;
  final String body;
}

/// Sends one POST. Replace it in tests, or to reuse your app's HTTP client.
typedef RewardsHttpTransport =
    Future<RewardsHttpResponse> Function(Uri url, Map<String, String> headers, String body, Duration timeout);

/// A `RewardsRpc` over raw HTTP, for apps without supabase_flutter: `POST {supabaseUrl}/rest/v1/rpc/{fn}` with the
/// project's public key and the signed-in user's access token.
///
/// ```dart
/// final rpc = RewardsHttpRpc(supabaseUrl: env.url, anonKey: env.anonKey, accessToken: () async => session?.accessToken);
/// final rewards = RewardsClient(rpc: rpc.call);
/// ```
///
/// Errors: 404 → [RewardsUnavailableException] `notDeployed`; a 4xx body carrying `rewards: <reason>` →
/// [RewardsException]; any other non-2xx or a body that is not JSON → [RewardsServerError]; no answer →
/// [RewardsNetworkError]. Response bodies are never put in an exception.
class RewardsHttpRpc {
  RewardsHttpRpc({
    required this.supabaseUrl,
    required this.anonKey,
    required this.accessToken,
    this.timeout = const Duration(seconds: 8),
    RewardsHttpTransport? transport,
  }) : _transport = transport ?? _dartIoPost;

  final String? supabaseUrl;

  /// The project's public key; sent as `apikey`. Never a service-role key.
  final String? anonKey;
  final Future<String?> Function() accessToken;
  final Duration timeout;
  final RewardsHttpTransport _transport;

  Future<Object?> call(String fn, Map<String, Object?> params) async {
    final base = supabaseUrl?.trim() ?? '';
    final key = anonKey?.trim() ?? '';
    if (base.isEmpty || key.isEmpty) throw const RewardsUnavailableException(RewardsUnavailableReason.noProject);
    final token = await accessToken();
    if (token == null || token.isEmpty) throw const RewardsUnavailableException(RewardsUnavailableReason.signedOut);

    final root = base.endsWith('/') ? base.substring(0, base.length - 1) : base;
    final url = Uri.parse('$root/rest/v1/rpc/$fn');
    final headers = {
      'apikey': key,
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    final RewardsHttpResponse r;
    try {
      r = await _transport(url, headers, jsonEncode(params), timeout);
    } catch (_) {
      throw RewardsNetworkError(fn);
    }
    if (r.status == 404) throw const RewardsUnavailableException(RewardsUnavailableReason.notDeployed);
    if (r.status < 200 || r.status >= 300) {
      // PostgREST puts the raised message in the body: keep only the reason, never the body.
      final reason = rewardsReasonOf(r.body);
      if (reason != null) throw RewardsException(reason);
      throw RewardsServerError(fn, r.status);
    }
    if (r.body.trim().isEmpty) return null;
    try {
      return jsonDecode(r.body);
    } on FormatException {
      throw RewardsServerError(fn, r.status);
    }
  }
}

Future<RewardsHttpResponse> _dartIoPost(Uri url, Map<String, String> headers, String body, Duration timeout) async {
  final client = HttpClient()..connectionTimeout = timeout;
  try {
    final req = await client.postUrl(url).timeout(timeout);
    headers.forEach(req.headers.set);
    req.add(utf8.encode(body));
    final res = await req.close().timeout(timeout);
    final text = await res.transform(utf8.decoder).join().timeout(timeout);
    return RewardsHttpResponse(res.statusCode, text);
  } finally {
    client.close(force: true);
  }
}
