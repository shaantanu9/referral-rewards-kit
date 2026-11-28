'use client';
/** Small shared pieces: class names, the card, props every component takes, reduced motion. */
import type { RewardsController, RewardsTexts } from '@myind/rewards-core';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

/** Props every component takes. */
export interface BaseProps {
  /** The controller; default the nearest `RewardsProvider`'s. */
  readonly controller?: RewardsController;
  /** Every string; default the provider's, else English. */
  readonly texts?: RewardsTexts;
  /** Added to the root element's class (`rk-…` classes stay). */
  readonly className?: string;
  /** Merged into the root element's style. Set `--rk-*` variables here to theme one component. */
  readonly style?: CSSProperties;
}

/** Joins class names, skipping empty ones. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

/** The card every default look sits in (`--rk-surface`, `--rk-radius`, `--rk-padding`). */
export function Card(props: {
  readonly name: string;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
  readonly children?: ReactNode;
  readonly as?: 'section' | 'div';
  readonly label?: string | undefined;
}): ReactNode {
  const Tag = props.as ?? 'section';
  return (
    <Tag className={cx('rk', 'rk-card', props.name, props.className)} style={props.style} aria-label={props.label}>
      {props.children}
    </Tag>
  );
}

/** True when the user asked the system for less motion (`prefers-reduced-motion: reduce`). False on the server. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** Reads [own] or the program's `public.<key>` as a trimmed string. */
export function publicString(v: unknown): string | null {
  return v == null ? null : String(v);
}

/** A progress bar (`role="progressbar"`, 0..1). */
export function ProgressBar(props: { readonly value: number; readonly label?: string; readonly tone?: 'accent' | 'warning' | 'success'; readonly className?: string }): ReactNode {
  const v = Math.max(0, Math.min(1, Number.isFinite(props.value) ? props.value : 0));
  return (
    <div
      className={cx('rk-bar', props.tone && props.tone !== 'accent' && `rk-bar--${props.tone}`, props.className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-label={props.label}
    >
      <div className="rk-bar__fill" style={{ width: `${v * 100}%` }} />
    </div>
  );
}
