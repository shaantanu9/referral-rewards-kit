// Port of packages/referral_kit/test/install_referrer_test.dart and terms_days_left_test.dart.
import { expect, it } from 'vitest';
import { codeFromReferrer, InstallReferrerCodeReader, MemoryKeyValueStore, noInstallReferrer, ReferralTerms } from '../src';

it('codeFromReferrer', () => {
  expect(codeFromReferrer('code=ABCDEFGH')).toBe('ABCDEFGH');
  expect(codeFromReferrer('code%3DABCDEFGH')).toBe('ABCDEFGH');
  expect(codeFromReferrer('utm_source=google-play&code=abcd-efgh')).toBe('ABCDEFGH');
  expect(codeFromReferrer('utm_source=google-play&utm_medium=organic')).toBeNull();
  expect(codeFromReferrer('code=ABCD0OIL')).toBeNull();
  expect(codeFromReferrer('code=%E0%A4')).toBeNull();
  expect(codeFromReferrer(null)).toBeNull();
});

it('reads the referrer once per install', async () => {
  const store = new MemoryKeyValueStore();
  let reads = 0;
  const reader = new InstallReferrerCodeReader({
    store,
    source: { readReferrer: async () => (reads++, 'code=ABCDEFGH') },
  });
  expect(await reader.readOnce()).toBe('ABCDEFGH');
  expect(await reader.readOnce()).toBeNull();
  expect(reads).toBe(1);
});

it('the default source has no referrer', async () => {
  expect(await noInstallReferrer.readReferrer()).toBeNull();
  expect(await new InstallReferrerCodeReader({ store: new MemoryKeyValueStore() }).readOnce()).toBeNull();
});

it('referral_terms carries the server count of days left to add a code', () => {
  const t = ReferralTerms.fromJson({ enabled: true, paid_enabled: true, rules: [], claim_days_left: 2 });
  expect(t.claimDaysLeft).toBe(2);
  expect(t.hasClaimDaysLeft).toBe(true);
});

it('older servers without claim_days_left give null', () => {
  const t = ReferralTerms.fromJson({ enabled: true, paid_enabled: true, rules: [] });
  expect(t.claimDaysLeft).toBeNull();
  expect(t.hasClaimDaysLeft).toBe(false);
});
