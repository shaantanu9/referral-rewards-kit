import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  reportRewardsEvent,
  RewardsEvent,
  RewardsEventName,
  type RewardGrant,
  type RewardsController,
  type RewardsEventSink,
  type RewardsTexts,
} from '@myind/rewards-core';
import { useRewardsKit } from '../context';
import { announce, Button, cardStyle, textStyle, useReducedMotion } from '../ui/primitives';

const OPEN_MS = 600;
const SHAKE_SHARE = 0.6;

export interface RewardRevealProps {
  grant: RewardGrant;
  texts?: RewardsTexts;
  /** Open by itself after mount (the same animation and haptic as a tap). */
  autoOpen?: boolean;
  /** Called once, when the reward is shown. */
  onOpened?: () => void;
  /** Analytics sink, e.g. `controller.client.report`. Props: `program`, `kind`. */
  onEvent?: RewardsEventSink;
  /** A haptic on open; default the provider's `onHaptic`. */
  onHaptic?: () => void;
  /** Your own look. Call `open` to open (haptic, [onOpened] and the event still happen; animate on `opened` yourself). */
  render?: (grant: RewardGrant, opened: boolean, open: () => void) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A surprise reward (ADR 0002 §18.6) as a closed gift: "Surprise!" / "Tap to open". A tap gives a haptic, a short
 * shake and scale-up (about 600 ms) and then the reward line pops in: "You got 23 coins".
 *
 * With "Reduce motion" on there is no shake: it opens at once. It shows only what was won, never what could have
 * been. A grant made while surprises were off (`grant.isFixed`) is not a gamble, so it is not shown as one: the
 * reward line at once, no shake, no haptic ([onOpened] and the event still fire once).
 */
export function RewardReveal(props: RewardRevealProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const t = kit.theme;
  const reduced = useReducedMotion();
  const fixed = props.grant.isFixed && props.render == null;
  const [opened, setOpened] = useState(fixed);
  const [started, setStarted] = useState(fixed);
  const announced = useRef(false);
  const openAnim = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(fixed ? 1 : 0)).current;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const tell = (): void => {
    if (announced.current) return;
    announced.current = true;
    props.onOpened?.();
    reportRewardsEvent(props.onEvent, new RewardsEvent(RewardsEventName.revealOpened, { program: props.grant.program, kind: props.grant.kind }));
    announce(texts.reveal.youGot(texts.reward(props.grant.spec)));
  };

  const finish = (animate: boolean): void => {
    setOpened(true);
    if (animate) Animated.spring(pop, { toValue: 1, friction: 4, tension: 80, useNativeDriver: true }).start();
    else pop.setValue(1);
    tell();
  };

  const start = (): void => {
    if (started) return;
    setStarted(true);
    try {
      (props.onHaptic ?? kit.onHaptic)?.();
    } catch {
      // A haptic never breaks the reveal.
    }
    if (props.render != null || reducedRef.current) {
      finish(false);
      return;
    }
    Animated.timing(openAnim, { toValue: 1, duration: OPEN_MS, easing: Easing.linear, useNativeDriver: true }).start(({ finished }) => {
      if (finished) finish(true);
    });
  };

  useEffect(() => {
    if (fixed) {
      const id = setTimeout(tell, 0);
      return () => clearTimeout(id);
    }
    if (props.autoOpen) {
      const id = setTimeout(start, 0);
      return () => clearTimeout(id);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (props.render) return <>{props.render(props.grant, opened, start)}</>;

  if (opened) {
    return (
      <View testID="reward-reveal-opened" style={[cardStyle(t), styles.center, props.style]}>
        <Animated.View style={{ alignItems: 'center', transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }}>
          <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.bigIcon}>
            🎉
          </Text>
          <Text accessibilityLiveRegion="polite" style={[textStyle(t.titleStyle, t.onSurface), styles.bold, styles.centerText]}>
            {texts.reveal.youGot(texts.reward(props.grant.spec))}
          </Text>
        </Animated.View>
      </View>
    );
  }
  // Shake for the first 60 %, then grow and fade (Flutter's AnimatedBuilder curve, sampled).
  const steps = Array.from({ length: 13 }, (_, i) => i / 12);
  const rotate = openAnim.interpolate({
    inputRange: steps,
    outputRange: steps.map((v) => {
      if (v >= SHAKE_SHARE) return '0rad';
      const p = v / SHAKE_SHARE;
      return `${Math.sin(p * Math.PI * 6) * 0.14 * (1 - p)}rad`;
    }),
  });
  const scale = openAnim.interpolate({ inputRange: [0, SHAKE_SHARE, 1], outputRange: [1, 1, 1.35], easing: Easing.out(Easing.quad) });
  const opacity = openAnim.interpolate({ inputRange: [0, SHAKE_SHARE, 1], outputRange: [1, 1, 0.4] });
  const x = texts.reveal;
  return (
    <View testID="reward-reveal" style={[cardStyle(t), props.style]}>
      <Pressable onPress={start} accessibilityRole="button" accessibilityLabel={`${x.title}. ${x.tapToOpen}`} disabled={started}>
        <Animated.View style={[styles.center, { opacity, transform: [{ scale }, { rotate }] }]}>
          <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.gift}>
            🎁
          </Text>
          <Text style={[textStyle(t.titleStyle, t.onSurface), styles.centerText]}>{x.title}</Text>
          <Text style={[textStyle(t.bodyStyle, t.muted), styles.centerText]}>{x.tapToOpen}</Text>
        </Animated.View>
      </Pressable>
      <View style={[styles.center, styles.m12]}>
        <Button theme={t} testID="reward-reveal-open" label={x.open} disabled={started} onPress={start} />
      </View>
    </View>
  );
}

export interface RewardRevealModalProps {
  /** The grant to reveal; nothing shown while null. */
  grant: RewardGrant | null;
  onClose: () => void;
  texts?: RewardsTexts;
  autoOpen?: boolean;
  onOpened?: () => void;
  onEvent?: RewardsEventSink;
}

/** A [RewardReveal] in a dialog with a close button ("Close", then "Nice!" once opened). Flutter's `showRewardReveal`. */
export function RewardRevealModal(props: RewardRevealModalProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const t = kit.theme;
  const [opened, setOpened] = useState(false);
  useEffect(() => setOpened(false), [props.grant?.id]);
  if (props.grant == null) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={styles.scrim}>
        <View accessibilityViewIsModal style={[styles.dialog, { backgroundColor: t.surface, borderRadius: t.radius + 12 }]}>
          <RewardReveal
            key={props.grant.id}
            grant={props.grant}
            texts={texts}
            {...(props.autoOpen ? { autoOpen: true } : {})}
            {...(props.onEvent ? { onEvent: props.onEvent } : {})}
            onOpened={() => {
              setOpened(true);
              props.onOpened?.();
            }}
          />
          <View style={styles.m12}>
            {opened ? (
              <Button theme={t} variant="tonal" testID="reward-reveal-nice" label={texts.reveal.nice} onPress={props.onClose} />
            ) : (
              <Button theme={t} variant="text" testID="reward-reveal-close" label={texts.reveal.close} onPress={props.onClose} />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

export interface RewardToastListenerProps {
  controller: RewardsController;
  children?: ReactNode;
  texts?: RewardsTexts;
  /** Replaces the toast and the reveal for every grant. */
  onGrant?: (grant: RewardGrant) => void;
  /** Queue grants until `controller.celebrateNow()` (a chapter ended), so a reward never interrupts. Default false. */
  holdUntilMoment?: boolean;
  /** Show surprise / mystery / range grants in the reveal dialog, one at a time. Default true. */
  revealSurprises?: boolean;
  /** How long a toast stays. Default 4000 ms. */
  toastMs?: number;
}

/**
 * Wraps a screen and announces each new grant once: a toast at the bottom by default, or the reveal dialog for a
 * grant that should be revealed (surprise, mystery, range), or the app's [onGrant]. With [holdUntilMoment] grants
 * wait for `controller.celebrateNow()`.
 */
export function RewardToastListener(props: RewardToastListenerProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const t = kit.theme;
  const held = useRef<RewardGrant[]>([]);
  const [reveals, setReveals] = useState<readonly RewardGrant[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const show = (g: RewardGrant): void => {
    const p = latest.current;
    if (p.onGrant) {
      p.onGrant(g);
      return;
    }
    if ((p.revealSurprises ?? true) && g.shouldReveal) {
      setReveals((r) => [...r, g]);
      return;
    }
    const line = texts.gotReward(texts.reward(g.spec));
    announce(line);
    setToast(line);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), p.toastMs ?? 4000);
  };
  const flush = (): void => {
    const all = held.current.splice(0);
    all.forEach(show);
  };

  useEffect(() => {
    const offGrant = props.controller.onGrant((g) => {
      if (latest.current.holdUntilMoment) held.current.push(g);
      else show(g);
    });
    const offMoment = props.controller.onMoment(flush);
    return () => {
      offGrant();
      offMoment();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.controller]);

  const wasHolding = useRef(props.holdUntilMoment ?? false);
  useEffect(() => {
    if (wasHolding.current && !props.holdUntilMoment) flush();
    wasHolding.current = props.holdUntilMoment ?? false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.holdUntilMoment]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <View style={styles.flex}>
      {props.children}
      {toast != null ? (
        <View pointerEvents="none" style={styles.toastWrap}>
          <View testID="reward-toast" style={[styles.toast, { backgroundColor: t.onSurface, borderRadius: 8 }]}>
            <Text accessibilityLiveRegion="polite" style={textStyle(t.bodyStyle, t.surface)}>
              {toast}
            </Text>
          </View>
        </View>
      ) : null}
      <RewardRevealModal
        grant={reveals[0] ?? null}
        texts={texts}
        onEvent={(e) => props.controller.client.report(e)}
        onClose={() => setReveals((r) => r.slice(1))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
  bold: { fontWeight: '700' },
  m12: { marginTop: 12 },
  gift: { fontSize: 56, marginBottom: 8 },
  bigIcon: { fontSize: 48, marginBottom: 8 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { alignSelf: 'stretch', maxWidth: 420, padding: 16 },
  toastWrap: { position: 'absolute', left: 16, right: 16, bottom: 24, alignItems: 'center' },
  toast: { paddingHorizontal: 16, paddingVertical: 12, maxWidth: 560 },
});
