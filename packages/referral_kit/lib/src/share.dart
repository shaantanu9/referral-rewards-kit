import 'dart:ui' show Rect;

import 'package:share_plus/share_plus.dart';

import 'code_format.dart';
import 'copy.dart';

/// Opens a share sheet with [text]. [origin] is the Share button's rectangle (needed on iPad). A handler may complete
/// with share_plus's `ShareResult` (as [systemShare] does) so `invite_shared` can say whether, and through which app,
/// the user shared; one that completes with nothing reports `status: unavailable`, `channel: unknown`.
typedef ShareHandler = Future<void> Function(String text, Rect? origin);

/// Runs [handler] and returns what its future completed with (a `ShareResult`, or null).
Future<Object?> runShareHandler(ShareHandler handler, String text, Rect? origin) async {
  final Future<Object?> f = handler(text, origin) as Future<Object?>;
  return f;
}

/// The default [ShareHandler]: share_plus's system share sheet, returning its `ShareResult`.
Future<ShareResult> systemShare(String text, Rect? origin) =>
    SharePlus.instance.share(ShareParams(text: text, sharePositionOrigin: origin));

/// [systemShare] (kept for 0.2.0 callers).
Future<ShareResult> systemShareWithResult(String text, Rect? origin) => systemShare(text, origin);

/// The share sheet's answer as a small channel name for analytics. iOS names the activity
/// (`net.whatsapp.WhatsApp.ShareExtension`, `com.apple.UIKit.activity.Message`); Android names the app's package on
/// some versions and nothing on others. Never the raw string: only these buckets, `other` or `unknown`.
String shareChannel(Object? result) {
  if (result is! ShareResult) return 'unknown';
  if (result.status == ShareResultStatus.dismissed) return 'dismissed';
  if (result.status == ShareResultStatus.unavailable) return 'unknown';
  final s = result.raw.toLowerCase();
  if (s.isEmpty || s.startsWith('dev.fluttercommunity.plus/')) return 'unknown';
  const buckets = {
    'whatsapp': 'whatsapp',
    'telegram': 'telegram',
    'instagram': 'instagram',
    'discord': 'discord',
    'messenger': 'messenger',
    'facebook': 'facebook',
    'twitter': 'x',
    'snapchat': 'snapchat',
    'activity.message': 'messages',
    'mms': 'messages',
    'messaging': 'messages',
    'activity.mail': 'mail',
    'android.gm': 'mail',
    'gmail': 'mail',
    'copytopasteboard': 'copy',
    'airdrop': 'airdrop',
  };
  for (final MapEntry(:key, :value) in buckets.entries) {
    if (s.contains(key)) return value;
  }
  return 'other';
}

/// Props of `invite_shared` for what the share handler returned (share_plus `ShareResult`, or anything else).
Map<String, Object> shareEventProps(Object? result, {required bool hasLink}) => {
  'channel': shareChannel(result),
  'status': result is ShareResult ? result.status.name : 'unavailable',
  'has_link': hasLink,
};

/// The invite link for [code], or null when the app has none (no invite page yet), or it is not https.
Uri? resolveInviteLink(Uri? Function(String code)? inviteLink, String code) {
  final link = inviteLink?.call(code);
  if (link == null || link.scheme != 'https' || link.host.isEmpty) return null;
  return link;
}

/// The sentence to share for [code]:
/// - with an invite link: the app's [shareText] (code, link) or the package's sentence from the terms;
/// - without one: the code to type in plus [storeLink] (the app's store page), still naming only rewards the terms
///   give; without a store link either, the code alone.
String inviteShareText({
  required ReferralCopy copy,
  required String appName,
  required String code,
  Uri? link,
  Uri? storeLink,
  String Function(String code, String link)? shareText,
  String Function(String code, String? storeLink)? shareTextNoLink,
}) {
  final shown = formatCode(code);
  if (link != null) {
    return shareText?.call(shown, '$link') ?? copy.shareText(appName: appName, code: code, link: '$link');
  }
  final store = storeLink?.toString();
  return shareTextNoLink?.call(shown, store) ?? copy.shareTextNoLink(appName: appName, code: code, storeLink: store);
}
