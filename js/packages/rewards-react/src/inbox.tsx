'use client';
import {
  GrantState,
  reportRewardsEvent,
  RewardsEvent,
  RewardsEventName,
  type RewardGrant,
  type RewardsController,
  type RewardsEventSink,
  type RewardsTexts,
} from '@myind/rewards-core';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { RewardsListener } from './base';
import { useRewardsController, useRewardsTexts } from './context';
import { Icon } from './icons';
import { cx, useReducedMotion, type BaseProps } from './internal';

// ---- RewardInbox ----

export interface RewardInboxProps extends BaseProps {
  /** Show `texts.inboxEmpty` when there is nothing. Default false: nothing. */
  readonly showEmpty?: boolean;
  /** Your own look for the whole list. `seen(ids)` marks granted ones seen; resolves to null or a reason. */
  readonly render?: (inbox: readonly RewardGrant[], seen: (ids: readonly string[]) => Promise<string | null>) => ReactNode;
}

/**
 * Rewards not yet seen. Granted ones get "Got it" (marks them seen); pending ones (e.g. Premium days the server has
 * not given yet) say "On its way" and stay until they land.
 */
export function RewardInbox(props: RewardInboxProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const c = useRewardsController(props.controller);
  return (
    <RewardsListener
      controller={c}
      render={({ state }) => {
        const inbox = state.inbox;
        if (props.render) return props.render(inbox, (ids) => c.markSeen(ids));
        if (inbox.length === 0) {
          return props.showEmpty ? (
            <p className={cx('rk', 'rk-inbox-empty', 'rk-muted', props.className)} style={props.style}>
              {texts.inboxEmpty}
            </p>
          ) : null;
        }
        return (
          <ul className={cx('rk', 'rk-inbox', props.className)} style={props.style}>
            {inbox.map((g) => (
              <li key={g.id} className="rk-card rk-row rk-inbox__item">
                <Icon name="gift" className="rk-accent" />
                <span className="rk-grow">{texts.gotReward(texts.reward(g.spec))}</span>
                {g.state === GrantState.granted ? (
                  <button type="button" className="rk-button rk-button--text" onClick={() => void c.markSeen([g.id])}>
                    {texts.gotIt}
                  </button>
                ) : (
                  <span className="rk-muted">{texts.onItsWay}</span>
                )}
              </li>
            ))}
          </ul>
        );
      }}
    />
  );
}

// ---- RewardReveal ----

/** A short vibration where the browser has one (`navigator.vibrate`); nothing elsewhere. */
export function defaultHaptic(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(20);
  } catch {
    // no haptics
  }
}

/** How long the shake and scale-up take before the reward pops in. */
export const revealOpenMs = 600;

export interface RewardRevealProps {
  readonly grant: RewardGrant;
  readonly texts?: RewardsTexts;
  /** Open by itself after mount (the same animation and haptic as a tap). */
  readonly autoOpen?: boolean;
  /** Called once, when the reward is shown. */
  readonly onOpened?: () => void;
  /** Analytics sink, e.g. `(e) => controller.client.report(e)`. Props: `program`, `kind`; never a user id. */
  readonly onEvent?: RewardsEventSink | null;
  /** The haptic on open; default `navigator.vibrate(20)` where it exists. */
  readonly onHaptic?: () => void;
  /** Your own look. Call `open` to open (haptic, [onOpened] and the event still happen; animate on `opened` yourself). */
  readonly render?: (grant: RewardGrant, opened: boolean, open: () => void) => ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * A surprise reward (ADR 0002 §18.6) as a closed gift: "Surprise!" / "Tap to open". Opening gives a haptic, a short
 * shake and scale-up (about 600 ms), then "You got 23 coins". With `prefers-reduced-motion: reduce` there is no
 * animation: it opens at once. It shows only what was won, never what could have been. A grant made while the user
 * had surprises off (`isFixed`) is not shown as a gamble: no gift, no shake, no haptic, the line at once. [onOpened]
 * and `rewards_reveal_opened` fire once.
 */
export function RewardReveal(props: RewardRevealProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const reduced = useReducedMotion();
  const fixed = props.grant.isFixed && !props.render;
  const [started, setStarted] = useState(fixed);
  const [opened, setOpened] = useState(fixed);
  const announced = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const announce = (): void => {
    if (announced.current) return;
    announced.current = true;
    const p = latest.current;
    p.onOpened?.();
    reportRewardsEvent(p.onEvent, new RewardsEvent(RewardsEventName.revealOpened, { program: p.grant.program, kind: p.grant.kind }));
  };
  const mounted = useRef(false);
  const finish = (): void => {
    if (!mounted.current) return;
    setOpened(true);
    announce();
  };
  const startedRef = useRef(fixed);
  const start = (): void => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStarted(true);
    (latest.current.onHaptic ?? defaultHaptic)();
    const motionless = latest.current.render != null || reducedRef.current || matchesReducedMotion();
    if (motionless) {
      finish();
      return;
    }
    setTimeout(finish, revealOpenMs);
  };

  // Mount only, like the Flutter post-frame callback. The open timer is not cleared on cleanup, so a StrictMode
  // remount still opens; [finish] does nothing once unmounted.
  useEffect(() => {
    mounted.current = true;
    if (fixed) announce();
    else if (props.autoOpen) start();
    return () => {
      mounted.current = false;
    };
  }, []);

  if (props.render) return <>{props.render(props.grant, opened, start)}</>;
  return (
    <div className={cx('rk', 'rk-card', 'rk-reveal', opened ? 'rk-reveal--opened' : started ? 'rk-reveal--opening' : 'rk-reveal--closed', props.className)} style={props.style}>
      {opened ? (
        <div className="rk-reveal__opened" role="status" aria-live="polite">
          <Icon name="celebration" size={56} className="rk-accent" />
          <p className="rk-title rk-strong">{texts.reveal.youGot(texts.reward(props.grant.spec))}</p>
        </div>
      ) : (
        <div className="rk-reveal__closed" onClick={start}>
          <div className="rk-reveal__gift">
            <Icon name="gift" size={64} className="rk-accent" />
          </div>
          <p className="rk-title">{texts.reveal.title}</p>
          <p className="rk-muted">{texts.reveal.tapToOpen}</p>
          <button
            type="button"
            className="rk-button"
            disabled={started}
            onClick={(e) => {
              e.stopPropagation();
              start();
            }}
          >
            {texts.reveal.open}
          </button>
        </div>
      )}
    </div>
  );
}

function matchesReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export interface RewardRevealDialogProps extends Omit<RewardRevealProps, 'render' | 'className' | 'style'> {
  /** Called by "Close" / "Nice!", Escape and a tap on the backdrop. */
  readonly onClose: () => void;
  readonly className?: string;
}

/**
 * [RewardReveal] in a modal dialog with a close button ("Close", then "Nice!" once opened); port of
 * `showRewardReveal`. Focus moves into the dialog and Escape closes it. Render it while it should show.
 */
export function RewardRevealDialog(props: RewardRevealDialogProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const [opened, setOpened] = useState(false);
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    box.current?.querySelector<HTMLElement>('button')?.focus();
    return () => prev?.focus?.();
  }, []);
  const { onClose, className, ...reveal } = props;
  return (
    <div className="rk rk-dialog-backdrop" onClick={onClose}>
      <div
        ref={box}
        className={cx('rk-dialog', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <span id={titleId} className="rk-sr-only">
          {texts.reveal.title}
        </span>
        <RewardReveal
          {...reveal}
          texts={texts}
          onOpened={() => {
            setOpened(true);
            props.onOpened?.();
          }}
        />
        <button type="button" className={cx('rk-button', opened ? 'rk-button--tonal' : 'rk-button--text')} onClick={onClose}>
          {opened ? texts.reveal.nice : texts.reveal.close}
        </button>
      </div>
    </div>
  );
}

// ---- RewardToastListener ----

export interface GrantQueueOptions {
  /** Queue grants until `controller.celebrateNow()`. Default false: at once. */
  readonly holdUntilMoment?: boolean;
  /** Called for each grant as it is announced (after any hold). */
  readonly onAnnounce: (grant: RewardGrant) => void;
}

/**
 * Hears each new grant once (`controller.onGrant`) and announces it, or holds it until `controller.celebrateNow()`
 * with [holdUntilMoment] (port of `RewardToastListener`'s hold-until-moment queue). Turning the hold off releases what
 * is held.
 */
export function useGrantQueue(controller: RewardsController, opts: GrantQueueOptions): void {
  const held = useRef<RewardGrant[]>([]);
  const latest = useRef(opts);
  latest.current = opts;
  const hold = opts.holdUntilMoment ?? false;
  useEffect(() => {
    const flush = (): void => {
      const list = held.current;
      held.current = [];
      for (const g of list) latest.current.onAnnounce(g);
    };
    const offGrant = controller.onGrant((g) => {
      if (latest.current.holdUntilMoment) held.current.push(g);
      else latest.current.onAnnounce(g);
    });
    const offMoment = controller.onMoment(flush);
    return () => {
      offGrant();
      offMoment();
    };
  }, [controller]);
  const wasHolding = useRef(hold);
  useEffect(() => {
    if (wasHolding.current && !hold) {
      const list = held.current;
      held.current = [];
      for (const g of list) latest.current.onAnnounce(g);
    }
    wasHolding.current = hold;
  }, [hold]);
}

interface Toast {
  readonly id: number;
  readonly text: string;
}

export interface RewardToastListenerProps {
  readonly controller?: RewardsController;
  readonly texts?: RewardsTexts;
  readonly children?: ReactNode;
  /** Queue grants until `controller.celebrateNow()`. Default false: announce at once. */
  readonly holdUntilMoment?: boolean;
  /** Show surprise / mystery / range grants in the reveal dialog, one at a time. Default true. */
  readonly revealSurprises?: boolean;
  /** Replaces the toast and the reveal. */
  readonly onGrant?: (grant: RewardGrant) => void;
  /** How long a toast stays. Default 4000 ms. */
  readonly toastMs?: number;
}

/**
 * Wraps your screen and announces each new grant once: a toast ("You got 20 coins", a polite live region) by
 * default, or your [onGrant]. With [holdUntilMoment] grants wait for `controller.celebrateNow()`, so a reward never
 * interrupts reading or a quiz question. With [revealSurprises] a grant whose `shouldReveal` is true opens the reveal
 * dialog instead, one after the other.
 */
export function RewardToastListener(props: RewardToastListenerProps): ReactNode {
  const c = useRewardsController(props.controller);
  const texts = useRewardsTexts(props.texts);
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const [reveals, setReveals] = useState<readonly RewardGrant[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const set = timers.current;
    return () => {
      for (const t of set) clearTimeout(t);
      set.clear();
    };
  }, []);
  const dismiss = (id: number): void => setToasts((list) => list.filter((t) => t.id !== id));
  useGrantQueue(c, {
    holdUntilMoment: props.holdUntilMoment ?? false,
    onAnnounce: (g) => {
      if (props.onGrant) return props.onGrant(g);
      if ((props.revealSurprises ?? true) && g.shouldReveal) {
        setReveals((list) => [...list, g]);
        return;
      }
      const id = ++seq.current;
      setToasts((list) => [...list, { id, text: texts.gotReward(texts.reward(g.spec)) }]);
      const t = setTimeout(() => {
        timers.current.delete(t);
        dismiss(id);
      }, props.toastMs ?? 4000);
      timers.current.add(t);
    },
  });
  const current = reveals[0];
  return (
    <>
      {props.children}
      <div className="rk rk-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="rk-toast">
            <Icon name="gift" size={18} />
            <span className="rk-grow">{t.text}</span>
            <button type="button" className="rk-button rk-button--text rk-toast__close" aria-label={texts.reveal.close} onClick={() => dismiss(t.id)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
      {current ? (
        <RewardRevealDialog
          key={current.id}
          grant={current}
          texts={texts}
          onEvent={(e) => c.client.report(e)}
          onClose={() => setReveals((list) => list.slice(1))}
        />
      ) : null}
    </>
  );
}

