// The generated locale objects and the ICU runtime against the Dart behaviour (Intl.pluralLogic).
import { describe, expect, it } from 'vitest';
import {
  formatIcu,
  referralLocalizations,
  referralMessageParams,
  referralMessagesEn,
  referralMessagesHi,
  referralMessagesId,
  resolveReferralLocale,
  t,
} from '../src';

describe('locale objects', () => {
  it('hi and id have every key of en, with the same placeholders', () => {
    const keys = Object.keys(referralMessagesEn);
    expect(keys.length).toBeGreaterThan(100);
    for (const m of [referralMessagesHi, referralMessagesId]) {
      expect(Object.keys(m).sort()).toEqual([...keys].sort());
      for (const k of keys as Array<keyof typeof referralMessageParams>) {
        for (const p of referralMessageParams[k]) expect(m[k], `${k} uses {${p}}`).toContain(p);
      }
    }
  });

  it('every message formats in every locale', () => {
    for (const loc of ['en', 'hi', 'id']) {
      const l = referralLocalizations(loc) as unknown as Record<string, unknown>;
      for (const [k, ps] of Object.entries(referralMessageParams)) {
        const v = l[k];
        const s = typeof v === 'function' ? (v as (...a: unknown[]) => string)(...ps.map((_, i) => (i === 0 ? 2 : 'X'))) : v;
        expect(typeof s).toBe('string');
        expect(s as string).not.toMatch(/[{}]/);
      }
    }
  });

  it('resolves locales and falls back to English', () => {
    expect(resolveReferralLocale('hi-IN')).toBe('hi');
    expect(resolveReferralLocale('id_ID')).toBe('id');
    expect(resolveReferralLocale('fr')).toBeNull();
    expect(referralLocalizations('fr').localeName).toBe('en');
    expect(referralLocalizations('fr').inviteTitle).toBe('Invite friends');
    expect(t('hi').inviteTitle).toBe('दोस्तों को बुलाएँ');
  });

  it('plurals: =1 then other in English', () => {
    const en = referralLocalizations('en');
    expect(en.skippedCap(1)).toBe('1 reward was over the limit');
    expect(en.skippedCap(0)).toBe('0 rewards were over the limit');
    expect(en.skippedCap(3)).toBe('3 rewards were over the limit');
  });

  it("Hindi 0 takes the 'one' case, like Dart's Intl.pluralLogic (CLDR: hi one = 0 or 1)", () => {
    expect(formatIcu('{n, plural, =1{one} other{many}}', { n: 0 }, 'hi')).toBe('one');
    expect(formatIcu('{n, plural, =1{one} other{many}}', { n: 0 }, 'en')).toBe('many');
    expect(formatIcu('{n, plural, =0{none} =1{one} other{{n} items}}', { n: 0 }, 'en')).toBe('none');
    expect(formatIcu('{x, select, a{A} other{O}}', { x: 'b' }, 'en')).toBe('O');
  });
});

describe('overrides', () => {
  it('an ICU string or a function per key', () => {
    const l = referralLocalizations('en', {
      inviteTitle: 'Bring a friend',
      skippedCap: '{count, plural, =1{one extra} other{{count} extra}}',
      joinedCount: (n) => `${n} pals`,
    });
    expect(l.inviteTitle).toBe('Bring a friend');
    expect(l.skippedCap(1)).toBe('one extra');
    expect(l.skippedCap(4)).toBe('4 extra');
    expect(l.joinedCount(2)).toBe('2 pals');
    expect(l.share).toBe('Share');
  });

  it('a language the kit lacks keeps its own plural rules', () => {
    const l = referralLocalizations('fr-FR', { skippedCap: '{count, plural, one{{count} récompense} other{{count} récompenses}}' });
    expect(l.localeName).toBe('fr');
    expect(l.skippedCap(0)).toBe('0 récompense');
    expect(l.skippedCap(2)).toBe('2 récompenses');
  });
});
