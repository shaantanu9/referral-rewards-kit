// Port of packages/referral_kit/test/prompt_policy_test.dart.
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryKeyValueStore, ReferralPromptMoment, ReferralPromptPolicy } from '../src';

const H = 3600 * 1000;
const D = 24 * H;
let store: MemoryKeyValueStore;
let now: Date;
const policy = (): ReferralPromptPolicy => new ReferralPromptPolicy({ store, clock: () => now });
const session = async (): Promise<ReferralPromptPolicy> => {
  const p = policy();
  await p.startSession();
  return p;
};
const later = (ms: number): void => {
  now = new Date(now.getTime() + ms);
};

beforeEach(() => {
  store = new MemoryKeyValueStore();
  now = new Date(Date.UTC(2026, 10, 1, 12));
});

it('never in the first session, even after a moment of value', async () => {
  const p = await session();
  p.reportMomentOfValue();
  expect(await p.shouldPrompt()).toBe(false);
});

it('second session: only after a moment of value', async () => {
  await session();
  const p = await session();
  expect(await p.shouldPrompt()).toBe(false);
  p.reportMomentOfValue();
  expect(await p.shouldPrompt()).toBe(true);
});

it('at most one prompt per 14 days', async () => {
  await session();
  let p = await session();
  p.reportMomentOfValue();
  await p.markPrompted();
  expect(await p.shouldPrompt()).toBe(false);
  later(13 * D + 23 * H);
  p = await session();
  p.reportMomentOfValue();
  expect(await p.shouldPrompt()).toBe(false);
  later(H);
  expect(await p.shouldPrompt()).toBe(true);
});

it('never during a purchase, nor later in that session', async () => {
  await session();
  const p = await session();
  p.reportMomentOfValue();
  p.reportPurchaseStarted();
  expect(await p.shouldPrompt()).toBe(false);
  await p.reportPurchaseFinished();
  expect(await p.shouldPrompt()).toBe(false);
});

it('not within 24 hours after a purchase, across sessions', async () => {
  await session();
  const p = await session();
  p.reportPurchaseStarted();
  await p.reportPurchaseFinished();
  later(23 * H);
  const next = await session();
  next.reportMomentOfValue();
  expect(await next.shouldPrompt()).toBe(false);
  later(H);
  expect(await next.shouldPrompt()).toBe(true);
});

it('session count persists in the store', async () => {
  await session();
  await session();
  expect(store.values.get('prompt.sessions')).toBe('2');
});

describe('moment welcomeRewardReceived', () => {
  const m = ReferralPromptMoment.welcomeRewardReceived;
  it('never in the first session', async () => {
    const p = await session();
    expect(await p.shouldPromptFor(m)).toBe(false);
  });
  it('allowed once ever, without a separate moment of value', async () => {
    await session();
    let p = await session();
    expect(await p.shouldPromptFor(m)).toBe(true);
    await p.markPromptedFor(m);
    expect(await p.shouldPromptFor(m)).toBe(false);
    later(400 * D);
    p = await session();
    expect(await p.shouldPromptFor(m)).toBe(false);
  });
  it('counts as a prompt for the 14-day interval, and respects purchases', async () => {
    await session();
    let p = await session();
    await p.markPromptedFor(m);
    p.reportMomentOfValue();
    expect(await p.shouldPrompt()).toBe(false);
    store.values.delete('prompt.moment.welcome_reward_received');
    p = await session();
    p.reportPurchaseStarted();
    expect(await p.shouldPromptFor(m)).toBe(false);
  });
});
