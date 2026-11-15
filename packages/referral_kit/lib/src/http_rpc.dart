import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'availability.dart';

/// One HTTP answer: status and body text.
class ReferralHttpResponse {
  const ReferralHttpResponse(this.status, this.body);
  final int status;
  final String body;
}

/// Sends one POST. Replace it in tests, or to reuse your app's HTTP client
/// (`(url, headers, body, timeout) async { final r = await http.post(url, headers: headers, body: body)
/// .timeout(timeout); return ReferralHttpResponse(r.statusCode, r.body); }`).
typedef ReferralHttpTransport =
    Future<ReferralHttpResponse> Function(Uri url, Map<String, String> headers, String body, Duration timeout);

/// A [ReferralRpc] over raw HTTP, for apps without supabase_flutter: `POST {supabaseUrl}/rest/v1/rpc/{fn}` with the
/// project's public (anon / publishable) key and the signed-in user's access token, and the decoded body back.
///
/// ```dart
/// final rpc = ReferralHttpRpc(
///   supabaseUrl: env.supabaseUrl,        // null or empty: ReferralUnavailableException(noProject)
///   anonKey: env.supabaseAnonKey,
///   accessToken: () async => session?.accessToken,  // null: ReferralUnavailableException(signedOut)
/// );
/// final referrals = ReferralClient(rpc: rpc.call, installIds: DefaultInstallIdStore());
/// if (!(await referrals.availability()).isAvailable) hideInviteEntry();
/// ```
///
/// Errors: 404 (PostgREST's "function not found", `PGRST202`) → [ReferralUnavailableException] `notDeployed`; any other
/// non-2xx status or a body that is not JSON → [ReferralServerError]; no answer or a timeout →
/// [ReferralNetworkError]. Response bodies are never put in an exception (they may echo user data).
class ReferralHttpRpc {
  ReferralHttpRpc({
    required this.supabaseUrl,
    required this.anonKey,
    required this.accessToken,
    this.timeout = const Duration(seconds: 8),
    ReferralHttpTransport? transport,
  }) : _transport = transport ?? _dartIoPost;

  /// `https://<ref>.supabase.co` (a trailing slash is fine).
  final String? supabaseUrl;

  /// The project's public key; sent as `apikey`. Never a service-role key.
  final String? anonKey;

  /// The signed-in user's JWT, or null when signed out.
  final Future<String?> Function() accessToken;
  final Duration timeout;
  final ReferralHttpTransport _transport;

  /// The [ReferralRpc] function. Pass `rpc.call` to `ReferralClient`.
  Future<Object?> call(String fn, Map<String, Object?> params) async {
    final base = supabaseUrl?.trim() ?? '';
    final key = anonKey?.trim() ?? '';
    if (base.isEmpty || key.isEmpty) throw const ReferralUnavailableException(ReferralUnavailableReason.noProject);
    final token = await accessToken();
    if (token == null || token.isEmpty) throw const ReferralUnavailableException(ReferralUnavailableReason.signedOut);

    final root = base.endsWith('/') ? base.substring(0, base.length - 1) : base;
    final url = Uri.parse('$root/rest/v1/rpc/$fn');
    final headers = {
      'apikey': key,
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    final ReferralHttpResponse r;
    try {
      r = await _transport(url, headers, jsonEncode(params), timeout);
    } catch (_) {
      throw ReferralNetworkError(fn);
    }
    if (r.status == 404) throw const ReferralUnavailableException(ReferralUnavailableReason.notDeployed);
    if (r.status < 200 || r.status >= 300) throw ReferralServerError(fn, r.status);
    if (r.body.trim().isEmpty) return null;
    try {
      return jsonDecode(r.body);
    } on FormatException {
      throw ReferralServerError(fn, r.status);
    }
  }
}

Future<ReferralHttpResponse> _dartIoPost(Uri url, Map<String, String> headers, String body, Duration timeout) async {
  final client = HttpClient()..connectionTimeout = timeout;
  try {
    final req = await client.postUrl(url).timeout(timeout);
    headers.forEach(req.headers.set);
    req.add(utf8.encode(body));
    final res = await req.close().timeout(timeout);
    final text = await res.transform(utf8.decoder).join().timeout(timeout);
    return ReferralHttpResponse(res.statusCode, text);
  } finally {
    client.close(force: true);
  }
}
