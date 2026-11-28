import { useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ProgramKind, type ProgramInfo, type RewardsController, type RewardsTexts } from '@myind/rewards-core';
import { useRewardsKit } from '../context';
import { RewardsListener } from './base';
import { MyindAttribution } from './MyindAttribution';
import { OfferBanner, QuestList, RechargeMeter, RewardInbox, SurpriseOdds, WindowBadge } from './programs';
import { MilestoneProgress, StreakCard } from './progress';
import { QuizCard, type QuizImageRender } from './quiz';
import { FriendStreaks, LeagueBoard, SocialTagTask } from './social';

export interface RewardsHubProps {
  controller: RewardsController;
  texts?: RewardsTexts;
  /** Replace any program's component: `{ daily: (p) => <MyStreak /> }`; return null to hide one. */
  programRenderers?: Readonly<Record<string, (program: ProgramInfo) => ReactNode>>;
  onOpenInstagram?: (account: string) => void;
  /** Shares a friend-streak invite code (`FriendStreaks.onShareInvite`). */
  onShareInvite?: (code: string) => void;
  /** Opens a quiz the app's way; default a full-screen `QuizScreen` (`QuizCard.onOpen`). */
  onOpenQuiz?: (program: string) => void;
  onPlaySound?: (soundId: string) => void;
  renderImage?: QuizImageRender;
  /** False inside a list that already scrolls. Default true (with pull to refresh). */
  scrollable?: boolean;
  /** Space between the parts. Default 12. */
  spacing?: number;
  header?: ReactNode;
  /** The "Surprises" odds card under the inbox. Default true. */
  showSurprises?: boolean;
  /** The small "Rewards by Myind" link at the bottom. Free to turn off. Default true. */
  showAttribution?: boolean;
  /** Which link text. Default 1, "Rewards by Myind". */
  attributionVariant?: number;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/**
 * Every live program on one screen, in the server's order: inbox first, then each program's default component.
 * Replace any with [programRenderers]. Titles come from the program's `public.title` when set. When the state has
 * surprise rules, one "Surprises" card with every odds line sits right under the inbox, so the odds are seen before
 * anything is earned (hidden while surprises are off).
 */
export function RewardsHub(props: RewardsHubProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const c = props.controller;
  const [refreshing, setRefreshing] = useState(false);
  const program = (p: ProgramInfo): ReactNode => {
    const custom = props.programRenderers?.[p.key];
    if (custom) return custom(p);
    const raw = p.public['title'];
    const title = raw == null ? undefined : String(raw);
    const t = title === undefined ? {} : { title };
    switch (p.kind) {
      case ProgramKind.streak:
        return <StreakCard controller={c} program={p.key} texts={texts} />;
      case ProgramKind.milestone:
        return <MilestoneProgress controller={c} program={p.key} texts={texts} {...t} />;
      case ProgramKind.offer:
        return <OfferBanner controller={c} program={p.key} texts={texts} {...t} />;
      case ProgramKind.socialTag:
        return <SocialTagTask controller={c} program={p.key} texts={texts} {...(props.onOpenInstagram ? { onOpenInstagram: props.onOpenInstagram } : {})} />;
      case ProgramKind.quiz:
        return (
          <QuizCard
            controller={c}
            program={p.key}
            texts={texts}
            {...t}
            {...(props.onOpenQuiz ? { onOpen: props.onOpenQuiz } : {})}
            {...(props.onPlaySound ? { onPlaySound: props.onPlaySound } : {})}
            {...(props.renderImage ? { renderImage: props.renderImage } : {})}
          />
        );
      case ProgramKind.questSet:
        return <QuestList controller={c} program={p.key} texts={texts} {...t} />;
      case ProgramKind.recharge:
        return <RechargeMeter controller={c} program={p.key} texts={texts} />;
      case ProgramKind.window:
        return <WindowBadge controller={c} program={p.key} texts={texts} {...t} />;
      case ProgramKind.friendStreak:
        return <FriendStreaks controller={c} program={p.key} texts={texts} {...t} {...(props.onShareInvite ? { onShareInvite: props.onShareInvite } : {})} />;
      case ProgramKind.league:
        return <LeagueBoard controller={c} program={p.key} texts={texts} {...t} />;
      default:
        // A comeback reward has nothing to show before it is earned; it lands in the inbox.
        return null;
    }
  };
  return (
    <RewardsListener
      controller={c}
      render={() => {
        const st = c.state;
        const column = (
          <View testID="rewards-hub" style={[{ padding: kit.theme.padding, gap: props.spacing ?? 12 }, props.contentContainerStyle]}>
            {props.header ?? null}
            <RewardInbox controller={c} texts={texts} />
            {(props.showSurprises ?? true) && st.surprises.length > 0 && !st.choices.surprisesOff ? <SurpriseOdds controller={c} texts={texts} /> : null}
            {st.programs.map((p) => (
              <View key={p.key}>{program(p)}</View>
            ))}
            {(props.showAttribution ?? true) ? <MyindAttribution variant={props.attributionVariant ?? 1} /> : null}
          </View>
        );
        if (props.scrollable === false) return <View style={props.style}>{column}</View>;
        return (
          <ScrollView
            style={[styles.flex, props.style]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                tintColor={kit.theme.accent}
                colors={[kit.theme.accent]}
                onRefresh={() => {
                  setRefreshing(true);
                  void c.refresh().finally(() => setRefreshing(false));
                }}
              />
            }
          >
            {column}
          </ScrollView>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
