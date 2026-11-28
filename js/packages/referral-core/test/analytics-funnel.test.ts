// Port of packages/referral_kit/test/analytics_funnel_test.dart.
import { beforeEach, expect, it } from 'vitest';
import {
  MemoryKeyValueStore,
  PendingClaimQueue,
  ReferralEvent,
  ReferralEventName,
  ReferralServerError,
  ReferralUnavailableException,
  type KeyValueStore,
  type ReferralClient,
  type ReferralCodeHasher,
} from '../src';
import { clientFor, FakeRpc, pendingJson } from './support';

let events: ReferralEvent[];
beforeEach(() => {
  events = [];
});
const client = (rpc: FakeRpc, o: { store?: KeyValueStore; clock?: () => Date; hasher?: ReferralCodeHasher } = {}): ReferralClient =>
  clientFor(rpc, { onEvent: (e) => events.push(e), eventStore: o.store ?? null, ...(o.clock ? { clock: o.clock } : {}), codeHasher: o.hasher ?? null });
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

it('wire names are the ones the first app logged, so switching breaks no data', () => {
  const firstApp = [
    'invite_screen_viewed',
    'invite_code_copied',
    'invite_shared',
    'invite_link_opened',
    'code_entry_started',
    'code_submitted',
    'code_claim_result',
    'reward_granted',
    'referral_feature_hidden',
  ];
  const all = Object.values(ReferralEventName);
  for (const n of firstApp) expect(all).toContain(n);
  expect(new Set(all).size).toBe(all.length);
  expect(all).toHaveLength(15);
});

it('reward_granted once per granted reward, across clients sharing a store; banked ones wait', async () => {
  const store = new MemoryKeyValueStore();
  const rpc = new FakeRpc();
  await client(rpc, { store }).pending();
  await client(rpc, { store }).pending();
  const granted = events.filter((e) => e.wireName === 'reward_granted');
  expect(granted).toHaveLength(1);
  expect(granted[0]!.props).toEqual({ kind: 'minutes', amount: 30, who: 'friend', event: 'joined' });
  rpc.responses['referral_pending'] = [{ ...(pendingJson()[1] as object), state: 'granted' }];
  await client(rpc, { store }).pending();
  expect(events.filter((e) => e.wireName === 'reward_granted')).toHaveLength(2);
});

it('no onEvent: pending() remembers nothing and reports nothing', async () => {
  const store = new MemoryKeyValueStore();
  const c = clientFor(new FakeRpc(), { eventStore: store });
  await c.pending();
  await c.reportHidden('no_invite_url');
  expect(store.values.size).toBe(0);
});

it('referral_feature_hidden at most once a day per reason', async () => {
  const store = new MemoryKeyValueStore();
  let now = new Date(Date.UTC(2026, 10, 14, 9));
  const rpc = Object.assign(new FakeRpc(), { error: new ReferralUnavailableException('not_deployed') });
  const c = client(rpc, { store, clock: () => now });
  for (let i = 0; i < 3; i++) await c.availability();
  await client(rpc, { store, clock: () => now }).availability();
  await c.reportHidden('no_invite_url');
  await c.reportHidden('no_invite_url');
  await tick();
  expect(events.map((e) => e.props['reason'])).toEqual(['not_deployed', 'no_invite_url']);
  expect(events.at(-1)!.props['surface']).toBe('app');
  now = new Date(now.getTime() + 24 * 3600 * 1000);
  await client(rpc, { store, clock: () => now }).availability();
  await tick();
  expect(events.filter((e) => e.props['reason'] === 'not_deployed')).toHaveLength(2);
});

it('availability() reports offline and server errors as hidden too', async () => {
  await client(Object.assign(new FakeRpc(), { error: new Error('socket') })).availability();
  await client(Object.assign(new FakeRpc(), { error: new ReferralServerError('referral_terms', 503) })).availability();
  expect(events.map((e) => e.props['reason'])).toEqual(['offline', 'server_error']);
});

it("an app's own code hasher keeps old and new code_hash values equal", async () => {
  const c = client(new FakeRpc(), { hasher: (code) => `h-${code}` });
  expect(c.codeHash('abcd-efgh')).toBe('h-ABCDEFGH');
  await new PendingClaimQueue({ client: c, store: new MemoryKeyValueStore() }).claim('abcd efgh');
  expect(new Set(events.map((e) => e.props['code_hash']))).toEqual(new Set(['h-ABCDEFGH']));
  c.reportLinkOpened(' abcd-efgh ');
  expect(events.at(-1)!.wireName).toBe('invite_link_opened');
  expect(events.at(-1)!.props).toEqual({ code_hash: 'h-ABCDEFGH' });
});

it('reportLinkOpened ignores something that is not a code', () => {
  client(new FakeRpc()).reportLinkOpened('hello');
  expect(events).toHaveLength(0);
});

it('legacy names stay available for apps that forwarded 0.2.0 events', () => {
  expect(new ReferralEvent(ReferralEventName.codeClaimResult).legacyWireName).toBe('referral_claim_result');
  expect(new ReferralEvent(ReferralEventName.rewardGranted).legacyWireName).toBe('reward_granted');
});

it('a store that throws never breaks the flow', async () => {
  const broken: KeyValueStore = {
    getString: async () => {
      throw new Error('disk');
    },
    setString: async () => {
      throw new Error('disk');
    },
    remove: async () => {
      throw new Error('disk');
    },
  };
  const items = await client(new FakeRpc(), { store: broken }).pending();
  expect(items).toHaveLength(2);
  expect(events.filter((e) => e.wireName === 'reward_granted')).toHaveLength(1);
});
