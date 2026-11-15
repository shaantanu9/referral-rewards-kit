/// Invite-code text handling (ADR 11.3, 11.7). Mirrors `referral.normalise_code` in
/// `supabase/migrations/20261112000002_referral_codes_claim.sql` so the client sends what the server would compute.
library;

/// The 31 symbols codes are made of: no O, 0, I, 1 or L.
const String codeAlphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/// Left-to-right isolate (U+2066) and pop directional isolate (U+2069), wrapped around the code in share text so a
/// right-to-left message never reorders it.
const String ltrIsolateStart = '\u2066';
const String ltrIsolateEnd = '\u2069';

final RegExp _validCode = RegExp('^[$codeAlphabet]{8}\$');

bool _isRemoved(int c) {
  // Format and dash characters listed in the SQL character class.
  if (c == 0x00AD || c == 0x061C || c == 0x180E || c == 0xFEFF || c == 0x2212 || c == 0x2D) return true;
  if (c >= 0x200B && c <= 0x200F) return true;
  if (c >= 0x202A && c <= 0x202E) return true;
  if (c >= 0x2060 && c <= 0x206F) return true;
  if (c >= 0x2010 && c <= 0x2015) return true;
  // Whitespace, listed explicitly (the SQL lists the same code points instead of `[:space:]`, which depends on the
  // database locale).
  if (c >= 0x09 && c <= 0x0D) return true;
  if (c == 0x20 || c == 0xA0 || c == 0x1680 || c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F) {
    return true;
  }
  if (c >= 0x2000 && c <= 0x200A) return true;
  if (c == 0x3000) return true;
  return false;
}

int _digit(int c) {
  if (c >= 0x0660 && c <= 0x0669) return 0x30 + c - 0x0660; // Arabic-Indic
  if (c >= 0x06F0 && c <= 0x06F9) return 0x30 + c - 0x06F0; // Extended Arabic-Indic
  if (c >= 0x0966 && c <= 0x096F) return 0x30 + c - 0x0966; // Devanagari
  return c;
}

/// The part of NFKC that matters for codes: full-width ASCII forms (U+FF01..U+FF5E) fold to ASCII.
int _foldWidth(int c) => (c >= 0xFF01 && c <= 0xFF5E) ? c - 0xFEE0 : c;

/// Normalises typed or pasted input the way the server does: strips format characters (bidi isolates, zero-width
/// spaces, soft hyphen, BOM), whitespace and dashes; converts Arabic-Indic, Extended Arabic-Indic and Devanagari
/// digits to ASCII; folds full-width letters and digits; upper-cases.
///
/// Same order as the SQL (migration 9): width folding first (so a full-width hyphen becomes `-`), then digits, then
/// removal, then upper-case. The removal list is explicit, so the result never depends on a database locale.
String normaliseCode(String? input) {
  if (input == null || input.isEmpty) return '';
  final out = StringBuffer();
  for (final rune in input.runes) {
    final c = _digit(_foldWidth(rune));
    if (_isRemoved(c)) continue;
    out.writeCharCode(c);
  }
  return out.toString().toUpperCase();
}

/// Whether a normalised string has the shape of a code (8 symbols of [codeAlphabet]).
bool isWellFormedCode(String normalised) => _validCode.hasMatch(normalised);

/// `ABCDEFGH` → `ABCD-EFGH`. Anything that is not 8 characters is returned unchanged.
String formatCode(String code) => code.length == 8 ? '${code.substring(0, 4)}-${code.substring(4)}' : code;

/// Screen-reader label, one letter at a time: `ABCDEFGH` → `A B C D, E F G H` (ADR 11.5).
String spellCode(String code) {
  final c = normaliseCode(code);
  if (c.length != 8) return c.split('').join(' ');
  return '${c.substring(0, 4).split('').join(' ')}, ${c.substring(4).split('').join(' ')}';
}

/// The formatted code wrapped in a left-to-right isolate, for share text (ADR 11.3).
String isolatedCode(String code) => '$ltrIsolateStart${formatCode(code)}$ltrIsolateEnd';
