'use client';
import {
  formatLeft,
  type FriendStreakState,
  type HistoryDay,
  type QuestState,
  type RechargeState,
  type RewardsController,
  type StreakHistory,
  type WindowState,
} from '@myind/rewards-core';
import { useEffect, useState, type ReactNode } from 'react';
import { RewardsListener } from './base';
import { useRewardsController, useRewardsTexts } from './context';
import { Countdown } from './countdown';
import { Icon } from './icons';
import { Card, cx, ProgressBar, publicString, type BaseProps } from './internal';

/** Runs one controller action at a time and keeps its refusal reason (the Flutter widgets' `_busy` / `_reason`). */
export function useAction(): {
  busy: boolean;
  reason: string | null;
  run: (action: () => Promise<string | null>, onOk?: () => void) => Promise<string | null>;
} {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const run = async (action: () => Promise<string | null>, onOk?: () => void): Promise<string | null> => {
    if (busy) return null;
    setBusy(true);
    const r = await action();
    setBusy(false);
    setReason(r);
    if (r == null) onOk?.();
    return r;
  };
  return { busy, reason, run };
}

// ---- QuestList ----

export interface QuestListProps extends BaseProps {
  readonly program: string;
  /** Default `texts.programs.questsTitle`. */
  readonly title?: string | null;
  readonly render?: (quest: QuestState, controller: RewardsController) => ReactNode;
}

/**
 * A quest set: each task with its progress and reward, the bonus for finishing all, and the real time until the set
 * resets (hidden while timers are off). Task names come from `texts.programs.questTask`.
 */
export function QuestList(props: QuestListProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  return (
    <RewardsListener
      controller={props.controller}
      render={({ state }, c) => {
        const q = state.quest(props.program);
        if (q == null) return null;
        if (props.render) return props.render(q, c);
        const x = texts.programs;
        const title = props.title ?? x.questsTitle;
        return (
          <Card name="rk-quests" className={props.className} style={props.style} label={title}>
            <div className="rk-row rk-row--spread">
              <h3 className="rk-title">{title}</h3>
              <Countdown
                endsAt={q.endsAt}
                clock={c.clock}
                prefix={x.questResetsIn}
                hidden={state.choices.timersOff}
                className="rk-muted"
                onExpired={() => void c.refresh()}
              />
            </div>
            <ul className="rk-list">
              {q.tasks.map((task) => (
                <li key={task.key} className={cx('rk-row', 'rk-quest', task.done && 'rk-quest--done')}>
                  <Icon name={task.done ? 'checkCircle' : 'circle'} size={20} className={task.done ? 'rk-success' : 'rk-muted'} />
                  <div className="rk-grow">
                    <span>{x.questTask(task)}</span>
                    {task.done ? <span className="rk-sr-only"> ({x.questDone})</span> : null}
                    {!task.done && task.count > 1 ? <ProgressBar value={task.fraction} label={texts.progress(task.progress, task.count)} /> : null}
                  </div>
                  <span className="rk-muted">{task.rewards.length === 0 ? texts.progress(task.progress, task.count) : texts.rewards(task.rewards)}</span>
                </li>
              ))}
            </ul>
            {q.done ? <p className="rk-success">{x.questDone}</p> : q.bonus.length > 0 ? <p>{x.questBonus(texts.rewards(q.bonus))}</p> : null}
          </Card>
        );
      }}
    />
  );
}

// ---- RechargeMeter ----

export interface RechargeMeterProps extends BaseProps {
  readonly program: string;
  /** A filled unit. Default a filled heart. */
  readonly icon?: ReactNode;
  /** An empty unit. Default a heart outline. */
  readonly emptyIcon?: ReactNode;
  /** Shows a "Use one" button (`useRecharge`). Default false: apps usually spend units in their own flow. */
  readonly showUseButton?: boolean;
  /** Your own look. `use` spends one unit and resolves to null or a reason (`empty`). */
  readonly render?: (recharge: RechargeState, use: () => Promise<string | null>) => ReactNode;
}

/**
 * Units that refill ("3 hearts"): filled and empty icons and the real time until the next one comes back. At that
 * time the state is reloaded from the server (the device never adds a unit itself).
 */
export function RechargeMeter(props: RechargeMeterProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const c = useRewardsController(props.controller);
  const act = useAction();
  const use = (): Promise<string | null> => act.run(() => c.useRecharge(props.program));
  return (
    <RewardsListener
      controller={c}
      render={({ state }) => {
        const r = state.recharge(props.program);
        if (r == null) return null;
        if (props.render) return props.render(r, use);
        const x = texts.programs;
        const units = Array.from({ length: Math.max(0, r.max) }, (_, i) => i < r.units);
        return (
          <Card name="rk-recharge" className={props.className} style={props.style}>
            <div className="rk-row">
              <span className="rk-row rk-recharge__units" role="img" aria-label={texts.progress(r.units, r.max)}>
                {units.map((full, i) => (
                  <span key={i} className={full ? 'rk-accent' : 'rk-muted'} data-full={full}>
                    {full ? (props.icon ?? <Icon name="heart" filled />) : (props.emptyIcon ?? <Icon name="heart" />)}
                  </span>
                ))}
              </span>
              <span className="rk-grow rk-muted">
                {r.full || r.nextAt == null ? (
                  x.rechargeFull
                ) : (
                  <Countdown endsAt={r.nextAt} clock={c.clock} prefix={x.rechargeNextIn} onExpired={() => void c.refresh()} />
                )}
              </span>
            </div>
            {act.reason != null ? <p className="rk-warning" role="alert">{texts.error(act.reason)}</p> : null}
            {props.showUseButton ? (
              <button type="button" className="rk-button rk-button--outlined" disabled={act.busy || r.empty} onClick={() => void use()}>
                {x.rechargeUse}
              </button>
            ) : null}
          </Card>
        );
      }}
    />
  );
}

// ---- WindowBadge ----

export interface WindowBadgeProps extends BaseProps {
  readonly program: string;
  /** Default the program's `public.title`, else `texts.programs.windowTitle`. */
  readonly title?: string | null;
  /** Your own look; `open` is whether the window is open now (server clock). */
  readonly render?: (window: WindowState, open: boolean) => ReactNode;
}

/**
 * A time window: "Happy hour: ends in 49m 59s" while open, "starts in 2h 00m" before. At either edge the state is
 * reloaded. With timers off an open window shows only its name and a coming one shows nothing.
 */
export function WindowBadge(props: WindowBadgeProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const c = useRewardsController(props.controller);
  const [, setEdge] = useState(0);
  const edge = (): void => {
    setEdge((n) => n + 1);
    void c.refresh();
  };
  return (
    <RewardsListener
      controller={c}
      render={({ state }) => {
        const w = state.window(props.program);
        if (w == null) return null;
        const open = w.activeAt(c.clock.now());
        if (props.render) return props.render(w, open);
        const x = texts.programs;
        const name = props.title ?? publicString(state.program(props.program)?.public['title']) ?? x.windowTitle;
        const deadline = open ? w.endsAt : w.startsAt;
        if (deadline == null) return null;
        const noTimer = state.choices.timersOff;
        if (noTimer && !open) return <Countdown endsAt={deadline} clock={c.clock} onExpired={edge} hidden />;
        return (
          <span className={cx('rk', 'rk-badge', open ? 'rk-badge--open' : 'rk-badge--soon', props.className)} style={props.style}>
            <Icon name={open ? 'bolt' : 'schedule'} size={18} />
            <Countdown
              endsAt={deadline}
              clock={c.clock}
              onExpired={edge}
              render={(left) => (
                <span role={noTimer ? undefined : 'timer'}>{noTimer ? name : `${name}: ${open ? x.windowEndsIn : x.windowStartsIn} ${formatLeft(left)}`}</span>
              )}
            />
          </span>
        );
      }}
    />
  );
}

// ---- FriendStreaks ----

export interface FriendStreaksProps extends BaseProps {
  readonly program: string;
  readonly title?: string | null;
  /** Shares the invite code the app's way (e.g. `navigator.share`). Without it the code is shown to copy. */
  readonly onShareInvite?: (code: string) => void;
  /** Your own look; use the controller's `friendInvite`, `invite`, `friendAccept`, `friendRemove`. */
  readonly render?: (friends: readonly FriendStreakState[], controller: RewardsController) => ReactNode;
}

/**
 * Streaks kept with friends: each friend's days together and who still has to act today; invite (the code goes to
 * [onShareInvite]), accept a friend's code, end a streak.
 */
export function FriendStreaks(props: FriendStreaksProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const c = useRewardsController(props.controller);
  const act = useAction();
  const [code, setCode] = useState('');
  const invite = (): void => {
    void act.run(
      () => c.friendInvite(props.program),
      () => {
        const made = c.invite(props.program)?.code;
        if (made != null) props.onShareInvite?.(made);
      },
    );
  };
  const accept = (): void => {
    void act.run(() => c.friendAccept(code), () => setCode(''));
  };
  return (
    <RewardsListener
      controller={c}
      render={({ state }) => {
        const friends = state.friendsOf(props.program);
        if (props.render) return props.render(friends, c);
        const x = texts.programs;
        const made = c.invite(props.program);
        const title = props.title ?? x.friendsTitle;
        const inputId = `rk-friend-code-${props.program}`;
        return (
          <Card name="rk-friends" className={props.className} style={props.style} label={title}>
            <h3 className="rk-title">{title}</h3>
            {friends.length === 0 ? <p className="rk-muted">{x.friendsEmpty}</p> : null}
            <ul className="rk-list">
              {friends.map((f) => (
                <li key={f.pairId} className="rk-row">
                  <Icon name="fire" className={f.todayBoth ? 'rk-accent' : 'rk-muted'} />
                  <div className="rk-grow">
                    <p>{`${f.friendName}  ·  ${x.friendDays(f.current)}`}</p>
                    <p className="rk-muted">{f.todayBoth ? x.friendBothDone : f.todayMe ? x.friendWaiting(f.friendName) : x.friendYourTurn}</p>
                  </div>
                  <button type="button" className="rk-button rk-button--text" disabled={act.busy} onClick={() => void act.run(() => c.friendRemove(f.pairId))}>
                    {x.friendRemove}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="rk-button" disabled={act.busy} onClick={invite}>
              <Icon name="personAdd" size={18} /> {x.friendInvite}
            </button>
            {made != null && props.onShareInvite == null ? (
              <output className="rk-code" aria-label={x.friendCodeLabel}>
                {made.code}
              </output>
            ) : null}
            <div className="rk-row">
              <label className="rk-field rk-grow" htmlFor={inputId}>
                <span className="rk-field__label">{x.friendCodeLabel}</span>
                <input
                  id={inputId}
                  className="rk-input"
                  value={code}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
              <button type="button" className="rk-button rk-button--outlined" disabled={act.busy} onClick={accept}>
                {x.friendAccept}
              </button>
            </div>
            {act.reason != null ? <p className="rk-warning" role="alert">{texts.error(act.reason)}</p> : null}
          </Card>
        );
      }}
    />
  );
}

// ---- ActivityHeatmap ----

export interface ActivityHeatmapProps extends BaseProps {
  /** The streak program; default the first streak. */
  readonly program?: string | null;
  /** Weeks loaded. Default 15. */
  readonly weeks?: number;
  /** Cell size in px. Default 12. */
  readonly cellSize?: number;
  /** Gap in px. Default 3. */
  readonly gap?: number;
  readonly showLegend?: boolean;
  /** Your own cell; `level` is 0..4. */
  readonly renderCell?: (day: HistoryDay, level: number, isToday: boolean) => ReactNode;
  /** Your own look for the whole map. */
  readonly render?: (history: StreakHistory) => ReactNode;
}

const weekdayMon0 = (d: Date): number => (d.getUTCDay() + 6) % 7;

/**
 * A streak's history as a weeks × 7 grid (Monday on top), oldest week on the left, today outlined. Five levels by
 * the day's count against the daily goal; days saved by a freeze are striped. Loads `rewards_history` itself on
 * mount (once per controller); a track updates today. Every cell names its day and count for screen readers.
 */
export function ActivityHeatmap(props: ActivityHeatmapProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const c = useRewardsController(props.controller);
  const program = props.program ?? null;
  const weeks = props.weeks ?? 15;
  useEffect(() => {
    if (c.history(program) == null) void c.loadHistory({ program, weeks });
  }, [c, program, weeks]);
  return (
    <RewardsListener
      controller={c}
      render={() => {
        const h = c.history(program);
        if (h == null || h.days.length === 0) return null;
        if (props.render) return props.render(h);
        const x = texts.programs;
        const size = props.cellSize ?? 12;
        const gap = props.gap ?? 3;
        const offset = weekdayMon0(h.days[0]!.day);
        const columns = Math.ceil((offset + h.days.length) / 7);
        const cells: ReactNode[] = [];
        for (let col = 0; col < columns; col++) {
          for (let row = 0; row < 7; row++) {
            const i = col * 7 + row - offset;
            const day = i >= 0 && i < h.days.length ? h.days[i]! : null;
            const key = `${col}-${row}`;
            if (day == null) {
              cells.push(<span key={key} className="rk-heat__cell rk-heat__cell--blank" aria-hidden="true" />);
              continue;
            }
            const level = h.levelOf(day.count);
            const today = i === h.days.length - 1;
            const label = `${day.dayKey}: ${day.count}${day.frozen ? ' (freeze)' : ''}`;
            cells.push(
              props.renderCell ? (
                <span key={key} className="rk-heat__slot" role="img" aria-label={label}>
                  {props.renderCell(day, level, today)}
                </span>
              ) : (
                <span
                  key={key}
                  role="img"
                  aria-label={label}
                  title={label}
                  className={cx('rk-heat__cell', `rk-heat__cell--l${level}`, today && 'rk-heat__cell--today', day.frozen && 'rk-heat__cell--frozen')}
                  data-level={level}
                />
              ),
            );
          }
        }
        return (
          <div className={cx('rk', 'rk-heat', props.className)} style={{ ['--rk-cell' as string]: `${size}px`, ['--rk-gap' as string]: `${gap}px`, ...props.style }}>
            <div className="rk-heat__scroll">
              <div className="rk-heat__grid" role="group" data-columns={columns}>
                {cells}
              </div>
            </div>
            {props.showLegend ?? true ? (
              <div className="rk-heat__legend" aria-hidden="true">
                <span className="rk-small rk-muted">{x.heatmapLess}</span>
                {[0, 1, 2, 3, 4].map((l) => (
                  <span key={l} className={cx('rk-heat__cell', `rk-heat__cell--l${l}`)} />
                ))}
                <span className="rk-small rk-muted">{x.heatmapMore}</span>
              </div>
            ) : null}
          </div>
        );
      }}
    />
  );
}
