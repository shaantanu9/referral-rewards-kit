/**
 * Every rewards component on `FakeRewardsServer`: the hub with every program kind, plus the components the hub does
 * not place (heatmap, goal ring, recap cards, reveal, ad button, follow-up settings). The buttons move the story on.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RewardGrant } from '@myind/rewards-core';
import { FakeRewardsServer, fakeRewards } from '@myind/rewards-core/testing';
import {
  ActivityHeatmap,
  DailyGoalRing,
  FollowupSettings,
  MyindAttribution,
  QuizScreen,
  RecapCard,
  recapYear,
  RewardedAdButton,
  RewardReveal,
  RewardsHub,
  RewardsRecapCard,
  RewardToastListener,
  useRewards,
} from '@myind/rewards-react-native';
import { Section, StoryButton } from './ui';

export function RewardsDemo(): ReactNode {
  const kit = useMemo(() => {
    const server = new FakeRewardsServer({ latencyMs: 250, surpriseChance: 0.3 });
    const { controller } = fakeRewards(server, { onEvent: (e) => console.log('[rewards]', e.toString()) });
    return { server, controller };
  }, []);
  const { server, controller } = kit;
  const snap = useRewards(controller);
  const [quizOpen, setQuizOpen] = useState(false);
  const recapRef = useRef<unknown>(null);
  useEffect(() => () => controller.dispose(), [controller]);
  const [from, to] = recapYear(new Date().getUTCFullYear());
  const story = (f: () => void) => () => {
    f();
    void controller.refresh();
  };
  return (
    <RewardToastListener controller={controller}>
      <Section title="Story">
        <View style={styles.wrap}>
          <StoryButton label="Read a chapter" onPress={() => void controller.track('chapter_read')} />
          <StoryButton label="New day" onPress={story(() => server.newDay())} />
          <StoryButton label="Break the streak" onPress={story(() => server.breakStreak())} />
          <StoryButton label="Mystery reward" onPress={story(() => server.grantMystery())} />
          <StoryButton label="Verify the post" onPress={story(() => server.verifySocial())} />
          <StoryButton label="Friend did today" onPress={story(() => server.friendDoesToday())} />
          <StoryButton label="Close league week" onPress={story(() => server.closeLeagueWeek(1))} />
          <StoryButton label="Expire offer" onPress={story(() => server.expireOffer())} />
          <StoryButton label="Celebrate now" onPress={() => controller.celebrateNow()} />
        </View>
        <Text style={styles.hint}>State version {snap.version} · inbox {snap.state.inbox.length}</Text>
      </Section>
      <Section title="RewardsHub (every program kind)">
        <RewardsHub controller={controller} scrollable={false} onOpenQuiz={() => setQuizOpen(true)} onOpenInstagram={() => {}} onShareInvite={() => {}} />
      </Section>
      {quizOpen ? (
        <Section title="QuizScreen">
          <View style={styles.quiz}>
            <QuizScreen controller={controller} program="quiz" onDone={() => setQuizOpen(false)} showAppBar={false} />
          </View>
        </Section>
      ) : null}
      <Section title="DailyGoalRing · ActivityHeatmap">
        <View style={styles.row}>
          <DailyGoalRing controller={controller} />
        </View>
        <ActivityHeatmap controller={controller} />
      </Section>
      <Section title="RecapCard">
        <RecapCard controller={controller} from={from} to={to} />
      </Section>
      <Section title="RewardsRecapCard (capture with /view-shot)">
        {controller.recap(from, to) ? <RewardsRecapCard ref={recapRef} recap={controller.recap(from, to)!} subtitle="Reader" /> : null}
      </Section>
      <Section title="RewardReveal">
        <RewardReveal grant={RewardGrant.fromJson({ id: 'demo', program: 'daily', kind: 'coins', amount: 23, params: { surprise: true, range: [5, 50] }, state: 'granted' })} />
      </Section>
      <Section title="RewardedAdButton (a fake ad)">
        <RewardedAdButton controller={controller} label="Watch an ad for 10 coins" onShowAd={() => new Promise((r) => setTimeout(() => r(true), 800))} />
      </Section>
      <Section title="FollowupSettings">
        <FollowupSettings controller={controller} showChoices />
      </Section>
      <Section title="MyindAttribution">
        <MyindAttribution source="expo-demo" />
      </Section>
    </RewardToastListener>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', marginBottom: 12 },
  hint: { marginTop: 8, opacity: 0.7 },
  quiz: { height: 560 },
});
