// Port of program_widgets_test.dart: QuestList, RechargeMeter, WindowBadge, FriendStreaks, ActivityHeatmap, plus the
// timers-off rules of fair_play_widgets_test.dart.
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityHeatmap, FriendStreaks, QuestList, RechargeMeter, WindowBadge } from '../src';
import { flush, loaded, renderWith, rig } from './helpers';

afterEach(() => {
  vi.useRealTimers();
});

describe('QuestList', () => {
  it('tasks, progress, rewards, bonus, reset countdown; render', async () => {
    const r = await loaded(rig());
    renderWith(r, <QuestList program="daily_quests" title="Today" />);
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.getByText('Read 3')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: '1 of 3' })).toBeTruthy();
    expect(screen.getAllByText('5 coins')).toHaveLength(2);
    expect(screen.getByText('0 of 1')).toBeTruthy();
    expect(screen.getByText('Finish all for 20 coins')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('Resets in 1h 30m');
    renderWith(r, <QuestList program="daily_quests" render={(q) => <i>{q.doneCount} done</i>} />);
    expect(screen.getByText('0 done')).toBeTruthy();
  });

  it('a done task says so without colour alone; all done; timers off hides the countdown', async () => {
    const r = rig();
    r.server.questProgress = { read: 3, quiz: 1, streak: 1 };
    r.server.followups.prefs['timers_off'] = true;
    await r.controller.refresh();
    renderWith(r, <QuestList program="daily_quests" />);
    expect(screen.getAllByText(/All done!/)).toHaveLength(4);
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByText(/Finish all/)).toBeNull();
  });
});

describe('RechargeMeter', () => {
  it('units, next-in countdown, use; the empty refusal; render', async () => {
    const r = await loaded(rig());
    renderWith(r, <RechargeMeter program="hearts" showUseButton />);
    expect(screen.getByRole('img', { name: '2 of 3' })).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('Next in 1h 05m');
    fireEvent.click(screen.getByRole('button', { name: 'Use one' }));
    await flush();
    expect(screen.getByRole('img', { name: '1 of 3' })).toBeTruthy();
    r.server.hearts = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Use one' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('None left. More come back soon.');
    expect(screen.getByRole('img', { name: '0 of 3' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Use one' }) as HTMLButtonElement).disabled).toBe(true);
    renderWith(r, <RechargeMeter program="hearts" render={(h) => <i>{h.units} left</i>} />);
    expect(screen.getByText('0 left')).toBeTruthy();
  });

  it('full says Full and has no countdown; no use button by default', async () => {
    const r = rig();
    r.server.hearts = 3;
    await r.controller.refresh();
    renderWith(r, <RechargeMeter program="hearts" />);
    expect(screen.getByText('Full')).toBeTruthy();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('WindowBadge', () => {
  it('ends in while open, starts in before; reloads at the edge; render', async () => {
    vi.useFakeTimers();
    const r = await loaded(rig());
    renderWith(r, <WindowBadge program="happy" />);
    expect(screen.getByText('Happy hour: ends in 50m 00s')).toBeTruthy();
    const before = r.server.called('rewards_state').length;
    r.advance(50 * 60 * 1000);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await flush();
    expect(r.server.called('rewards_state').length).toBe(before + 1);
    r.server.windowActive = false;
    await act(async () => {
      await r.controller.refresh();
    });
    expect(screen.getByText('Happy hour: starts in 2h 00m')).toBeTruthy();
    renderWith(r, <WindowBadge program="happy" render={(w, open) => <i>{open ? 'open' : 'closed'}</i>} />);
    expect(screen.getByText('closed')).toBeTruthy();
  });

  it('timers off: an open window shows only its name; a coming one shows nothing', async () => {
    const r = rig();
    r.server.followups.prefs['timers_off'] = true;
    await r.controller.refresh();
    const a = renderWith(r, <WindowBadge program="happy" title="Double coins" />);
    expect(a.container.textContent).toBe('Double coins');
    a.unmount();
    r.server.windowActive = false;
    await r.controller.refresh();
    const b = renderWith(r, <WindowBadge program="happy" />);
    expect(b.container.textContent).toBe('');
  });
});

describe('FriendStreaks', () => {
  it('lists friends; invite goes to the share callback; accept and remove', async () => {
    const r = await loaded(rig());
    const shared: string[] = [];
    renderWith(r, <FriendStreaks program="buddies" onShareInvite={(c) => shared.push(c)} />);
    expect(screen.getByText('Asha · 4 days together')).toBeTruthy();
    expect(screen.getByText('Your turn today')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Invite a friend' }));
    await flush();
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatch(/^F\d{6}$/);
    expect(screen.queryByText(shared[0]!)).toBeNull();
    fireEvent.change(screen.getByLabelText("Friend's code"), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('That code does not work. Check it and try again.');
    fireEvent.change(screen.getByLabelText("Friend's code"), { target: { value: 'F1234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await flush(10);
    expect(screen.getByText('Sam · 0 days together')).toBeTruthy();
    expect((screen.getByLabelText("Friend's code") as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getAllByRole('button', { name: 'End streak' })[0]!);
    await flush(10);
    expect(screen.queryByText(/Asha/)).toBeNull();
  });

  it('no share callback: the code is shown; waiting and both-done lines; empty list; render', async () => {
    const r = await loaded(rig());
    await r.controller.track('chapter_read');
    renderWith(r, <FriendStreaks program="buddies" />);
    expect(screen.getByText('Both done today')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Invite a friend' }));
    await flush();
    expect(screen.getByText(r.controller.invite('buddies')!.code)).toBeTruthy();
    r.server.friends = [];
    await act(async () => {
      await r.controller.refresh();
    });
    expect(screen.getByText('Keep a streak going with a friend.')).toBeTruthy();
    renderWith(r, <FriendStreaks program="buddies" render={(f) => <i>{f.length} friends</i>} />);
    expect(screen.getByText('0 friends')).toBeTruthy();
  });
});

describe('ActivityHeatmap', () => {
  it('loads the history itself; weeks × 7 cells; today outlined; frozen striped; legend', async () => {
    const r = await loaded(rig());
    const { container } = renderWith(r, <ActivityHeatmap weeks={15} />);
    await flush();
    expect(r.server.called('rewards_history')).toEqual([{ program: null, weeks: 15 }].map((x) => expect.objectContaining({ weeks: x.weeks })));
    const cells = container.querySelectorAll('.rk-heat__grid [role="img"]');
    expect(cells).toHaveLength(105);
    const today = container.querySelectorAll('.rk-heat__cell--today');
    expect(today).toHaveLength(1);
    expect(today[0]!.getAttribute('aria-label')).toBe('2026-11-27: 0');
    expect(container.querySelectorAll('.rk-heat__cell--frozen')).toHaveLength(2);
    expect(screen.getByText('Less')).toBeTruthy();
    expect(screen.getByText('More')).toBeTruthy();
    // A track updates today.
    await act(async () => {
      await r.controller.track('chapter_read');
    });
    expect(container.querySelector('.rk-heat__cell--today')!.getAttribute('aria-label')).toBe('2026-11-27: 1');
  });

  it('render gets the history; renderCell; no legend', async () => {
    const r = await loaded(rig());
    await r.controller.loadHistory({ weeks: 2 });
    const { container } = renderWith(
      r,
      <>
        <ActivityHeatmap weeks={2} render={(h) => <i>{h.days.length} days</i>} />
        <ActivityHeatmap weeks={2} showLegend={false} renderCell={(d, level, today) => <b data-level={level}>{today ? 'T' : ''}</b>} />
      </>,
    );
    expect(screen.getByText('14 days')).toBeTruthy();
    expect(container.querySelectorAll('b[data-level]')).toHaveLength(14);
    expect(screen.getByText('T')).toBeTruthy();
    expect(screen.queryByText('Less')).toBeNull();
  });
});
