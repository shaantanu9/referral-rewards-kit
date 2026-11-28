// Port of packages/rewards_kit/test/controller_v2_test.dart.
import { expect, it } from 'vitest';
import { QuizStatus, RewardGrant } from '../src';
import { controllerOn, FakeRpc, grant, historyJson, iso, MIN, plus, quizStateJson, sampleState, sampleStateV2, serverNow } from './fakes';

const fail = (reason: string) => () => {
  throw new Error(`rewards: ${reason}`);
};

it('useRecharge merges units and next time, keeps every_minutes; empty corrects to zero', async () => {
  const rpc = new FakeRpc({
    rewards_state: () => sampleStateV2(),
    rewards_recharge_use: () => ({ program: 'hearts', units: 1, max: 3, next_at: iso(plus(serverNow, 30 * MIN)) }),
  });
  const c = controllerOn(rpc);
  await c.refresh();
  expect(await c.useRecharge('hearts')).toBeNull();
  const r = c.state.recharge('hearts')!;
  expect([r.units, r.max, r.everyMinutes]).toEqual([1, 3, 240]);
  expect(r.nextAt).toEqual(plus(serverNow, 30 * MIN));
  rpc.handlers['rewards_recharge_use'] = fail('empty');
  expect(await c.useRecharge('hearts')).toBe('empty');
  expect(c.state.recharge('hearts')!.units).toBe(0);
});

it('friendInvite keeps the code for the share sheet; accept and remove reload the list', async () => {
  let states = 0;
  const rpc = new FakeRpc({
    rewards_state: () => (states++, sampleStateV2()),
    rewards_friend_invite: () => ({ code: 'FAB12CDE', expires_at: iso(serverNow) }),
    rewards_friend_accept: () => ({ pair_id: 'p2', program: 'buddies' }),
    rewards_friend_remove: () => true,
  });
  const c = controllerOn(rpc);
  await c.refresh();
  expect(c.invite('buddies')).toBeNull();
  expect(await c.friendInvite('buddies')).toBeNull();
  expect(c.invite('buddies')!.code).toBe('FAB12CDE');
  expect(c.getSnapshot().invites['buddies']!.code).toBe('FAB12CDE');
  expect(await c.friendAccept('FXYZ1234')).toBeNull();
  expect(states).toBe(2);
  rpc.handlers['rewards_state'] = () => (states++, sampleStateV2({ friends: [] }));
  const seen: number[] = [];
  c.addListener(() => seen.push(c.state.friends.length));
  expect(await c.friendRemove('p1')).toBeNull();
  expect(seen[0]).toBe(0);
  expect(states).toBe(3);
  rpc.handlers['rewards_friend_accept'] = fail('already_friends');
  expect(await c.friendAccept('FXYZ1234')).toBe('already_friends');
  expect(states).toBe(3);
});

it('submitSocialLink sets post_url on the task', async () => {
  const rpc = new FakeRpc({
    rewards_state: () => sampleState({ socialState: 'pending' }),
    rewards_social_submit_link: () => ({ program: 'ig_tag', state: 'pending', post_url: 'https://instagram.com/p/abc' }),
  });
  const c = controllerOn(rpc);
  await c.refresh();
  expect(await c.submitSocialLink('ig_tag', 'https://instagram.com/p/abc')).toBeNull();
  const t = c.state.socialTask('ig_tag')!;
  expect(t.postUrl).toBe('https://instagram.com/p/abc');
  expect(t.code).toBe('MYAPP-K7Q2HX');
  rpc.handlers['rewards_social_submit_link'] = fail('bad_link');
  expect(await c.submitSocialLink('ig_tag', 'nope')).toBe('bad_link');
});

it('quizToday merges into quizzes; applyGrants emits once', async () => {
  const rpc = new FakeRpc({
    rewards_state: () => sampleStateV2(),
    rewards_quiz_today: () => quizStateJson({ state: 'finished', attemptsLeft: 0, score: 3 }),
  });
  const c = controllerOn(rpc);
  await c.refresh();
  expect(await c.quizToday('quiz')).toBeNull();
  expect(c.state.quiz('quiz')!.status).toBe(QuizStatus.finished);
  const got: string[] = [];
  c.onGrant((g) => got.push(g.id));
  c.applyGrants([RewardGrant.fromJson(grant('qz'))]);
  c.applyGrants([RewardGrant.fromJson(grant('qz'))]);
  expect(got).toEqual(['qz']);
  expect(c.state.inbox.filter((g) => g.id === 'qz')).toHaveLength(1);
});

it('history and recap load into caches; a track updates today on the heatmap', async () => {
  const rpc = new FakeRpc({
    rewards_state: () => sampleStateV2(),
    rewards_history: () => historyJson(),
    rewards_recap: () => ({ days_active: 4, best_streak: 6 }),
    rewards_track: () => ({ streaks: [{ program: 'daily', current: 3, today_count: 7, daily_goal: 2 }] }),
  });
  const c = controllerOn(rpc);
  await c.refresh();
  expect(c.history()).toBeNull();
  expect(await c.loadHistory()).toBeNull();
  expect(c.history()!.days).toHaveLength(14);
  expect(c.history('daily')).not.toBeNull();
  const from = new Date(2026, 10, 1),
    to = new Date(2026, 10, 14);
  expect(await c.loadRecap(from, to)).toBeNull();
  expect(c.recap(from, to)!.bestStreak).toBe(6);
  expect(c.recap('2026-11-01', '2026-11-14')!.bestStreak).toBe(6);
  await c.track('chapter_read');
  expect(c.history()!.today!.count).toBe(7);
  expect(c.history('daily')!.today!.count).toBe(7);
  expect(c.getSnapshot().histories['daily']!.today!.count).toBe(7);
});

it('history offline returns the reason and keeps nothing', async () => {
  const c = controllerOn(
    new FakeRpc({
      rewards_history: () => {
        throw new Error('socket');
      },
    }),
  );
  expect(await c.loadHistory()).toBe('offline');
  expect(c.history()).toBeNull();
});

it('celebrateNow fires moments; nothing after dispose', () => {
  const c = controllerOn(new FakeRpc());
  let n = 0;
  c.onMoment(() => n++);
  c.celebrateNow();
  expect(n).toBe(1);
  c.dispose();
  c.celebrateNow();
  expect(n).toBe(1);
});

it('track merges quests and refreshes when quests exist', async () => {
  let states = 0;
  const c = controllerOn(
    new FakeRpc({
      rewards_state: () => (states++, sampleStateV2()),
      rewards_track: () => ({ quests: [{ program: 'daily_quests', done: true }] }),
    }),
  );
  await c.refresh();
  await c.track('chapter_read');
  expect(states).toBe(2);
});
