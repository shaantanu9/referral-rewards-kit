'use client';
import { MyClaimState, type MyClaim } from '@myind/referral-core';
import type { ReactNode } from 'react';
import { useResolvedKit, type ReferralKitOptions } from '../context';
import { useWelcomeCard } from '../hooks';
import { cx, icons, RfkButton, type StyleProps } from '../ui';

export interface ReferralWelcomeCardRenderContext {
  readonly claim: MyClaim;
  readonly text: string;
  readonly close: (action: 'dismiss' | 'invite') => Promise<void>;
  readonly defaultContent: ReactNode;
}

export interface ReferralWelcomeCardProps extends ReferralKitOptions, StyleProps {
  /** The app's words for the first real use, e.g. "Read your first page". */
  activationStep?: string | null;
  /** Opens the invite hub from the pass-it-on card. Without it the card has only "Got it". */
  onPassItOn?: (() => void) | null;
  /** Shown before the sentence; a gift or heart icon by default. */
  leading?: ReactNode;
  /** Identifies this page load (default: one id per page load, `welcomeCardSession`). */
  session?: string;
  render?: (ctx: ReferralWelcomeCardRenderContext) => ReactNode;
}

/**
 * The friend's in-app card (G2, G3), from `referral_my_claim`:
 *
 * - **claimed**: "Your welcome gift of 4 free chapters is waiting: Read your first page. 12 days left." (the server's
 *   days).
 * - **joined**: once, "Pass it on: give a friend 4 free chapters …" with "Invite a friend" ([onPassItOn]). With a
 *   prompt policy it shows only when `shouldPromptFor(welcomeRewardReceived)` allows it.
 * - none / expired, an older server or offline: nothing.
 *
 * Each state shows in at most one visit per day and "Got it" hides it, remembered in the store. In-app only.
 */
export function ReferralWelcomeCard(props: ReferralWelcomeCardProps): ReactNode {
  const { className, style, leading, onPassItOn, render } = props;
  const kit = useResolvedKit(props, 'ReferralWelcomeCard');
  const { claim, terms, close } = useWelcomeCard(props);
  if (claim == null) return null;
  const copy = kit.copy(terms);
  const joined = claim.state === MyClaimState.joined;
  const text = joined
    ? copy.passItOn({ appName: kit.appName })
    : copy.welcomeWaiting(claim, { appName: kit.appName, activationStep: props.activationStep ?? null });
  const content = (
    <article className={cx('rfk-root', 'rfk-card', className)} style={style} data-testid={`referral-welcome-${claim.state}`}>
      <div className="rfk-card__row">
        <div className="rfk-leading" aria-hidden={leading ? undefined : true}>
          {leading ?? (joined ? icons.heart : icons.gift)}
        </div>
        <p className="rfk-text" role="status" aria-live="polite">
          {text}
        </p>
      </div>
      <div className="rfk-actions rfk-actions--end">
        <RfkButton variant="text" testId="referral-welcome-dismiss" onClick={() => void close('dismiss')}>
          {kit.l10n.dismiss}
        </RfkButton>
        {joined && onPassItOn ? (
          <RfkButton
            testId="referral-welcome-invite"
            onClick={() => {
              void close('invite');
              onPassItOn();
            }}
          >
            {kit.l10n.inviteAFriend}
          </RfkButton>
        ) : null}
      </div>
    </article>
  );
  return render ? render({ claim, text, close, defaultContent: content }) : content;
}
