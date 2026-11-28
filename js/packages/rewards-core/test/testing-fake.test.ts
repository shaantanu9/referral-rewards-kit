// The demo rewards engine (`@myind/rewards-core/testing`) drives every program kind through the real client and
// controllers.
import { expect, it } from 'vitest';
import { FollowupScheduler, OfferStatus, QuizController, QuizPhase, RewardsChoices, SocialTaskStatus } from '../src';
import { FakeRewardsServer, fakeRewards, MemoryFollowupNotifier } from '../src/testing';

const start = new Date(Date.UTC(2026, 10, 14, 10));

it('state has every program kind', async () => {
  const server = new FakeRewardsServer({ clock: () => start });
  const { controller } = fakeRewards(server);
  await controller.refresh();
  const s = controller.state;
  expect(controller.visible).toBe(true);
  expect(s.programs.map((p) => p.kind)).toEqual([
    'streak',
    'milestone',
    'offer',
    'social_tag',
    'quiz',
    'quest_set',
    'recharge',
    'window',
    'friend_streak',
    'league',
  ]);
  expect(s.streak('daily')!.dailyGoal).toBe(2);
  expect(s.milestone('reader')!.level!.name).toBe('Explorer');
  expect(s.offer('welcome')!.status).toBe(OfferStatus.active);
  expect(s.quest('daily_quests')!.tasks).toHaveLength(3);
  expect(s.recharge('hearts')!.units).toBe(2);
  expect(s.window('happy')!.activeAt(start)).toBe(true);
  expect(s.friendsOf('buddies')).toHaveLength(1);
  expect(s.surprises[0]!.chance).toBe(0.3);
});

it('tracking completes the daily goal, moves the streak and the milestone; offers, social, hearts, friends', async () => {
  let now = start;
  const server = new FakeRewardsServer({ clock: () => now, surpriseChance: 0 });
  const { controller } = fakeRewards(server);
  await controller.refresh();
  const grants: string[] = [];
  controller.onGrant((g) => grants.push(`${g.program}:${g.kind}`));
  await controller.track('chapter_read');
  await controller.track('chapter_read');
  expect(controller.state.streak('daily')!.todayDone).toBe(true);
  expect(controller.state.streak('daily')!.current).toBe(3);
  expect(grants).toContain('daily:coins');
  expect(grants).toContain('reader:badge');

  expect(await controller.claimOffer('welcome')).toBeNull();
  expect(await controller.claimOffer('welcome')).toBe('offer_claimed');
  expect(await controller.startSocial('ig', 'me')).toBeNull();
  expect(controller.state.socialTask('ig')!.status).toBe(SocialTaskStatus.pending);
  expect(await controller.submitSocialLink('ig', 'nope')).toBe('bad_link');
  expect(await controller.submitSocialLink('ig', 'https://instagram.com/p/x')).toBeNull();
  server.verifySocial();
  await controller.refresh();
  expect(controller.state.socialTask('ig')!.status).toBe(SocialTaskStatus.verified);

  expect(await controller.useRecharge('hearts', 2)).toBeNull();
  expect(controller.state.recharge('hearts')!.empty).toBe(true);
  expect(await controller.useRecharge('hearts')).toBe('empty');

  expect(await controller.friendInvite('buddies')).toBeNull();
  const code = controller.invite('buddies')!.code;
  expect(await controller.friendAccept(code)).toBe('own_code');
  expect(await controller.friendAccept('FQWERTY1')).toBeNull();
  expect(controller.state.friendsOf('buddies')).toHaveLength(2);
  expect(await controller.friendRemove('p1')).toBeNull();
  expect(controller.state.friendsOf('buddies')).toHaveLength(1);

  server.expireOffer();
  now = new Date(now.getTime() + 60000);
  await controller.refresh();
  expect(controller.state.offer('welcome')!.status).toBe(OfferStatus.claimed);
});

it('quiz, league, history, recap, surprises off, repair and follow-ups', async () => {
  let now = start;
  const server = new FakeRewardsServer({ clock: () => now, seed: 1, surpriseChance: 1 });
  const { client, controller } = fakeRewards(server);
  await controller.refresh();

  const quiz = new QuizController({ client, program: 'quiz', rewards: controller, revealForMs: null, tickEveryMs: 1e9 });
  await quiz.open();
  await quiz.start();
  for (const right of [1, 0, 2, 1]) {
    expect(quiz.phase).toBe(QuizPhase.question);
    await quiz.answer(right);
    await quiz.next();
  }
  expect(quiz.phase).toBe(QuizPhase.finished);
  expect(quiz.finishedGrants.map((g) => g.amount)).toEqual([30]);
  quiz.dispose();

  expect(await controller.joinLeague('weekly')).toBeNull();
  await controller.track('chapter_read');
  expect(controller.league('weekly')!.joined).toBe(true);
  server.closeLeagueWeek(1);
  expect(await controller.loadLeague('weekly')).toBeNull();
  expect(controller.league('weekly')!.tierName).toBe('Silver');
  expect(controller.state.inbox.some((g) => g.program === 'weekly')).toBe(true);

  expect(await controller.loadHistory({ weeks: 2 })).toBeNull();
  expect(controller.history()!.days).toHaveLength(14);
  expect(await controller.loadRecap('2026-01-01', '2026-12-31')).toBeNull();
  expect(controller.recap('2026-01-01', '2026-12-31')!.daysActive).toBe(212);

  expect(controller.state.inbox.some((g) => g.isSurprise)).toBe(true);
  await client.followupPrefs({ surprises_off: true, streaks_off: true });
  await controller.applyChoices(new RewardsChoices({ surprisesOff: true, streaksOff: true }));
  expect(controller.state.streak('daily')!.hidden).toBe(true);

  server.breakStreak(20, 2);
  server.newDay();
  await controller.refresh();
  expect(controller.state.streak('daily')!.repair!.restoresTo).toBe(20);
  await controller.track('chapter_read');
  await controller.track('chapter_read');
  expect(controller.state.streak('daily')!.current).toBe(21);
  expect(controller.state.streak('daily')!.repairedRecently(now)).toBe(true);

  const notifier = new MemoryFollowupNotifier();
  const scheduler = new FollowupScheduler({ controller, notifier });
  await scheduler.replanNow();
  expect(notifier.scheduled.size).toBe(2);
  await client.setFollowupGroupMuted('recap', true);
  await scheduler.replanNow();
  expect(notifier.scheduled.size).toBe(1);
  await scheduler.stop();
  expect(notifier.scheduled.size).toBe(0);
  now = new Date(now.getTime() + 1);
});

it('switches for unavailable, offline and server errors', async () => {
  const server = new FakeRewardsServer();
  const { controller } = fakeRewards(server);
  server.deployed = false;
  await controller.refresh();
  expect(controller.unavailable).toBe('not_deployed');
  server.deployed = true;
  server.offline = true;
  expect(await controller.track('x')).toBe('offline');
  server.offline = false;
  server.serverError = true;
  expect(await controller.track('x')).toBe('server_error');
  server.serverError = false;
  server.enabled = false;
  await controller.refresh();
  expect(controller.loaded && !controller.visible).toBe(true);
});
