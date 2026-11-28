// @vitest-environment node
// Server rendering (Next.js App Router, any SSR): every component renders to a string without window or document,
// before and after the state is loaded, and effects (loading, timers) never run on the server.
import { RewardGrant } from '@myind/rewards-core';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import {
  ActivityHeatmap,
  Countdown,
  DailyGoalRing,
  FollowupSettings,
  FriendStreaks,
  LeagueBoard,
  MilestoneProgress,
  MyindAttribution,
  OfferBanner,
  QuestList,
  QuizCard,
  QuizScreen,
  RechargeMeter,
  RecapCard,
  RecapShareCard,
  RewardedAdButton,
  RewardInbox,
  RewardReveal,
  RewardRevealDialog,
  RewardsHub,
  RewardsProvider,
  RewardToastListener,
  SocialTagTask,
  StreakCard,
  SurpriseOdds,
  WindowBadge,
} from '../src';
import { rig } from './helpers';

const all = (
  <>
    <RewardsHub />
    <StreakCard />
    <DailyGoalRing />
    <MilestoneProgress program="reader" />
    <ActivityHeatmap />
    <QuestList program="daily_quests" />
    <OfferBanner program="welcome" />
    <WindowBadge program="happy" />
    <RechargeMeter program="hearts" showUseButton />
    <FriendStreaks program="buddies" />
    <LeagueBoard program="weekly" />
    <RecapCard from="2026-01-01" to="2026-12-31" />
    <RewardInbox showEmpty />
    <SurpriseOdds />
    <SocialTagTask program="ig" showLinkField />
    <RewardedAdButton label="Ad" onShowAd={async () => true} />
    <FollowupSettings showChoices />
    <QuizCard program="quiz" />
    <QuizScreen program="quiz" />
    <RewardToastListener>
      <p>child</p>
    </RewardToastListener>
    <MyindAttribution />
  </>
);

it('renders every component on the server, before and after loading, without touching the network', async () => {
  expect(typeof window).toBe('undefined');
  const r = rig({ surpriseChance: 0.1 });
  const before = renderToString(<RewardsProvider controller={r.controller}>{all}</RewardsProvider>);
  expect(before).toContain('child');
  expect(before).toContain('Rewards by Myind');
  expect(r.server.calls).toHaveLength(0);
  await r.controller.refresh();
  await r.controller.loadHistory({});
  await r.controller.loadLeague('weekly');
  const calls = r.server.calls.length;
  const after = renderToString(<RewardsProvider controller={r.controller}>{all}</RewardsProvider>);
  expect(after).toContain('2-day streak');
  expect(after).toContain('Your streak ends in 1h 30m');
  expect(after).toContain('Happy hour: ends in 50m 00s');
  expect(after).toContain('1 in 10 chance of 5–50 coins');
  expect(r.server.calls.length).toBe(calls);
});

it('renders the controller-free pieces on the server', async () => {
  const r = rig();
  await r.controller.refresh();
  const recap = await r.client.recap('2026-01-01', '2026-12-31');
  const grant = new RewardGrant({ id: 'g', program: 'reader', kind: 'coins', amount: 9, params: { surprise: true } });
  const html = renderToString(
    <>
      <RecapShareCard recap={recap} />
      <RewardReveal grant={grant} />
      <RewardRevealDialog grant={grant} onClose={() => {}} />
      <Countdown endsAt={new Date(r.now().getTime() + 5000)} clock={r.controller.clock} prefix="In" />
    </>,
  );
  expect(html).toContain('Your 2026');
  expect(html).toContain('Surprise!');
  expect(html).toContain('In 5s');
});
