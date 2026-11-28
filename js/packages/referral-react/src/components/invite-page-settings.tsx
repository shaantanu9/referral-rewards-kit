'use client';
import type { ReferralPreferences } from '@myind/referral-core';
import { useId, useState, type ReactNode } from 'react';
import { useResolvedKit, type ReferralKitOptions } from '../context';
import type { InvitePageSettingsController, InvitePageSettingsState, PrefsStatus } from '../controllers/invite-page-settings';
import { useInvitePageSettings } from '../hooks';
import { cx, RfkButton, RfkDialog, type StyleProps } from '../ui';

export interface ReferralInvitePageSettingsRenderContext {
  readonly state: InvitePageSettingsState;
  readonly controller: InvitePageSettingsController;
  readonly dirty: boolean;
  /** Opens the leave confirm. */
  readonly askLeave: () => void;
  readonly defaultContent: ReactNode;
}

export interface ReferralInvitePageSettingsProps extends ReferralKitOptions, StyleProps {
  /** Already loaded preferences (the invite screen loads them with the code); loaded here when null. */
  initialPreferences?: ReferralPreferences | null;
  /** The terms reward the sharer, so the friend's page says "{Name} gets a reward if you join". Default true. */
  sharerRewarded?: boolean;
  /** Runs after leaving was saved (the invite screen reloads into its "You left" state). */
  onLeft?: (() => void) | null;
  render?: (ctx: ReferralInvitePageSettingsRenderContext) => ReactNode;
}

/**
 * "Your invite page" (G7, G9): the sharer's opt-in to show their first name on the invite page, what the friend sees,
 * and "Leave the invite program" with a confirm. Shows nothing on a server without `referral_preferences` (before
 * migration 23) or when it cannot load.
 */
export function ReferralInvitePageSettings(props: ReferralInvitePageSettingsProps): ReactNode {
  const { className, style, sharerRewarded = true, render } = props;
  const { l10n, copy } = useResolvedKit(props, 'ReferralInvitePageSettings');
  const s = useInvitePageSettings(props);
  const [confirm, setConfirm] = useState(false);
  const switchId = useId();
  const nameId = useId();
  const errorId = useId();
  const c = s.controller;
  if (s.prefs == null) return null;
  const statusText = (k: PrefsStatus | null): string =>
    k === 'saved' ? l10n.saved : k === 'unavailable' ? l10n.errUnavailable : k === 'saveFailed' ? l10n.saveFailed : '';
  const nameError = copy(null).displayNameError(s.nameError);

  const content = (
    <div className={cx('rfk-root', 'rfk-invite-page', className)} style={style} data-testid="referral-invite-page">
      <h4 className="rfk-subtitle">{l10n.invitePageTitle}</h4>
      <div className="rfk-switch-row">
        <label htmlFor={switchId} className="rfk-switch-row__label">
          {l10n.showFirstName}
        </label>
        <input
          id={switchId}
          type="checkbox"
          role="switch"
          className="rfk-switch"
          data-testid="referral-show-name"
          checked={s.showName}
          aria-checked={s.showName}
          disabled={s.saving}
          onChange={(e) => void c.toggle(e.target.checked)}
        />
      </div>
      <p className="rfk-muted">{sharerRewarded ? l10n.invitePageExplainRewarded : l10n.invitePageExplain}</p>
      {s.showName ? (
        <form
          className="rfk-field"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void c.saveName();
          }}
        >
          <label className="rfk-field__label" htmlFor={nameId}>
            {l10n.firstNameLabel}
          </label>
          <input
            id={nameId}
            className="rfk-input"
            data-testid="referral-name-field"
            type="text"
            autoComplete="given-name"
            autoCapitalize="words"
            disabled={s.saving}
            value={s.name}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? errorId : undefined}
            onChange={(e) => c.setName(e.target.value)}
          />
          {nameError ? (
            <p id={errorId} className="rfk-error" data-testid="referral-name-error">
              {nameError}
            </p>
          ) : null}
        </form>
      ) : null}
      {s.dirty ? (
        <div className="rfk-actions rfk-actions--end">
          <RfkButton testId="referral-name-save" disabled={s.saving} onClick={() => void c.saveName()}>
            {l10n.save}
          </RfkButton>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="rfk-status rfk-muted" data-testid="referral-prefs-status">
        {statusText(s.status)}
      </p>
      <div className="rfk-actions">
        <RfkButton variant="danger" testId="referral-leave" disabled={s.saving} onClick={() => setConfirm(true)}>
          {l10n.leaveProgram}
        </RfkButton>
      </div>
      <RfkDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={l10n.leaveConfirmTitle}
        testId="referral-leave-dialog"
        actions={
          <>
            <RfkButton variant="text" testId="referral-leave-cancel" onClick={() => setConfirm(false)}>
              {l10n.cancel}
            </RfkButton>
            <RfkButton
              variant="danger"
              testId="referral-leave-confirm"
              onClick={() => {
                setConfirm(false);
                void c.leave();
              }}
            >
              {l10n.leaveConfirm}
            </RfkButton>
          </>
        }
      >
        <p className="rfk-text">{l10n.leaveConfirmBody}</p>
      </RfkDialog>
    </div>
  );
  return render
    ? render({ state: s, controller: c, dirty: s.dirty, askLeave: () => setConfirm(true), defaultContent: content })
    : content;
}
