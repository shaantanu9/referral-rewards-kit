'use client';
import { ReferralEvent, ReferralEventName, type ClaimResult, type ReferralTexts } from '@myind/referral-core';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { useResolvedKit, type ReferralKitOptions } from '../context';
import { cx, type StyleProps } from '../ui';
import { InviteCodeSection, pickKit } from './invite-code-section';
import { InviteFriendsScreen, type InviteFriendsScreenProps } from './invite-friends-screen';
import type { ReferralUnavailableRender } from './message';
import { MyindAttribution } from './myind-attribution';

/** The two parts of an [InviteHub]. */
export const InviteHubSection = {
  /** "Your invite code" with Share and Copy, the rules, caps, joined count and what you earned. */
  invite: 'invite',
  /** The friend's code: the gift, the real days left, the field, the steps, "almost yours" after a code. */
  enterCode: 'enterCode',
} as const;
export type InviteHubSection = (typeof InviteHubSection)[keyof typeof InviteHubSection];

/** Call through a ref: `hubRef.current?.scrollTo('enterCode')`. */
export interface InviteHubHandle {
  /** Brings [section] into view (smoothly unless the user prefers reduced motion). Does nothing when it is hidden. */
  scrollTo(section: InviteHubSection, opts?: { animate?: boolean }): void;
}

export interface InviteHubRenderContext {
  readonly invite: ReactNode;
  readonly entry: ReactNode;
  readonly attribution: ReactNode;
  readonly defaultContent: ReactNode;
}

export interface InviteHubProps
  extends ReferralKitOptions,
    StyleProps,
    Pick<
      InviteFriendsScreenProps,
      'onOpenTerms' | 'header' | 'shareText' | 'onCopied' | 'showWhatsApp' | 'showQrCode' | 'showInvitePageSettings'
    > {
  showInvite?: boolean;
  showEntry?: boolean;
  /** Scrolls to this part once it has loaded. */
  initialSection?: InviteHubSection | null;
  /** Where the app opened the hub from (`invite_screen_viewed.from`): `you`, `settings`, `home`, `deeplink`… */
  from?: string | null;
  /** See `InviteCodeEntry.eligibleFrom`; the server's `claim_days_left` wins. */
  eligibleFrom?: Date | null;
  /** A code from a link or the install referrer, shown with one-tap confirm. */
  initialCode?: string | null;
  onClaimed?: ((result: ClaimResult) => void) | null;
  /** See `InviteCodeSection.onAlmostAction`. */
  onAlmostAction?: (() => void) | null;
  /** App art above / beside the friend part's headline. */
  entryHeader?: ReactNode;
  entryLeading?: ReactNode;
  showSteps?: boolean;
  /** Replaces "Have an invite code?" (wins over `texts.entryTitle`). */
  entryTitle?: string;
  renderUnavailable?: ReferralUnavailableRender | null;
  /** The "Invite friends" heading (Flutter's app bar). Default true. */
  showTitle?: boolean;
  /** Replaces the heading's text. */
  title?: string;
  /**
   * True: the hub is its own scroll container (give it a height). Default false on the web: it flows in the page,
   * and `scrollTo` scrolls the page (Flutter's default is its own scroll view).
   */
  scrollable?: boolean;
  /** The small "Built with Myind" link at the bottom, once for both parts. Free to turn off. Default true. */
  showAttribution?: boolean;
  attributionVariant?: number;
  render?: (ctx: InviteHubRenderContext) => ReactNode;
}

function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/**
 * The one invite screen an app needs: your code with Share / Copy on top, and a friend's code below. Built from
 * `InviteFriendsScreen` (embedded) and `InviteCodeSection`, so every slot they have works here.
 *
 * - Open on a part with [initialSection] (`'enterCode'` from a "Got a code?" row), or call `scrollTo` through a ref.
 *   Reports `invite_screen_viewed` once per open with [from] and the focus.
 * - Hide a part with [showInvite] / [showEntry].
 * - Not deployed / signed out: one message (or [renderUnavailable]) instead of two; Sign in with `onSignIn`.
 * - The attribution link shows once at the bottom (not again for the embedded invite part).
 */
export const InviteHub = forwardRef<InviteHubHandle, InviteHubProps>(function InviteHub(props, ref) {
  const {
    className,
    style,
    showInvite = true,
    showEntry = true,
    initialSection = null,
    showTitle = true,
    scrollable = false,
    showAttribution = true,
    attributionVariant = 0,
    render,
  } = props;
  const kit = useResolvedKit(props, 'InviteHub');
  const inviteRef = useRef<HTMLDivElement>(null);
  const entryRef = useRef<HTMLDivElement>(null);
  const pending = useRef<InviteHubSection | null>(initialSection);
  const viewed = useRef(false);
  const both = showInvite && showEntry;

  const scrollTo = useCallback((section: InviteHubSection, opts: { animate?: boolean } = {}) => {
    const el = (section === InviteHubSection.invite ? inviteRef : entryRef).current;
    if (!el || typeof el.scrollIntoView !== 'function') return;
    const smooth = (opts.animate ?? true) && !prefersReducedMotion();
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  }, []);
  useImperativeHandle(ref, () => ({ scrollTo }), [scrollTo]);

  const scrollSoon = useCallback(() => {
    const target = pending.current;
    if (target == null) return;
    const run = (): void => {
      pending.current = null;
      scrollTo(target, { animate: false });
    };
    if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(run);
    else run();
  }, [scrollTo]);

  useEffect(() => {
    if (!viewed.current) {
      viewed.current = true;
      kit.emit(
        new ReferralEvent(ReferralEventName.inviteScreenViewed, {
          from: props.from ?? 'unknown',
          focus: initialSection === InviteHubSection.enterCode ? 'code' : 'share',
        }),
      );
    }
    // With the invite part shown, wait for its data (onLoaded): it changes the height above the entry.
    if (!showInvite) scrollSoon();
    // Once per open.
  }, []);

  const texts: ReferralTexts | undefined =
    props.entryTitle === undefined ? kit.texts : { ...(kit.texts ?? {}), entryTitle: props.entryTitle };
  const shared = { ...pickKit(props), ...(texts ? { texts } : {}) };
  // With both parts shown, the invite part explains "not available" once; the entry hides itself.
  const entryUnavailable: ReferralUnavailableRender | null = both ? () => null : (props.renderUnavailable ?? null);

  const invite = showInvite ? (
    <div ref={inviteRef} className="rfk-hub__part" data-testid="referral-hub-invite">
      <InviteFriendsScreen
        {...shared}
        embedded
        onLoaded={scrollSoon}
        onOpenTerms={props.onOpenTerms ?? null}
        header={props.header}
        shareText={props.shareText ?? null}
        onCopied={props.onCopied ?? null}
        renderUnavailable={props.renderUnavailable ?? null}
        showWhatsApp={props.showWhatsApp ?? true}
        showQrCode={props.showQrCode ?? true}
        showInvitePageSettings={props.showInvitePageSettings ?? true}
        showAttribution={false}
      />
    </div>
  ) : null;
  const entry = showEntry ? (
    <div ref={entryRef} className="rfk-hub__part" data-testid="referral-hub-entry">
      <InviteCodeSection
        {...shared}
        initialCode={props.initialCode ?? null}
        eligibleFrom={props.eligibleFrom ?? null}
        onClaimed={props.onClaimed ?? null}
        onAlmostAction={props.onAlmostAction ?? null}
        header={props.entryHeader}
        leading={props.entryLeading}
        showSteps={props.showSteps ?? true}
        renderUnavailable={entryUnavailable}
      />
    </div>
  ) : null;
  const attribution = showAttribution ? (
    <MyindAttribution variant={attributionVariant} source={kit.attributionSource} />
  ) : null;

  const content = (
    <div
      className={cx('rfk-root', 'rfk-hub', scrollable && 'rfk-hub--scroll', className)}
      style={style}
      data-testid="referral-hub"
    >
      {showTitle ? <h2 className="rfk-heading">{props.title ?? texts?.title ?? kit.l10n.inviteTitle}</h2> : null}
      {invite}
      {both ? <hr className="rfk-divider" /> : null}
      {entry}
      {attribution}
    </div>
  );
  return render ? render({ invite, entry, attribution, defaultContent: content }) : content;
});
