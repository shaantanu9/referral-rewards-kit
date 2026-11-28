'use client';
import { normaliseCode, spellCode } from '@myind/referral-core';
import type { ReactNode } from 'react';
import { cx, type StyleProps } from '../ui';

export interface InviteCodeTextRenderContext {
  /** The normalised code (`ABCDEFGH`). */
  readonly code: string;
  /** `ABCD-` and `EFGH` (or the whole value when it is not 8 characters). */
  readonly halves: readonly string[];
  /** The screen-reader label, one letter at a time: `A B C D, E F G H`. */
  readonly spoken: string;
  readonly defaultContent: ReactNode;
}

export interface InviteCodeTextProps extends StyleProps {
  code: string;
  /** Font size in px (Flutter's `fontSize`). Default 28. */
  size?: number;
  render?: (ctx: InviteCodeTextRenderContext) => ReactNode;
}

/**
 * A code shown as `ABCD-EFGH` in large monospace (ADR 4.1, 11.5): always left to right, read out one letter at a
 * time, and wrapped onto two lines on narrow screens or large text instead of being shrunk.
 */
export function InviteCodeText({ code, size = 28, className, style, render }: InviteCodeTextProps): ReactNode {
  const c = normaliseCode(code);
  const halves = c.length === 8 ? [`${c.substring(0, 4)}-`, c.substring(4)] : [c];
  const spoken = spellCode(c);
  const content = (
    <span
      className={cx('rfk-code', className)}
      style={{ fontSize: `${size}px`, ...style }}
      dir="ltr"
      role="img"
      aria-label={spoken}
      data-testid="referral-code"
    >
      {halves.map((h) => (
        <span key={h} className="rfk-code__half" aria-hidden="true" data-testid={`referral-code-${h}`}>
          {h}
        </span>
      ))}
    </span>
  );
  return render ? render({ code: c, halves, spoken, defaultContent: content }) : content;
}
