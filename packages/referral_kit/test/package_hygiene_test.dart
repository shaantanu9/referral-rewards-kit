import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// ADR 14: the package imports nothing app-specific.
void main() {
  test('lib/ imports only the SDK, its declared dependencies and itself', () {
    const allowed = [
      'dart:',
      'package:flutter/',
      'package:flutter_localizations/',
      'package:flutter_secure_storage/',
      'package:intl/',
      'package:play_install_referrer/',
      'package:qr_flutter/',
      'package:share_plus/',
      'package:shared_preferences/',
      'package:url_launcher/',
      'package:referral_kit/',
    ];
    final bad = <String>[];
    for (final f in Directory(
      'lib',
    ).listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart'))) {
      for (final m in RegExp(r'''^(?:import|export) '([^']+)';''', multiLine: true).allMatches(f.readAsStringSync())) {
        final uri = m.group(1)!;
        if (!uri.contains(':')) continue;
        if (!allowed.any(uri.startsWith)) bad.add('${f.path}: $uri');
      }
    }
    expect(bad, isEmpty);
  });
}
