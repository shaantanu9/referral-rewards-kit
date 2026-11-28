// Ports of widgets_test.dart (StreakCard, MilestoneProgress), program_widgets_test.dart (DailyGoalRing, MysteryOdds)
// and fair_play_widgets_test.dart (choices, repair, personal best, head start, levels, surprises off).
import { rewardsTexts, RewardSpec, MysteryOdd } from '@myind/rewards-core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DailyGoalRing, MilestoneProgress, MysteryOdds, StreakCard } from '../src';
import { flush, loaded, renderWith, rig } from './helpers';

describe('StreakCard', () => {
  it('loads the state itself and shows the streak, the risk countdown and the next reward', async () => {
    const r = rig();
    expect(r.controller.loaded).toBe(false);
    renderWith(r, <StreakCard />);
    await screen.findByText('2-day streak');
    expect(r.server.called('rewards_state')).toHaveLength(1);
    expect(screen.getByRole('timer').textContent).toBe('Your streak ends in 1h 30m');
    expect(screen.getByRole('timer').closest('.rk-countdown')!.className).toContain('rk-warning');
    expect(screen.getByText('50 coins in 5 more days')).toBeTruthy();
    expect(screen.getByText('Best: 4 · Freezes: 1')).toBeTruthy();
  });

  it('done today, custom texts', async () => {
    const r = await loaded(rig());
    await r.controller.track('chapter_read');
    await r.controller.track('chapter_read');
    renderWith(r, <StreakCard texts={rewardsTexts({ streakDoneToday: 'All set', streakDays: (d) => `${d} in a row` })} />);
    expect(screen.getByText('3 in a row')).toBeTruthy();
    expect(screen.getByText('All set')).toBeTruthy();
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('not at risk yet: the plain line, no countdown', async () => {
    const r = await loaded(rig({ now: new Date('2026-11-27T08:00:00Z') }));
    renderWith(r, <StreakCard />);
    expect(screen.getByText('Keep your streak: do it today')).toBeTruthy();
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('render replaces the whole look; className and style reach the card', async () => {
    const r = await loaded(rig());
    const { container } = renderWith(
      r,
      <>
        <StreakCard render={(s) => <i>own {s.current}</i>} />
        <StreakCard className="mine" style={{ maxWidth: 300 }} />
      </>,
    );
    expect(screen.getByText('own 2')).toBeTruthy();
    const card = container.querySelector('.rk-streak.mine') as HTMLElement;
    expect(card.style.maxWidth).toBe('300px');
  });

  it('hidden when the engine is disabled or not deployed', async () => {
    const off = rig();
    off.server.enabled = false;
    const a = renderWith(off, <StreakCard />);
    await flush();
    expect(a.container.textContent).toBe('');
    const gone = rig();
    gone.server.deployed = false;
    const b = renderWith(gone, <StreakCard />);
    await flush();
    expect(b.container.textContent).toBe('');
    expect(gone.controller.unavailable).toBe('not_deployed');
  });

  it('a mystery next reward shows its odds as percentages', async () => {
    const r = rig();
    r.server.streak = 8;
    await r.controller.refresh();
    renderWith(r, <StreakCard />);
    expect(screen.getByText('a mystery reward in 22 more days')).toBeTruthy();
    expect(screen.getByText('What it can be')).toBeTruthy();
    for (const t of ['60%', '50 coins', '30%', '1 streak freeze', '10%', '3 days of Premium']) expect(screen.getByText(t)).toBeTruthy();
  });
});

describe('fair play', () => {
  it('a hidden streak shows no StreakCard and no DailyGoalRing; streaks_off hides them too', async () => {
    const r = rig();
    r.server.followups.prefs['streaks_off'] = true;
    await r.controller.refresh();
    const { container } = renderWith(r, <><StreakCard /><DailyGoalRing /></>);
    expect(container.textContent).toBe('');
  });

  it('an older server (no choices, no hidden) shows the card as before', async () => {
    const r = await loaded(rig());
    renderWith(r, <StreakCard />);
    expect(screen.getByText('2-day streak')).toBeTruthy();
  });

  it('timers off: no at-risk countdown, the plain line in the warning colour', async () => {
    const r = rig();
    r.server.followups.prefs['timers_off'] = true;
    await r.controller.refresh();
    renderWith(r, <StreakCard />);
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.getByText('Keep your streak: do it today').className).toContain('rk-warning');
  });

  it('the repair line and its deadline; with timers off no time', async () => {
    const r = rig();
    r.server.breakStreak(20, 2);
    await r.controller.refresh();
    const a = renderWith(r, <StreakCard />);
    expect(screen.getByText('Do 2 more today to bring back your 20-day streak')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('Ends in 1h 30m');
    a.unmount();
    r.server.followups.prefs['timers_off'] = true;
    await r.controller.refresh();
    renderWith(r, <StreakCard />);
    expect(screen.getByText('Do 2 more today to bring back your 20-day streak')).toBeTruthy();
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('the day it came back says so', async () => {
    const r = rig();
    r.server.breakStreak(20, 2);
    await r.controller.refresh();
    await r.controller.track('chapter_read');
    await r.controller.track('chapter_read');
    renderWith(r, <StreakCard />);
    expect(screen.getByText('Your 21-day streak is back')).toBeTruthy();
    expect(screen.getByText('Done for today')).toBeTruthy();
  });

  it('a record day shows the personal best chip; other days do not', async () => {
    const r = await loaded(rig());
    const a = renderWith(r, <StreakCard />);
    expect(screen.queryByText(/New personal best/)).toBeNull();
    a.unmount();
    for (let i = 0; i < 3; i++) await r.controller.track('chapter_read');
    renderWith(r, <StreakCard />);
    expect(screen.getByText('New personal best: 3 today')).toBeTruthy();
  });

  it('surprises off: a mystery next reward is named by what it gives, with no odds', async () => {
    const r = rig();
    r.server.streak = 8;
    r.server.followups.prefs['surprises_off'] = true;
    await r.controller.refresh();
    renderWith(r, <StreakCard />);
    expect(screen.getByText('50 coins in 22 more days')).toBeTruthy();
    expect(screen.queryByText('What it can be')).toBeNull();
  });
});

describe('MilestoneProgress', () => {
  it('shows count, target, reward, title, the head start with the program label, and the level', async () => {
    const r = await loaded(rig());
    renderWith(r, <MilestoneProgress program="reader" title="Read 5 chapters" />);
    expect(screen.getByRole('heading', { name: 'Read 5 chapters' })).toBeTruthy();
    expect(screen.getByText('3 of 5 · "Bookworm" badge')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('60');
    expect(screen.getByText('Includes 1 chapter from us to get you going')).toBeTruthy();
    expect(screen.getByText('Level 2 · Explorer')).toBeTruthy();
    expect(screen.getByText('3 of 6 to the next level')).toBeTruthy();
  });

  it('no label: the default head start line; all earned; render', async () => {
    const r = await loaded(rig());
    r.server.chapters = 9;
    await r.controller.refresh();
    renderWith(
      r,
      <>
        <MilestoneProgress program="reader" headStartLabel={null} texts={rewardsTexts({ allEarned: 'Done!' })} />
        <MilestoneProgress program="reader" render={(m) => <i>count {m.count}</i>} />
        <MilestoneProgress program="nope" />
      </>,
    );
    expect(screen.getByText('Done!')).toBeTruthy();
    expect(screen.getByText('count 9')).toBeTruthy();
    expect(screen.getByText('Level 3 · Bookworm')).toBeTruthy();
    expect(screen.queryByText(/to the next level/)).toBeNull();
  });

  it('an older server: no head start line, no level', async () => {
    const r = await loaded(rig());
    r.server.headStart = 0;
    await r.controller.refresh();
    renderWith(r, <MilestoneProgress program="reader" headStartLabel="x" />);
    expect(screen.queryByText('x')).toBeNull();
  });
});

describe('DailyGoalRing', () => {
  it('count of goal, a check when done; render', async () => {
    const r = await loaded(rig());
    renderWith(r, <DailyGoalRing size={64} />);
    expect(screen.getByRole('img', { name: '0/2' })).toBeTruthy();
    await r.controller.track('chapter_read');
    await flush();
    expect(screen.getByRole('img', { name: '1/2' })).toBeTruthy();
    await r.controller.track('chapter_read');
    await flush();
    expect(screen.getByRole('img', { name: 'Goal met' }).className).toContain('rk-ring--done');
    renderWith(r, <DailyGoalRing render={(s) => <i>{s.todayCount} today</i>} />);
    expect(screen.getByText('2 today')).toBeTruthy();
  });
});

describe('MysteryOdds', () => {
  it('every chance as a percentage; nothing without odds; render', () => {
    const reward = new RewardSpec({
      kind: 'mystery',
      odds: [new MysteryOdd({ kind: 'coins', amount: 5, chance: 0.75 }), new MysteryOdd({ kind: 'badge', amount: 1, chance: 0.25, params: { badge: 'lucky' } })],
    });
    const { container } = render(
      <>
        <MysteryOdds reward={reward} />
        <MysteryOdds reward={new RewardSpec({ kind: 'coins', amount: 3 })} />
        <MysteryOdds reward={reward} render={(o) => <i>{o.length} outcomes</i>} />
      </>,
    );
    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByText('"Lucky" badge')).toBeTruthy();
    expect(screen.getByText('2 outcomes')).toBeTruthy();
    expect(container.querySelectorAll('.rk-mystery-odds')).toHaveLength(1);
  });
});
