'use client';
import { attributionLink } from '@myind/rewards-core';
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import { cx } from './internal';

/** `utm_source` this package puts on the link. */
export const defaultAttributionSource = 'rewards-react';

/**
 * True below a top-level screen (`RewardsHub`, `QuizScreen`) that already shows the link, so a screen inside another
 * one (the quiz dialog opened from the hub) never shows it twice.
 */
export const AttributionShownContext = createContext(false);

export interface MyindAttributionProps {
  /** Which text and URL (`MYIND_ATTRIBUTION.variants`); any integer, it wraps. Default 0. */
  readonly variant?: number;
  /** `utm_source` on the link. Default `rewards-react`. */
  readonly source?: string;
  /** Called when the link is opened (before the browser follows it). */
  readonly onOpen?: (url: string) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * A small centred "Rewards by Myind" link (ADR 0003): a real `<a>` that opens the site in a new tab with
 * `utm_source`, `utm_medium=attribution` and `utm_campaign=v<variant>`. Nothing is sent at runtime. At least 44 px
 * tall and wide. `RewardsHub` and `QuizScreen` show it at the bottom; `showAttribution={false}` hides it there.
 */
export function MyindAttribution(props: MyindAttributionProps): ReactNode {
  const link = attributionLink(props.variant ?? 0, props.source ?? defaultAttributionSource);
  return (
    <div className={cx('rk', 'rk-attribution', props.className)} style={props.style} data-testid="myind-attribution">
      <a
        className="rk-attribution__link"
        href={link.url}
        target="_blank"
        rel="noopener"
        aria-label={link.label}
        onClick={() => props.onOpen?.(link.url)}
      >
        {link.text}
      </a>
    </div>
  );
}

/** The link once per screen: nothing when [show] is false or an outer screen already shows it. */
export function ScreenAttribution(props: { readonly show: boolean; readonly variant: number }): ReactNode {
  const shown = useContext(AttributionShownContext);
  if (!props.show || shown) return null;
  return <MyindAttribution variant={props.variant} />;
}
