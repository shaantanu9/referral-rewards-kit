'use client';
import type { MilestoneState, RewardsController, RewardsState, StreakState } from '@myind/rewards-core';
import type { ReactNode } from 'react';
import { RewardsListener } from './base';
import { useRewardsTexts } from './context';
import { Countdown } from './countdown';
import { Icon } from './icons';
import { Card, cx, ProgressBar, publicString, type BaseProps } from './internal';
import { MysteryOdds } from './odds';

const HOUR = 3600 * 1000;

/** The streak of [program], or the first streak; null when none. */
function streakOf(state: RewardsState, program: string | null | undefined): StreakState | null {
  return program == null ? (state.streaks[0] ?? null) : state.streak(program);
}

export interface StreakCardProps extends BaseProps {
  /** The streak program key; default the first streak. */
  readonly program?: string | null;
  /** When the today-countdown turns to the warning colour. Default 4 h. */
  readonly atRiskWithinMs?: number;
  /** Your own look for the whole card. */
  readonly render?: (streak: StreakState, controller: RewardsController) => ReactNode;
}

/**
 * A daily streak: days in a row, best, freezes, and the next reward. When today is not done it shows the real time
 * left today (from the server), in the warning colour once [atRiskWithinMs] is reached.
 *
 * 0.7: nothing while the streak is `hidden` or streaks are switched off; no countdown while timers are off; the
 * repair offer of a broken streak, "is back" the day it came back, and a "New personal best" chip on a record day.
 * While surprises are off a mystery or range reward is named by what it will really give.
 */
export function StreakCard(props: StreakCardProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  return (
    <RewardsListener
      controller={props.controller}
      render={({ state }, c) => {
        const s = streakOf(state, props.program);
        if (s == null || s.hidden || state.choices.streaksOff) return null;
        if (props.render) return props.render(s, c);
        const choices = state.choices;
        const now = c.clock.now();
        const risk = s.atRisk(now, props.atRiskWithinMs ?? 4 * HOUR);
        const next = choices.surprisesOff ? (s.nextReward?.fixed ?? null) : s.nextReward;
        const left = s.daysToNextReward;
        const repair = s.repair;
        const x = texts.fairPlay;
        return (
          <Card name="rk-streak" className={props.className} style={props.style} label={texts.streakDays(s.current)}>
            <div className="rk-row">
              <Icon name="fire" size={32} className={risk ? 'rk-warning' : 'rk-accent'} />
              <span className="rk-number">{texts.streakDays(s.current)}</span>
              {s.recordToday && s.bestDayCount > 0 ? <span className="rk-chip rk-chip--success">{x.personalBest(s.bestDayCount)}</span> : null}
            </div>
            {repair != null && repair.left > 0 ? (
              <>
                <p className="rk-accent-text">{x.repair(repair.left, repair.restoresTo)}</p>
                <Countdown endsAt={repair.until} clock={c.clock} prefix={x.repairEndsIn} className="rk-muted" hidden={choices.timersOff} />
              </>
            ) : s.repairedRecently(now) ? (
              <p className="rk-success">{x.streakBack(s.current)}</p>
            ) : null}
            {s.todayDone ? (
              <p className="rk-success">
                <Icon name="check" size={16} /> {texts.streakDoneToday}
              </p>
            ) : risk && choices.timersOff ? (
              <p className="rk-warning">{texts.streakDoToday}</p>
            ) : risk ? (
              <Countdown endsAt={s.endsTodayAt} clock={c.clock} prefix={texts.streakAtRisk} className="rk-warning rk-block" />
            ) : (
              <p className="rk-muted">{texts.streakDoToday}</p>
            )}
            <p className="rk-muted">{`${texts.streakLongest}: ${s.longest}  ·  ${texts.streakFreezes}: ${s.freezes}`}</p>
            {next != null && left != null ? (
              <>
                <p>{texts.nextIn(texts.reward(next), left)}</p>
                {next.isMystery ? <MysteryOdds reward={next} texts={texts} /> : null}
              </>
            ) : null}
          </Card>
        );
      }}
    />
  );
}

export interface DailyGoalRingProps extends BaseProps {
  /** The streak program; default the first streak. */
  readonly program?: string | null;
  /** Diameter in px. Default 56. */
  readonly size?: number;
  /** Ring width in px. Default 6. */
  readonly strokeWidth?: number;
  readonly render?: (streak: StreakState) => ReactNode;
}

/**
 * Today's progress towards a streak's daily goal ("1/2"), a check once the day counts. Nothing while the streak is
 * `hidden` or streaks are switched off (0.7).
 */
export function DailyGoalRing(props: DailyGoalRingProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  return (
    <RewardsListener
      controller={props.controller}
      render={({ state }) => {
        const s = streakOf(state, props.program);
        if (s == null || s.hidden || state.choices.streaksOff) return null;
        if (props.render) return props.render(s);
        const x = texts.programs;
        const size = props.size ?? 56;
        const w = props.strokeWidth ?? 6;
        const r = (size - w) / 2;
        const circ = 2 * Math.PI * r;
        const label = s.todayDone ? x.goalDone : x.goal(s.todayCount, s.dailyGoal);
        return (
          <div
            className={cx('rk', 'rk-ring', s.todayDone && 'rk-ring--done', props.className)}
            style={{ width: size, height: size, ...props.style }}
            role="img"
            aria-label={label}
          >
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
              <circle className="rk-ring__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={w} fill="none" />
              <circle
                className="rk-ring__value"
                cx={size / 2}
                cy={size / 2}
                r={r}
                strokeWidth={w}
                fill="none"
                strokeDasharray={circ}
                strokeDashoffset={circ * (1 - s.goalProgress)}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                strokeLinecap="round"
              />
            </svg>
            <span className="rk-ring__label" aria-hidden="true">
              {s.todayDone ? <Icon name="check" size={Math.round(size * 0.45)} /> : x.goal(s.todayCount, s.dailyGoal)}
            </span>
          </div>
        );
      }}
    />
  );
}

export interface MilestoneProgressProps extends BaseProps {
  readonly program: string;
  /** The app's own title ("Invite 3 friends"); none by default. */
  readonly title?: string | null;
  /** Why the user got a head start; default the program's `public.head_start_label`. */
  readonly headStartLabel?: string | null;
  readonly render?: (milestone: MilestoneState, controller: RewardsController) => ReactNode;
}

/**
 * Progress towards a milestone's next reward ("3 of 5 · 100 coins"), or "All rewards earned". 0.7: the head start
 * and the level ("Level 3 · Explorer", "4 of 6 to the next level"); with surprises off, a mystery or range reward is
 * named by what it will really give.
 */
export function MilestoneProgress(props: MilestoneProgressProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  return (
    <RewardsListener
      controller={props.controller}
      render={({ state }, c) => {
        const m = state.milestone(props.program);
        if (m == null) return null;
        if (props.render) return props.render(m, c);
        const next = state.choices.surprisesOff ? (m.nextReward?.fixed ?? null) : m.nextReward;
        const x = texts.fairPlay;
        const level = m.level;
        const label = props.headStartLabel ?? publicString(state.program(props.program)?.public['head_start_label']);
        const line = next == null || m.target == null ? texts.allEarned : `${texts.progress(m.count, m.target)}  ·  ${texts.reward(next)}`;
        return (
          <Card name="rk-milestone" className={props.className} style={props.style} label={props.title ?? undefined}>
            {props.title ? <h3 className="rk-title">{props.title}</h3> : null}
            {level != null ? (
              <div className="rk-milestone__level">
                <p>{x.level(level.number, level.name)}</p>
                {level.nextAt != null ? <p className="rk-muted">{x.toNextLevel(m.count, level.nextAt)}</p> : null}
              </div>
            ) : null}
            <ProgressBar value={m.progress} label={line} />
            <p className="rk-muted">{line}</p>
            {m.headStart > 0 ? <p className="rk-muted">{x.headStart(m.headStart, label)}</p> : null}
            {next != null && next.isMystery ? <MysteryOdds reward={next} texts={texts} /> : null}
          </Card>
        );
      }}
    />
  );
}
