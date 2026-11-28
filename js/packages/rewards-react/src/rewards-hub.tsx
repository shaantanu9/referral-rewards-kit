'use client';
import { ProgramKind, type ProgramInfo } from '@myind/rewards-core';
import type { ReactNode } from 'react';
import { RewardsListener } from './base';
import { useRewardsController, useRewardsTexts } from './context';
import { RewardInbox } from './inbox';
import { cx, publicString, type BaseProps } from './internal';
import { LeagueBoard } from './league-board';
import { AttributionShownContext, ScreenAttribution } from './myind-attribution';
import { SurpriseOdds } from './odds';
import { FriendStreaks, QuestList, RechargeMeter, WindowBadge } from './programs';
import { MilestoneProgress, StreakCard } from './progress';
import { QuizCard, type QuizMediaProps } from './quiz';
import { OfferBanner, SocialTagTask } from './tasks';

export interface RewardsHubProps extends BaseProps, QuizMediaProps {
  /** Replace one program's component (`{ daily: (p) => <MyStreak /> }`), or hide it by returning null. */
  readonly programRenderers?: Readonly<Record<string, (program: ProgramInfo) => ReactNode>>;
  readonly onOpenInstagram?: (account: string) => void;
  /** Shares a friend-streak invite code (`FriendStreaks.onShareInvite`). */
  readonly onShareInvite?: (code: string) => void;
  /** Opens a quiz the app's way; default a `QuizScreen` in a dialog (`QuizCard.onOpen`). */
  readonly onOpenQuiz?: (program: string) => void;
  /** Above the inbox. */
  readonly header?: ReactNode;
  /** The "Surprises" odds card under the inbox. Default true. */
  readonly showSurprises?: boolean;
  /** The small "Rewards by Myind" link at the bottom. Free to turn off: false hides it. Default true. */
  readonly showAttribution?: boolean;
  /** Which link text; default 1, "Rewards by Myind". */
  readonly attributionVariant?: number;
  /** Gap between the cards in px. Default 12. */
  readonly spacing?: number;
}

/**
 * Every live program on one screen, in the server's order: inbox first, then each program's default component.
 * Titles come from the program's `public.title`. When the state has surprise rules one "Surprises" card with every
 * odds line sits right under the inbox, so the odds are seen before anything is earned (not while the user switched
 * surprises off). The attribution link sits at the bottom, once.
 */
export function RewardsHub(props: RewardsHubProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const c = useRewardsController(props.controller);
  const media: QuizMediaProps = {
    ...(props.onPlaySound ? { onPlaySound: props.onPlaySound } : {}),
    ...(props.renderImage ? { renderImage: props.renderImage } : {}),
  };
  const program = (p: ProgramInfo): ReactNode => {
    const custom = props.programRenderers?.[p.key];
    if (custom) return custom(p);
    const title = publicString(p.public['title']);
    const common = { controller: c, texts, program: p.key } as const;
    switch (p.kind) {
      case ProgramKind.streak:
        return <StreakCard {...common} />;
      case ProgramKind.milestone:
        return <MilestoneProgress {...common} title={title} />;
      case ProgramKind.offer:
        return <OfferBanner {...common} title={title} />;
      case ProgramKind.socialTag:
        return <SocialTagTask {...common} {...(props.onOpenInstagram ? { onOpenInstagram: props.onOpenInstagram } : {})} />;
      case ProgramKind.quiz:
        return <QuizCard {...common} title={title} {...(props.onOpenQuiz ? { onOpen: props.onOpenQuiz } : {})} {...media} />;
      case ProgramKind.questSet:
        return <QuestList {...common} title={title} />;
      case ProgramKind.recharge:
        return <RechargeMeter {...common} />;
      case ProgramKind.window:
        return (
          <div className="rk-hub__start">
            <WindowBadge {...common} title={title} />
          </div>
        );
      case ProgramKind.friendStreak:
        return <FriendStreaks {...common} title={title} {...(props.onShareInvite ? { onShareInvite: props.onShareInvite } : {})} />;
      case ProgramKind.league:
        return <LeagueBoard {...common} title={title} />;
      default:
        // A comeback reward has nothing to show before it is earned; it lands in the inbox.
        return null;
    }
  };
  return (
    <RewardsListener
      controller={c}
      render={({ state }) => (
        <div className={cx('rk', 'rk-hub', props.className)} style={{ ...(props.spacing != null ? { gap: props.spacing } : {}), ...props.style }}>
          <AttributionShownContext.Provider value={true}>
            {props.header ?? null}
            <RewardInbox controller={c} texts={texts} />
            {(props.showSurprises ?? true) && state.surprises.length > 0 && !state.choices.surprisesOff ? <SurpriseOdds controller={c} texts={texts} /> : null}
            {state.programs.map((p) => (
              <div key={p.key} className="rk-hub__program" data-program={p.key}>
                {program(p)}
              </div>
            ))}
          </AttributionShownContext.Provider>
          <ScreenAttribution show={props.showAttribution ?? true} variant={props.attributionVariant ?? 1} />
        </div>
      )}
    />
  );
}
