'use client';
import { type ClaimResult, type ReferralCopy, type ReferralTerms } from '@myind/referral-core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useResolvedKit, type ReferralKitOptions } from '../context';
import { useReferralTerms } from '../hooks';
import { cx, RfkButton, Spinner, type StyleProps } from '../ui';
import { ReferralDeadlineChip } from './invite-extras';
import { InviteCodeEntry } from './invite-code-entry';
import { ReferralEntryUnavailable, type ReferralUnavailableRender } from './message';

export type InviteCodeSectionPhase = 'loading' | 'open' | 'almost' | 'cannot' | 'unavailable';

export interface InviteCodeSectionRenderContext {
  readonly phase: InviteCodeSectionPhase;
  readonly terms: ReferralTerms | null;
  readonly copy: ReferralCopy;
  readonly defaultContent: ReactNode;
}

export interface InviteCodeSectionProps extends ReferralKitOptions, StyleProps {
  /** Loaded through the client when null. */
  terms?: ReferralTerms | null;
  /** A code from a link or the install referrer: shown with one-tap confirm. */
  initialCode?: string | null;
  /** See `InviteCodeEntry.eligibleFrom`; the server's `claim_days_left` wins. */
  eligibleFrom?: Date | null;
  onClaimed?: ((result: ClaimResult) => void) | null;
  /** The button under "Almost yours" (e.g. go to the reader). Hidden when null. */
  onAlmostAction?: (() => void) | null;
  /** App art above the section. */
  header?: ReactNode;
  /** App art beside the headline (e.g. a "+4" sticker). */
  leading?: ReactNode;
  /** The three steps under the field (only when the friend gets a reward). Default true. */
  showSteps?: boolean;
  renderUnavailable?: ReferralUnavailableRender | null;
  render?: (ctx: InviteCodeSectionRenderContext) => ReactNode;
}

/**
 * The friend's side of a referral, built to make the gift and its real deadline clear; every number comes from
 * `referral_terms`, so nothing is promised that the server does not give.
 *
 * - Open: the gift ("A gift is waiting for you: 4 free chapters", only when the friend rule gives something), the
 *   server's days left as a chip, the code field (`InviteCodeEntry`) and three steps.
 * - Code accepted: "Almost yours", a 1-of-2 progress bar, and the app's next step ([onAlmostAction]).
 * - Can't add a code (window over, or not eligible): no field, one line saying why.
 * - Not deployed / signed out: [renderUnavailable], or one sentence (Sign in with `onSignIn`).
 */
export function InviteCodeSection(props: InviteCodeSectionProps): ReactNode {
  const { className, style, header, leading, showSteps = true, render } = props;
  const kit = useResolvedKit(props, 'InviteCodeSection');
  const loaded = useReferralTerms({ ...props, given: props.terms ?? null });
  const [claimedWith, setClaimedWith] = useState<ReferralTerms | null>(null);
  const closedReported = useRef(false);
  const { l10n, texts } = kit;
  const title = texts?.entryTitle ?? l10n.enterCodeTitle;
  const loadedTerms = loaded.value;
  const terms = claimedWith ?? loadedTerms;
  const copy = kit.copy(terms);
  const friendReward = terms == null ? null : copy.friendReward;

  let phase: InviteCodeSectionPhase;
  if (loaded.unavailable != null) phase = 'unavailable';
  else if (loaded.loading) phase = 'loading';
  else if (claimedWith != null && friendReward != null) phase = 'almost';
  else if (terms != null && copy.cannotAddReason() != null) phase = 'cannot';
  else phase = 'open';

  const closed = phase === 'cannot' && (copy.terms.claimDaysLeft ?? 1) <= 0;
  useEffect(() => {
    if (closed && !closedReported.current) {
      closedReported.current = true;
      void kit.client.reportHidden('window_closed', { surface: 'entry' });
    }
  }, [closed, kit.client]);

  if (phase === 'unavailable') {
    const reason = loaded.unavailable!;
    if (props.renderUnavailable) return props.renderUnavailable(reason);
    return (
      <ReferralEntryUnavailable
        className={cx('rfk-root', className)}
        style={style}
        title={title}
        reason={reason}
        texts={texts ?? null}
        onSignIn={kit.onSignIn}
        l10n={l10n}
      />
    );
  }

  let body: ReactNode;
  if (phase === 'loading') {
    body = <Spinner testId="referral-section-loading" />;
  } else if (phase === 'almost') {
    const progress = texts?.almostProgress ?? l10n.almostProgress;
    body = (
      <>
        <h3 className="rfk-title" data-testid="referral-almost">
          {texts?.almostTitle ?? l10n.almostTitle}
        </h3>
        <p className="rfk-text" role="status" aria-live="polite">
          {texts?.almostLine?.(friendReward, copy.bothGetSame) ?? copy.almostLine()}
        </p>
        <div
          className="rfk-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={50}
          aria-label={progress}
        >
          <span className="rfk-progress__bar" style={{ width: '50%' }} />
        </div>
        <p className="rfk-muted rfk-small" aria-hidden="true">
          {progress}
        </p>
        {props.onAlmostAction ? (
          <div className="rfk-actions">
            <RfkButton testId="referral-almost-action" onClick={() => props.onAlmostAction?.()}>
              {texts?.almostActionLabel ?? l10n.stepStartUsing(kit.appName)}
            </RfkButton>
          </div>
        ) : null}
      </>
    );
  } else if (phase === 'cannot') {
    const why = texts?.cannotAdd?.(closed, copy.terms.claimWindowDays) ?? copy.cannotAddReason()!;
    body = (
      <>
        <h3 className="rfk-title">{title}</h3>
        <p className="rfk-muted" data-testid="referral-cannot-add">
          {why}
        </p>
      </>
    );
  } else {
    const headline = texts?.giftTitle?.(friendReward) ?? (friendReward == null ? title : copy.giftTitle());
    const days = terms?.claimDaysLeft ?? null;
    const deadline = terms == null || days == null || days <= 0 ? null : (texts?.deadline?.(days) ?? copy.deadline());
    const steps =
      texts?.steps?.(friendReward, copy.bothGetSame) ??
      copy.steps({ appName: kit.appName, activationStep: texts?.activationStep ?? null });
    body = (
      <>
        <div className="rfk-headline-row">
          {leading ? <div className="rfk-leading">{leading}</div> : null}
          <h3 className="rfk-title" data-testid="referral-gift-title">
            {headline}
          </h3>
        </div>
        {deadline != null ? (
          <div>
            <ReferralDeadlineChip text={deadline} lastDay={days === 1} />
          </div>
        ) : null}
        <InviteCodeEntry
          {...pickKit(props)}
          terms={terms}
          eligibleFrom={props.eligibleFrom ?? null}
          initialCode={props.initialCode ?? null}
          onClaimed={(r) => {
            props.onClaimed?.(r);
            if (r.isOk) setClaimedWith(terms ?? copy.terms);
          }}
          // The chip shows the days left; the entry still states a closed window.
          showWindow={deadline == null}
          showTitle={false}
          renderUnavailable={props.renderUnavailable ?? null}
        />
        {showSteps && friendReward != null ? (
          <>
            <h4 className="rfk-subtitle">{texts?.stepsTitle ?? l10n.stepsTitle}</h4>
            <ol className="rfk-steps" data-testid="referral-steps">
              {steps.map((s, i) => (
                <li key={i} className="rfk-step">
                  <span className="rfk-step__n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="rfk-text">{s}</span>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </>
    );
  }

  const content = (
    <section className={cx('rfk-root', 'rfk-section', className)} style={style} data-testid="referral-code-section">
      {header ? <div className="rfk-header">{header}</div> : null}
      {body}
    </section>
  );
  return render ? render({ phase, terms, copy, defaultContent: content }) : content;
}

/** The shared kit options of [props], to pass down to a child component. */
export function pickKit(props: ReferralKitOptions): ReferralKitOptions {
  const keys: Array<keyof ReferralKitOptions> = [
    'client',
    'queue',
    'appName',
    'locale',
    'l10nOverrides',
    'labels',
    'texts',
    'launcher',
    'share',
    'codeCache',
    'store',
    'inviteLink',
    'storeLink',
    'onEvent',
    'onSignIn',
    'clock',
    'policy',
    'attributionSource',
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (props[k] !== undefined) out[k] = props[k];
  return out as ReferralKitOptions;
}
