'use client';
import { OfferStatus, RewardsEvent, RewardsEventName, SocialTaskStatus, type OfferState, type SocialTaskState } from '@myind/rewards-core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RewardsListener } from './base';
import { useRewardsController, useRewardsTexts } from './context';
import { Countdown } from './countdown';
import { Icon } from './icons';
import { Card, cx, type BaseProps } from './internal';
import { useAction } from './programs';

// ---- OfferBanner ----

export interface OfferBannerProps extends BaseProps {
  readonly program: string;
  readonly title?: string | null;
  /** Your own look; gets every state. `claim` resolves to null on success or a reason. */
  readonly render?: (offer: OfferState, claim: () => Promise<string | null>) => ReactNode;
  readonly onClaimed?: () => void;
}

/**
 * A timed offer: the reward, the real time left, and Claim. The deadline and any stock count come from the server
 * and never reset. The default look hides itself once the offer is claimed, expired (also when the countdown reaches
 * zero, without a server call) or sold out; a [render] gets every state.
 */
export function OfferBanner(props: OfferBannerProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const c = useRewardsController(props.controller);
  const act = useAction();
  const [expiredLocally, setExpiredLocally] = useState(false);
  const claim = (): Promise<string | null> => act.run(() => c.claimOffer(props.program), props.onClaimed);
  return (
    <RewardsListener
      controller={c}
      render={({ state }) => {
        let o = state.offer(props.program);
        if (o == null) return null;
        if (expiredLocally && o.status === OfferStatus.active) o = o.copyWith({ status: OfferStatus.expired });
        if (props.render) return props.render(o, claim);
        if (o.status !== OfferStatus.active) return null;
        return (
          <Card name="rk-offer" className={props.className} style={props.style} label={props.title ?? undefined}>
            {props.title ? <h3 className="rk-title">{props.title}</h3> : null}
            <p className="rk-number">{texts.rewards(o.rewards)}</p>
            <div className="rk-row">
              <Countdown
                endsAt={o.endsAt}
                clock={c.clock}
                prefix={texts.offerEndsIn}
                hidden={state.choices.timersOff}
                className="rk-warning"
                onExpired={() => setExpiredLocally(true)}
              />
              {o.stockLeft != null ? <span className="rk-muted">{texts.stockLeft(o.stockLeft)}</span> : null}
            </div>
            {act.reason != null ? <p className="rk-warning" role="alert">{texts.error(act.reason)}</p> : null}
            <button type="button" className="rk-button" disabled={act.busy} onClick={() => void claim()}>
              {texts.claim}
            </button>
          </Card>
        );
      }}
    />
  );
}

// ---- SocialTagTask ----

/** Copies text with the async clipboard; resolves false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}

export interface SocialTagTaskProps extends BaseProps {
  readonly program: string;
  /** Opens Instagram (`https://instagram.com/<account>` or the app). The button is hidden without it. */
  readonly onOpenInstagram?: (account: string) => void;
  /** Copies the code; default the browser clipboard. */
  readonly onCopy?: (code: string) => Promise<void> | void;
  /** While pending, offer "Link to your post" (`rewards_social_submit_link`) for when the webhook misses it. */
  readonly showLinkField?: boolean;
  /** Your own look. `start(handle)` resolves to null on success or a reason. */
  readonly render?: (task: SocialTaskState, start: (handle: string) => Promise<string | null>) => ReactNode;
}

/**
 * "Tag us on Instagram" (ADR 0002 §6.3): username → code → post with the code → verified by the server. Opening
 * Instagram is the app's job ([onOpenInstagram]). Analytics events never carry the code or the handle.
 */
export function SocialTagTask(props: SocialTagTaskProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const c = useRewardsController(props.controller);
  const act = useAction();
  const [handle, setHandle] = useState('');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const start = (h: string): Promise<string | null> => act.run(() => c.startSocial(props.program, h));
  const copy = async (code: string): Promise<void> => {
    if (props.onCopy) await props.onCopy(code);
    else await copyText(code);
    c.client.report(new RewardsEvent(RewardsEventName.socialCodeCopied, { program: props.program }));
    setCopied(true);
  };
  const open = (account: string): void => {
    c.client.report(new RewardsEvent(RewardsEventName.instagramOpened, { program: props.program }));
    props.onOpenInstagram?.(account);
  };
  return (
    <RewardsListener
      controller={c}
      render={({ state }) => {
        const task = state.socialTask(props.program);
        if (task == null) return null;
        if (props.render) return props.render(task, start);
        const x = texts;
        const error = act.reason != null ? <p className="rk-warning" role="alert">{x.error(act.reason)}</p> : null;
        let body: ReactNode;
        switch (task.status) {
          case SocialTaskStatus.pending:
            body = (
              <>
                <p className="rk-muted">{x.socialSteps(task.account)}</p>
                <div className="rk-row">
                  <output className="rk-code">{task.code ?? ''}</output>
                  <button type="button" className="rk-button rk-button--text" onClick={() => void copy(task.code ?? '')}>
                    {copied ? x.codeCopied : x.copyCode}
                  </button>
                </div>
                <p className="rk-muted">{x.socialDisclose}</p>
                {props.onOpenInstagram ? (
                  <button type="button" className="rk-button" onClick={() => open(task.account)}>
                    {x.openInstagram}
                  </button>
                ) : null}
                <Countdown endsAt={task.expiresAt} clock={c.clock} prefix={x.socialCheckingIn} className="rk-muted rk-block" />
                {props.showLinkField ? (
                  task.postUrl != null ? (
                    <p className="rk-success">{x.programs.postLinkSent}</p>
                  ) : (
                    <>
                      <label className="rk-field">
                        <span className="rk-field__label">{x.programs.postLinkLabel}</span>
                        <input className="rk-input" type="url" inputMode="url" autoComplete="off" value={link} onChange={(e) => setLink(e.target.value)} />
                      </label>
                      {error}
                      <button type="button" className="rk-button rk-button--text" disabled={act.busy} onClick={() => void act.run(() => c.submitSocialLink(props.program, link))}>
                        {x.programs.postLinkSend}
                      </button>
                    </>
                  )
                ) : null}
              </>
            );
            break;
          case SocialTaskStatus.verified:
            body = <p className="rk-success">{x.socialVerified}</p>;
            break;
          case SocialTaskStatus.cooldown:
            body = (
              <>
                <p className="rk-success">{x.socialVerified}</p>
                <Countdown endsAt={task.expiresAt} clock={c.clock} prefix={x.socialCooldown} className="rk-muted rk-block" />
              </>
            );
            break;
          case SocialTaskStatus.unknown:
            return null;
          default:
            body = (
              <>
                {task.status === SocialTaskStatus.rejected ? <p className="rk-muted">{x.socialRejected}</p> : null}
                {task.status === SocialTaskStatus.expired ? <p className="rk-muted">{x.socialExpired}</p> : null}
                <label className="rk-field">
                  <span className="rk-field__label">{x.socialHandleLabel}</span>
                  <span className="rk-input-wrap">
                    <span className="rk-input-prefix" aria-hidden="true">
                      @
                    </span>
                    <input className="rk-input" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={handle} onChange={(e) => setHandle(e.target.value)} />
                  </span>
                </label>
                {error}
                <button type="button" className="rk-button" disabled={act.busy} onClick={() => void start(handle)}>
                  {x.socialStart}
                </button>
              </>
            );
        }
        return (
          <Card name="rk-social" className={props.className} style={props.style} label={x.socialTitle(task.account)}>
            <h3 className="rk-title">{x.socialTitle(task.account)}</h3>
            <p>{x.rewards(task.rewards)}</p>
            {body}
          </Card>
        );
      }}
    />
  );
}

// ---- RewardedAdButton ----

export interface RewardedAdButtonProps extends BaseProps {
  /** The app's text, e.g. "Watch an ad for 10 coins". */
  readonly label: string;
  /** The ad adapter: shows the ad (e.g. through RevenueCat's ad adapter) and resolves true when the reward was verified. */
  readonly onShowAd: () => Promise<boolean>;
  /** Your copy of `settings.ads_enabled` / your own availability. Default true. */
  readonly enabled?: boolean;
  /** Extra reloads after a verified reward (the webhook lands a little later). Default 5 s and 20 s. */
  readonly refreshAfterMs?: readonly number[];
  /** Your own look. `show` is null while an ad is showing; `message` is the last not-verified / error line. */
  readonly render?: (show: (() => void) | null, busy: boolean, message: string | null) => ReactNode;
}

/**
 * "Watch an ad for 10 coins". The ad itself is the app's adapter ([onShowAd]); the package depends on no ad SDK.
 * After a verified reward the state is reloaded now and again after each of [refreshAfterMs]. Hidden while rewards
 * are not visible or [enabled] is false.
 */
export function RewardedAdButton(props: RewardedAdButtonProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const c = useRewardsController(props.controller);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
  }, []);
  const report = (result: string): void => c.client.report(new RewardsEvent(RewardsEventName.adRewardShown, { result }));
  const show = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    let ok: boolean;
    let msg: string | null = null;
    try {
      ok = await props.onShowAd();
      report(ok ? 'verified' : 'not_verified');
      if (!ok) msg = texts.programs.adNotVerified;
    } catch {
      ok = false;
      report('error');
      msg = texts.programs.adError;
    }
    if (ok) {
      void c.refresh();
      for (const t of timers.current) clearTimeout(t);
      timers.current = (props.refreshAfterMs ?? [5000, 20000]).map((ms) => setTimeout(() => void c.refresh(), ms));
    }
    if (!mounted.current) return;
    setBusy(false);
    setMessage(msg);
  };
  if (props.enabled === false) return null;
  return (
    <RewardsListener
      controller={c}
      render={() => {
        const onShow = busy ? null : () => void show();
        if (props.render) return props.render(onShow, busy, message);
        return (
          <div className={cx('rk', 'rk-ad', props.className)} style={props.style}>
            <button type="button" className="rk-button rk-button--outlined rk-button--block" disabled={onShow == null} aria-busy={busy} onClick={onShow ?? undefined}>
              {busy ? <span className="rk-spinner" aria-hidden="true" /> : <Icon name="video" size={18} className="rk-accent" />} {props.label}
            </button>
            {message != null ? (
              <p className="rk-muted" role="status">
                {message}
              </p>
            ) : null}
          </div>
        );
      }}
    />
  );
}
