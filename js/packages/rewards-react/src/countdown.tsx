'use client';
import { formatLeft, type ServerClock } from '@myind/rewards-core';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from './internal';

/**
 * Milliseconds left until [endsAt] on the server-corrected [clock], re-rendering every second (not while [hidden]).
 * Calls [onExpired] once when it reaches zero, also while hidden. Null without a deadline.
 */
export function useCountdown(
  endsAt: Date | null | undefined,
  clock: ServerClock,
  opts: { onExpired?: (() => void) | null | undefined; hidden?: boolean } = {},
): number | null {
  const [, setTick] = useState(0);
  const expired = useRef(opts.onExpired);
  expired.current = opts.onExpired;
  const hidden = opts.hidden ?? false;
  const end = endsAt?.getTime() ?? null;
  useEffect(() => {
    if (end == null) return undefined;
    let fired = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const check = (): void => {
      if (fired || clock.leftMs(new Date(end)) !== 0) return;
      fired = true;
      if (timer) clearInterval(timer);
      timer = null;
      const cb = expired.current;
      if (cb) queueMicrotask(cb);
    };
    timer = setInterval(() => {
      if (!hidden) setTick((t) => t + 1);
      check();
    }, 1000);
    check();
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [end, clock, hidden]);
  return end == null ? null : clock.leftMs(new Date(end));
}

/** The text a screen reader hears: rounded up to whole minutes, so a polite live region speaks once a minute at most. */
export function coarseLeft(ms: number): string {
  if (ms <= 0) return formatLeft(0);
  return formatLeft(Math.ceil(ms / 60000) * 60000);
}

export interface CountdownProps {
  readonly endsAt: Date | null | undefined;
  readonly clock: ServerClock;
  readonly onExpired?: (() => void) | null;
  /** Your own look: gets the time left in ms (zero at the end). */
  readonly render?: (leftMs: number) => ReactNode;
  /** Text before the time, e.g. "Ends in". */
  readonly prefix?: string | null;
  /** Show nothing (0.7 `timers_off`); [onExpired] still fires. */
  readonly hidden?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * A live countdown to a server deadline (ADR 0002 §8): ticks every second on the server clock, never negative,
 * [onExpired] once at zero. No [endsAt]: nothing. The visible text is a `timer` (not announced on every tick); a
 * visually hidden polite live region repeats it rounded to the minute.
 */
export function Countdown(props: CountdownProps): ReactNode {
  const hidden = props.hidden ?? false;
  const left = useCountdown(props.endsAt, props.clock, { onExpired: props.onExpired, hidden });
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (left == null || hidden) return null;
  if (props.render) return <>{props.render(left)}</>;
  const p = props.prefix;
  const text = p ? `${p} ${formatLeft(left)}` : formatLeft(left);
  return (
    <span className={cx('rk-countdown', props.className)} style={props.style}>
      <span role="timer" aria-live="off" suppressHydrationWarning>
        {text}
      </span>
      {mounted ? (
        <span className="rk-sr-only" aria-live="polite">
          {p ? `${p} ${coarseLeft(left)}` : coarseLeft(left)}
        </span>
      ) : null}
    </span>
  );
}
