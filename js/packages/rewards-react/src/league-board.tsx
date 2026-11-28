'use client';
import { LeagueTierChange, type LeagueMember, type LeagueState, type RewardsController } from '@myind/rewards-core';
import { useEffect, type ReactNode } from 'react';
import { RewardsListener } from './base';
import { useRewardsController, useRewardsTexts } from './context';
import { Countdown } from './countdown';
import { Icon } from './icons';
import { Card, cx, publicString, type BaseProps } from './internal';
import { useAction } from './programs';

/** The first [max] rows, plus the user's own row when it is further down. */
export function leagueRows(all: readonly LeagueMember[], max: number | null | undefined): readonly LeagueMember[] {
  if (max == null || all.length <= max) return all;
  const top = all.slice(0, max);
  if (!top.some((m) => m.me)) {
    const me = all.slice(max).find((m) => m.me);
    if (me) return [...top, me];
  }
  return top;
}

export interface LeagueBoardProps extends BaseProps {
  readonly program: string;
  /** Default the program's `public.title`, else "Weekly league". */
  readonly title?: string | null;
  /** At most this many rows (the user's own row is always shown). Default the whole group. */
  readonly maxRows?: number | null;
  /** Your own look; use the controller's `joinLeague`, `leaveLeague`, `loadLeague`. */
  readonly render?: (league: LeagueState, controller: RewardsController) => ReactNode;
}

/**
 * An opt-in weekly league (ADR 0002 §18.10). Before joining: what it is, what is shared, and Join. After: the tier,
 * the real time left in the week, the board (display names and points only; the user's own row marked in bold and
 * "(You)"), who moves up, what each place pays, last week's own result, and Leave. Nothing marks who moves down.
 * Loads `rewards_league` itself on mount.
 */
export function LeagueBoard(props: LeagueBoardProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const c = useRewardsController(props.controller);
  const act = useAction();
  useEffect(() => {
    if (c.league(props.program) == null) void c.loadLeague(props.program);
  }, [c, props.program]);
  return (
    <RewardsListener
      controller={c}
      render={({ state }) => {
        const l = c.league(props.program);
        if (l == null) return null;
        if (props.render) return props.render(l, c);
        const x = texts.leagues;
        const title = props.title ?? publicString(state.program(props.program)?.public['title']) ?? x.title;
        const rows = leagueRows(l.members, props.maxRows);
        return (
          <Card name="rk-league" className={props.className} style={props.style} label={title}>
            <div className="rk-row rk-row--spread">
              <h3 className="rk-title">{title}</h3>
              {l.joined && l.tierName != null ? (
                <span className="rk-chip">
                  <Icon name="trophy" size={18} className="rk-accent" /> {l.tierName}
                </span>
              ) : null}
            </div>
            {!l.live ? (
              <p className="rk-muted">{x.notLive}</p>
            ) : !l.joined ? (
              <>
                <p>{x.pitch(l.groupSize)}</p>
                <button type="button" className="rk-button" disabled={act.busy} onClick={() => void act.run(() => c.joinLeague(props.program))}>
                  <Icon name="groupAdd" size={18} /> {x.join}
                </button>
              </>
            ) : (
              <>
                <Countdown endsAt={l.endsAt} clock={c.clock} prefix={x.weekEndsIn} className="rk-muted rk-block" hidden={state.choices.timersOff} />
                {l.lastWeek != null ? (
                  <>
                    <p className="rk-muted">{x.lastWeek(l.lastWeek.rank, l.lastWeek.score)}</p>
                    {l.lastWeek.tierChange === LeagueTierChange.up ? <p className="rk-success">{x.movedUp(l.tierName)}</p> : null}
                  </>
                ) : null}
                <ol className="rk-list rk-league__board">
                  {rows.map((m, i) => {
                    const name = m.name ?? (m.me ? x.you : x.member);
                    return (
                      <li key={i} className={cx('rk-row', 'rk-league__row', m.me && 'rk-league__row--me')} aria-current={m.me ? 'true' : undefined}>
                        <span className="rk-league__place">{m.rank == null ? '–' : x.place(m.rank)}</span>
                        <span className="rk-grow rk-ellipsis">{m.me && m.name != null ? `${name} (${x.you})` : name}</span>
                        <span>{x.points(m.score)}</span>
                      </li>
                    );
                  })}
                </ol>
                {l.canMoveUp ? <p className="rk-muted">{x.movesUp(l.promote, l.nextTierName)}</p> : null}
              </>
            )}
            {l.live && l.rewards.length > 0 ? (
              <ul className="rk-list">
                {l.rewards.map((r, i) =>
                  r.threshold != null ? (
                    <li key={i} className="rk-muted">
                      {x.placeReward(r.threshold, texts.reward(r))}
                    </li>
                  ) : null,
                )}
              </ul>
            ) : null}
            {l.joined ? (
              <div className="rk-row rk-row--end">
                <button type="button" className="rk-button rk-button--text" disabled={act.busy} onClick={() => void act.run(() => c.leaveLeague(props.program))}>
                  {x.leave}
                </button>
              </div>
            ) : null}
            {act.reason != null ? <p className="rk-warning" role="alert">{texts.error(act.reason)}</p> : null}
          </Card>
        );
      }}
    />
  );
}
