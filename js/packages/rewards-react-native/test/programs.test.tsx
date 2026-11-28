import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ServerClock } from '@myind/rewards-core';
import {
  ActivityHeatmap,
  Countdown,
  DailyGoalRing,
  FriendStreaks,
  LeagueBoard,
  MilestoneProgress,
  MysteryOdds,
  OfferBanner,
  QuestList,
  RecapCard,
  RechargeMeter,
  RewardInbox,
  RewardsHub,
  RewardsRecapCard,
  recapYear,
  SocialTagTask,
  StreakCard,
  SurpriseOdds,
  WindowBadge,
} from '../src';
import { setup, x } from './helpers';

describe('Countdown', () => {
  test('ticks every second, fires onExpired once; hidden shows nothing but still fires', async () => {
    jest.useFakeTimers();
    try {
      let now = new Date('2026-11-20T10:00:00Z').getTime();
      const clock = new ServerClock({ local: () => new Date(now) });
      const fired = jest.fn();
      const end = new Date(now + 3000);
      await render(<Countdown endsAt={end} clock={clock} prefix="Ends in" onExpired={fired} />);
      expect(screen.getByText('Ends in 3s')).toBeOnTheScreen();
      now += 1000;
      await act(() => jest.advanceTimersByTime(1000));
      expect(screen.getByText('Ends in 2s')).toBeOnTheScreen();
      now += 3000;
      await act(() => jest.advanceTimersByTime(3000));
      expect(screen.getByText('Ends in 0s')).toBeOnTheScreen();
      expect(fired).toHaveBeenCalledTimes(1);
      await screen.unmount();
      const firedHidden = jest.fn();
      await render(<Countdown endsAt={new Date(now + 1000)} clock={clock} hidden onExpired={firedHidden} />);
      expect(screen.queryByText(/s$/)).toBeNull();
      now += 1000;
      await act(() => jest.advanceTimersByTime(1100));
      expect(firedHidden).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('no deadline: nothing; render gets the time left', async () => {
    const clock = new ServerClock({ local: () => new Date('2026-11-20T10:00:00Z') });
    await render(<Countdown endsAt={null} clock={clock} />);
    expect(screen.toJSON()).toBeNull();
    await render(<Countdown endsAt={new Date('2026-11-20T10:01:00Z')} clock={clock} render={(ms) => <Text>{`left ${ms}`}</Text>} />);
    expect(screen.getByText('left 60000')).toBeOnTheScreen();
  });
});

describe('streak, milestone, ring, heatmap', () => {
  test('StreakCard loads the state itself: streak, risk countdown, next reward; render replaces the look', async () => {
    const s = setup();
    await render(s.wrap(<StreakCard controller={s.controller} />));
    expect(await screen.findByText(x.streakDays(2))).toBeOnTheScreen();
    expect(screen.getByText(/^Your streak ends in 3h/)).toBeOnTheScreen();
    expect(screen.getByText(x.nextIn('50 coins', 5))).toBeOnTheScreen();
    await screen.unmount();
    await render(s.wrap(<StreakCard controller={s.controller} render={(st) => <Text>{`custom ${st.current}`}</Text>} />));
    expect(await screen.findByText('custom 2')).toBeOnTheScreen();
  });

  test('fair play: streaks off hides it; timers off shows the plain line; repair; record day', async () => {
    const s = setup();
    s.server.todayCount = 1;
    s.server.breakStreak(20, 2);
    s.server.bestDay = 0;
    await render(s.wrap(<StreakCard controller={s.controller} />));
    expect(await screen.findByText(x.fairPlay.repair(1, 20))).toBeOnTheScreen();
    expect(screen.getByText(x.fairPlay.personalBest(1))).toBeOnTheScreen();
    await screen.unmount();
    s.server.followups.prefs['timers_off'] = true;
    s.server.repair = null;
    await act(() => s.controller.refresh());
    await render(s.wrap(<StreakCard controller={s.controller} />));
    expect(await screen.findByText(x.streakDoToday)).toBeOnTheScreen();
    expect(screen.queryByText(/ends in/)).toBeNull();
    await screen.unmount();
    s.server.followups.prefs['streaks_off'] = true;
    await act(() => s.controller.refresh());
    await render(s.wrap(<StreakCard controller={s.controller} />));
    await render(s.wrap(<DailyGoalRing controller={s.controller} />));
    expect(screen.queryByTestId('streak-card')).toBeNull();
    expect(screen.queryByTestId('daily-goal-ring')).toBeNull();
  });

  test('hidden while not deployed', async () => {
    const s = setup();
    s.server.deployed = false;
    await render(s.wrap(<StreakCard controller={s.controller} />));
    await act(() => s.controller.refresh());
    expect(screen.queryByTestId('streak-card')).toBeNull();
  });

  test('MilestoneProgress: count, target, reward, title, level and head start', async () => {
    const s = setup();
    await render(s.wrap(<MilestoneProgress controller={s.controller} program="reader" title="Read 5" />));
    expect(await screen.findByText('Read 5')).toBeOnTheScreen();
    expect(screen.getByText(`${x.progress(3, 5)}  ·  "Bookworm" badge`)).toBeOnTheScreen();
    expect(screen.getByText(x.fairPlay.level(2, 'Explorer'))).toBeOnTheScreen();
    expect(screen.getByText('Includes 1 chapter from us to get you going')).toBeOnTheScreen();
    expect(screen.getByRole('progressbar')).toBeOnTheScreen();
  });

  test('DailyGoalRing: count of goal, a check when done', async () => {
    const s = setup();
    await render(s.wrap(<DailyGoalRing controller={s.controller} />));
    expect(await screen.findByLabelText(x.programs.goal(0, 2))).toBeOnTheScreen();
    await act(async () => {
      await s.controller.track('chapter_read');
      await s.controller.track('chapter_read');
    });
    expect(await screen.findByLabelText(x.programs.goalDone)).toBeOnTheScreen();
  });

  test('ActivityHeatmap loads history itself: weeks × 7 cells, frozen striped', async () => {
    const s = setup();
    await render(s.wrap(<ActivityHeatmap controller={s.controller} weeks={6} />));
    expect(await screen.findByTestId('activity-heatmap')).toBeOnTheScreen();
    expect(screen.getAllByTestId('heatmap-frozen').length).toBeGreaterThan(0);
    expect(s.server.called('rewards_history')).toHaveLength(1);
    expect(screen.getByText(x.programs.heatmapLess)).toBeOnTheScreen();
  });

  test('MysteryOdds: every chance as a percentage; nothing without odds', async () => {
    const s = setup();
    s.server.streak = 8;
    await act(() => s.controller.refresh());
    const next = s.controller.state.streaks[0]!.nextReward!;
    await render(<MysteryOdds reward={next} />);
    expect(screen.getByText('60%')).toBeOnTheScreen();
    expect(screen.getByText('10%')).toBeOnTheScreen();
  });
});

describe('offers, quests, recharge, window, odds, inbox', () => {
  test('OfferBanner: reward, stock, time left; Claim calls the server and hides it', async () => {
    const s = setup();
    const claimed = jest.fn();
    await render(s.wrap(<OfferBanner controller={s.controller} program="welcome" title="Welcome gift" onClaimed={claimed} />));
    expect(await screen.findByText('100 coins')).toBeOnTheScreen();
    expect(screen.getByText(x.stockLeft(7))).toBeOnTheScreen();
    expect(screen.getByText(/^Ends in 30m/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: x.claim }));
    expect(claimed).toHaveBeenCalled();
    expect(screen.queryByTestId('offer-banner')).toBeNull();
  });

  test('OfferBanner: sold out on claim hides it; render gets every state; timers off hides only the countdown', async () => {
    const s = setup();
    s.server.followups.prefs['timers_off'] = true;
    await render(s.wrap(<OfferBanner controller={s.controller} program="welcome" />));
    expect(await screen.findByText('100 coins')).toBeOnTheScreen();
    expect(screen.queryByText(/Ends in/)).toBeNull();
    s.server.sellOutOffer();
    await fireEvent.press(screen.getByRole('button', { name: x.claim }));
    expect(screen.queryByTestId('offer-banner')).toBeNull();
    await screen.unmount();
    await render(s.wrap(<OfferBanner controller={s.controller} program="welcome" render={(o) => <Text>{`state ${o.status}`}</Text>} />));
    expect(await screen.findByText('state sold_out')).toBeOnTheScreen();
  });

  test('QuestList: tasks, progress, rewards, bonus, reset countdown', async () => {
    const s = setup();
    await render(s.wrap(<QuestList controller={s.controller} program="daily_quests" title="Today" />));
    expect(await screen.findByText('Today')).toBeOnTheScreen();
    expect(screen.getByText('Read 3')).toBeOnTheScreen();
    expect(screen.getByText(x.programs.questBonus('20 coins'))).toBeOnTheScreen();
    expect(screen.getByText(/^Resets in/)).toBeOnTheScreen();
  });

  test('RechargeMeter: units, next-in, use; empty refusal; full', async () => {
    const s = setup();
    await render(s.wrap(<RechargeMeter controller={s.controller} program="hearts" showUseButton />));
    expect(await screen.findByLabelText('2 / 3')).toBeOnTheScreen();
    expect(screen.getByText(/^Next in 1h 05m/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: x.programs.rechargeUse }));
    await fireEvent.press(screen.getByRole('button', { name: x.programs.rechargeUse }));
    expect(await screen.findByLabelText('0 / 3')).toBeOnTheScreen();
    await screen.unmount();
    s.server.hearts = 3;
    await act(() => s.controller.refresh());
    await render(s.wrap(<RechargeMeter controller={s.controller} program="hearts" />));
    expect(await screen.findByText(x.programs.rechargeFull)).toBeOnTheScreen();
  });

  test('WindowBadge: ends in while open, starts in before; timers off: the name only, a coming one nothing', async () => {
    const s = setup();
    await render(s.wrap(<WindowBadge controller={s.controller} program="happy" />));
    expect(await screen.findByText(/^Happy hour: ends in 50m/)).toBeOnTheScreen();
    await screen.unmount();
    s.server.windowActive = false;
    await act(() => s.controller.refresh());
    await render(s.wrap(<WindowBadge controller={s.controller} program="happy" />));
    expect(await screen.findByText(/^Happy hour: starts in 2h/)).toBeOnTheScreen();
    await screen.unmount();
    s.server.followups.prefs['timers_off'] = true;
    await act(() => s.controller.refresh());
    await render(s.wrap(<WindowBadge controller={s.controller} program="happy" />));
    expect(screen.queryByTestId('window-badge')).toBeNull();
    await screen.unmount();
    s.server.windowActive = true;
    await act(() => s.controller.refresh());
    await render(s.wrap(<WindowBadge controller={s.controller} program="happy" />));
    expect(await screen.findByText('Happy hour')).toBeOnTheScreen();
  });

  test('SurpriseOdds: each odds line; nothing when surprises are off', async () => {
    const s = setup({ surpriseChance: 0.1 });
    await render(s.wrap(<SurpriseOdds controller={s.controller} />));
    expect(await screen.findByText('1 in 10 chance of 5–50 coins')).toBeOnTheScreen();
    await screen.unmount();
    s.server.followups.prefs['surprises_off'] = true;
    await act(() => s.controller.refresh());
    await render(s.wrap(<SurpriseOdds controller={s.controller} />));
    expect(screen.queryByTestId('surprise-odds')).toBeNull();
  });

  test('RewardInbox: granted items get Got it, pending ones On its way', async () => {
    const s = setup();
    s.server.verifySocial();
    s.server.social = 'pending';
    s.server.verifySocial();
    s.server.grantPending();
    await render(s.wrap(<RewardInbox controller={s.controller} />));
    expect(await screen.findByText(x.onItsWay)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: x.gotIt }));
    expect(screen.queryByRole('button', { name: x.gotIt })).toBeNull();
    expect(s.server.called('rewards_mark_seen')).toHaveLength(1);
  });
});

describe('social, friends, league, recap', () => {
  test('SocialTagTask: username → code; copy and open Instagram report events with no code; link field', async () => {
    const s = setup();
    const open = jest.fn();
    await render(s.wrap(<SocialTagTask controller={s.controller} program="ig" onOpenInstagram={open} showLinkField />));
    await fireEvent.changeText(await screen.findByTestId('social-handle'), 'asha');
    await fireEvent.press(screen.getByRole('button', { name: x.socialStart }));
    expect(await screen.findByTestId('social-code')).toHaveTextContent('DEMO-K7Q2HX');
    await fireEvent.press(screen.getByRole('button', { name: x.copyCode }));
    expect(s.copied).toEqual(['DEMO-K7Q2HX']);
    await fireEvent.press(screen.getByRole('button', { name: x.openInstagram }));
    expect(open).toHaveBeenCalledWith('myapp');
    const props = s.events.filter((e) => e.name === 'rewards_social_code_copied' || e.name === 'rewards_instagram_opened').map((e) => e.props);
    expect(props).toEqual([{ program: 'ig' }, { program: 'ig' }]);
    await fireEvent.changeText(screen.getByTestId('social-link'), 'https://instagram.com/p/x');
    await fireEvent.press(screen.getByRole('button', { name: x.programs.postLinkSend }));
    expect(await screen.findByText(x.programs.postLinkSent)).toBeOnTheScreen();
  });

  test('SocialTagTask: a refusal shows its line; verified state', async () => {
    const s = setup();
    await render(s.wrap(<SocialTagTask controller={s.controller} program="ig" />));
    const startButton = await screen.findByRole('button', { name: x.socialStart });
    s.server.social = 'verified';
    await fireEvent.press(startButton);
    expect(await screen.findByText(x.error('already_posted'))).toBeOnTheScreen();
    await act(() => s.controller.refresh());
    expect(await screen.findByText(x.socialVerified)).toBeOnTheScreen();
  });

  test('FriendStreaks: list; invite goes to the share callback; accept and remove; no callback shows the code', async () => {
    const s = setup();
    const shared: string[] = [];
    await render(s.wrap(<FriendStreaks controller={s.controller} program="buddies" onShareInvite={(c) => shared.push(c)} />));
    expect(await screen.findByText(`Asha  ·  ${x.programs.friendDays(4)}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: x.programs.friendInvite }));
    expect(shared[0]).toMatch(/^F/);
    await fireEvent.changeText(screen.getByTestId('friend-code'), 'FABC1234');
    await fireEvent.press(screen.getByRole('button', { name: x.programs.friendAccept }));
    expect(await screen.findByText(`Sam  ·  ${x.programs.friendDays(0)}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getAllByRole('button', { name: x.programs.friendRemove })[0]!);
    await act(async () => {});
    expect(screen.queryByText(/^Asha/)).toBeNull();
    await screen.unmount();
    await render(s.wrap(<FriendStreaks controller={s.controller} program="buddies" />));
    await fireEvent.press(await screen.findByRole('button', { name: x.programs.friendInvite }));
    expect(await screen.findByTestId('friend-invite-code')).toBeOnTheScreen();
  });

  test('LeagueBoard: the pitch, Join loads the board with the own row; Leave', async () => {
    const s = setup();
    await render(s.wrap(<LeagueBoard controller={s.controller} program="weekly" />));
    await fireEvent.press(await screen.findByRole('button', { name: x.leagues.join }));
    expect(await screen.findByTestId('league-me')).toBeOnTheScreen();
    expect(screen.getByText(/^Week ends in/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: x.leagues.leave }));
    expect(await screen.findByRole('button', { name: x.leagues.join })).toBeOnTheScreen();
  });

  test('RecapCard loads itself; RewardsRecapCard: "Your 2026" for a year, "Your recap" for a range', async () => {
    const s = setup();
    const [from, to] = recapYear(2026);
    await render(s.wrap(<RecapCard controller={s.controller} from={from} to={to} />));
    expect(await screen.findByText(x.programs.recapTitle)).toBeOnTheScreen();
    await act(async () => {});
    const recap = s.controller.recap(from, to)!;
    await screen.unmount();
    await render(s.wrap(<RewardsRecapCard recap={recap} subtitle="Reader" />));
    const yearly = recap.from != null && recap.from.getUTCMonth() === 0 && recap.from.getUTCDate() === 1;
    expect(screen.getByText(yearly ? x.recapCard.yearTitle(2026) : x.recapCard.rangeTitle)).toBeOnTheScreen();
    expect(screen.getByText(x.recapCard.mostDone)).toBeOnTheScreen();
  });
});

describe('RewardsHub', () => {
  test('one component per live program, inbox first, odds card, attribution at the bottom', async () => {
    const s = setup({ surpriseChance: 0.1 });
    await render(s.wrap(<RewardsHub controller={s.controller} />));
    expect(await screen.findByTestId('streak-card')).toBeOnTheScreen();
    for (const id of ['milestone-progress', 'offer-banner', 'social-tag-task', 'quiz-card', 'quest-list', 'recharge-meter', 'window-badge', 'friend-streaks', 'surprise-odds']) {
      expect(screen.getByTestId(id)).toBeOnTheScreen();
    }
    expect(screen.getByText('Welcome gift')).toBeOnTheScreen();
    expect(await screen.findByTestId('league-board')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('link', { name: 'Opens myind.ai: Rewards by Myind' }));
    expect(s.opened[0]).toContain('utm_source=rewards-react-native');
    expect(s.opened[0]).toContain('utm_campaign=v1');
  });

  test('programRenderers replace one program; scrollable false; showAttribution false; showSurprises false', async () => {
    const s = setup({ surpriseChance: 0.1 });
    await render(
      s.wrap(
        <RewardsHub
          controller={s.controller}
          scrollable={false}
          showAttribution={false}
          showSurprises={false}
          programRenderers={{ daily: () => <Text>my streak</Text> }}
        />,
      ),
    );
    expect(await screen.findByText('my streak')).toBeOnTheScreen();
    expect(screen.queryByTestId('streak-card')).toBeNull();
    expect(screen.queryByTestId('myind-attribution')).toBeNull();
    expect(screen.queryByTestId('surprise-odds')).toBeNull();
  });
});
