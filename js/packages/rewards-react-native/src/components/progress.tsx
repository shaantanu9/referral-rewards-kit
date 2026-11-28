import { useEffect, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { HistoryDay, MilestoneState, RewardsController, RewardsTexts, StreakHistory, StreakState } from '@myind/rewards-core';
import { useRewardsKit } from '../context';
import { alpha, cardStyle, ProgressBar, Ring, textStyle } from '../ui/primitives';
import { Countdown, MysteryOdds, RewardsListener } from './base';

const HOUR = 3_600_000;

function firstOr(controller: RewardsController, program: string | undefined): StreakState | null {
  const st = controller.state;
  return program == null ? (st.streaks[0] ?? null) : st.streak(program);
}

export interface StreakCardProps {
  controller: RewardsController;
  /** The streak program key; none = the first streak. */
  program?: string;
  texts?: RewardsTexts;
  /** When the warning colour and the countdown start. Default 4 h. */
  atRiskWithinMs?: number;
  /** Your own look for the whole card. */
  render?: (streak: StreakState, controller: RewardsController) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A daily streak: days in a row, best, freezes, and the next reward. When today is not done it shows the real time
 * left today, in the warning colour once [atRiskWithinMs] is reached.
 *
 * Fair play (0.7): nothing while the streak is `hidden` or streaks are off; no countdown while timers are off; the
 * repair of a broken streak, "is back" the day it came back, a "New personal best" chip; with surprises off a mystery
 * or range reward is named by what it will really give.
 */
export function StreakCard(props: StreakCardProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const c = props.controller;
  return (
    <RewardsListener
      controller={c}
      render={() => {
        const s = firstOr(c, props.program);
        if (s == null || s.hidden || c.state.choices.streaksOff) return null;
        if (props.render) return props.render(s, c);
        const t = kit.theme;
        const choices = c.state.choices;
        const now = c.clock.now();
        const risk = s.atRisk(now, props.atRiskWithinMs ?? 4 * HOUR);
        const next = choices.surprisesOff ? (s.nextReward?.fixed ?? null) : s.nextReward;
        const left = s.daysToNextReward;
        const repair = s.repair;
        const x = texts.fairPlay;
        const body = (color: string) => textStyle(t.bodyStyle, color);
        return (
          <View testID="streak-card" style={[cardStyle(t), props.style]}>
            <View style={styles.row}>
              <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.fire, { color: risk ? t.warning : t.accent }]}>
                🔥
              </Text>
              <Text accessibilityRole="header" style={[textStyle(t.numberStyle, t.onSurface), styles.shrink]}>
                {texts.streakDays(s.current)}
              </Text>
              {s.recordToday && s.bestDayCount > 0 ? (
                <View style={[styles.chip, { backgroundColor: alpha(t.success, 0.15), borderRadius: t.radius }]}>
                  <Text numberOfLines={1} style={body(t.success)}>
                    {x.personalBest(s.bestDayCount)}
                  </Text>
                </View>
              ) : null}
            </View>
            {repair != null && repair.left > 0 ? (
              <View style={styles.m8}>
                <Text style={body(t.accent)}>{x.repair(repair.left, repair.restoresTo)}</Text>
                <Countdown endsAt={repair.until} clock={c.clock} prefix={x.repairEndsIn} style={body(t.muted)} hidden={choices.timersOff} />
              </View>
            ) : s.repairedRecently(now) ? (
              <Text style={[body(t.success), styles.m8]}>{x.streakBack(s.current)}</Text>
            ) : null}
            <View style={styles.m8}>
              {s.todayDone ? (
                <Text style={body(t.success)}>{texts.streakDoneToday}</Text>
              ) : risk && choices.timersOff ? (
                <Text style={body(t.warning)}>{texts.streakDoToday}</Text>
              ) : risk ? (
                <Countdown endsAt={s.endsTodayAt} clock={c.clock} prefix={texts.streakAtRisk} style={body(t.warning)} />
              ) : (
                <Text style={body(t.muted)}>{texts.streakDoToday}</Text>
              )}
            </View>
            <Text style={[body(t.muted), styles.m4]}>
              {`${texts.streakLongest}: ${s.longest}  ·  ${texts.streakFreezes}: ${s.freezes}`}
            </Text>
            {next != null && left != null ? (
              <View style={styles.m4}>
                <Text style={body(t.onSurface)}>{texts.nextIn(texts.reward(next), left)}</Text>
                {next.isMystery ? <MysteryOdds reward={next} texts={texts} /> : null}
              </View>
            ) : null}
          </View>
        );
      }}
    />
  );
}

export interface MilestoneProgressProps {
  controller: RewardsController;
  program: string;
  /** The app's own title ("Invite 3 friends"); none by default. */
  title?: string;
  texts?: RewardsTexts;
  render?: (milestone: MilestoneState, controller: RewardsController) => ReactNode;
  /** Why the user got a head start; default the program's `public.head_start_label`. */
  headStartLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Progress towards a milestone's next reward ("3 of 5 · 100 coins"), or "All rewards earned". Names a head start
 * (0.7), shows "Level 3 · Explorer" and the way to the next level, and with surprises off names a mystery or range
 * reward by what it will really give.
 */
export function MilestoneProgress(props: MilestoneProgressProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const c = props.controller;
  return (
    <RewardsListener
      controller={c}
      render={() => {
        const m = c.state.milestone(props.program);
        if (m == null) return null;
        if (props.render) return props.render(m, c);
        const t = kit.theme;
        const next = c.state.choices.surprisesOff ? (m.nextReward?.fixed ?? null) : m.nextReward;
        const x = texts.fairPlay;
        const level = m.level;
        const raw = c.state.program(props.program)?.public['head_start_label'];
        const label = props.headStartLabel ?? (raw == null ? null : String(raw));
        const muted = textStyle(t.bodyStyle, t.muted);
        const line = next == null || m.target == null ? texts.allEarned : `${texts.progress(m.count, m.target)}  ·  ${texts.reward(next)}`;
        return (
          <View testID="milestone-progress" style={[cardStyle(t), props.style]}>
            {props.title != null ? (
              <Text accessibilityRole="header" style={[textStyle(t.titleStyle, t.onSurface), styles.mb8]}>
                {props.title}
              </Text>
            ) : null}
            {level != null ? (
              <View style={styles.mb8}>
                <Text style={textStyle(t.bodyStyle, t.onSurface)}>{x.level(level.number, level.name)}</Text>
                {level.nextAt != null ? <Text style={muted}>{x.toNextLevel(m.count, level.nextAt)}</Text> : null}
              </View>
            ) : null}
            <ProgressBar value={m.progress} color={t.accent} track={alpha(t.muted, 0.2)} label={line} />
            <Text style={[muted, styles.m8]}>{line}</Text>
            {m.headStart > 0 ? <Text style={muted}>{x.headStart(m.headStart, label)}</Text> : null}
            {next != null && next.isMystery ? <MysteryOdds reward={next} texts={texts} /> : null}
          </View>
        );
      }}
    />
  );
}

export interface DailyGoalRingProps {
  controller: RewardsController;
  /** The streak program; none = the first streak. */
  program?: string;
  size?: number;
  strokeWidth?: number;
  texts?: RewardsTexts;
  render?: (streak: StreakState) => ReactNode;
}

/** Today's progress towards a streak's daily goal ("1/2"), a check once the day counts. Nothing while hidden or off. */
export function DailyGoalRing(props: DailyGoalRingProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const c = props.controller;
  const size = props.size ?? 56;
  return (
    <RewardsListener
      controller={c}
      render={() => {
        const s = firstOr(c, props.program);
        if (s == null || s.hidden || c.state.choices.streaksOff) return null;
        if (props.render) return props.render(s);
        const t = kit.theme;
        const x = texts.programs;
        const label = s.todayDone ? x.goalDone : x.goal(s.todayCount, s.dailyGoal);
        return (
          <View
            testID="daily-goal-ring"
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={label}
            accessibilityValue={{ min: 0, max: s.dailyGoal, now: Math.min(s.todayCount, s.dailyGoal) }}
          >
            <Ring value={s.goalProgress} size={size} stroke={props.strokeWidth ?? 6} color={s.todayDone ? t.success : t.accent} track={alpha(t.muted, 0.2)}>
              {s.todayDone ? (
                <Text style={{ color: t.success, fontSize: size * 0.4, fontWeight: '700' }}>✓</Text>
              ) : (
                <Text style={textStyle(t.bodyStyle, t.onSurface)}>{x.goal(s.todayCount, s.dailyGoal)}</Text>
              )}
            </Ring>
          </View>
        );
      }}
    />
  );
}

export interface ActivityHeatmapProps {
  controller: RewardsController;
  /** The streak program; none = the first streak. */
  program?: string;
  weeks?: number;
  cellSize?: number;
  gap?: number;
  showLegend?: boolean;
  texts?: RewardsTexts;
  /** Your own cell; `level` is 0..4. */
  renderCell?: (day: HistoryDay, level: number, isToday: boolean) => ReactNode;
  /** Your own look for the whole map. */
  render?: (history: StreakHistory) => ReactNode;
}

/**
 * A streak's history as a weeks × 7 grid (Monday on top), oldest week on the left, today outlined. Five levels by the
 * day's count against the daily goal; days saved by a freeze are striped. Loads `rewards_history` itself once.
 */
export function ActivityHeatmap(props: ActivityHeatmapProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const c = props.controller;
  const weeks = props.weeks ?? 15;
  const s = props.cellSize ?? 12;
  const g = props.gap ?? 3;

  useEffect(() => {
    if (c.history(props.program ?? null) == null) void c.loadHistory({ program: props.program ?? null, weeks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c]);

  return (
    <RewardsListener
      controller={c}
      render={() => {
        const h = c.history(props.program ?? null);
        if (h == null || h.days.length === 0) return null;
        if (props.render) return props.render(h);
        const t = kit.theme;
        const color = (level: number): string =>
          level <= 0 ? alpha(t.muted, 0.15) : level === 1 ? alpha(t.accent, 0.3) : level === 2 ? alpha(t.accent, 0.55) : level === 3 ? alpha(t.accent, 0.8) : t.accent;
        const first = h.days[0]!.day;
        const offset = (first.getUTCDay() + 6) % 7; // Monday = 0
        const columns = Math.ceil((offset + h.days.length) / 7);
        const cell = (i: number): ReactNode => {
          const day = i >= 0 && i < h.days.length ? h.days[i]! : null;
          if (day == null) return <View style={{ width: s, height: s }} />;
          const level = h.levelOf(day.count);
          const today = i === h.days.length - 1;
          if (props.renderCell) return <View style={{ width: s, height: s }}>{props.renderCell(day, level, today)}</View>;
          return (
            <View
              testID={day.frozen ? 'heatmap-frozen' : undefined}
              style={{
                width: s,
                height: s,
                borderRadius: s / 4,
                backgroundColor: color(level),
                overflow: 'hidden',
                ...(today ? { borderWidth: 1.5, borderColor: t.onSurface } : {}),
              }}
            >
              {day.frozen
                ? [0, 1, 2].map((k) => (
                    <View
                      key={k}
                      style={{ position: 'absolute', width: s * 1.6, height: 1.2, left: -s * 0.3, top: (k + 0.5) * (s / 3), backgroundColor: alpha(t.accent, 0.7), transform: [{ rotate: '-45deg' }] }}
                    />
                  ))
                : null}
            </View>
          );
        };
        const legendText = { ...textStyle(t.bodyStyle, t.muted), fontSize: 11 };
        return (
          <View testID="activity-heatmap" style={styles.end} accessible accessibilityLabel={`${h.days.filter((d) => d.count > 0).length} / ${h.days.length}`}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: g }}>
              {Array.from({ length: columns }, (_, col) => (
                <View key={col} style={{ gap: g }}>
                  {Array.from({ length: 7 }, (_, row) => (
                    <View key={row}>{cell(col * 7 + row - offset)}</View>
                  ))}
                </View>
              ))}
            </ScrollView>
            {(props.showLegend ?? true) ? (
              <View style={[styles.row, { marginTop: g * 2, gap: g }]}>
                <Text style={legendText}>{texts.programs.heatmapLess}</Text>
                {[0, 1, 2, 3, 4].map((l) => (
                  <View key={l} style={{ width: s, height: s, borderRadius: s / 4, backgroundColor: color(l) }} />
                ))}
                <Text style={legendText}>{texts.programs.heatmapMore}</Text>
              </View>
            ) : null}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  fire: { fontSize: 28, marginRight: 8 },
  shrink: { flexShrink: 1 },
  chip: { marginLeft: 8, paddingHorizontal: 8, paddingVertical: 2, flexShrink: 1 },
  m4: { marginTop: 4 },
  m8: { marginTop: 8 },
  mb8: { marginBottom: 8 },
  end: { alignItems: 'flex-end' },
});
