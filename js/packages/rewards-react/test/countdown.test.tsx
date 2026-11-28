// Port of widgets_test.dart "Countdown" and fair_play_widgets_test.dart "Countdown(hidden)".
import { ServerClock } from '@myind/rewards-core';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { coarseLeft, Countdown } from '../src';

let now = new Date('2026-11-27T10:00:00Z');
const clock = new ServerClock({ local: () => now });
const tick = (ms: number): void => {
  act(() => {
    now = new Date(now.getTime() + ms);
    vi.advanceTimersByTime(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  now = new Date('2026-11-27T10:00:00Z');
});
afterEach(() => {
  vi.useRealTimers();
});

it('ticks every second and fires onExpired once', async () => {
  const expired = vi.fn();
  render(<Countdown endsAt={new Date(now.getTime() + 3000)} clock={clock} prefix="Ends in" onExpired={expired} />);
  expect(screen.getByRole('timer').textContent).toBe('Ends in 3s');
  tick(1000);
  expect(screen.getByRole('timer').textContent).toBe('Ends in 2s');
  tick(2000);
  expect(screen.getByRole('timer').textContent).toBe('Ends in 0s');
  await act(async () => {
    await Promise.resolve();
  });
  expect(expired).toHaveBeenCalledTimes(1);
  tick(5000);
  await act(async () => {
    await Promise.resolve();
  });
  expect(expired).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('timer').textContent).toBe('Ends in 0s');
});

it('uses the server clock, never negative', () => {
  const skewed = new ServerClock({ local: () => now });
  skewed.sync(new Date(now.getTime() + 60_000)); // the server is one minute ahead
  render(<Countdown endsAt={new Date(now.getTime() + 90_000)} clock={skewed} />);
  expect(screen.getByRole('timer').textContent).toBe('30s');
  render(<Countdown endsAt={new Date(now.getTime() - 5000)} clock={clock} className="past" />);
  expect(screen.getAllByRole('timer')[1]!.textContent).toBe('0s');
});

it('no deadline: nothing shown; render gets the time left', () => {
  const { container } = render(<Countdown endsAt={null} clock={clock} prefix="x" />);
  expect(container.textContent).toBe('');
  render(<Countdown endsAt={new Date(now.getTime() + 65_000)} clock={clock} render={(left) => <b data-testid="own">{left}</b>} />);
  expect(screen.getByTestId('own').textContent).toBe('65000');
});

it('hidden shows nothing and still fires onExpired', async () => {
  const expired = vi.fn();
  const { container } = render(<Countdown endsAt={new Date(now.getTime() + 2000)} clock={clock} hidden onExpired={expired} />);
  expect(container.textContent).toBe('');
  tick(2000);
  await act(async () => {
    await Promise.resolve();
  });
  expect(expired).toHaveBeenCalledTimes(1);
});

it('screen readers hear it rounded to the minute, politely; the visible timer is not live', () => {
  const { container } = render(<Countdown endsAt={new Date(now.getTime() + 125_000)} clock={clock} prefix="Ends in" />);
  expect(screen.getByRole('timer').getAttribute('aria-live')).toBe('off');
  const polite = container.querySelector('[aria-live="polite"]')!;
  expect(polite.textContent).toBe('Ends in 3m 00s');
  tick(1000);
  expect(polite.textContent).toBe('Ends in 3m 00s');
  tick(5000);
  expect(polite.textContent).toBe('Ends in 2m 00s');
  expect(coarseLeft(0)).toBe('0s');
  expect(coarseLeft(1)).toBe('1m 00s');
});
