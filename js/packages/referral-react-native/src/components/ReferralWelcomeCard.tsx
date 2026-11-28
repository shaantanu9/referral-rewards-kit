import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  MyClaimState,
  ReferralCopy,
  ReferralEvent,
  ReferralEventName,
  ReferralPromptMoment,
  ReferralTerms,
  reportReferralEvent,
  type KeyValueStore,
  type MyClaim,
  type ReferralClient,
  type ReferralEventSink,
  type ReferralPromptPolicy,
  type RewardLabels,
} from '@myind/referral-core';
import { useReferralKit } from '../context';
import { Button, LiveText, type } from '../ui/primitives';

export interface ReferralWelcomeCardProps {
  client: ReferralClient;
  /** Remembers which day / session each state was shown and dismissed. */
  store: KeyValueStore;
  appName: string;
  /** The app's words for the first real use, e.g. "Read your first page". */
  activationStep?: string;
  /** Opens the invite hub from the pass-it-on card. Without it the card has only "Got it". */
  onPassItOn?: () => void;
  /** The pass-it-on card is a prompt: with a policy it follows `welcomeRewardReceived`. */
  policy?: ReferralPromptPolicy;
  labels?: RewardLabels;
  /** Replaces the default icon. */
  leading?: ReactNode;
  clock?: () => Date;
  onEvent?: ReferralEventSink;
  /** Your own look; `close('dismiss' | 'invite')` hides it and remembers. */
  render?: (claim: MyClaim, text: string, close: (action: 'dismiss' | 'invite') => void) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

const claimedShownKey = 'welcome_card.claimed.shown';
const claimedDismissedKey = 'welcome_card.claimed.dismissed';
const joinedKey = 'welcome_card.joined';

/**
 * The friend's in-app card (G2, G3), from `referral_my_claim`:
 *
 * - claimed: "Your welcome gift of 4 free chapters is waiting: Read your first page. 12 days left."
 * - joined: once, "Pass it on: give a friend 4 free chapters …" with "Invite a friend" ([onPassItOn]). With a
 *   [policy] only when `shouldPromptFor(welcomeRewardReceived)` allows it.
 * - none / expired: nothing.
 *
 * Not nagging: each state shows in at most one app session per day, and "Got it" hides it. In-app only.
 */
export function ReferralWelcomeCard(props: ReferralWelcomeCardProps): ReactNode {
  const kit = useReferralKit();
  const { l10n, theme } = kit;
  const [claim, setClaim] = useState<MyClaim | null>(null);
  const [terms, setTerms] = useState<ReferralTerms>(ReferralTerms.none);
  const generation = useRef(0);
  const alive = useRef(true);

  const day = (): string => {
    const d = (props.clock ?? (() => new Date()))();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const emit = (name: ReferralEventName, p: Record<string, string>): void =>
    reportReferralEvent(props.onEvent ?? props.client.onEvent, new ReferralEvent(name, p));

  const mayShowClaimed = async (): Promise<boolean> => {
    const s = props.store,
      today = day(),
      session = ReferralWelcomeCard.session;
    if ((await s.getString(claimedDismissedKey)) === today) return false;
    const shown = await s.getString(claimedShownKey);
    if (shown != null && shown.startsWith(`${today}|`) && shown !== `${today}|${session}`) return false;
    await s.setString(claimedShownKey, `${today}|${session}`);
    return true;
  };

  const mayShowJoined = async (): Promise<boolean> => {
    const s = props.store,
      session = ReferralWelcomeCard.session;
    const v = await s.getString(joinedKey);
    if (v != null) return v === session;
    const p = props.policy;
    if (p) {
      if (!(await p.shouldPromptFor(ReferralPromptMoment.welcomeRewardReceived))) return false;
      await p.markPromptedFor(ReferralPromptMoment.welcomeRewardReceived);
    }
    await s.setString(joinedKey, session);
    return true;
  };

  useEffect(() => {
    alive.current = true;
    const gen = ++generation.current;
    setClaim(null);
    void (async () => {
      try {
        const c = await props.client.myClaim();
        const show =
          c.state === MyClaimState.claimed ? await mayShowClaimed() : c.state === MyClaimState.joined ? await mayShowJoined() : false;
        if (!show) return;
        let t = ReferralTerms.none;
        if (c.state === MyClaimState.joined) {
          try {
            t = await props.client.terms();
          } catch {
            // The plain "invite a friend to {app}" line then.
          }
        }
        if (!alive.current || gen !== generation.current) return;
        setTerms(t);
        setClaim(c);
        emit(ReferralEventName.welcomeCardShown, { state: c.state });
      } catch {
        // Older server or offline: no card.
      }
    })();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.client]);

  const close = (action: 'dismiss' | 'invite'): void => {
    const c = claim;
    if (c == null) return;
    setClaim(null);
    emit(ReferralEventName.welcomeCardDismissed, { state: c.state, action });
    void (c.state === MyClaimState.claimed ? props.store.setString(claimedDismissedKey, day()) : props.store.setString(joinedKey, 'done')).catch(
      () => {},
    );
  };

  if (claim == null) return null;
  const copy = new ReferralCopy({ l10n, terms, labels: props.labels ?? kit.labels });
  const joined = claim.state === MyClaimState.joined;
  const text = joined
    ? copy.passItOn({ appName: props.appName })
    : copy.welcomeWaiting(claim, { appName: props.appName, activationStep: props.activationStep ?? null });
  if (props.render) return <>{props.render(claim, text, close)}</>;
  return (
    <View testID={`referral-welcome-${claim.state}`} style={[styles.card, { backgroundColor: theme.card, borderRadius: theme.radius }, props.style]}>
      <View style={styles.row}>
        {props.leading ?? (
          <Text accessibilityElementsHidden importantForAccessibility="no" style={[type.titleMedium, { color: theme.primary }]}>
            {joined ? '♡' : '🎁'}
          </Text>
        )}
        <LiveText style={[type.bodyLarge, styles.flex, { color: theme.onSurface }]}>{text}</LiveText>
      </View>
      <View style={styles.buttons}>
        <Button theme={theme} variant="text" testID="referral-welcome-dismiss" label={l10n.dismiss} onPress={() => close('dismiss')} />
        {joined && props.onPassItOn ? (
          <Button
            theme={theme}
            testID="referral-welcome-invite"
            label={l10n.inviteAFriend}
            onPress={() => {
              close('invite');
              props.onPassItOn?.();
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

/**
 * Identifies this app launch, so a card stays visible across re-renders within one session but not in the next launch
 * the same day. Tests set it to simulate a new launch.
 */
ReferralWelcomeCard.session = `${Date.now()}-${Math.floor(Math.random() * 2 ** 30)}`;

const styles = StyleSheet.create({
  card: { padding: 16 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  flex: { flex: 1 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
});
