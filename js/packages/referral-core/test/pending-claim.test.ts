// Port of packages/referral_kit/test/pending_claim_test.dart.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ClaimReason,
  ClaimStatus,
  MemoryKeyValueStore,
  PendingClaimQueue,
  PendingClaimRetrier,
  RetryTrigger,
  type ClaimOutcome,
  type Subscribe,
} from '../src';
import { clientFor, FakeRpc } from './support';

let rpc: FakeRpc;
let store: MemoryKeyValueStore;
let queue: PendingClaimQueue;
let resolved: Array<[ClaimOutcome, RetryTrigger]>;

beforeEach(() => {
  rpc = new FakeRpc();
  store = new MemoryKeyValueStore();
  resolved = [];
  queue = new PendingClaimQueue({ client: clientFor(rpc), store, onResolved: (o, t) => resolved.push([o, t]) });
});

it('online ok: nothing kept', async () => {
  const o = await queue.claim('abcd-efgh');
  expect(o.status).toBe(ClaimStatus.answered);
  expect(o.result!.isOk).toBe(true);
  expect(await queue.pendingCode()).toBeNull();
});

it('offline: kept, normalised, retried on reconnect', async () => {
  rpc.error = new Error('SocketException');
  const o = await queue.claim('⁦abcd-efgh⁩');
  expect(o.status).toBe(ClaimStatus.queuedOffline);
  expect(await queue.pendingCode()).toBe('ABCDEFGH');
  expect(await queue.pendingStatus()).toBe(ClaimStatus.queuedOffline);
  rpc.error = null;
  const r = await queue.retryPendingClaim({ trigger: RetryTrigger.reconnect });
  expect(r.result!.isOk).toBe(true);
  expect(await queue.pendingCode()).toBeNull();
  expect(resolved[0]![1]).toBe(RetryTrigger.reconnect);
});

it('not_verified: kept until the server says something else', async () => {
  rpc.responses['referral_claim'] = { reason: 'not_verified' };
  expect((await queue.claim('ABCDEFGH')).status).toBe(ClaimStatus.queuedNotVerified);
  expect(await queue.pendingStatus()).toBe(ClaimStatus.queuedNotVerified);
  expect((await queue.retryPendingClaim()).status).toBe(ClaimStatus.queuedNotVerified);
  expect(resolved).toHaveLength(0);
  rpc.responses['referral_claim'] = { reason: 'window_closed' };
  const r = await queue.retryPendingClaim({ trigger: RetryTrigger.tokenRefresh });
  expect(r.result!.reason).toBe(ClaimReason.windowClosed);
  expect(await queue.pendingCode()).toBeNull();
  expect(resolved[0]![1]).toBe(RetryTrigger.tokenRefresh);
});

it('a kept code survives rate_limited and anonymous_user on retry, and is claimed later', async () => {
  rpc.responses['referral_claim'] = { reason: 'not_verified' };
  await queue.claim('ABCDEFGH');
  rpc.responses['referral_claim'] = { reason: 'rate_limited', retry_after_seconds: 600 };
  expect((await queue.retryPendingClaim({ trigger: RetryTrigger.appResume })).isQueued).toBe(true);
  expect(await queue.pendingCode()).toBe('ABCDEFGH');
  rpc.responses['referral_claim'] = { reason: 'anonymous_user' };
  expect((await queue.retryPendingClaim({ trigger: RetryTrigger.appResume })).isQueued).toBe(true);
  expect(await queue.pendingCode()).toBe('ABCDEFGH');
  expect(resolved).toHaveLength(0);
  rpc.responses['referral_claim'] = { reason: 'ok', days_left: 30 };
  const r = await queue.retryPendingClaim({ trigger: RetryTrigger.signInChange });
  expect(r.result!.isOk).toBe(true);
  expect(await queue.pendingCode()).toBeNull();
});

it('a typed code refused as rate_limited is not kept', async () => {
  rpc.responses['referral_claim'] = { reason: 'rate_limited', retry_after_seconds: 600 };
  expect((await queue.claim('ABCDEFGH')).status).toBe(ClaimStatus.answered);
  expect(await queue.pendingCode()).toBeNull();
});

it('keep: a link code is stored before sign-in and never claimed without a tap', async () => {
  expect(await queue.keep('⁦abcd-efgh⁩', { source: 'link' })).toBe(true);
  expect(rpc.names).toHaveLength(0);
  expect(await queue.linkCode()).toBe('ABCDEFGH');
  expect(await queue.pendingCode()).toBeNull();
  expect(await queue.pendingStatus()).toBeNull();
  expect((await queue.retryPendingClaim({ trigger: RetryTrigger.signInChange })).status).toBe(ClaimStatus.nothingPending);
  expect(rpc.names).toHaveLength(0);
  expect((await queue.claim('ABCDEFGH', { source: 'prefilled' })).result!.isOk).toBe(true);
  expect(await queue.linkCode()).toBeNull();
});

it('keep ignores a malformed code and never replaces a kept one; a refused claim clears it', async () => {
  expect(await queue.keep('nope')).toBe(false);
  expect(await queue.linkCode()).toBeNull();
  expect(await queue.keep('ABCDEFGH')).toBe(true);
  expect(await queue.keep('JKMNPQRS')).toBe(false);
  expect(await queue.linkCode()).toBe('ABCDEFGH');
  rpc.responses['referral_claim'] = { reason: 'own_code' };
  await queue.claim('ABCDEFGH', { source: 'prefilled' });
  expect(await queue.linkCode()).toBeNull();
});

it('a link code survives an offline claim and moves into the retry queue', async () => {
  await queue.keep('ABCDEFGH');
  rpc.error = new Error('offline');
  expect((await queue.claim('ABCDEFGH', { source: 'prefilled' })).status).toBe(ClaimStatus.queuedOffline);
  expect(await queue.pendingCode()).toBe('ABCDEFGH');
  expect(await queue.linkCode()).toBeNull();
});

it('a final refusal is not kept', async () => {
  rpc.responses['referral_claim'] = { reason: 'unknown_code' };
  expect((await queue.claim('ABCDEFGH')).status).toBe(ClaimStatus.answered);
  expect(await queue.pendingCode()).toBeNull();
});

it('nothing pending: no call', async () => {
  expect((await queue.retryPendingClaim()).status).toBe(ClaimStatus.nothingPending);
  expect(rpc.calls).toHaveLength(0);
});

it('concurrent retries share one request', async () => {
  await store.setString(PendingClaimQueue.storageKey, 'ABCDEFGH');
  await Promise.all([queue.retryPendingClaim(), queue.retryPendingClaim(), queue.retryPendingClaim()]);
  expect(rpc.names).toEqual(['referral_claim']);
});

describe('PendingClaimRetrier triggers', () => {
  const signal = (): { subscribe: Subscribe; fire: () => void; count: () => number } => {
    const ls = new Set<() => void>();
    return {
      subscribe: (l) => (ls.add(l), () => ls.delete(l)),
      fire: () => ls.forEach((l) => l()),
      count: () => ls.size,
    };
  };
  const cases: Array<[RetryTrigger, 'reconnects' | 'tokenRefreshes' | 'signInChanges' | 'appResumes']> = [
    [RetryTrigger.reconnect, 'reconnects'],
    [RetryTrigger.tokenRefresh, 'tokenRefreshes'],
    [RetryTrigger.signInChange, 'signInChanges'],
    [RetryTrigger.appResume, 'appResumes'],
  ];
  for (const [trigger, key] of cases) {
    it(trigger, async () => {
      await store.setString(PendingClaimQueue.storageKey, 'ABCDEFGH');
      const s = signal();
      const r = new PendingClaimRetrier({ queue, [key]: s.subscribe });
      s.fire();
      await new Promise((res) => setTimeout(res, 0));
      expect(resolved[0]![1]).toBe(trigger);
      r.dispose();
      expect(s.count()).toBe(0);
    });
  }
});
