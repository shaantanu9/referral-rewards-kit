// Port of packages/referral_kit/test/client_test.dart.
import { describe, expect, it } from 'vitest';
import {
  ActivationResult,
  ClaimReason,
  ClaimResult,
  MyCodeResult,
  ReferralFormatException,
  ReferralStats,
  ReferralTerms,
} from '../src';
import { clientFor, FakeRpc, statsJson, termsJson, testInstallId } from './support';

it('every call sends install_id, claim sends the normalised code', async () => {
  const rpc = new FakeRpc();
  const c = clientFor(rpc);
  await c.myCode();
  await c.rotateCode();
  await c.claim('⁦abcd-efgh⁩');
  await c.terms();
  await c.checkActivation();
  await c.stats();
  await c.pending();
  await c.ack(['r1', 'r2']);
  expect(rpc.names).toEqual([
    'referral_my_code',
    'referral_rotate_code',
    'referral_claim',
    'referral_terms',
    'referral_check_activation',
    'referral_stats',
    'referral_pending',
    'referral_ack',
  ]);
  for (const [, params] of rpc.calls) expect(params['install_id']).toBe(testInstallId);
  expect(rpc.calls[2]![1]).toEqual({ code: 'ABCDEFGH', install_id: testInstallId });
  expect(rpc.calls[7]![1]['reward_ids']).toEqual(['r1', 'r2']);
});

it('ack with no ids makes no call', async () => {
  const rpc = new FakeRpc();
  expect(await clientFor(rpc).ack([])).toBe(0);
  expect(rpc.calls).toHaveLength(0);
});

it('a JSON string result (raw HTTP) is decoded', async () => {
  const rpc = new FakeRpc({ referral_claim: JSON.stringify({ reason: 'ok', days_left: 29 }) });
  const r = await clientFor(rpc).claim('ABCDEFGH');
  expect(r.isOk).toBe(true);
  expect(r.daysLeft).toBe(29);
});

describe('claim reasons (ADR 7)', () => {
  const wire: Record<string, ClaimReason> = {
    ok: ClaimReason.ok,
    own_code: ClaimReason.ownCode,
    already_referred: ClaimReason.alreadyReferred,
    unknown_code: ClaimReason.unknownCode,
    window_closed: ClaimReason.windowClosed,
    rate_limited: ClaimReason.rateLimited,
    not_verified: ClaimReason.notVerified,
    anonymous_user: ClaimReason.anonymousUser,
    same_install: ClaimReason.sameInstall,
    program_paused: ClaimReason.programPaused,
    under_age: ClaimReason.underAge,
    something_new: ClaimReason.unknown,
  };
  for (const [w, reason] of Object.entries(wire)) {
    it(w, () => expect(ClaimResult.fromJson({ reason: w }).reason).toBe(reason));
  }
  it('rate_limited carries retry_after_seconds', () =>
    expect(ClaimResult.fromJson({ reason: 'rate_limited', retry_after_seconds: 3541 }).retryAfterSeconds).toBe(3541));
  it('unknown keeps the raw reason', () => expect(ClaimResult.fromJson({ reason: 'x' }).rawReason).toBe('x'));
});

it('my_code shapes', async () => {
  const paused = MyCodeResult.fromJson({ code: null, reason: 'program_paused' });
  expect(paused.hasCode).toBe(false);
  expect(paused.reason).toBe('program_paused');
  const r = await clientFor(new FakeRpc()).rotateCode();
  expect(r.reason).toBe('too_soon');
  expect(r.nextAllowedAt).toEqual(new Date(Date.UTC(2026, 11, 1)));
});

it('terms', async () => {
  const t = await clientFor(new FakeRpc()).terms();
  expect(t.enabled).toBe(true);
  expect(t.paidEnabled).toBe(true);
  expect(t.ruleSetVersion).toBe(1);
  expect(t.rules).toHaveLength(3);
  expect(t.rule('paid', 'sharer')!.params['entitlement_id']).toBe('premium');
  expect(t.rule('joined', 'friend')!.amount).toBe(30);
  expect([t.claimWindowDays, t.activateWindowDays, t.paidWindowDays, t.holdHours]).toEqual([7, 30, 90, 72]);
  expect([t.sharerJoinsPer30d, t.sharerPaidPer365d]).toEqual([10, 6]);
  expect(ReferralTerms.fromJson(termsJson({ paidEnabled: false })).rule('paid', 'sharer')).toBeNull();
  expect(ReferralTerms.fromJson({ ...termsJson(), rule_set_version: null, rules: [] }).rules).toHaveLength(0);
});

it('stats', async () => {
  const s = await clientFor(new FakeRpc()).stats();
  expect(s.rewardsGranted[0]!.at).toEqual(new Date('2026-11-10T08:15:30.123Z'));
  expect(s.pending[0]!.availableAt).toEqual(new Date(Date.UTC(2026, 10, 15, 9)));
  expect(s.banked[0]!.kind).toBe('entitlement_days');
  expect(s.skippedCap).toBe(2);
  expect(s.joinedCount).toBe(4);
  expect(s.paidCount).toBe(1);
  const empty = ReferralStats.fromJson(statsJson(true));
  expect(empty.isEmpty).toBe(true);
  expect(empty.joinedCount).toBeNull();
  expect(empty.claimedCount).toBeNull();
  const waiting = ReferralStats.fromJson({ ...statsJson(true), claimed_count: 1, joined_count: 0 });
  expect(waiting.claimedCount).toBe(1);
  expect(waiting.joinedCount).toBe(0);
  expect(waiting.isEmpty).toBe(false);
});

it('pending and ack', async () => {
  const c = clientFor(new FakeRpc());
  const p = await c.pending();
  expect(p.map((r) => r.state)).toEqual(['granted', 'banked']);
  expect(p[0]!.params).toEqual({});
  expect(p[1]!.params['entitlement_id']).toBe('premium');
  expect(await c.ack([p[0]!.id])).toBe(1);
});

it('check_activation', async () => {
  expect((await clientFor(new FakeRpc()).checkActivation()).joined).toBe(true);
  expect(ActivationResult.fromJson({ state: 'no_referral' }).joined).toBe(false);
});

it('a wrong shape raises ReferralFormatException', async () => {
  await expect(clientFor(new FakeRpc({ referral_terms: [1, 2] })).terms()).rejects.toBeInstanceOf(ReferralFormatException);
});

it('accepts Postgres text timestamps and keeps instants exact', async () => {
  const s = ReferralStats.fromJson({ ...statsJson(true), rewards_granted: [{ id: 'a', kind: 'k', amount: 1, at: '2026-11-10 08:15:30+05:30' }] });
  expect(s.rewardsGranted[0]!.at!.toISOString()).toBe('2026-11-10T02:45:30.000Z');
});
