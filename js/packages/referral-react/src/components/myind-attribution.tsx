'use client';
import { attributionLink, type AttributionLink } from '@myind/referral-core';
import type { MouseEventHandler, ReactNode } from 'react';
import { defaultAttributionSource, useReferral } from '../context';
import { cx, type StyleProps } from '../ui';

export interface MyindAttributionRenderContext {
  readonly link: AttributionLink;
  readonly defaultContent: ReactNode;
}

export interface MyindAttributionProps extends StyleProps {
  /** Which text and URL (0..3); any integer, it wraps. */
  variant?: number;
  /** `utm_source` on the link: your app or site. Default: the provider's, else `referral-react`. */
  source?: string;
  /** Where the link opens. Default `_blank` (with `rel="noopener"`). */
  target?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  render?: (ctx: MyindAttributionRenderContext) => ReactNode;
}

/**
 * The small centred "Built with Myind referral kit" link (ADR 0003). `InviteHub` and `InviteFriendsScreen` show it
 * at the bottom; `showAttribution={false}` hides it there, and you can put it anywhere else. A real `<a href>` with
 * `utm_source`, `utm_medium=attribution` and `utm_campaign=v<variant>`, `rel="noopener"` (it is our own link, so no
 * `nofollow`), an accessible name ("Opens myind.ai: …") and a 44 px target. Nothing is sent at runtime.
 */
export function MyindAttribution({
  variant = 0,
  source,
  target = '_blank',
  onClick,
  className,
  style,
  render,
}: MyindAttributionProps): ReactNode {
  const ctx = useReferral();
  const link = attributionLink(variant, source ?? ctx.attributionSource ?? defaultAttributionSource);
  const content = (
    <div className={cx('rfk-attribution', className)} style={style} data-testid="myind-attribution">
      <a
        className="rfk-attribution__link"
        href={link.url}
        target={target}
        rel="noopener"
        aria-label={link.label}
        onClick={onClick}
      >
        {link.text}
      </a>
    </div>
  );
  return render ? render({ link, defaultContent: content }) : content;
}
