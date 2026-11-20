// The code in an invite link, for the app's own routing. Copy as is.
//
// The invite page lives at `https://<site>/i/<CODE>`. With App Links (Android) and Associated Domains (iOS) the same
// URL opens the app, and Flutter hands the path (`/i/<CODE>`) to the navigator as a route name. A link may also carry
// `?code=` (a route of the app's own, or a custom scheme). The package's `codeFromReferrer` covers the Play install
// referrer; this covers the link.
import 'package:referral_kit/referral_kit.dart';

/// The normalised code in [link] (a full URL or a route like `/i/H4PZ-8WNE`), or null when it carries no
/// well-formed code.
String? codeFromInviteLink(String link) {
  final uri = Uri.tryParse(link);
  if (uri == null) return null;
  final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  final i = segments.indexOf('i');
  final raw = (i >= 0 && i + 1 < segments.length) ? segments[i + 1] : uri.queryParameters['code'];
  final code = normaliseCode(raw);
  return isWellFormedCode(code) ? code : null;
}
