'use client';
import type { RewardItem } from '@myind/referral-core';
import type { ReactNode } from 'react';
import { useResolvedKit, type ReferralKitOptions } from '../context';
import { usePendingRewards } from '../hooks';
import { cx, RfkButton, type StyleProps } from '../ui';

export interface ReferralRewardCardRenderContext {
  readonly items: readonly RewardItem[];
  /** The sentence for a reward ("A friend you invited started using the app. You got 4 chapters."). */
  readonly textOf: (r: RewardItem) => string;
  readonly dismiss: (r: RewardItem) => Promise<void>;
  readonly defaultContent: ReactNode;
}

export interface ReferralRewardCardProps extends ReferralKitOptions, StyleProps {
  /** Shown before the sentence (an icon or small picture). */
  leading?: ReactNode;
  /** A second button next to Dismiss (e.g. "Read now"). Tapping it also dismisses the card. */
  actionLabel?: string | null;
  onAction?: ((reward: RewardItem) => void) | null;
  /** Called once per reward when its card appears (the reward is already granted on the server by then). */
  onShown?: ((reward: RewardItem) => void) | null;
  /** Called after a card is dismissed and acked; `acknowledged` false when the ack failed (it comes back next time). */
  onDismissed?: ((reward: RewardItem, acknowledged: boolean) => void) | null;
  render?: (ctx: ReferralRewardCardRenderContext) => ReactNode;
}

/**
 * In-app cards for rewards that landed (ADR 4.1 step 3, 4.2 step 5): reads `referral_pending` and calls
 * `referral_ack` when the user dismisses one, so each device shows each card once. Shows nothing when there is
 * nothing new or the call fails. Asks again when the page comes back into view and when given another client.
 */
export function ReferralRewardCard(props: ReferralRewardCardProps): ReactNode {
  const { className, style, leading, actionLabel, onAction, render } = props;
  const { l10n, copy } = useResolvedKit(props, 'ReferralRewardCard');
  const { items, dismiss } = usePendingRewards(props);
  const c = copy(null);
  if (items.length === 0 && !render) return null;
  const content =
    items.length === 0 ? null : (
      <div className={cx('rfk-root', 'rfk-cards', className)} style={style}>
        {items.map((r) => (
          <article key={r.id} className="rfk-card" data-testid={`referral-reward-${r.id}`}>
            <div className="rfk-card__row">
              {leading ? <div className="rfk-leading">{leading}</div> : null}
              <p className="rfk-text" role="status" aria-live="polite">
                {c.rewardCard(r)}
              </p>
            </div>
            <div className="rfk-actions rfk-actions--end">
              <RfkButton variant="text" testId={`referral-reward-dismiss-${r.id}`} onClick={() => void dismiss(r)}>
                {l10n.dismiss}
              </RfkButton>
              {actionLabel && onAction ? (
                <RfkButton
                  testId={`referral-reward-action-${r.id}`}
                  onClick={() => {
                    void dismiss(r);
                    onAction(r);
                  }}
                >
                  {actionLabel}
                </RfkButton>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    );
  return render ? render({ items, textOf: (r) => c.rewardCard(r), dismiss, defaultContent: content }) : content;
}
