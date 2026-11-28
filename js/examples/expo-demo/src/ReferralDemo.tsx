/**
 * Every referral component on `FakeReferralServer`: the hub (your code + a friend's code), the reward card, the
 * welcome card, and each part on its own. The buttons play the other people in the story.
 */
import { useMemo, useReducer, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MemoryKeyValueStore, PendingClaimQueue, ReferralTerms } from '@myind/referral-core';
import { FakeReferralServer, fakeReferralClient } from '@myind/referral-core/testing';
import {
  InviteCodeEntry,
  InviteCodeSection,
  InviteCodeText,
  InviteFriendsScreen,
  InviteHub,
  MyindAttribution,
  ReferralBoostBanner,
  ReferralDeadlineChip,
  ReferralInvitePageSettings,
  ReferralRewardCard,
  ReferralWelcomeCard,
} from '@myind/referral-react-native';
import { Section, StoryButton } from './ui';

export function ReferralDemo(): ReactNode {
  // A new key remounts the components after a story move, so they load again.
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const kit = useMemo(() => {
    const server = new FakeReferralServer({ latencyMs: 300 });
    const client = fakeReferralClient(server, { onEvent: (e) => console.log('[referral]', e.toString()) });
    const queue = new PendingClaimQueue({ client, store: new MemoryKeyValueStore() });
    const friendServer = new FakeReferralServer({ latencyMs: 300 });
    friendServer.claimed = true;
    const friendClient = fakeReferralClient(friendServer);
    return { server, client, queue, friendClient, store: new MemoryKeyValueStore(), cache: new MemoryKeyValueStore() };
  }, []);
  const move = (f: () => void) => () => {
    f();
    bump();
  };
  const inviteLink = (code: string) => `https://example.com/i/${code}`;
  return (
    <View key={version}>
      <Section title="Story">
        <View style={styles.wrap}>
          <StoryButton label="A friend signs up" onPress={move(() => kit.server.aFriendSignsUp())} />
          <StoryButton label="A friend starts" onPress={move(() => kit.server.aFriendStarts())} />
          <StoryButton label="A friend pays" onPress={move(() => kit.server.aFriendPays())} />
          <StoryButton label="Pending reward" onPress={move(() => kit.server.addPendingReward(new Date(Date.now() + 3 * 86_400_000)))} />
          <StoryButton label={kit.server.offline ? 'Go online' : 'Go offline'} onPress={move(() => (kit.server.offline = !kit.server.offline))} />
          <StoryButton label={kit.server.deployed ? 'Not deployed' : 'Deployed'} onPress={move(() => (kit.server.deployed = !kit.server.deployed))} />
          <StoryButton label={kit.server.enabled ? 'Pause program' : 'Resume program'} onPress={move(() => (kit.server.enabled = !kit.server.enabled))} />
        </View>
        <Text style={styles.hint}>A friend&apos;s code that works: {FakeReferralServer.friendCode}</Text>
      </Section>
      <Section title="ReferralRewardCard">
        <ReferralRewardCard client={kit.client} actionLabel="Read now" onAction={() => {}} />
      </Section>
      <Section title="ReferralWelcomeCard (a friend who added a code)">
        <ReferralWelcomeCard client={kit.friendClient} store={kit.store} appName="Reader" activationStep="Read your first page" />
      </Section>
      <Section title="InviteHub">
        <InviteHub client={kit.client} queue={kit.queue} appName="Reader" inviteLink={inviteLink} codeCache={kit.cache} scrollable={false} from="demo" />
      </Section>
      <Section title="InviteFriendsScreen (no invite page)">
        <InviteFriendsScreen client={kit.client} appName="Reader" storeLink="https://example.com/app" embedded showAttribution={false} />
      </Section>
      <Section title="InviteCodeSection">
        <InviteCodeSection client={kit.client} queue={kit.queue} appName="Reader" onAlmostAction={() => {}} />
      </Section>
      <Section title="InviteCodeEntry">
        <InviteCodeEntry client={kit.client} queue={kit.queue} />
      </Section>
      <Section title="ReferralInvitePageSettings">
        <ReferralInvitePageSettings client={kit.client} />
      </Section>
      <Section title="InviteCodeText · ReferralDeadlineChip · ReferralBoostBanner">
        <InviteCodeText code={FakeReferralServer.myCode} />
        <View style={styles.row}>
          <ReferralDeadlineChip text="Only 3 days left to add a code" />
          <ReferralDeadlineChip text="Last day to add a code" lastDay />
        </View>
        <BoostBanner server={kit.server} />
      </Section>
      <Section title="MyindAttribution (variants 0–3)">
        {[0, 1, 2, 3].map((v) => (
          <MyindAttribution key={v} variant={v} source="expo-demo" />
        ))}
      </Section>
    </View>
  );
}

function BoostBanner({ server }: { server: FakeReferralServer }): ReactNode {
  const terms = useMemo(
    () =>
      ReferralTerms.fromJson({
        enabled: true,
        rules: [{ event: 'joined', who: 'friend', kind: 'chapters', amount: 4 }],
        claim_window_days: 7,
        boost: { starts_at: new Date(Date.now() - 86_400_000).toISOString(), ends_at: server.boostEndsAt.toISOString(), multiplier: 2, events: ['joined'], who: ['sharer', 'friend'] },
      }),
    [server],
  );
  return <ReferralBoostBanner terms={terms} />;
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  hint: { marginTop: 8, opacity: 0.7 },
});
