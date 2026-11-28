'use client';
import {
  ReferralUnavailableReason,
  type ReferralKitLocalizations,
  type ReferralTexts,
} from '@myind/referral-core';
import type { ReactNode } from 'react';
import { useReferral } from '../context';
import { cx, RfkButton, type StyleProps } from '../ui';

/**
 * What a component shows when referrals are unavailable (not deployed, signed out, no project): return `null` to hide
 * the feature, or your own explanation. Flutter's `ReferralUnavailableBuilder`.
 */
export type ReferralUnavailableRender = (reason: ReferralUnavailableReason) => ReactNode;

/** The sentence for [reason]: the app's [texts] first, then the kit's localisation. */
export function unavailableMessage(
  l10n: ReferralKitLocalizations,
  reason: ReferralUnavailableReason,
  opts: { texts?: ReferralTexts | null; codeKept?: boolean } = {},
): string {
  const custom = opts.texts?.unavailable?.(reason);
  if (custom != null) return custom;
  switch (reason) {
    case ReferralUnavailableReason.signedOut:
      return l10n.signInToInvite;
    case ReferralUnavailableReason.noProject:
      return l10n.notInThisVersion;
    default:
      return opts.codeKept ? l10n.notAvailableCodeKept : l10n.notAvailable;
  }
}

export interface ReferralMessageProps extends StyleProps {
  text: string;
  /** The button's label; shown only with [onAction]. */
  action?: string | null;
  onAction?: (() => void) | null;
  /** Kept for parity with Flutter (`embedded`: no scroll view of its own); on the web both lay out the same. */
  embedded?: boolean;
  testId?: string;
}

/** A sentence (announced politely) with an optional button. */
export function ReferralMessage({ text, action, onAction, className, style, testId }: ReferralMessageProps): ReactNode {
  return (
    <div className={cx('rfk-root', 'rfk-message', className)} style={style} data-testid={testId}>
      <p role="status" aria-live="polite" className="rfk-text">
        {text}
      </p>
      {action && onAction ? (
        <div className="rfk-actions">
          <RfkButton variant="outlined" onClick={() => onAction()}>
            {action}
          </RfkButton>
        </div>
      ) : null}
    </div>
  );
}

export interface ReferralUnavailableMessageProps extends StyleProps {
  reason: ReferralUnavailableReason;
  texts?: ReferralTexts | null;
  onSignIn?: (() => void) | null;
  codeKept?: boolean;
}

/** The unavailable state for [reason], with Sign in when signed out and [onSignIn] is given (Flutter's factory). */
export function ReferralUnavailableMessage({ reason, texts, onSignIn, codeKept, className, style }: ReferralUnavailableMessageProps): ReactNode {
  const { l10n, texts: ctxTexts, onSignIn: ctxSignIn } = useReferral();
  const t = texts ?? ctxTexts;
  const signIn = reason === ReferralUnavailableReason.signedOut ? (onSignIn ?? ctxSignIn) : null;
  return (
    <ReferralMessage
      testId="referral-not-available"
      text={unavailableMessage(l10n, reason, { texts: t, codeKept: codeKept ?? false })}
      action={signIn ? (t?.signIn ?? l10n.signIn) : null}
      onAction={signIn}
      className={className}
      style={style}
    />
  );
}

export interface ReferralEntryUnavailableProps extends StyleProps {
  /** The entry's title; nothing when null. */
  title?: string | null;
  reason: ReferralUnavailableReason;
  texts?: ReferralTexts | null;
  onSignIn?: (() => void) | null;
  codeKept?: boolean;
  l10n: ReferralKitLocalizations;
}

/** The unavailable state of a code entry: its title and one sentence (Sign in when signed out and [onSignIn] given). */
export function ReferralEntryUnavailable({
  title,
  reason,
  texts,
  onSignIn,
  codeKept,
  l10n,
  className,
  style,
}: ReferralEntryUnavailableProps): ReactNode {
  const signIn = reason === ReferralUnavailableReason.signedOut ? onSignIn : null;
  return (
    <div className={cx('rfk-entry-unavailable', className)} style={style}>
      {title ? <h3 className="rfk-title">{title}</h3> : null}
      <p role="status" aria-live="polite" className="rfk-text" data-testid="referral-not-available">
        {unavailableMessage(l10n, reason, { texts: texts ?? null, codeKept: codeKept ?? false })}
      </p>
      {signIn ? (
        <div className="rfk-actions">
          <RfkButton variant="outlined" onClick={() => signIn()}>
            {texts?.signIn ?? l10n.signIn}
          </RfkButton>
        </div>
      ) : null}
    </div>
  );
}
