// Port of packages/referral_kit/test/events_test.dart.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ClaimOutcome,
  ClaimReason,
  ClaimResult,
  claimEventResult,
  claimReasonName,
  claimResultName,
  claimResultNames,
  ClaimStatus,
  FixedInstallIdStore,
  MemoryKeyValueStore,
  PendingClaimQueue,
  ReferralAvailability,
  ReferralClient,
  referralCodeHash,
  ReferralNetworkError,
  ReferralServerError,
  ReferralUnavailableException,
  ReferralUnavailableReason,
  RetryTrigger,
  sha256Hex,
  sha256HexAsync,
  isTransientAvailability,
  ReferralEvent,
  ReferralEventName,
} from '../src';
import { clientFor, FakeRpc, testInstallId } from './support';

const pgrst202 =
  'PostgrestException(message: Could not find the function public.referral_terms(install_id) in the schema cache, ' +
  'code: PGRST202, details: Searched for the function, hint: null)';
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('sha256Hex', () => {
  const vectors: Array<[string, string]> = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ];
  it('FIPS 180-4 vectors', () => {
    for (const [m, h] of vectors) expect(sha256Hex(m)).toBe(h);
  });
  it('WebCrypto gives the same output, also for non-ASCII and long input', async () => {
    for (const m of ['', 'abc', 'referral_kit:ABCDEFGH', 'नमस्ते 👋', 'x'.repeat(1000)]) {
      expect(await sha256HexAsync(m)).toBe(sha256Hex(m));
    }
  });
});

describe('referralCodeHash', () => {
  it('12 hex characters, same for every spelling of a code, never the code', () => {
    const h = referralCodeHash('ABCDEFGH');
    expect(h).toMatch(/^[0-9a-f]{12}$/);
    expect(referralCodeHash('abcd-efgh')).toBe(h);
    expect(referralCodeHash(' ABCD EFGH ')).toBe(h);
    expect(h.toUpperCase()).not.toContain('ABCD');
  });
  it('the salt changes it', () => expect(referralCodeHash('ABCDEFGH', 'app-a')).not.toBe(referralCodeHash('ABCDEFGH', 'app-b')));
});

describe('claimEventResult', () => {
  const answered = (reason: string): ClaimOutcome =>
    new ClaimOutcome(ClaimStatus.answered, { code: 'ABCDEFGH', result: ClaimResult.fromJson({ reason }) });

  it('server reasons', () => {
    const cases: Record<string, string> = {
      ok: 'ok',
      unknown_code: 'invalid',
      window_closed: 'expired',
      own_code: 'own_code',
      already_referred: 'already_used',
      rate_limited: 'rate_limited',
      same_install: 'same_install',
      program_paused: 'paused',
      under_age: 'under_age',
      anonymous_user: 'anonymous',
      not_verified: 'not_verified',
      something_new: 'other',
    };
    for (const [w, name] of Object.entries(cases)) expect(claimEventResult(answered(w))).toBe(name);
    expect(answered('own_code').resultName).toBe('own_code');
    expect(claimResultName(ClaimResult.fromJson({ reason: 'something_new' }))).toBe('other');
  });

  it('every reason and kept state has a name in claimResultNames', () => {
    for (const r of Object.values(ClaimReason)) expect(claimResultNames.has(claimReasonName(r))).toBe(true);
    for (const reason of Object.values(ReferralUnavailableReason)) {
      const o = new ClaimOutcome(ClaimStatus.queuedOffline, { error: new ReferralUnavailableException(reason) });
      expect(claimResultNames.has(claimEventResult(o))).toBe(true);
    }
  });

  it('kept codes', () => {
    const kept = (error: unknown): ClaimOutcome => new ClaimOutcome(ClaimStatus.queuedOffline, { code: 'ABCDEFGH', error });
    expect(claimEventResult(kept(new Error('socket')))).toBe('offline_queued');
    expect(claimEventResult(kept(new ReferralNetworkError('referral_claim')))).toBe('offline_queued');
    expect(claimEventResult(kept(new ReferralServerError('referral_claim', 500)))).toBe('server_error');
    expect(claimEventResult(kept(new ReferralUnavailableException('not_deployed')))).toBe('not_deployed');
    expect(claimEventResult(kept(new ReferralUnavailableException('signed_out')))).toBe('signed_out');
    expect(
      claimEventResult(
        new ClaimOutcome(ClaimStatus.queuedNotVerified, { code: 'ABCDEFGH', result: ClaimResult.fromJson({ reason: 'not_verified' }) }),
      ),
    ).toBe('not_verified');
  });

  it('legacy names', () => {
    expect(new ReferralEvent(ReferralEventName.inviteShared).legacyWireName).toBe('referral_invite_shared');
    expect(new ReferralEvent(ReferralEventName.rewardGranted).legacyWireName).toBe('reward_granted');
  });
});

describe('ReferralClient', () => {
  it('a PGRST202 error becomes not deployed, reported once', async () => {
    const events: ReferralEvent[] = [];
    const rpc = new FakeRpc();
    rpc.error = new Error(pgrst202);
    const client = new ReferralClient({ rpc: rpc.call, installIds: new FixedInstallIdStore(testInstallId), onEvent: (e) => events.push(e) });
    await expect(client.terms()).rejects.toMatchObject({ name: 'ReferralUnavailableException', reason: 'not_deployed' });
    await expect(client.stats()).rejects.toBeInstanceOf(ReferralUnavailableException);
    await tick();
    expect(events.map((e) => e.wireName)).toEqual(['referral_feature_hidden']);
    expect(events[0]!.props).toEqual({ reason: 'not_deployed', surface: 'client' });
  });

  it('other errors pass through unchanged (offline)', async () => {
    const rpc = new FakeRpc();
    rpc.error = new TypeError('socket closed');
    await expect(clientFor(rpc).terms()).rejects.toBeInstanceOf(TypeError);
  });

  it('a custom not-deployed check', async () => {
    const rpc = new FakeRpc();
    rpc.error = new RangeError('no such function');
    const client = clientFor(rpc, { isNotDeployed: (e) => e instanceof RangeError });
    await expect(client.terms()).rejects.toBeInstanceOf(ReferralUnavailableException);
  });

  it('availability()', async () => {
    const withError = (e: unknown): FakeRpc => Object.assign(new FakeRpc(), { error: e });
    expect(await clientFor(new FakeRpc()).availability()).toBe(ReferralAvailability.available);
    expect(await clientFor(withError(new Error(pgrst202))).availability()).toBe(ReferralAvailability.notDeployed);
    expect(await clientFor(withError(new ReferralUnavailableException('signed_out'))).availability()).toBe(
      ReferralAvailability.signedOut,
    );
    expect(await clientFor(withError(new ReferralServerError('referral_terms', 503))).availability()).toBe(
      ReferralAvailability.serverError,
    );
    expect(await clientFor(withError(new Error('offline'))).availability()).toBe(ReferralAvailability.offline);
    expect(isTransientAvailability(ReferralAvailability.offline)).toBe(true);
    expect(isTransientAvailability(ReferralAvailability.notDeployed)).toBe(false);
  });

  it('a throwing event sink never breaks a call', async () => {
    const rpc = Object.assign(new FakeRpc(), { error: new Error(pgrst202) });
    const client = clientFor(rpc, {
      onEvent: () => {
        throw new Error('analytics down');
      },
    });
    expect(await client.availability()).toBe(ReferralAvailability.notDeployed);
  });

  it('referral_feature_hidden once a day per reason, remembered in the event store', async () => {
    const events: ReferralEvent[] = [];
    const store = new MemoryKeyValueStore();
    let now = new Date(Date.UTC(2026, 10, 20, 10));
    const make = (): ReferralClient =>
      clientFor(Object.assign(new FakeRpc(), { error: new Error('offline') }), {
        onEvent: (e) => events.push(e),
        eventStore: store,
        clock: () => now,
      });
    await make().availability();
    await make().availability();
    expect(events).toHaveLength(1);
    now = new Date(Date.UTC(2026, 10, 21, 1));
    await make().availability();
    expect(events).toHaveLength(2);
  });

  it('reward_granted once per granted reward, never for banked', async () => {
    const events: ReferralEvent[] = [];
    const client = clientFor(new FakeRpc(), { onEvent: (e) => events.push(e), eventStore: new MemoryKeyValueStore() });
    await client.pending();
    await client.pending();
    expect(events.map((e) => e.wireName)).toEqual(['reward_granted']);
    expect(events[0]!.props).toEqual({ kind: 'minutes', amount: 30, who: 'friend', event: 'joined' });
  });
});

describe('PendingClaimQueue events', () => {
  let events: ReferralEvent[];
  const client = (rpc: FakeRpc): ReferralClient => clientFor(rpc, { onEvent: (e) => events.push(e), codeHashSalt: 'test' });
  beforeEach(() => {
    events = [];
  });

  it('claim reports the result with the hash, never the code', async () => {
    const rpc = new FakeRpc({ referral_claim: { reason: 'own_code' } });
    await new PendingClaimQueue({ client: client(rpc), store: new MemoryKeyValueStore() }).claim('abcd-efgh', { source: 'pasted' });
    const hash = referralCodeHash('ABCDEFGH', 'test');
    expect(events.map((e) => e.wireName)).toEqual(['code_submitted', 'code_claim_result']);
    expect(events[0]!.props).toEqual({ code_hash: hash, source: 'pasted' });
    expect(events[1]!.props).toEqual({ result: 'own_code', via: 'entry', code_hash: hash });
    expect(events.flatMap((e) => Object.values(e.props)).join()).not.toContain('ABCDEFGH');
  });

  it('not deployed: the code is kept, the outcome says why', async () => {
    const rpc = Object.assign(new FakeRpc(), { error: new Error(pgrst202) });
    const store = new MemoryKeyValueStore();
    const outcome = await new PendingClaimQueue({ client: client(rpc), store }).claim('ABCDEFGH');
    expect(outcome.status).toBe(ClaimStatus.queuedOffline);
    expect(outcome.unavailable).toBe('not_deployed');
    expect(store.values.get(PendingClaimQueue.storageKey)).toBe('ABCDEFGH');
    // `referral_feature_hidden` is reported in the background too, so look the claim result up by name.
    expect(events.find((e) => e.wireName === 'code_claim_result')!.props['result']).toBe('not_deployed');
  });

  it('a retry is reported when it resolves, not while it stays queued', async () => {
    const rpc = Object.assign(new FakeRpc(), { error: new Error('offline') as unknown });
    const queue = new PendingClaimQueue({ client: client(rpc), store: new MemoryKeyValueStore() });
    await queue.claim('ABCDEFGH');
    expect(events.at(-1)!.props['result']).toBe('offline_queued');
    await queue.retryPendingClaim({ trigger: RetryTrigger.appResume });
    expect(events).toHaveLength(2);
    rpc.error = null;
    await queue.retryPendingClaim({ trigger: RetryTrigger.appResume });
    expect(events.at(-1)!.wireName).toBe('code_claim_result');
    expect(events.at(-1)!.props).toEqual({
      result: 'ok',
      via: 'retry',
      trigger: 'appresume',
      code_hash: referralCodeHash('ABCDEFGH', 'test'),
    });
  });
});
