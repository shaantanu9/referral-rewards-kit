/**
 * Invite-code text handling (ADR 11.3, 11.7). Mirrors `referral.normalise_code` in
 * `supabase/migrations/20261112000002_referral_codes_claim.sql` so the client sends what the server would compute.
 */

/** The 31 symbols codes are made of: no O, 0, I, 1 or L. */
export const codeAlphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Left-to-right isolate (U+2066) and pop directional isolate (U+2069), wrapped around the code in share text. */
export const ltrIsolateStart = '⁦';
export const ltrIsolateEnd = '⁩';

const validCode = new RegExp(`^[${codeAlphabet}]{8}$`);

function isRemoved(c: number): boolean {
  if (c === 0x00ad || c === 0x061c || c === 0x180e || c === 0xfeff || c === 0x2212 || c === 0x2d) return true;
  if (c >= 0x200b && c <= 0x200f) return true;
  if (c >= 0x202a && c <= 0x202e) return true;
  if (c >= 0x2060 && c <= 0x206f) return true;
  if (c >= 0x2010 && c <= 0x2015) return true;
  if (c >= 0x09 && c <= 0x0d) return true;
  if (c === 0x20 || c === 0xa0 || c === 0x1680 || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f) {
    return true;
  }
  if (c >= 0x2000 && c <= 0x200a) return true;
  if (c === 0x3000) return true;
  return false;
}

function digit(c: number): number {
  if (c >= 0x0660 && c <= 0x0669) return 0x30 + c - 0x0660;
  if (c >= 0x06f0 && c <= 0x06f9) return 0x30 + c - 0x06f0;
  if (c >= 0x0966 && c <= 0x096f) return 0x30 + c - 0x0966;
  return c;
}

const foldWidth = (c: number): number => (c >= 0xff01 && c <= 0xff5e ? c - 0xfee0 : c);

/**
 * Normalises typed or pasted input the way the server does: strips format characters (bidi isolates, zero-width
 * spaces, soft hyphen, BOM), whitespace and dashes; converts Arabic-Indic, Extended Arabic-Indic and Devanagari digits
 * to ASCII; folds full-width letters and digits; upper-cases. Same order as the SQL.
 */
export function normaliseCode(input: string | null | undefined): string {
  if (input == null || input === '') return '';
  let out = '';
  for (const ch of input) {
    const c = digit(foldWidth(ch.codePointAt(0)!));
    if (isRemoved(c)) continue;
    out += String.fromCodePoint(c);
  }
  return out.toUpperCase();
}

/** Whether a normalised string has the shape of a code (8 symbols of [codeAlphabet]). */
export const isWellFormedCode = (normalised: string): boolean => validCode.test(normalised);

/** `ABCDEFGH` → `ABCD-EFGH`. Anything that is not 8 characters is returned unchanged. */
export const formatCode = (code: string): string =>
  code.length === 8 ? `${code.substring(0, 4)}-${code.substring(4)}` : code;

/** Screen-reader label, one letter at a time: `ABCDEFGH` → `A B C D, E F G H` (ADR 11.5). */
export function spellCode(code: string): string {
  const c = normaliseCode(code);
  if (c.length !== 8) return c.split('').join(' ');
  return `${c.substring(0, 4).split('').join(' ')}, ${c.substring(4).split('').join(' ')}`;
}

/** The formatted code wrapped in a left-to-right isolate, for share text (ADR 11.3). */
export const isolatedCode = (code: string): string => `${ltrIsolateStart}${formatCode(code)}${ltrIsolateEnd}`;
