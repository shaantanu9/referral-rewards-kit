import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

void main() {
  group('normaliseCode: same inputs as supabase/tests/03_codes_claim.test.sql', () {
    test('trims, removes dash, upper-cases', () => expect(normaliseCode(' abcd-efgh '), 'ABCDEFGH'));
    test('removes bidi isolates from share text', () => expect(normaliseCode('\u2066ABCD-EFGH\u2069'), 'ABCDEFGH'));
    test('removes zero-width space and non-breaking hyphen', () {
      expect(normaliseCode('AB\u200bCD EF\u2011GH'), 'ABCDEFGH');
    });
    test('folds full-width letters and digits', () {
      expect(normaliseCode('ＡＢＣＤ２３４５'), 'ABCD2345');
    });
    test('Devanagari digits', () => expect(normaliseCode('ABCD२३४५'), 'ABCD2345'));
    test('Arabic-Indic digits', () => expect(normaliseCode('ABCD٢٣٤٥'), 'ABCD2345'));
    test('pasted, lower-case, dashed code (the claim test)', () {
      expect(normaliseCode('\u2066abcd-EFGH\u2069'), 'ABCDEFGH');
    });
  });

  group('normaliseCode: further cases measured against Postgres 17 (en_US.UTF-8)', () {
    final removed = <int>[
      0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x180E, //
      0x2000, 0x2005, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF, 0x00AD, 0x061C,
      0x200B, 0x200E, 0x200F, 0x202A, 0x202E, 0x2060, 0x2066, 0x2069, 0x2010, 0x2015, 0x2212,
    ];
    for (final c in removed) {
      test('U+${c.toRadixString(16).padLeft(4, '0')} is removed', () {
        expect(normaliseCode('A${String.fromCharCode(c)}B'), 'AB');
      });
    }
    test('U+0085 is kept (not [:space:] in Postgres)', () => expect(normaliseCode('A\u0085B'), 'A\u0085B'));
    test('full-width hyphen and space are removed (width folding runs first)', () {
      expect(normaliseCode('ABCD－EFGH'), 'ABCDEFGH');
      expect(normaliseCode('ABCD\u3000EFGH'), 'ABCDEFGH');
    });
    test('Extended Arabic-Indic digits', () => expect(normaliseCode('۲۳۴۵'), '2345'));
    test('empty and null', () {
      expect(normaliseCode(null), '');
      expect(normaliseCode(''), '');
    });
  });

  test('isWellFormedCode uses the 31-symbol alphabet', () {
    expect(isWellFormedCode('ABCD2345'), isTrue);
    expect(isWellFormedCode('ABCD0OIL'), isFalse);
    expect(isWellFormedCode('ABCD234'), isFalse);
  });

  test('formatCode, spellCode, isolatedCode', () {
    expect(formatCode('ABCDEFGH'), 'ABCD-EFGH');
    expect(formatCode('ABC'), 'ABC');
    expect(spellCode('abcd-efgh'), 'A B C D, E F G H');
    expect(isolatedCode('ABCDEFGH'), '\u2066ABCD-EFGH\u2069');
    expect(normaliseCode(isolatedCode('ABCDEFGH')), 'ABCDEFGH');
  });
}
