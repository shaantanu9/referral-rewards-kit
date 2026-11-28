// Port of packages/rewards_kit/test/controller_test.dart, plus snapshot stability for useSyncExternalStore.
import { expect, it } from 'vitest';
import { OfferStatus, RewardsEventName, RewardsNetworkError, SocialTaskStatus, type RewardsEvent } from '../src';
import { controllerOn, FakeRpc, grant, iso, MIN, sampleState, serverNow, tick } from './fakes';

it('nothing runs until refresh; refresh loads, syncs the clock and is shared while running', async () => {
  const rpc = new FakeRpc({ rewards_state: () => sampleState() });
  const c = controllerOn(rpc, { local: () => new Date(serverNow.getTime() - 3 * MIN) });
  expect(rpc.calls).toHaveLength(0);
  expect(c.visible).toBe(false);
  await Promise.all([c.refresh(), c.refresh()]);
  expect(rpc.called('rewards_state')).toHaveLength(1);
  expect(c.loaded && c.visible).toBe(true);
  expect(c.clock.offsetMs).toBe(3 * MIN);
});

it('disabled engine: loaded but not visible', async () => {
  const events: RewardsEvent[] = [];
  const c = controllerOn(new FakeRpc({ rewards_state: () => sampleState({ enabled: false }) }), { events });
  await c.refresh();
  expect(c.loaded).toBe(true);
  expect(c.visible).toBe(false);
  expect(events.some((e) => e.name === RewardsEventName.unavailable && e.props['reason'] === 'disabled')).toBe(true);
});

it('not deployed: unavailable, hidden, reported', async () => {
  const events: RewardsEvent[] = [];
  const c = controllerOn(
    new FakeRpc({
      rewards_state: () => {
        throw new Error('PGRST202 function not found');
      },
    }),
    { events },
  );
  await c.refresh();
  expect(c.unavailable).toBe('not_deployed');
  expect(c.visible).toBe(false);
  expect(events.at(-1)!.props['reason']).toBe('not_deployed');
});

it('offline: error kept, nothing thrown', async () => {
  const c = controllerOn(
    new FakeRpc({
      rewards_state: () => {
        throw new Error('socket');
      },
    }),
  );
  await c.refresh();
  expect(c.error).toBeInstanceOf(RewardsNetworkError);
  expect(c.loaded).toBe(false);
});

it('onGrant emits each granted inbox item once, never pending ones', async () => {
  const c = controllerOn(new FakeRpc({ rewards_state: () => sampleState({ inbox: [grant('g1'), grant('g2', { state: 'queued' })] }) }));
  const got: string[] = [];
  c.onGrant((g) => got.push(g.id));
  await c.refresh();
  await c.refresh();
  expect(got).toEqual(['g1']);
});

it('track merges the changed streak and new grants, then refreshes when something else may have moved', async () => {
  let states = 0;
  const rpc = new FakeRpc({
    rewards_state: () => (states++, sampleState()),
    rewards_track: () => ({ duplicate: false, grants: [grant('t1', { amount: 50 })], streaks: [{ program: 'daily', current: 4, today_done: true }] }),
  });
  const c = controllerOn(rpc);
  await c.refresh();
  const got: string[] = [];
  c.onGrant((g) => got.push(g.id));
  expect(await c.track('chapter_read')).toBeNull();
  expect(got).toEqual(['t1']);
  expect(states).toBe(2);
});

it('duplicate track changes nothing and does not refresh', async () => {
  let states = 0;
  const c = controllerOn(new FakeRpc({ rewards_state: () => (states++, sampleState()), rewards_track: () => ({ duplicate: true }) }));
  await c.refresh();
  await c.track('chapter_read');
  expect(states).toBe(1);
  expect(c.state.streak('daily')!.current).toBe(3);
});

it('track without a refresh needed merges locally', async () => {
  const base = { ...sampleState(), milestones: [], offers: [] };
  let states = 0;
  const c = controllerOn(
    new FakeRpc({
      rewards_state: () => (states++, base),
      rewards_track: () => ({ streaks: [{ program: 'daily', current: 4, today_done: true }] }),
    }),
  );
  await c.refresh();
  await c.track('chapter_read');
  expect(states).toBe(1);
  expect(c.state.streak('daily')!.current).toBe(4);
  expect(c.state.streak('daily')!.todayDone).toBe(true);
});

it('track refusal returns the reason', async () => {
  const c = controllerOn(
    new FakeRpc({
      rewards_track: () => {
        throw new Error('rewards: daily_limit');
      },
    }),
  );
  expect(await c.track('x')).toBe('daily_limit');
});

it('claimOffer: success marks claimed and emits; refusals correct the offer state', async () => {
  const rpc = new FakeRpc({ rewards_state: () => sampleState(), rewards_offer_claim: () => ({ grants: [grant('o1', { amount: 100 })] }) });
  const c = controllerOn(rpc);
  await c.refresh();
  const got: string[] = [];
  c.onGrant((g) => got.push(g.id));
  expect(await c.claimOffer('welcome')).toBeNull();
  expect(c.state.offer('welcome')!.status).toBe(OfferStatus.claimed);
  expect(got).toEqual(['o1']);
  for (const [reason, status] of [
    ['offer_expired', OfferStatus.expired],
    ['sold_out', OfferStatus.soldOut],
    ['offer_claimed', OfferStatus.claimed],
  ] as const) {
    rpc.handlers['rewards_offer_claim'] = () => {
      throw new Error(`rewards: ${reason}`);
    };
    await c.refresh();
    expect(await c.claimOffer('welcome')).toBe(reason);
    expect(c.state.offer('welcome')!.status).toBe(status);
  }
});

it('startSocial makes the task pending with its code', async () => {
  const rpc = new FakeRpc({
    rewards_state: () => sampleState(),
    rewards_social_start: () => ({ code: 'MYAPP-K7Q2HX', account: 'myapp', expires_at: iso(serverNow) }),
  });
  const c = controllerOn(rpc);
  await c.refresh();
  expect(await c.startSocial('ig_tag', 'me')).toBeNull();
  const t = c.state.socialTask('ig_tag')!;
  expect(t.status).toBe(SocialTaskStatus.pending);
  expect(t.code).toBe('MYAPP-K7Q2HX');
  rpc.handlers['rewards_social_start'] = () => {
    throw new Error('rewards: handle_taken');
  };
  expect(await c.startSocial('ig_tag', 'me')).toBe('handle_taken');
});

it('markSeen sends only granted ids and removes them', async () => {
  const rpc = new FakeRpc({ rewards_state: () => sampleState({ inbox: [grant('g1'), grant('g2', { state: 'queued' })] }), rewards_mark_seen: () => 1 });
  const c = controllerOn(rpc);
  await c.refresh();
  await c.markSeen(['g1', 'g2']);
  expect(rpc.called('rewards_mark_seen')[0]).toEqual({ grant_ids: ['g1'] });
  expect(c.state.inbox.map((g) => g.id)).toEqual(['g2']);
  expect(await c.markSeen(['g2'])).toBeNull();
  expect(rpc.called('rewards_mark_seen')).toHaveLength(1);
});

it('dispose stops notifications and closes the grant stream', async () => {
  const c = controllerOn(new FakeRpc({ rewards_state: () => sampleState({ inbox: [grant('g1')] }) }));
  const got: string[] = [];
  let notified = 0;
  c.onGrant((g) => got.push(g.id));
  c.subscribe(() => notified++);
  c.dispose();
  await c.refresh();
  expect(got).toHaveLength(0);
  expect(notified).toBe(0);
});

it('snapshots: the same object between changes, a new frozen one after each change (useSyncExternalStore)', async () => {
  const c = controllerOn(new FakeRpc({ rewards_state: () => sampleState(), rewards_mark_seen: () => 1 }));
  const first = c.getSnapshot();
  expect(c.getSnapshot()).toBe(first);
  expect(Object.isFrozen(first)).toBe(true);
  expect(first.loaded).toBe(false);
  const seen: number[] = [];
  const unsubscribe = c.subscribe(() => seen.push(c.getSnapshot().version));
  await c.refresh();
  const loaded = c.getSnapshot();
  expect(loaded).not.toBe(first);
  expect(loaded.loaded && loaded.visible).toBe(true);
  expect(loaded.state.streak('daily')!.current).toBe(3);
  expect(c.getSnapshot()).toBe(loaded);
  expect(seen).toEqual([1, 2]);
  expect(first.loaded).toBe(false);
  unsubscribe();
  c.celebrateNow();
  expect(c.getSnapshot()).toBe(loaded);
  await tick();
  expect(seen).toHaveLength(2);
  const { getSnapshot, subscribe } = c;
  expect(getSnapshot()).toBe(loaded);
  expect(typeof subscribe(() => {})).toBe('function');
});
