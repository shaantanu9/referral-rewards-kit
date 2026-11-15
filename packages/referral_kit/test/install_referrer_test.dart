import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

class _Source implements InstallReferrerSource {
  _Source(this.value);
  final String? value;
  int reads = 0;
  @override
  Future<String?> readReferrer() async {
    reads++;
    return value;
  }
}

void main() {
  test('codeFromReferrer', () {
    expect(codeFromReferrer('code=ABCDEFGH'), 'ABCDEFGH');
    expect(codeFromReferrer('code%3DABCDEFGH'), 'ABCDEFGH', reason: 'still encoded');
    expect(codeFromReferrer('utm_source=google-play&code=abcd-efgh'), 'ABCDEFGH');
    expect(codeFromReferrer('utm_source=google-play&utm_medium=organic'), isNull);
    expect(codeFromReferrer('code=ABCD0OIL'), isNull, reason: 'not the code alphabet');
    expect(codeFromReferrer('code=%E0%A4'), isNull);
    expect(codeFromReferrer(null), isNull);
  });

  test('read once per install', () async {
    final store = MemoryKeyValueStore();
    final source = _Source('code=ABCDEFGH');
    final reader = InstallReferrerCodeReader(store: store, source: source);
    expect(await reader.readOnce(), 'ABCDEFGH');
    expect(await reader.readOnce(), isNull);
    expect(source.reads, 1);
  });

  test('Play source returns null off Android', () async {
    expect(await const PlayInstallReferrerSource().readReferrer(), isNull);
  });
}
