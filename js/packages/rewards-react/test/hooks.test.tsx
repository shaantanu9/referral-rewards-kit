// The provider, hooks and RewardsListener (port of base.dart): one load on mount however many components listen,
// a hidden fallback, a clear error without a controller, and StrictMode-safe quiz controllers.
import { render, renderHook, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { expect, it, vi } from 'vitest';
import { QuizScreen, RewardsListener, RewardsProvider, StreakCard, useRewards, useRewardsState } from '../src';
import { flush, renderWith, rig } from './helpers';

it('loads the state once on mount, however many components listen; hidden shows the fallback', async () => {
  const r = rig();
  r.server.enabled = false;
  renderWith(
    r,
    <>
      <StreakCard />
      <RewardsListener render={() => <p>shown</p>} hidden={(s) => <p>{s.loaded ? 'switched off' : 'loading'}</p>} />
    </>,
  );
  expect(screen.getByText('loading')).toBeTruthy();
  await flush();
  expect(r.server.called('rewards_state')).toHaveLength(1);
  expect(screen.getByText('switched off')).toBeTruthy();
  r.server.enabled = true;
  await r.controller.refresh();
  await flush();
  expect(screen.getByText('shown')).toBeTruthy();
});

it('a loaded controller is not loaded again', async () => {
  const r = rig();
  await r.controller.refresh();
  renderWith(r, <StreakCard />);
  await flush();
  expect(r.server.called('rewards_state')).toHaveLength(1);
});

it('hooks read the snapshot; the props win over the provider; a clear error without a controller', async () => {
  const r = rig();
  await r.controller.refresh();
  const { result } = renderHook(() => useRewardsState(), { wrapper: ({ children }) => <RewardsProvider controller={r.controller}>{children}</RewardsProvider> });
  expect(result.current.streak('daily')!.current).toBe(2);
  const other = rig();
  const own = renderHook(() => useRewards(other.controller), { wrapper: ({ children }) => <RewardsProvider controller={r.controller}>{children}</RewardsProvider> });
  expect(own.result.current.loaded).toBe(false);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => render(<StreakCard />)).toThrow(/pass `controller` or wrap/);
});

it('StrictMode: the quiz screen still opens and runs after the double mount', async () => {
  const r = rig();
  await r.controller.refresh();
  render(
    <StrictMode>
      <RewardsProvider controller={r.controller}>
        <QuizScreen program="quiz" />
      </RewardsProvider>
    </StrictMode>,
  );
  await flush(10);
  screen.getByRole('button', { name: 'Start' }).click();
  await flush(10);
  expect(screen.getByText('Question 1 of 4')).toBeTruthy();
});
