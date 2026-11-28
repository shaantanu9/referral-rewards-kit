'use client';
import { formatPercent, type MysteryOdd, type RewardSpec, type SurpriseOdd } from '@myind/rewards-core';
import type { ReactNode } from 'react';
import { RewardsListener } from './base';
import { useRewardsTexts } from './context';
import { Icon } from './icons';
import { Card, cx, type BaseProps } from './internal';

export interface MysteryOddsProps extends Omit<BaseProps, 'controller'> {
  readonly reward: RewardSpec;
  /** Your own look. Each odd's `chance` is 0..1; `formatPercent` gives the default text. */
  readonly render?: (odds: readonly MysteryOdd[]) => ReactNode;
}

/**
 * What a `mystery` reward can turn into, each chance as a percentage. Stating the odds before it is earned is
 * required honesty (app store loot-box rules). Nothing when the reward carries no odds.
 */
export function MysteryOdds(props: MysteryOddsProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const odds = props.reward.odds;
  if (odds.length === 0) return null;
  if (props.render) return <>{props.render(odds)}</>;
  return (
    <div className={cx('rk', 'rk-mystery-odds', props.className)} style={props.style}>
      <p className="rk-muted">{texts.programs.oddsTitle}</p>
      <ul className="rk-list">
        {odds.map((o, i) => (
          <li key={i} className="rk-row">
            <span className="rk-mystery-odds__chance">{formatPercent(o.chance)}</span>
            <span className="rk-muted">{texts.reward(o.spec)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface SurpriseOddsProps extends BaseProps {
  /** Only this program's surprises; default all. */
  readonly program?: string | null;
  /** The heading; default `texts.reveal.oddsTitle` ("Surprises"). */
  readonly title?: string;
  /** Your own look. `texts.surpriseOdds(s)` gives the default line. */
  readonly render?: (surprises: readonly SurpriseOdd[]) => ReactNode;
}

/**
 * The odds of every surprise reward ("1 in 10 chance of 5–50 coins"). Nothing when there are none, or while the user
 * switched surprises off (0.7): no surprise is drawn for them, so there are no odds to show.
 */
export function SurpriseOdds(props: SurpriseOddsProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  return (
    <RewardsListener
      controller={props.controller}
      render={({ state }) => {
        const list = props.program == null ? state.surprises : state.surprisesOf(props.program);
        if (list.length === 0 || state.choices.surprisesOff) return null;
        if (props.render) return props.render(list);
        const title = props.title ?? texts.reveal.oddsTitle;
        return (
          <Card name="rk-surprise-odds" className={props.className} style={props.style} label={title}>
            <h3 className="rk-title">{title}</h3>
            <ul className="rk-list">
              {list.map((s, i) => (
                <li key={i} className="rk-row">
                  <Icon name="gift" size={18} className="rk-accent" />
                  <span className="rk-muted">{texts.surpriseOdds(s)}</span>
                </li>
              ))}
            </ul>
          </Card>
        );
      }}
    />
  );
}
