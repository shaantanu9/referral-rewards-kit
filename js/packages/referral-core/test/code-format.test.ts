// Port of packages/referral_kit/test/code_format_test.dart.
import { describe, expect, it } from 'vitest';
import { formatCode, isolatedCode, isWellFormedCode, normaliseCode, spellCode } from '../src';

describe('normaliseCode: same inputs as supabase/tests/03_codes_claim.test.sql', () => {
  it('trims, removes dash, upper-cases', () => expect(normaliseCode(' abcd-efgh ')).toBe('ABCDEFGH'));
  it('removes bidi isolates from share text', () => expect(normaliseCode('⁦ABCD-EFGH⁩')).toBe('ABCDEFGH'));
  it('removes zero-width space and non-breaking hyphen', () =>
    expect(normaliseCode('AB​CD EF‑GH')).toBe('ABCDEFGH'));
  it('folds full-width letters and digits', () => expect(normaliseCode('ＡＢＣＤ２３４５')).toBe('ABCD2345'));
  it('Devanagari digits', () => expect(normaliseCode('ABCD२३४५')).toBe('ABCD2345'));
  it('Arabic-Indic digits', () => expect(normaliseCode('ABCD٢٣٤٥')).toBe('ABCD2345'));
  it('pasted, lower-case, dashed code', () => expect(normaliseCode('⁦abcd-EFGH⁩')).toBe('ABCDEFGH'));
});

describe('normaliseCode: further cases measured against Postgres 17', () => {
  const removed = [
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x180e, 0x2000, 0x2005, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f,
    0x3000, 0xfeff, 0x00ad, 0x061c, 0x200b, 0x200e, 0x200f, 0x202a, 0x202e, 0x2060, 0x2066, 0x2069, 0x2010, 0x2015,
    0x2212,
  ];
  for (const c of removed) {
    it(`U+${c.toString(16).padStart(4, '0')} is removed`, () =>
      expect(normaliseCode(`A${String.fromCharCode(c)}B`)).toBe('AB'));
  }
  it('U+0085 is kept', () => expect(normaliseCode('A\u0085B')).toBe('A\u0085B'));
  it('full-width hyphen and space are removed', () => {
    expect(normaliseCode('ABCD－EFGH')).toBe('ABCDEFGH');
    expect(normaliseCode('ABCD　EFGH')).toBe('ABCDEFGH');
  });
  it('Extended Arabic-Indic digits', () => expect(normaliseCode('۲۳۴۵')).toBe('2345'));
  it('empty and null', () => {
    expect(normaliseCode(null)).toBe('');
    expect(normaliseCode('')).toBe('');
  });
});

it('isWellFormedCode uses the 31-symbol alphabet', () => {
  expect(isWellFormedCode('ABCD2345')).toBe(true);
  expect(isWellFormedCode('ABCD0OIL')).toBe(false);
  expect(isWellFormedCode('ABCD234')).toBe(false);
});

it('formatCode, spellCode, isolatedCode', () => {
  expect(formatCode('ABCDEFGH')).toBe('ABCD-EFGH');
  expect(formatCode('ABC')).toBe('ABC');
  expect(spellCode('abcd-efgh')).toBe('A B C D, E F G H');
  expect(isolatedCode('ABCDEFGH')).toBe('⁦ABCD-EFGH⁩');
  expect(normaliseCode(isolatedCode('ABCDEFGH'))).toBe('ABCDEFGH');
});
