import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  ReferralCopy,
  ReferralEvent,
  ReferralEventName,
  ReferralTerms,
  reportReferralEvent,
  rewardEventProps,
  type ReferralClient,
  type ReferralEventSink,
  type RewardItem,
  type RewardLabels,
  type Subscribe,
} from '@myind/referral-core';
import { useReferralKit } from '../context';
import { appStateResumes } from '../platform';
import { Button, LiveText, type } from '../ui/primitives';

export interface ReferralRewardCardProps {
  client: ReferralClient;
  labels?: RewardLabels;
  /** Shown before the sentence (an icon or small picture). */
  leading?: ReactNode;
  /** A second button next to Dismiss (e.g. "Read now"). Tapping it also dismisses the card. */
  actionLabel?: string;
  onAction?: () => void;
  /** Called once per reward when its card appears (the reward is already granted on the server). */
  onShown?: (reward: RewardItem) => void;
  /** Called when a card is dismissed, after the ack; `acknowledged` false: it comes back next launch. */
  onDismissed?: (reward: RewardItem, acknowledged: boolean) => void;
  onEvent?: ReferralEventSink;
  /** When to ask again; default the app coming back to the foreground (`AppState`). */
  resumes?: Subscribe;
  /** Your own look per reward; `dismiss` acks it. */
  render?: (reward: RewardItem, text: string, dismiss: () => void) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * In-app card for rewards that landed (ADR 4.1 step 3, 4.2 step 5): reads `referral_pending` and calls `referral_ack`
 * when the user dismisses one, so each device shows each card once. Shows nothing when there is nothing new or the
 * call fails. Asks again when the app comes back to the foreground and when it gets another [client].
 */
export function ReferralRewardCard(props: ReferralRewardCardProps): ReactNode {
  const kit = useReferralKit();
  const { l10n, theme } = kit;
  const [items, setItems] = useState<readonly RewardItem[]>([]);
  const shown = useRef(new Set<string>());
  const dismissed = useRef(new Set<string>());
  const loading = useRef<Promise<void> | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const latest = useRef(props);
  latest.current = props;

  const emit = (e: ReferralEvent): void => reportReferralEvent(latest.current.onEvent ?? latest.current.client.onEvent, e);
  const safe = (f: () => void): void => {
    try {
      f();
    } catch {
      // The app's callback failed; the card keeps working.
    }
  };

  const load = async (gen: number): Promise<void> => {
    try {
      const all = await latest.current.client.pending();
      if (!alive.current || gen !== generation.current) return;
      const next = all.filter((r) => !dismissed.current.has(r.id));
      setItems(next);
      for (const r of next) {
        if (shown.current.has(r.id)) continue;
        shown.current.add(r.id);
        emit(new ReferralEvent(ReferralEventName.rewardShown, rewardEventProps(r)));
        safe(() => latest.current.onShown?.(r));
      }
    } catch {
      // Nothing new shown; the rewards stay pending and appear on the next resume or launch.
    }
  };

  const reload = (): void => {
    if (loading.current) return;
    const f = load(generation.current);
    loading.current = f;
    void f.finally(() => {
      if (loading.current === f) loading.current = null;
    });
  };

  useEffect(() => {
    alive.current = true;
    generation.current++;
    setItems([]);
    shown.current.clear();
    dismissed.current.clear();
    loading.current = null;
    reload();
    const off = (props.resumes ?? appStateResumes)(reload);
    return () => {
      alive.current = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.client]);

  const dismiss = async (r: RewardItem): Promise<void> => {
    dismissed.current.add(r.id);
    setItems((xs) => xs.filter((x) => x.id !== r.id));
    let acked = true;
    try {
      await latest.current.client.ack([r.id]);
    } catch {
      // Not acknowledged: the card comes back next launch, which is better than never showing it.
      acked = false;
    }
    emit(new ReferralEvent(ReferralEventName.rewardAcknowledged, { ...rewardEventProps(r), acknowledged: acked }));
    safe(() => latest.current.onDismissed?.(r, acked));
  };

  if (items.length === 0) return null;
  const copy = new ReferralCopy({ l10n, terms: ReferralTerms.none, labels: props.labels ?? kit.labels });
  return (
    <View style={props.style}>
      {items.map((r) => {
        const text = copy.rewardCard(r);
        if (props.render) return <View key={r.id}>{props.render(r, text, () => void dismiss(r))}</View>;
        return (
          <View key={r.id} testID={`referral-reward-${r.id}`} style={[styles.card, { backgroundColor: theme.card, borderRadius: theme.radius }]}>
            <View style={styles.row}>
              {props.leading != null ? <View style={styles.leading}>{props.leading}</View> : null}
              <LiveText style={[type.bodyLarge, styles.flex, { color: theme.onSurface }]}>{text}</LiveText>
            </View>
            <View style={styles.buttons}>
              <Button theme={theme} variant="text" label={l10n.dismiss} onPress={() => void dismiss(r)} testID={`referral-reward-dismiss-${r.id}`} />
              {props.actionLabel && props.onAction ? (
                <Button
                  theme={theme}
                  testID={`referral-reward-action-${r.id}`}
                  label={props.actionLabel}
                  onPress={() => {
                    void dismiss(r);
                    props.onAction?.();
                  }}
                />
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, marginVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  leading: { marginRight: 12 },
  flex: { flex: 1 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
});
