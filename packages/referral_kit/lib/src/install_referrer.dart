import 'package:flutter/foundation.dart';
import 'package:play_install_referrer/play_install_referrer.dart';

import 'code_format.dart';
import 'storage.dart';

/// Reads the raw install referrer string the store recorded for this install, or null.
abstract class InstallReferrerSource {
  Future<String?> readReferrer();
}

/// Google Play Install Referrer API through the `play_install_referrer` plugin (BSD-2-Clause). Android only;
/// null elsewhere and on any error (no Play Store, sideloaded build, API unavailable).
class PlayInstallReferrerSource implements InstallReferrerSource {
  const PlayInstallReferrerSource();

  @override
  Future<String?> readReferrer() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return null;
    try {
      final details = await PlayInstallReferrer.installReferrer;
      return details.installReferrer;
    } catch (_) {
      return null;
    }
  }
}

/// Pulls the invite code out of a referrer string. The invite page links Play with
/// `&referrer=code%3DABCDEFGH`, which Play hands back as `code=ABCDEFGH`; a still-encoded value and other
/// parameters (`utm_source=…&code=…`) are accepted too. Returns the normalised code, or null when there is no
/// well-formed one.
String? codeFromReferrer(String? referrer) {
  if (referrer == null || referrer.isEmpty) return null;
  var text = referrer;
  for (var i = 0; i < 2 && text.contains('%'); i++) {
    try {
      text = Uri.decodeComponent(text);
    } on FormatException {
      break;
    } on ArgumentError {
      break;
    }
  }
  for (final part in text.split('&')) {
    final eq = part.indexOf('=');
    if (eq <= 0 || part.substring(0, eq).trim() != 'code') continue;
    final code = normaliseCode(part.substring(eq + 1));
    if (isWellFormedCode(code)) return code;
  }
  return null;
}

/// Reads the install referrer once per install (ADR 4.2): the first call asks the source and remembers that it
/// did; later calls return null, so a code the user dismissed is never offered again.
class InstallReferrerCodeReader {
  InstallReferrerCodeReader({required KeyValueStore store, InstallReferrerSource? source})
    : _store = store,
      _source = source ?? const PlayInstallReferrerSource();

  final KeyValueStore _store;
  final InstallReferrerSource _source;
  static const readKey = 'install_referrer_read';

  /// The code to prefill, or null.
  Future<String?> readOnce() async {
    if (await _store.getString(readKey) != null) return null;
    final raw = await _source.readReferrer();
    await _store.setString(readKey, '1');
    return codeFromReferrer(raw);
  }
}
