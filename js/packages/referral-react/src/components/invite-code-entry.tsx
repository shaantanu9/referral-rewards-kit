'use client';
import {
  formatCode,
  type ClaimResult,
  type ReferralCopy,
  type ReferralKitLocalizations,
  type ReferralTerms,
} from '@myind/referral-core';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useResolvedKit, type ReferralKitOptions } from '../context';
import type { CodeEntryController, CodeEntryMessage, CodeEntryState } from '../controllers/code-entry';
import { useCodeEntry } from '../hooks';
import { cx, icons, RfkButton, type StyleProps } from '../ui';
import { InviteCodeText } from './code-text';
import { ReferralEntryUnavailable, type ReferralUnavailableRender } from './message';

/** The words for a code entry message in the current language. */
export function codeEntryMessageText(m: CodeEntryMessage, l10n: ReferralKitLocalizations, copy: ReferralCopy): string {
  switch (m.kind) {
    case 'claimOk':
      return l10n.claimOk;
    case 'offlineQueued':
      return l10n.offlineQueued;
    case 'notVerified':
      return l10n.errNotVerified;
    case 'notAvailableCodeKept':
      return l10n.notAvailableCodeKept;
    case 'claim':
      return copy.claimMessage(m.result) ?? l10n.claimOk;
  }
}

export interface InviteCodePasteButtonProps extends StyleProps {
  onPasted: (text: string) => void;
  label?: string;
  /** Show the button even where the page cannot read the clipboard (it then does nothing). Default false. */
  alwaysShow?: boolean;
}

/**
 * Paste from the clipboard (`navigator.clipboard.readText`, which asks the user in some browsers). Hidden where the
 * page cannot read the clipboard; pasting into the field (Ctrl/Cmd+V, long-press) always works and is handled the
 * same way.
 */
export function InviteCodePasteButton({ onPasted, label, alwaysShow = false, className, style }: InviteCodePasteButtonProps): ReactNode {
  const [can, setCan] = useState(false);
  useEffect(() => {
    const c = (globalThis as { navigator?: Navigator }).navigator?.clipboard;
    setCan(typeof c?.readText === 'function');
  }, []);
  if (!can && !alwaysShow) return null;
  return (
    <RfkButton
      variant="text"
      icon={icons.paste}
      className={className}
      style={style}
      testId="referral-paste"
      onClick={async () => {
        try {
          const text = await (globalThis as { navigator?: Navigator }).navigator?.clipboard?.readText();
          if (text) onPasted(text);
        } catch {
          // Permission refused or nothing to read.
        }
      }}
    >
      {label ?? 'Paste'}
    </RfkButton>
  );
}

export interface InviteCodeEntryRenderContext {
  readonly state: CodeEntryState;
  readonly controller: CodeEntryController;
  readonly daysLeft: number | null;
  readonly copy: ReferralCopy;
  readonly defaultContent: ReactNode;
}

export interface InviteCodeEntryProps extends ReferralKitOptions, StyleProps {
  /** Loaded through the client when null. */
  terms?: ReferralTerms | null;
  /** When the account became verified, for the countdown; the server's `claim_days_left` wins. */
  eligibleFrom?: Date | null;
  /** A code from a link or the install referrer: shown with one-tap confirm (reports `invite_link_opened`). */
  initialCode?: string | null;
  onClaimed?: ((result: ClaimResult) => void) | null;
  /** The "You can add an invite code for N more days" line. False when the count is shown elsewhere. Default true. */
  showWindow?: boolean;
  /** Shown instead of the entry when referrals are unavailable; return null to hide it. */
  renderUnavailable?: ReferralUnavailableRender | null;
  /** Replaces "Have an invite code?" (wins over `texts.entryTitle`). */
  title?: string;
  /** False when a headline sits above the entry (as in `InviteCodeSection`). Default true. */
  showTitle?: boolean;
  render?: (ctx: InviteCodeEntryRenderContext) => ReactNode;
}

/**
 * Invite-code entry (ADR 4.2 step 3, 11.2, 11.6): a field with Paste, the claim-window countdown, the disclosure
 * before confirming, a message per claim reason, and one-tap confirm for a prefilled code. Pasting a whole invite link
 * or share message finds the code in it. Claims go through the queue, so an offline or `not_verified` claim is kept
 * and retried.
 */
export function InviteCodeEntry(props: InviteCodeEntryProps): ReactNode {
  const { className, style, showWindow = true, showTitle = true, render } = props;
  const kit = useResolvedKit(props, 'InviteCodeEntry');
  const entry = useCodeEntry(props);
  const fieldId = useId();
  const { l10n, texts, onSignIn } = kit;
  const state = entry;
  const title = props.title ?? texts?.entryTitle ?? l10n.enterCodeTitle;

  if (state.unavailable != null) {
    if (props.renderUnavailable) return props.renderUnavailable(state.unavailable);
    return (
      <ReferralEntryUnavailable
        className={cx('rfk-root', className)}
        style={style}
        title={showTitle ? title : null}
        reason={state.unavailable}
        texts={texts ?? null}
        onSignIn={onSignIn}
        codeKept={state.codeKept}
        l10n={l10n}
      />
    );
  }

  const copy = kit.copy(state.terms);
  const terms = copy.terms;
  const daysLeft = entry.daysLeft;
  const closed = daysLeft === 0;
  // Before terms load, name both events: never say less than the server may do.
  const disclosure = state.terms == null ? l10n.friendDisclosureBoth : copy.friendDisclosure();
  const c = entry.controller;
  const message = state.message ? codeEntryMessageText(state.message, l10n, copy) : '';

  const content = (
    <div className={cx('rfk-root', 'rfk-entry', className)} style={style} data-testid="referral-entry">
      {showTitle ? <h3 className="rfk-title">{title}</h3> : null}
      {daysLeft != null && (closed || showWindow) ? (
        <p className="rfk-text" data-testid="referral-window">
          {closed ? l10n.windowOver(terms.claimWindowDays) : l10n.windowCountdown(daysLeft)}
        </p>
      ) : null}
      {!closed && !state.done ? (
        state.prefilled != null ? (
          <div className="rfk-stack">
            <InviteCodeText code={state.prefilled} />
            {disclosure ? (
              <p className="rfk-text" data-testid="referral-disclosure">
                {disclosure}
              </p>
            ) : null}
            <div className="rfk-actions">
              <RfkButton
                testId="referral-use-code"
                disabled={state.busy}
                onClick={() => void c.submit(state.prefilled!, 'prefilled')}
              >
                {l10n.useCode(formatCode(state.prefilled))}
              </RfkButton>
              <RfkButton variant="text" disabled={state.busy} onClick={() => c.clearPrefilled()}>
                {l10n.enterDifferentCode}
              </RfkButton>
            </div>
          </div>
        ) : (
          <form
            className="rfk-stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void c.submit(state.text);
            }}
          >
            <div className="rfk-field">
              <label className="rfk-field__label" htmlFor={fieldId}>
                {l10n.codeFieldLabel}
              </label>
              <input
                id={fieldId}
                className="rfk-input rfk-input--code"
                data-testid="referral-code-field"
                dir="ltr"
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                enterKeyHint="go"
                disabled={state.busy}
                value={state.text}
                onFocus={() => c.startEntry('focus')}
                onChange={(e) => c.setText(e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData?.getData('text');
                  if (!text) return;
                  e.preventDefault();
                  c.paste(text);
                }}
              />
            </div>
            {disclosure ? (
              <p className="rfk-text" data-testid="referral-disclosure">
                {disclosure}
              </p>
            ) : null}
            <div className="rfk-actions">
              <RfkButton type="submit" disabled={state.busy} testId="referral-add-code">
                {l10n.addCode}
              </RfkButton>
              <InviteCodePasteButton label={l10n.paste} onPasted={(t) => c.paste(t)} />
            </div>
          </form>
        )
      ) : null}
      <p role="status" aria-live="polite" className="rfk-status" data-testid="referral-message">
        {message}
      </p>
    </div>
  );
  return render
    ? render({ state, controller: c, daysLeft, copy, defaultContent: content })
    : content;
}
