// Ports of league_test.dart (LeagueBoard, RewardsRecapCard) and program_widgets_test.dart (RecapCard).
import { LeagueMember, rewardsTexts } from '@myind/rewards-core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeagueBoard, leagueRows, RecapCard, recapCardSvg, RecapShareCard, recapYear, type RecapShareHandle } from '../src';
import { flush, loaded, renderWith, rig } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LeagueBoard', () => {
  it('not joined: the pitch says what is shared; Join loads the board; the own row is marked; Leave', async () => {
    const r = await loaded(rig());
    renderWith(r, <LeagueBoard program="weekly" />);
    await flush();
    expect(r.server.called('rewards_league')).toHaveLength(1);
    expect(screen.getByText('Compete with up to 20 people this week. Only your display name and score are shown. Leave any time.')).toBeTruthy();
    expect(screen.getByText('1st: 100 coins')).toBeTruthy();
    expect(screen.getByText('Top 3: 30 coins')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await flush();
    expect(screen.getByText('Bronze')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('Week ends in 2d 1h');
    expect(screen.getByText('Asha')).toBeTruthy();
    expect(screen.getByText('A member')).toBeTruthy();
    const me = screen.getByText('You').closest('li')!;
    expect(me.getAttribute('aria-current')).toBe('true');
    expect(me.className).toContain('rk-league__row--me');
    expect(me.textContent).toContain('–');
    expect(screen.getByText('Top 2 move up to Silver')).toBeTruthy();
    expect(screen.queryByText(/move down|relegat/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Leave league' }));
    await flush();
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy();
  });

  it('last week: own result and moving up; maxRows keeps the user', async () => {
    const r = await loaded(rig());
    await r.controller.joinLeague('weekly');
    await r.controller.track('chapter_read');
    r.server.closeLeagueWeek(2);
    await r.controller.loadLeague('weekly');
    renderWith(r, <LeagueBoard program="weekly" maxRows={2} />);
    expect(screen.getByText('Last week: 2nd with 1 point')).toBeTruthy();
    expect(screen.getByText('You moved up to Silver')).toBeTruthy();
    expect(screen.getAllByRole('listitem').filter((li) => li.className.includes('rk-league__row'))).toHaveLength(3);
    expect(screen.getByText('You')).toBeTruthy();
  });

  it('render replaces the look; not live hides Join', async () => {
    const r = await loaded(rig());
    r.server.league.live = false;
    await r.controller.loadLeague('weekly');
    renderWith(
      r,
      <>
        <LeagueBoard program="weekly" title="Readers league" />
        <LeagueBoard program="weekly" render={(l) => <i>live {String(l.live)}</i>} />
      </>,
    );
    expect(screen.getByRole('heading', { name: 'Readers league' })).toBeTruthy();
    expect(screen.getByText('This league is not running right now.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
    expect(screen.getByText('live false')).toBeTruthy();
  });

  it('leagueRows keeps the own row below the cut', () => {
    const rows = [1, 2, 3, 4].map((n) => new LeagueMember({ rank: n, name: `m${n}`, score: 10 - n, me: n === 4 }));
    expect(leagueRows(rows, 2).map((m) => m.name)).toEqual(['m1', 'm2', 'm4']);
    expect(leagueRows(rows, null)).toHaveLength(4);
    expect(leagueRows(rows, 10)).toHaveLength(4);
  });
});

describe('RecapCard', () => {
  it('loads itself and shows totals; render', async () => {
    const r = await loaded(rig());
    renderWith(r, <RecapCard from="2026-01-01" to="2026-12-31" />);
    await flush();
    expect(r.server.called('rewards_recap')).toHaveLength(1);
    expect(screen.getByText('212 days active')).toBeTruthy();
    expect(screen.getByText('Best streak: 31 days')).toBeTruthy();
    expect(screen.getByText('4200 coins')).toBeTruthy();
    expect(screen.getByText('3 streak freezes')).toBeTruthy();
    expect(screen.getByText('Chapter read: 840')).toBeTruthy();
    expect(screen.getByText('"Night owl" badge')).toBeTruthy();
    renderWith(r, <RecapCard from="2026-01-01" to="2026-12-31" title="Your year" render={(x) => <i>{x.bestStreak} best</i>} />);
    expect(screen.getByText('31 best')).toBeTruthy();
    expect(r.server.called('rewards_recap')).toHaveLength(1);
  });
});

describe('RecapShareCard', () => {
  const year = async () => {
    const r = await loaded(rig());
    const [from, to] = recapYear(2026);
    return r.client.recap(from, to);
  };

  it('a whole year: "Your 2026", the big numbers, the top 3 actions, what was earned', async () => {
    const recap = await year();
    render(<RecapShareCard recap={recap} subtitle="Acme Reader" />);
    expect(screen.getByRole('heading', { name: 'Your 2026' })).toBeTruthy();
    expect(screen.getByText('Acme Reader')).toBeTruthy();
    for (const t of ['212', '31', '2', 'days active', 'days best streak', 'badges', 'Most done', 'Clip made: 9', 'Earned']) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByText('4200 coins · 3 streak freezes')).toBeTruthy();
    expect((document.querySelector('.rk-share__card') as HTMLElement).style.aspectRatio).toBe('0.8');
  });

  it('a range gets "Your recap"; render keeps the image actions; the SVG is escaped', async () => {
    const r = await loaded(rig());
    const recap = await r.client.recap('2026-11-01', '2026-11-27');
    render(<RecapShareCard recap={recap} aspectRatio={null} render={(x) => <i>own {x.daysActive}</i>} showActions={false} />);
    expect(screen.getByText('own 212')).toBeTruthy();
    const svg = recapCardSvg(recap, { texts: rewardsTexts(), title: 'Tom & <Jerry>' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Tom &amp; &lt;Jerry&gt;');
    expect(svg).toContain('Chapter read: 840');
    expect(svg).toContain('width="1080" height="1350"');
    expect(recapCardSvg(recap, { texts: rewardsTexts() })).toContain('Your recap');
  });

  it('turns into a PNG only on a tap: Download saves it, Share opens the share sheet', async () => {
    const recap = await year();
    const png = new Blob(['png'], { type: 'image/png' });
    const rasterize = vi.fn(async (_svg: string, _w: number, _h: number) => png);
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const ref = createRef<RecapShareHandle>();
    render(<RecapShareCard recap={recap} rasterize={rasterize} shareRef={ref} fileName="my-2026.png" />);
    await flush();
    expect(rasterize).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await flush();
    expect(rasterize).toHaveBeenCalledTimes(1);
    expect(rasterize.mock.calls[0]![1]).toBe(1080);
    expect(rasterize.mock.calls[0]![2]).toBe(1350);
    expect(URL.createObjectURL).toHaveBeenCalledWith(png);
    expect(clicked).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await flush();
    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0]! as unknown as [{ files: File[]; title: string }];
    expect(arg[0].files[0]!.name).toBe('my-2026.png');
    expect(arg[0].title).toBe('Your 2026');
    expect(ref.current!.toSvg()).toContain('Your 2026');
    await act(async () => {
      expect(await ref.current!.share()).toBe('shared');
    });
  });

  it('without file sharing there is no Share button', async () => {
    const recap = await year();
    vi.stubGlobal('navigator', { ...navigator, canShare: undefined });
    render(<RecapShareCard recap={recap} />);
    await flush();
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  });
});
