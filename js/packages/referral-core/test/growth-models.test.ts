// Port of packages/referral_kit/test/growth_models_test.dart, reading the real SQL fixtures of the Dart package.
import { describe, expect, it } from 'vitest';
import {
  MyClaim,
  MyClaimReward,
  myClaimStateFromWire,
  MyClaimState,
  MyCodeResult,
  ReferralBoost,
  ReferralClient,
  ReferralPreferences,
  ReferralTerms,
  ReferralUnavailableException,
  displayNameProblem,
  FixedInstallIdStore,
  type ReferralEvent,
} from '../src';
import myClaimClaimedFx from '../../../../packages/referral_kit/test/fixtures/growth/my_claim_claimed.json';
import myClaimExpiredFx from '../../../../packages/referral_kit/test/fixtures/growth/my_claim_expired.json';
import myClaimJoinedFx from '../../../../packages/referral_kit/test/fixtures/growth/my_claim_joined.json';
import myClaimNoneFx from '../../../../packages/referral_kit/test/fixtures/growth/my_claim_none.json';
import myCodeLeftFx from '../../../../packages/referral_kit/test/fixtures/growth/my_code_left.json';
import prefsFx from '../../../../packages/referral_kit/test/fixtures/growth/preferences.json';
import prefsDefaultFx from '../../../../packages/referral_kit/test/fixtures/growth/preferences_default.json';
import prefsInvalidFx from '../../../../packages/referral_kit/test/fixtures/growth/preferences_invalid_name.json';
import prefsLeftFx from '../../../../packages/referral_kit/test/fixtures/growth/preferences_left.json';
import termsBoostFx from '../../../../packages/referral_kit/test/fixtures/growth/terms_boost.json';
import { boostJson, myClaimClaimed, myClaimExpired, myClaimJoined, myClaimNone, prefsJson } from './growth-json';
import { clientFor, FakeRpc, termsJson, testInstallId } from './support';

const utc = (...a: [number, number, number, number?, number?]): Date =>
  new Date(Date.UTC(a[0], a[1] - 1, a[2], a[3] ?? 0, a[4] ?? 0));

describe('ReferralBoost in the terms', () => {
  it('parsed from referral_terms().boost', () => {
    const b = ReferralTerms.fromJson({ ...termsJson(), boost: boostJson() }).boost!;
    expect(b.multiplier).toBe(2);
    expect(b.endsAt).toEqual(utc(2026, 11, 24));
    expect(b.startsAt).toEqual(utc(2026, 11, 17));
    expect(b.events).toEqual(['joined']);
    expect(b.forSharer && b.forFriend).toBe(true);
  });

  it('null, absent or malformed boost → none', () => {
    expect(ReferralTerms.fromJson(termsJson()).boost).toBeNull();
    expect(ReferralTerms.fromJson({ ...termsJson(), boost: null }).boost).toBeNull();
    expect(ReferralTerms.fromJson({ ...termsJson(), boost: 'x' }).boost).toBeNull();
    expect(ReferralTerms.fromJson({ ...termsJson(), boost: { multiplier: 2 } }).boost).toBeNull();
    expect(ReferralTerms.fromJson({ ...termsJson(), boost: boostJson({ multiplier: 1 }) }).boost).toBeNull();
  });

  it('boostAt hides an ended boost (end is exclusive)', () => {
    const t = ReferralTerms.fromJson({ ...termsJson(), boost: boostJson() });
    expect(t.boostAt(utc(2026, 11, 23, 23, 59))).not.toBeNull();
    expect(t.boostAt(utc(2026, 11, 24))).toBeNull();
    expect(t.boostAt(utc(2026, 11, 16))).toBeNull();
  });

  it('tolerant: string multiplier, missing lists', () => {
    const b = ReferralBoost.tryParse({ ends_at: '2026-11-24T00:00:00Z', multiplier: '3' })!;
    expect(b.multiplier).toBe(3);
    expect(b.who).toEqual(['sharer', 'friend']);
    expect(b.startsAt).toBeNull();
  });
});

describe('ReferralPreferences', () => {
  it('defaults and values', () => {
    const p = ReferralPreferences.fromJson(prefsJson);
    expect([p.showName, p.displayName, p.participating, p.isOk]).toEqual([false, null, true, true]);
    const q = ReferralPreferences.fromJson({ show_name: true, display_name: 'Priya', participating: false });
    expect([q.showName, q.displayName, q.participating]).toEqual([true, 'Priya', false]);
  });
  it('a refusal carries its reason', () => {
    for (const r of ['under_age', 'anonymous_user', 'invalid_name']) {
      const p = ReferralPreferences.fromJson({ reason: r });
      expect(p.reason).toBe(r);
      expect(p.isOk).toBe(false);
    }
  });
  it('display names are checked like the server', () => {
    expect(displayNameProblem('Priya')).toBeNull();
    expect(displayNameProblem('  Anaïs ')).toBeNull();
    expect(displayNameProblem('प्रिया')).toBeNull();
    expect(displayNameProblem('   ')).toBe('empty');
    expect(displayNameProblem('a'.repeat(41))).toBe('too_long');
    expect(displayNameProblem('a'.repeat(40))).toBeNull();
    expect(displayNameProblem('1234')).toBe('no_letter');
    expect(displayNameProblem('me@x.com')).toBe('email_or_link');
    expect(displayNameProblem('https://spam')).toBe('email_or_link');
  });
});

describe('MyClaim', () => {
  it('none', () => expect(MyClaim.fromJson(myClaimNone).state).toBe(MyClaimState.none));
  it('claimed with days left and a boosted reward', () => {
    const c = MyClaim.fromJson(myClaimClaimed);
    expect(c.state).toBe(MyClaimState.claimed);
    expect(c.daysLeft).toBe(12);
    expect(c.claimedAt).toEqual(utc(2026, 11, 20, 8));
    expect(c.activateBy).toEqual(utc(2026, 12, 2, 8));
    const r = c.rewards[0]!;
    expect([r.kind, r.amount, r.baseAmount, r.boosted]).toEqual(['minutes', 60, 30, true]);
  });
  it('joined and expired', () => {
    expect(MyClaim.fromJson(myClaimJoined).state).toBe(MyClaimState.joined);
    expect(MyClaim.fromJson(myClaimJoined).joinedAt).toEqual(utc(2026, 11, 21, 9, 30));
    expect(MyClaim.fromJson(myClaimExpired).state).toBe(MyClaimState.expired);
  });
  it('later states map to joined; missing to none', () => {
    for (const s of ['paid', 'void', 'something_new']) expect(myClaimStateFromWire(s)).toBe(MyClaimState.joined);
    expect(MyClaim.fromJson({}).state).toBe(MyClaimState.none);
    expect(myClaimStateFromWire('no_referral')).toBe(MyClaimState.none);
  });
  it('a reward without base_amount is not boosted and has base = amount', () => {
    const r = MyClaimReward.fromJson({ kind: 'minutes', amount: 30 });
    expect(r.baseAmount).toBe(30);
    expect(r.boosted).toBe(false);
  });
});

it('referral_my_code {left: true} has no code', () => {
  const r = MyCodeResult.fromJson({ left: true });
  expect([r.left, r.code, r.hasCode]).toEqual([true, null, false]);
  expect(MyCodeResult.fromJson({ code: 'ABCDEFGH', reason: 'ok' }).left).toBe(false);
});

describe('client calls send the install id', () => {
  it('preferences, setPreferences (only given keys), myClaim', async () => {
    const rpc = new FakeRpc({
      referral_preferences: prefsJson,
      referral_preferences_set: () => ({ show_name: true, display_name: 'Priya', participating: true }),
      referral_my_claim: myClaimClaimed,
    });
    const c = clientFor(rpc);
    expect((await c.preferences()).participating).toBe(true);
    expect((await c.setPreferences({ showName: true, displayName: ' Priya ' })).displayName).toBe('Priya');
    await c.setPreferences({ participating: false });
    await c.setPreferences({ displayName: '' });
    expect((await c.myClaim()).state).toBe(MyClaimState.claimed);
    expect(rpc.calls.every(([, p]) => p['install_id'] === testInstallId)).toBe(true);
    expect(rpc.calls.filter(([fn]) => fn === 'referral_preferences_set').map(([, p]) => p['prefs'])).toEqual([
      { show_name: true, display_name: 'Priya' },
      { participating: false },
      { display_name: null },
    ]);
  });

  it('an older server without the new RPCs is not reported as hidden', async () => {
    const events: ReferralEvent[] = [];
    const c = new ReferralClient({
      rpc: async () => {
        throw new ReferralUnavailableException('not_deployed');
      },
      installIds: new FixedInstallIdStore(testInstallId),
      onEvent: (e) => events.push(e),
    });
    await expect(c.myClaim()).rejects.toBeInstanceOf(ReferralUnavailableException);
    await expect(c.preferences()).rejects.toBeInstanceOf(ReferralUnavailableException);
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toHaveLength(0);
  });
});

describe('fixtures from the real SQL (packages/referral_kit/test/fixtures/growth)', () => {
  it('terms_boost', () => {
    const t = ReferralTerms.fromJson(termsBoostFx);
    const b = t.boost!;
    expect(b.multiplier).toBe(2);
    expect(b.startsAt).toEqual(new Date('2026-11-20T12:38:26.219Z'));
    expect(b.endsAt).toEqual(new Date('2026-11-27T12:38:26.219Z'));
    expect(b.events).toEqual(['joined']);
    expect(t.boostAt(utc(2026, 11, 21))).not.toBeNull();
    expect(t.boostAt(utc(2026, 11, 28))).toBeNull();
    expect(t.rule('joined', 'friend')!.amount).toBe(30);
    expect(t.claimDaysLeft).toBe(7);
  });
  it('my_claim_*', () => {
    const c = MyClaim.fromJson(myClaimClaimedFx);
    expect(c.state).toBe(MyClaimState.claimed);
    expect(c.daysLeft).toBe(30);
    const r = c.rewards[0]!;
    expect([r.kind, r.amount, r.baseAmount, r.boosted]).toEqual(['minutes', 60, 30, true]);
    expect(MyClaim.fromJson(myClaimJoinedFx).state).toBe(MyClaimState.joined);
    expect(MyClaim.fromJson(myClaimJoinedFx).joinedAt).not.toBeNull();
    expect(MyClaim.fromJson(myClaimExpiredFx).state).toBe(MyClaimState.expired);
    expect(MyClaim.fromJson(myClaimNoneFx).state).toBe(MyClaimState.none);
  });
  it('preferences*', () => {
    const p = ReferralPreferences.fromJson(prefsFx);
    expect([p.showName, p.displayName, p.participating, p.isOk]).toEqual([true, 'Priya', true, true]);
    const d = ReferralPreferences.fromJson(prefsDefaultFx);
    expect([d.showName, d.displayName, d.participating]).toEqual([false, null, true]);
    expect(ReferralPreferences.fromJson(prefsLeftFx).participating).toBe(false);
    expect(ReferralPreferences.fromJson(prefsInvalidFx).reason).toBe('invalid_name');
  });
  it('my_code_left and under_age', () => {
    const r = MyCodeResult.fromJson(myCodeLeftFx);
    expect([r.left, r.code, r.reason]).toEqual([true, null, 'left']);
    const u = MyCodeResult.fromJson({ code: null, reason: 'under_age' });
    expect([u.code, u.left, u.reason]).toEqual([null, false, 'under_age']);
  });
});
