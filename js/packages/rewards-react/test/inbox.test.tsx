// Ports of widgets_test.dart (RewardInbox, RewardToastListener), widgets_v2_test.dart (holdUntilMoment) and
// reveal_widgets_test.dart (RewardReveal, showRewardReveal, toast reveals, SurpriseOdds, hub odds card).
import { RewardGrant, rewardsTexts } from '@myind/rewards-core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RewardInbox, RewardReveal, RewardRevealDialog, RewardsHub, RewardToastListener, SurpriseOdds } from '../src';
import { flush, loaded, renderWith, rig } from './helpers';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const surprise = (id: string, amount = 23): RewardGrant =>
  new RewardGrant({ id, program: 'reader', kind: 'coins', amount, params: { surprise: true, range: [5, 50] } });
const plain = (id: string, amount = 20): RewardGrant => new RewardGrant({ id, program: 'daily', kind: 'coins', amount });

describe('RewardInbox', () => {
  it('granted items get Got it, pending ones On its way; empty shows nothing unless asked; render', async () => {
    const r = rig();
    r.server.grantPending();
    r.server.grantMystery();
    await r.controller.refresh();
    const { container } = renderWith(r, <RewardInbox />);
    expect(screen.getByText('You got 3 days of Premium')).toBeTruthy();
    expect(screen.getByText('On its way')).toBeTruthy();
    expect(screen.getByText('You got 1 streak freeze')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await flush();
    expect(r.server.called('rewards_mark_seen')).toHaveLength(1);
    expect(screen.queryByText('You got 1 streak freeze')).toBeNull();
    expect(screen.getByText('You got 3 days of Premium')).toBeTruthy();
    expect(container.querySelectorAll('.rk-inbox__item')).toHaveLength(1);
    const e = rig();
    await e.controller.refresh();
    const a = renderWith(e, <RewardInbox />);
    expect(a.container.textContent).toBe('');
    renderWith(e, <RewardInbox showEmpty />);
    expect(screen.getByText('No new rewards')).toBeTruthy();
    renderWith(r, <RewardInbox render={(list) => <i>{list.length} waiting</i>} />);
    expect(screen.getByText('1 waiting')).toBeTruthy();
  });
});

describe('RewardToastListener', () => {
  it('shows a toast for a new grant once, or calls onGrant', async () => {
    const r = await loaded(rig());
    renderWith(
      r,
      <RewardToastListener>
        <p>screen</p>
      </RewardToastListener>,
    );
    expect(screen.getByText('screen')).toBeTruthy();
    act(() => r.controller.applyGrants([plain('a')]));
    expect(screen.getByText('You got 20 coins')).toBeTruthy();
    expect(screen.getByText('You got 20 coins').closest('[aria-live="polite"]')).toBeTruthy();
    act(() => r.controller.applyGrants([plain('a')]));
    expect(screen.getAllByText('You got 20 coins')).toHaveLength(1);
    const seen: string[] = [];
    renderWith(r, <RewardToastListener onGrant={(g) => seen.push(g.id)} />);
    act(() => r.controller.applyGrants([plain('b', 5)]));
    expect(seen).toEqual(['b']);
  });

  it('a toast goes away by itself and with its close button', async () => {
    vi.useFakeTimers();
    const r = await loaded(rig());
    renderWith(r, <RewardToastListener toastMs={3000} />);
    act(() => r.controller.applyGrants([plain('a'), plain('b', 7)]));
    expect(screen.getByText('You got 7 coins')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[1]!);
    expect(screen.queryByText('You got 7 coins')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('You got 20 coins')).toBeNull();
  });

  it('holdUntilMoment holds grants until celebrateNow; turning it off releases them', async () => {
    const r = await loaded(rig());
    const seen: string[] = [];
    const ui = (hold: boolean): React.ReactElement => <RewardToastListener controller={r.controller} holdUntilMoment={hold} onGrant={(g) => seen.push(g.id)} />;
    const { rerender } = render(ui(true));
    act(() => r.controller.applyGrants([plain('a')]));
    expect(seen).toEqual([]);
    act(() => r.controller.celebrateNow());
    expect(seen).toEqual(['a']);
    act(() => r.controller.applyGrants([plain('b')]));
    expect(seen).toEqual(['a']);
    rerender(ui(false));
    expect(seen).toEqual(['a', 'b']);
  });

  it('surprises open the reveal one at a time; plain grants keep the toast', async () => {
    const r = await loaded(rig());
    renderWith(r, <RewardToastListener />);
    act(() => r.controller.applyGrants([surprise('s1', 11), surprise('s2', 12), plain('p')]));
    expect(screen.getByText('You got 20 coins')).toBeTruthy();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Surprise!' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('revealSurprises false keeps the toast; hold applies to reveals too', async () => {
    const r = await loaded(rig());
    const a = renderWith(r, <RewardToastListener revealSurprises={false} />);
    act(() => r.controller.applyGrants([surprise('s1', 11)]));
    expect(screen.getByText('You got 11 coins')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    a.unmount();
    renderWith(r, <RewardToastListener holdUntilMoment />);
    act(() => r.controller.applyGrants([surprise('s2', 12)]));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => r.controller.celebrateNow());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('RewardReveal', () => {
  it('closed → tap → shake → opened; haptic; onOpened and the event once; never a near miss', () => {
    vi.useFakeTimers();
    const haptic = vi.fn();
    const opened = vi.fn();
    const events: string[] = [];
    const { container } = render(<RewardReveal grant={surprise('g')} onHaptic={haptic} onOpened={opened} onEvent={(e) => events.push(e.name)} />);
    expect(screen.getByText('Surprise!')).toBeTruthy();
    expect(screen.getByText('Tap to open')).toBeTruthy();
    fireEvent.click(screen.getByText('Surprise!'));
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.rk-reveal--opening')).toBeTruthy();
    expect(screen.queryByText('You got 23 coins')).toBeNull();
    fireEvent.click(screen.getByText('Surprise!'));
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByText('You got 23 coins')).toBeTruthy();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['rewards_reveal_opened']);
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toMatch(/50|almost|close/i);
  });

  it('the Open button opens it too', () => {
    vi.useFakeTimers();
    render(<RewardReveal grant={surprise('g')} onHaptic={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect((screen.getByRole('button', { name: 'Open' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByText('You got 23 coins')).toBeTruthy();
  });

  it('reduced motion opens at once, with the haptic and no animation', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
    const haptic = vi.fn();
    const { container } = render(<RewardReveal grant={surprise('g')} onHaptic={haptic} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(screen.getByText('You got 23 coins')).toBeTruthy();
    expect(container.querySelector('.rk-reveal--opening')).toBeNull();
  });

  it('autoOpen opens by itself', () => {
    vi.useFakeTimers();
    render(<RewardReveal grant={surprise('g')} autoOpen onHaptic={() => {}} />);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByText('You got 23 coins')).toBeTruthy();
  });

  it('render replaces the look; open still fires once', () => {
    const opened = vi.fn();
    const events: string[] = [];
    render(
      <RewardReveal
        grant={surprise('g')}
        onHaptic={() => {}}
        onOpened={opened}
        onEvent={(e) => events.push(e.name)}
        render={(g, isOpen, open) => (
          <button type="button" onClick={open}>
            {isOpen ? `got ${g.amount}` : 'mine'}
          </button>
        )}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'mine' }));
    fireEvent.click(screen.getByRole('button', { name: 'got 23' }));
    expect(opened).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
  });

  it('texts are overridable', () => {
    vi.useFakeTimers();
    const texts = rewardsTexts({ reveal: { title: 'A gift!', open: 'Unwrap', youGot: (x) => `Yours: ${x}` } });
    render(<RewardReveal grant={surprise('g')} texts={texts} onHaptic={() => {}} />);
    expect(screen.getByText('A gift!')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unwrap' }));
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByText('Yours: 23 coins')).toBeTruthy();
  });

  it('a fixed grant (surprises off) is not a gamble: the line at once, no haptic, onOpened once', () => {
    const haptic = vi.fn();
    const opened = vi.fn();
    const g = new RewardGrant({ id: 'f', program: 'reader', kind: 'coins', amount: 27, params: { range: [5, 50], fixed: true } });
    expect(g.shouldReveal).toBe(false);
    render(<RewardReveal grant={g} onHaptic={haptic} onOpened={opened} />);
    expect(screen.getByText('You got 27 coins')).toBeTruthy();
    expect(screen.queryByText('Surprise!')).toBeNull();
    expect(haptic).not.toHaveBeenCalled();
    expect(opened).toHaveBeenCalledTimes(1);
  });
});

describe('RewardRevealDialog', () => {
  it('a modal dialog: Close, then Nice! once opened; Escape closes', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const closed = vi.fn();
    render(<RewardRevealDialog grant={surprise('g')} onClose={closed} onHaptic={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nice!' }));
    expect(closed).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(closed).toHaveBeenCalledTimes(2);
  });
});

describe('SurpriseOdds', () => {
  it('lists every odds line; filtered by program; render; nothing when none or surprises off', async () => {
    const r = await loaded(rig({ surpriseChance: 0.1 }));
    const { container } = renderWith(
      r,
      <>
        <SurpriseOdds />
        <SurpriseOdds program="other" />
        <SurpriseOdds program="reader" title="Bonus" render={(list) => <i>{list.length} rule</i>} />
      </>,
    );
    expect(screen.getByRole('heading', { name: 'Surprises' })).toBeTruthy();
    expect(screen.getByText('1 in 10 chance of 5–50 coins')).toBeTruthy();
    expect(screen.getByText('1 rule')).toBeTruthy();
    expect(container.querySelectorAll('.rk-surprise-odds')).toHaveLength(1);
    const off = rig({ surpriseChance: 0.1 });
    off.server.followups.prefs['surprises_off'] = true;
    await off.controller.refresh();
    const b = renderWith(off, <SurpriseOdds />);
    expect(b.container.textContent).toBe('');
  });

  it('RewardsHub shows one Surprises card under the inbox; showSurprises false hides it', async () => {
    const r = rig({ surpriseChance: 0.1 });
    r.server.grantPending();
    await r.controller.refresh();
    const a = renderWith(r, <RewardsHub />);
    const hub = a.container.querySelector('.rk-hub')!;
    expect(hub.querySelectorAll('.rk-surprise-odds')).toHaveLength(1);
    const kids = [...hub.children].map((c) => c.className);
    expect(kids.indexOf('rk rk-inbox')).toBeLessThan(kids.findIndex((c) => c.includes('rk-surprise-odds')));
    a.unmount();
    const b = renderWith(r, <RewardsHub showSurprises={false} />);
    expect(b.container.querySelector('.rk-surprise-odds')).toBeNull();
    await flush();
  });
});
