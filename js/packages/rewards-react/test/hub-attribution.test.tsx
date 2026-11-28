// Ports of widgets_test.dart / widgets_v2_test.dart (RewardsHub) and attribution_test.dart (MyindAttribution on the
// hub and the quiz screen), plus the web rules: a real link, 44 px, never shown twice.
import { RewardsClient, RewardsController, ServerClock } from '@myind/rewards-core';
import { FakeRewardsServer } from '@myind/rewards-core/testing';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MyindAttribution, QuizScreen, RewardsHub, RewardsProvider } from '../src';
import { flush, loaded, renderWith, rig, start } from './helpers';

const links = (): HTMLAnchorElement[] => [...document.querySelectorAll<HTMLAnchorElement>('[data-testid="myind-attribution"] a')];

describe('RewardsHub', () => {
  it('one component per live program in the server order; titles from public.title', async () => {
    const r = await loaded(rig());
    const { container } = renderWith(r, <RewardsHub />);
    await flush();
    const keys = [...container.querySelectorAll('.rk-hub__program')].map((e) => e.getAttribute('data-program'));
    expect(keys).toEqual(['daily', 'reader', 'welcome', 'ig', 'quiz', 'daily_quests', 'hearts', 'happy', 'buddies', 'weekly']);
    expect(screen.getByText('2-day streak')).toBeTruthy();
    for (const t of ['Read 5 chapters', 'Welcome gift', 'Tag @myapp on Instagram', 'Daily quiz', 'Today', 'Friend streaks', 'Weekly league']) {
      expect(screen.getByRole('heading', { name: t })).toBeTruthy();
    }
    expect(screen.getByText(/^Happy hour: ends in/)).toBeTruthy();
    expect(screen.getByRole('img', { name: '2 of 3' })).toBeTruthy();
  });

  it('programRenderers replace one program; a comeback shows nothing; header on top', async () => {
    const server = new FakeRewardsServer({ clock: () => start, surpriseChance: 0 });
    const client = new RewardsClient({
      timezone: () => 'UTC',
      rpc: async (fn, p) => {
        const x = (await server.call(fn, p)) as Record<string, unknown>;
        if (fn === 'rewards_state') (x['programs'] as unknown[]).push({ key: 'back', kind: 'comeback' });
        return x;
      },
    });
    const controller = new RewardsController({ client, clock: new ServerClock({ local: () => start }) });
    await controller.refresh();
    const { container } = render(
      <RewardsProvider controller={controller}>
        <RewardsHub header={<p>top</p>} programRenderers={{ daily: (p) => <i>own {p.key}</i>, hearts: () => null }} spacing={20} />
      </RewardsProvider>,
    );
    await flush();
    expect(screen.getByText('own daily')).toBeTruthy();
    expect(screen.queryByText('2-day streak')).toBeNull();
    expect(container.querySelector('[data-program="back"]')!.textContent).toBe('');
    expect(container.querySelector('[data-program="hearts"]')!.textContent).toBe('');
    expect((container.querySelector('.rk-hub') as HTMLElement).style.gap).toBe('20px');
    expect(container.querySelector('.rk-hub')!.firstElementChild!.textContent).toBe('top');
  });

  it('shows "Rewards by Myind" at the bottom by default: a real link, new tab, noopener, labelled, UTM-tagged', async () => {
    const r = await loaded(rig());
    const { container } = renderWith(r, <RewardsHub />);
    await flush();
    const all = links();
    expect(all).toHaveLength(1);
    const a = all[0]!;
    expect(a.textContent).toBe('Rewards by Myind');
    expect(a.getAttribute('href')).toBe('https://www.myind.ai/referral-kit?utm_source=rewards-react&utm_medium=attribution&utm_campaign=v1');
    expect(a.getAttribute('rel')).toBe('noopener');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('aria-label')).toBe('Opens myind.ai: Rewards by Myind');
    expect(a.className).toBe('rk-attribution__link');
    expect(container.querySelector('.rk-hub')!.lastElementChild!.getAttribute('data-testid')).toBe('myind-attribution');
  });

  it('showAttribution false hides it; attributionVariant picks the text', async () => {
    const r = await loaded(rig());
    const a = renderWith(r, <RewardsHub showAttribution={false} />);
    await flush();
    expect(links()).toHaveLength(0);
    a.unmount();
    renderWith(r, <RewardsHub attributionVariant={2} />);
    await flush();
    expect(links()[0]!.textContent).toBe('Free referral kit by Myind');
    expect(links()[0]!.getAttribute('href')).toContain('/referral-kit/showcase?');
  });

  it('never doubled: the quiz opened from the hub adds no second link', async () => {
    const r = await loaded(rig());
    renderWith(r, <RewardsHub />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await flush();
    expect(screen.getByRole('dialog', { name: 'Daily quiz' })).toBeTruthy();
    expect(links()).toHaveLength(1);
  });
});

describe('QuizScreen attribution', () => {
  it('shows it under the quiz by default, also while loading and unavailable; false hides it', async () => {
    const r = await loaded(rig());
    const a = renderWith(r, <QuizScreen program="quiz" />);
    expect(links()).toHaveLength(1);
    await flush();
    expect(links()[0]!.textContent).toBe('Rewards by Myind');
    a.unmount();
    r.server.deployed = false;
    const b = renderWith(r, <QuizScreen program="quiz" />);
    await flush();
    expect(screen.getByText('The quiz is not available right now.')).toBeTruthy();
    expect(links()).toHaveLength(1);
    b.unmount();
    renderWith(r, <QuizScreen program="quiz" showAttribution={false} />);
    expect(links()).toHaveLength(0);
  });
});

describe('MyindAttribution', () => {
  it('variants wrap, the source is the utm_source, onOpen hears the tap', () => {
    const opened = vi.fn();
    render(<MyindAttribution variant={5} source="com.acme.reader" onOpen={opened} className="mine" />);
    const a = links()[0]!;
    expect(a.textContent).toBe('Rewards by Myind');
    expect(a.getAttribute('href')).toBe('https://www.myind.ai/referral-kit?utm_source=com.acme.reader&utm_medium=attribution&utm_campaign=v1');
    a.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(a);
    expect(opened).toHaveBeenCalledWith(a.getAttribute('href'));
    render(<MyindAttribution />);
    expect(links()[1]!.textContent).toBe('Built with Myind referral kit');
  });
});
