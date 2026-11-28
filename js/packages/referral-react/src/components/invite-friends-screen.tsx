'use client';
import {
  formatCode,
  inviteShareText,
  isShareResult,
  ReferralEvent,
  ReferralEventName,
  shareEventProps,
  webShare,
  whatsAppShareUri,
  type ReferralCopy,
  type ShareOrigin,
} from '@myind/referral-core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useResolvedKit, type ReferralKitOptions } from '../context';
import type { InviteScreenController, InviteScreenData, InviteScreenState } from '../controllers/invite-screen';
import { useInviteScreen } from '../hooks';
import { cx, icons, LiveText, RfkButton, Spinner, type StyleProps } from '../ui';
import { InviteCodeText } from './code-text';
import { ReferralBoostBanner, ReferralQrSheet } from './invite-extras';
import { ReferralInvitePageSettings } from './invite-page-settings';
import { ReferralMessage, ReferralUnavailableMessage, type ReferralUnavailableRender } from './message';
import { MyindAttribution } from './myind-attribution';
import { pickKit } from './invite-code-section';

export interface InviteFriendsScreenActions {
  share: () => Promise<void>;
  copy: () => Promise<void>;
  shareWhatsApp: () => Promise<void>;
  openQr: () => void;
  reload: () => Promise<void>;
  rejoin: () => Promise<void>;
}

export interface InviteFriendsScreenRenderContext {
  readonly state: InviteScreenState;
  readonly data: InviteScreenData | null;
  readonly copy: ReferralCopy;
  readonly link: string | null;
  readonly controller: InviteScreenController;
  readonly actions: InviteFriendsScreenActions;
  readonly defaultContent: ReactNode;
}

export interface InviteFriendsScreenProps extends ReferralKitOptions, StyleProps {
  /** Opens the program terms page; the link is hidden when null. */
  onOpenTerms?: (() => void) | null;
  /** Shown above the code (an app's own picture and headline). */
  header?: ReactNode;
  /** The app's own share sentence for a code and its link; the kit's sentence (from the terms) otherwise. */
  shareText?: ((code: string, link: string) => string) | null;
  /** Shown instead of the body when referrals are unavailable (e.g. not deployed); return null to hide. */
  renderUnavailable?: ReferralUnavailableRender | null;
  /** Inside an `InviteHub`: no title, no `invite_screen_viewed` (the hub reports its own open). */
  embedded?: boolean;
  /** The "Invite friends" heading (Flutter's app bar). Default true; never when [embedded]. */
  showTitle?: boolean;
  /** Called after each load finishes, whether it worked or not. */
  onLoaded?: (() => void) | null;
  /** Called after the code was copied (formatted, `ABCD-EFGH`). */
  onCopied?: ((code: string) => void) | null;
  /** Where the app opened this screen from, for `invite_screen_viewed` (`you`, `settings`, `home`, `deeplink`…). */
  from?: string | null;
  /** The WhatsApp button next to Share; hidden anyway when it cannot open. Default true. */
  showWhatsApp?: boolean;
  /** "Show QR code" for the invite link (only with an https invite link). Default true. */
  showQrCode?: boolean;
  /** The "Your invite page" block. Hidden anyway on a server without `referral_preferences`. Default true. */
  showInvitePageSettings?: boolean;
  /** The small "Built with Myind" link at the bottom. Free to turn off: false hides it. Default true. */
  showAttribution?: boolean;
  /** Which link text (0..3, wraps). */
  attributionVariant?: number;
  render?: (ctx: InviteFriendsScreenRenderContext) => ReactNode;
}

const toastMs = 4000;

/**
 * The "Invite friends" screen (ADR 4.1): the code, Share, WhatsApp, Copy, Show QR code, the rules with their
 * conditions, caps, the give-first headline and the boost banner, joined and waiting friends, rewards earned, pending
 * rewards with dates, "Your invite page", the terms link, and the empty, paused, disabled, left, offline and
 * unavailable states. Every sentence comes from `referral_terms()` through `ReferralCopy` (or the app's `texts`).
 *
 * Without an invite page (`inviteLink` null, or it returns null) Share still works: it sends the code and the
 * `storeLink`, and a line under the buttons says how the friend uses the code.
 */
export function InviteFriendsScreen(props: InviteFriendsScreenProps): ReactNode {
  const {
    className,
    style,
    embedded = false,
    showTitle = true,
    showWhatsApp = true,
    showQrCode = true,
    showInvitePageSettings = true,
    showAttribution = true,
    attributionVariant = 0,
    render,
  } = props;
  const kit = useResolvedKit(props, 'InviteFriendsScreen');
  const screen = useInviteScreen({ ...props, showInvitePageSettings, showWhatsApp });
  const c = screen.controller;
  const { l10n, texts } = kit;
  const [qrOpen, setQrOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!embedded) c.reportViewed(props.from, kit.emit);
    // Once per mount; the controller also guards against a second report (StrictMode).
  }, [c]);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const say = (text: string): void => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), toastMs);
  };

  const data = screen.data;
  const copy = kit.copy(data?.terms);
  const code = data?.code.code ?? null;
  const link = code == null ? null : c.link(code);
  const shareTextFor = (cd: string): string =>
    inviteShareText({
      copy,
      appName: kit.appName,
      code: cd,
      link: c.link(cd),
      storeLink: kit.storeLink,
      ...(props.shareText ? { shareText: props.shareText } : {}),
      ...(texts?.shareTextNoLink ? { shareTextNoLink: texts.shareTextNoLink } : {}),
    });

  const actions: InviteFriendsScreenActions = {
    copy: async () => {
      if (!code) return;
      const shown = formatCode(code);
      try {
        await (globalThis as { navigator?: Navigator }).navigator?.clipboard?.writeText(shown);
      } catch {
        // No clipboard permission: the code is on screen to copy by hand.
      }
      kit.emit(new ReferralEvent(ReferralEventName.inviteCodeCopied, { has_link: link != null }));
      try {
        props.onCopied?.(shown);
      } catch {
        // The app's callback never breaks the screen.
      }
      say(l10n.codeCopied);
    },
    share: async () => {
      if (!code) return;
      const r = shareRef.current?.getBoundingClientRect();
      const origin: ShareOrigin | null = r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
      let result: unknown = null;
      try {
        result = await kit.share(shareTextFor(code), origin);
      } catch {
        result = null;
      }
      kit.emit(new ReferralEvent(ReferralEventName.inviteShared, shareEventProps(result, { hasLink: link != null })));
      // The default handler copies the text where the browser cannot share: say so.
      if (kit.share === webShare && isShareResult(result) && result.status === 'unavailable') say(l10n.codeCopied);
    },
    shareWhatsApp: async () => {
      if (!code) return;
      let opened = false;
      try {
        opened = await kit.launcher.launch(whatsAppShareUri(shareTextFor(code)));
      } catch {
        opened = false;
      }
      kit.emit(
        new ReferralEvent(ReferralEventName.inviteShared, {
          channel: 'whatsapp_button',
          status: opened ? 'opened' : 'unavailable',
          has_link: link != null,
        }),
      );
    },
    openQr: () => {
      if (!link) return;
      kit.emit(new ReferralEvent(ReferralEventName.inviteQrShown));
      setQrOpen(true);
    },
    reload: () => c.reload(),
    rejoin: async () => {
      let result = 'failed';
      try {
        const p = await kit.client.setPreferences({ participating: true });
        result = p.reason ?? 'ok';
      } catch {
        // Shown below.
      }
      kit.emit(new ReferralEvent(ReferralEventName.invitePreferencesChanged, { participating: true, result }));
      if (result === 'ok') await c.reload();
      else say(l10n.saveFailed);
    },
  };

  let body: ReactNode;
  if (screen.status === 'loading') {
    body = <Spinner testId="referral-loading" />;
  } else if (screen.status === 'unavailable') {
    const reason = screen.unavailable!;
    body = props.renderUnavailable ? (
      props.renderUnavailable(reason)
    ) : (
      <ReferralUnavailableMessage reason={reason} texts={texts ?? null} onSignIn={kit.onSignIn} />
    );
  } else if (screen.status === 'error' || data == null) {
    body = (
      <ReferralMessage
        testId="referral-load-failed"
        text={l10n.loadFailed}
        action={l10n.retry}
        onAction={() => void c.reload()}
      />
    );
  } else {
    body = inviteContent();
  }

  function inviteContent(): ReactNode {
    const d = data!;
    const paused = !d.terms.enabled || d.code.reason === 'program_paused';
    const s = d.stats;
    const parts: ReactNode[] = [];
    if (props.header && !paused) parts.push(<div key="header" className="rfk-header">{props.header}</div>);
    if (paused) {
      parts.push(
        <h3 key="paused" className="rfk-title" data-testid="referral-paused">
          {l10n.paused}
        </h3>,
      );
    } else if (d.code.left) {
      parts.push(
        <div key="left" className="rfk-stack">
          <h3 className="rfk-title" data-testid="referral-left">
            {l10n.leftTitle}
          </h3>
          <p className="rfk-muted">{l10n.leftBody}</p>
          <div className="rfk-actions">
            <RfkButton testId="referral-join-again" onClick={() => void actions.rejoin()}>
              {l10n.joinAgain}
            </RfkButton>
          </div>
        </div>,
      );
    } else if (code == null) {
      parts.push(
        <h3 key="unavailable" className="rfk-title" data-testid="referral-unavailable">
          {d.code.reason === 'code_disabled' ? l10n.codeDisabled : l10n.errUnavailable}
        </h3>,
      );
    } else {
      const headline = texts?.inviteHeadline?.(copy.friendReward, copy.sharerJoinedReward) ?? copy.inviteHeadline();
      if (!d.offline && d.terms.boostAt(kit.clock()) != null) {
        parts.push(<ReferralBoostBanner key="boost" terms={d.terms} clock={kit.clock} l10n={l10n} />);
      }
      if (headline != null && !d.offline) {
        parts.push(
          <h3 key="headline" className="rfk-title rfk-center" data-testid="referral-invite-headline">
            {headline}
          </h3>,
        );
      }
      parts.push(
        <div key="code" className="rfk-code-block">
          <p className="rfk-label rfk-center">{l10n.yourCode}</p>
          <InviteCodeText code={code} />
        </div>,
        <div key="buttons" className="rfk-actions rfk-actions--center">
          <RfkButton ref={shareRef} icon={icons.share} testId="referral-share" onClick={() => void actions.share()}>
            {l10n.share}
          </RfkButton>
          {screen.whatsApp && showWhatsApp ? (
            <RfkButton
              variant="outlined"
              icon={icons.chat}
              testId="referral-whatsapp"
              onClick={() => void actions.shareWhatsApp()}
            >
              {l10n.whatsApp}
            </RfkButton>
          ) : null}
          <RfkButton variant="outlined" icon={icons.copy} testId="referral-copy-code" onClick={() => void actions.copy()}>
            {l10n.copyCode}
          </RfkButton>
        </div>,
      );
      if (link != null && showQrCode) {
        parts.push(
          <div key="qr" className="rfk-actions rfk-actions--center">
            <RfkButton variant="text" icon={icons.qr} testId="referral-show-qr" onClick={actions.openQr}>
              {l10n.showQr}
            </RfkButton>
          </div>,
        );
      }
      if (link == null) {
        parts.push(
          <p key="nolink" className="rfk-muted rfk-center" data-testid="referral-no-link">
            {texts?.noLinkHint?.(kit.appName) ?? l10n.noLinkHint(kit.appName)}
          </p>,
        );
      }
      parts.push(
        <ul key="rules" className="rfk-rules" data-testid="referral-rules">
          {[...copy.rules(), ...copy.caps()].map((line) => (
            <li key={line} className="rfk-text rfk-text--large">
              {line}
            </li>
          ))}
        </ul>,
      );
    }
    if (!paused && code != null && s.isEmpty && !d.offline) {
      parts.push(
        <p key="empty" className="rfk-text" data-testid="referral-empty">
          {copy.emptyState()}
        </p>,
      );
    }
    const joined = s.joinedCount ?? 0;
    if (joined > 0) {
      parts.push(
        <p key="joined" className="rfk-text" data-testid="referral-joined">
          {l10n.joinedCount(joined)}
        </p>,
      );
    }
    const claimed = s.claimedCount ?? 0;
    if (claimed > 0 && !paused) {
      const step = texts?.activationStepForFriends ?? texts?.activationStep ?? null;
      const line =
        texts?.waiting?.(claimed, copy.nextStep({ appName: kit.appName, activationStep: step }), copy.sharerJoinedReward, copy.friendReward) ??
        copy.waitingLine(claimed, { appName: kit.appName, activationStep: step })!;
      parts.push(
        <p key="claimed" className="rfk-text" data-testid="referral-claimed">
          {line}
        </p>,
      );
    }
    if (s.rewardsGranted.length > 0) {
      parts.push(
        <div key="earned" className="rfk-stack-tight" data-testid="referral-earned">
          <h4 className="rfk-subtitle">{l10n.rewardsEarned}</h4>
          <ul className="rfk-list">
            {s.rewardsGranted.map((r, i) => (
              <li key={r.id || i}>{copy.itemReward(r)}</li>
            ))}
          </ul>
        </div>,
      );
    }
    if (s.pending.length > 0 || s.banked.length > 0) {
      parts.push(
        <div key="pending" className="rfk-stack-tight" data-testid="referral-pending">
          <h4 className="rfk-subtitle">{l10n.pendingRewards}</h4>
          <ul className="rfk-list">
            {s.pending.map((r, i) => (
              <li key={`p${r.id || i}`}>{copy.pendingLine(r)}</li>
            ))}
            {s.banked.map((r, i) => (
              <li key={`b${r.id || i}`}>{l10n.bankedItem(copy.itemReward(r))}</li>
            ))}
          </ul>
        </div>,
      );
    }
    if (s.skippedCap > 0) {
      parts.push(
        <p key="skipped" className="rfk-text" data-testid="referral-skipped">
          {l10n.skippedCap(s.skippedCap)}
        </p>,
      );
    }
    if (showInvitePageSettings && !paused && code != null && !d.offline && d.prefs != null) {
      parts.push(
        <hr key="divider" className="rfk-divider" />,
        <ReferralInvitePageSettings
          key="invite-page"
          {...pickKit(props)}
          initialPreferences={d.prefs}
          sharerRewarded={copy.sharerJoined != null || copy.sharerPaid != null}
          onLeft={() => void c.reload()}
        />,
      );
    }
    if (props.onOpenTerms) {
      parts.push(
        <div key="terms" className="rfk-actions">
          <RfkButton variant="text" testId="referral-terms" onClick={() => props.onOpenTerms?.()}>
            {l10n.termsLink}
          </RfkButton>
        </div>,
      );
    }
    return <>{parts}</>;
  }

  const content = (
    <section
      className={cx('rfk-root', 'rfk-invite', embedded && 'rfk-invite--embedded', className)}
      style={style}
      aria-busy={screen.status === 'loading' ? true : undefined}
      data-testid="referral-invite-screen"
    >
      {showTitle && !embedded ? <h2 className="rfk-heading">{texts?.title ?? l10n.inviteTitle}</h2> : null}
      {body}
      {showAttribution && screen.status === 'ready' ? (
        <MyindAttribution variant={attributionVariant} source={kit.attributionSource} />
      ) : null}
      <LiveText className="rfk-toast" testId="referral-toast">
        {toast ?? ''}
      </LiveText>
      {link ? <ReferralQrSheet open={qrOpen} onClose={() => setQrOpen(false)} link={link} l10n={l10n} /> : null}
    </section>
  );
  return render
    ? render({ state: screen, data, copy, link, controller: c, actions, defaultContent: content })
    : content;
}
