import { useEffect, useReducer, useRef, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import {
  formatLeft,
  formatPercent,
  type MysteryOdd,
  type RewardSpec,
  type RewardsController,
  type RewardsTexts,
  type ServerClock,
} from '@myind/rewards-core';
import { useRewards, useRewardsKit } from '../context';
import { textStyle } from '../ui/primitives';

/**
 * Re-renders on every controller change and loads the state once when nobody has yet (after mount, so a component
 * never triggers an update while rendering). Shows [hidden] (default: nothing) while rewards are not visible.
 */
export function RewardsListener(props: { controller: RewardsController; render: () => ReactNode; hidden?: () => ReactNode }): ReactNode {
  const snap = useRewards(props.controller);
  useEffect(() => {
    const c = props.controller;
    if (c.loaded || c.loading) return;
    const id = setTimeout(() => {
      if (!c.loaded) void c.refresh();
    }, 0);
    return () => clearTimeout(id);
    // Once per controller, like Flutter's initState.
  }, [props.controller]);
  return <>{snap.visible ? props.render() : (props.hidden?.() ?? null)}</>;
}

export interface CountdownProps {
  /** The server's deadline. None: nothing shown (a deadline is never invented). */
  endsAt: Date | null | undefined;
  /** The controller's server-corrected clock. */
  clock: ServerClock;
  /** Called once when the time reaches zero (also while [hidden]). */
  onExpired?: () => void;
  /** Your own look; gets the time left in ms (0 at the end). */
  render?: (leftMs: number) => ReactNode;
  style?: StyleProp<TextStyle>;
  /** Text before the time, e.g. "Ends in". */
  prefix?: string;
  /** Show nothing (`timers_off`); [onExpired] still fires. */
  hidden?: boolean;
}

/**
 * A live countdown to a server deadline (ADR 0002 §8). Ticks every second on the server-corrected clock, never shows a
 * negative time, and calls [onExpired] once at zero.
 */
export function Countdown(props: CountdownProps): ReactNode {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const fired = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const end = props.endsAt?.getTime() ?? null;

  useEffect(() => {
    fired.current = false;
    if (end == null) return;
    const check = (): boolean => {
      const p = latest.current;
      if (p.clock.leftMs(p.endsAt) === 0 && !fired.current) {
        fired.current = true;
        const cb = p.onExpired;
        if (cb) setTimeout(cb, 0);
        return true;
      }
      return false;
    };
    if (check()) return;
    const id = setInterval(() => {
      if (!latest.current.hidden) tick();
      if (check()) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [end]);

  const left = props.clock.leftMs(props.endsAt);
  if (left == null || props.hidden) return null;
  if (props.render) return <>{props.render(left)}</>;
  const text = props.prefix == null ? formatLeft(left) : `${props.prefix} ${formatLeft(left)}`;
  return (
    <Text accessibilityRole="timer" style={props.style}>
      {text}
    </Text>
  );
}

/**
 * What a `mystery` reward can turn into, with each chance as a percentage. Stating the odds before it is earned is
 * required honesty (app store loot-box rules); mystery rewards are free only, never sold. Nothing when [reward] has no
 * odds.
 */
export function MysteryOdds(props: { reward: RewardSpec; texts?: RewardsTexts; render?: (odds: readonly MysteryOdd[]) => ReactNode }): ReactNode {
  const kit = useRewardsKit();
  const t = kit.theme;
  const texts = props.texts ?? kit.texts;
  const odds = props.reward.odds;
  if (odds.length === 0) return null;
  if (props.render) return <>{props.render(odds)}</>;
  const muted = textStyle(t.bodyStyle, t.muted);
  return (
    <View testID="mystery-odds">
      <Text style={muted}>{texts.programs.oddsTitle}</Text>
      {odds.map((o, i) => (
        <View key={i} style={styles.row}>
          <Text style={[textStyle(t.bodyStyle, t.onSurface), styles.pct]}>{formatPercent(o.chance)}</Text>
          <Text style={[muted, styles.flex]}>{texts.reward(o.spec)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  pct: { width: 56 },
  flex: { flex: 1 },
});
