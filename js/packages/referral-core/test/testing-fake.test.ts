// The demo fake server (`@myind/referral-core/testing`) drives the whole story through the real client and queue.
import { expect, it } from 'vitest';
import {
  ClaimStatus,
  MemoryKeyValueStore,
  MyClaimState,
  PendingClaimQueue,
  ReferralAvailability,
  ReferralCopy,
  referralLocalizations,
  type ReferralEvent,
} from '../src';
import { FakeReferralServer, fakeReferralClient } from '../src/testing';

it('sharer and friend journey: code, claim, waiting, joined, rewards, ack', async () => {
  const server = new FakeReferralServer({ clock: () => new Date(Date.UTC(2026, 10, 20, 12)) });
  const events: ReferralEvent[] = [];
  const client = fakeReferralClient(server, { onEvent: (e) => events.push(e) });
  expect(await client.availability()).toBe(ReferralAvailability.available);
  expect((await client.myCode()).code).toBe(FakeReferralServer.myCode);
  const terms = await client.terms();
  expect(terms.boostAt(new Date(Date.UTC(2026, 10, 20, 12)))?.multiplier).toBe(2);
  expect(terms.claimDaysLeft).toBe(3);

  const queue = new PendingClaimQueue({ client, store: new MemoryKeyValueStore() });
  expect((await queue.claim(FakeReferralServer.myCode)).result!.reason).toBe('own_code');
  expect((await queue.claim('ZZZZZZZZ')).result!.reason).toBe('unknown_code');
  expect((await queue.claim('h4pz-8wne')).result!.isOk).toBe(true);
  const claim = await client.myClaim();
  expect(claim.state).toBe(MyClaimState.claimed);
  expect(claim.rewards[0]!.amount).toBe(8);
  const copy = new ReferralCopy({ l10n: referralLocalizations('en'), terms, labels: { byKind: { chapters: (n) => `${n} free chapters` } } });
  expect(copy.welcomeWaiting(claim, { appName: 'Reader' })).toBe(
    'Your welcome gift of 8 free chapters is waiting: Start using Reader. 30 days left.',
  );

  server.aFriendSignsUp();
  expect((await client.stats()).claimedCount).toBe(1);
  server.aFriendStarts();
  server.youStartUsing();
  server.aFriendPays();
  const pending = await client.pending();
  expect(pending.map((r) => [r.who, r.event, r.amount])).toEqual([
    ['sharer', 'joined', 8],
    ['friend', 'joined', 8],
    ['sharer', 'paid', 5],
  ]);
  expect(events.filter((e) => e.wireName === 'reward_granted')).toHaveLength(3);
  expect(await client.ack(pending.map((r) => r.id))).toBe(3);
  expect(await client.pending()).toHaveLength(0);
  expect((await client.myClaim()).state).toBe(MyClaimState.joined);
  const stats = await client.stats();
  expect([stats.joinedCount, stats.paidCount, stats.rewardsGranted.length]).toEqual([1, 1, 2]);
});

it('switches for every unavailable and failure state', async () => {
  const server = new FakeReferralServer();
  const client = fakeReferralClient(server);
  server.deployed = false;
  expect(await client.availability()).toBe(ReferralAvailability.notDeployed);
  server.deployed = true;
  server.signedIn = false;
  expect(await client.availability()).toBe(ReferralAvailability.signedOut);
  server.signedIn = true;
  server.offline = true;
  expect(await client.availability()).toBe(ReferralAvailability.offline);
  const queue = new PendingClaimQueue({ client, store: new MemoryKeyValueStore() });
  expect((await queue.claim(FakeReferralServer.friendCode)).status).toBe(ClaimStatus.queuedOffline);
  server.offline = false;
  server.serverError = true;
  expect(await client.availability()).toBe(ReferralAvailability.serverError);
  server.serverError = false;
  server.claimReason = 'rate_limited';
  expect((await client.claim('ABCDEFGH')).retryAfterSeconds).toBe(120);
  server.claimReason = null;
  expect((await queue.retryPendingClaim()).result!.isOk).toBe(true);
});

it('preferences, leaving, rotation, banked and pending rewards', async () => {
  let now = new Date(Date.UTC(2026, 10, 20));
  const server = new FakeReferralServer({ clock: () => now });
  const client = fakeReferralClient(server);
  expect((await client.setPreferences({ displayName: 'me@x.com' })).reason).toBe('invalid_name');
  expect((await client.setPreferences({ showName: true, displayName: ' Priya ' })).displayName).toBe('Priya');
  await client.setPreferences({ participating: false });
  expect((await client.myCode()).left).toBe(true);
  await client.setPreferences({ participating: true });
  expect((await client.rotateCode()).reason).toBe('ok');
  expect((await client.rotateCode()).reason).toBe('too_soon');
  now = new Date(now.getTime() + 31 * 86400000);
  expect((await client.rotateCode()).code).toBe(FakeReferralServer.myCode);
  server.addPendingReward(new Date(Date.UTC(2026, 11, 1)));
  server.addBankedReward();
  const s = await client.stats();
  expect([s.pending.length, s.banked.length, s.isEmpty]).toEqual([1, 1, false]);
  expect((await client.pending()).map((r) => r.state)).toEqual(['banked']);
  expect(server.called('referral_rotate_code')).toHaveLength(3);
});
