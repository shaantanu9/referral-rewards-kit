import { forwardRef, useEffect, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { RewardSpec, type DayInput, type Recap, type RewardsController, type RewardsTexts } from '@myind/rewards-core';
import { useRewardsKit } from '../context';
import { alpha, cardStyle, textStyle } from '../ui/primitives';
import { RewardsListener } from './base';

/** The first and last day of calendar [year] (UTC), for `controller.loadRecap(...)` and a "Your 2026" card. */
export function recapYear(year: number): readonly [Date, Date] {
  return [new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year, 11, 31))];
}

export interface RecapCardProps {
  controller: RewardsController;
  /** First and last local day (dates or `YYYY-MM-DD`; the time of day is ignored). */
  from: DayInput;
  to: DayInput;
  title?: string;
  texts?: RewardsTexts;
  render?: (recap: Recap) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A recap between two local days ("your week", "your year"): days active, best streak, what was earned, what was
 * done, badges. Loads `rewards_recap` itself once.
 */
export function RecapCard(props: RecapCardProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const c = props.controller;
  useEffect(() => {
    if (c.recap(props.from, props.to) == null) void c.loadRecap(props.from, props.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c]);
  return (
    <RewardsListener
      controller={c}
      render={() => {
        const r = c.recap(props.from, props.to);
        if (r == null) return null;
        if (props.render) return props.render(r);
        const t = kit.theme;
        const x = texts.programs;
        const body = textStyle(t.bodyStyle, t.onSurface);
        const muted = textStyle(t.bodyStyle, t.muted);
        return (
          <View testID="recap-card" style={[cardStyle(t), props.style]}>
            <Text accessibilityRole="header" style={textStyle(t.titleStyle, t.onSurface)}>
              {props.title ?? x.recapTitle}
            </Text>
            <Text style={[textStyle(t.numberStyle, t.onSurface), styles.m8]}>{x.recapDaysActive(r.daysActive)}</Text>
            <Text style={body}>{x.recapBestStreak(r.bestStreak)}</Text>
            {r.grants.length > 0 ? (
              <View style={styles.m8}>
                <Text style={muted}>{x.recapEarned}</Text>
                {r.grants.map((g, i) => (
                  <Text key={i} style={body}>
                    {texts.reward(g.spec)}
                  </Text>
                ))}
              </View>
            ) : null}
            {r.events.length > 0 ? (
              <View style={styles.m8}>
                {r.events.map((e, i) => (
                  <Text key={i} style={muted}>
                    {x.recapEvent(e.type, e.count)}
                  </Text>
                ))}
              </View>
            ) : null}
            {r.badges.length > 0 ? (
              <View style={[styles.wrap, styles.m8]}>
                {r.badges.map((b, i) => (
                  <View key={i} style={[styles.chip, { borderColor: alpha(t.muted, 0.5) }]}>
                    <Text style={body}>{`🏅 ${texts.reward(new RewardSpec({ kind: 'badge', amount: 1, params: { badge: b.badge } }))}`}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      }}
    />
  );
}

export interface RewardsRecapCardProps {
  recap: Recap;
  /** Default: "Your 2026" when the recap is one whole calendar year, else "Your recap". */
  title?: string;
  /** A line under the title, e.g. the app's name. */
  subtitle?: string;
  /** At the bottom, e.g. the app's logo or address. */
  footer?: ReactNode;
  /** Width / height (default 4:5, a feed post; 9/16 for stories; null = natural height). */
  aspectRatio?: number | null;
  /** How many "most done" lines. Default 3. */
  maxEvents?: number;
  texts?: RewardsTexts;
  /** Replaces the whole look; still wrapped by the captured view, so a custom card shares the same way. */
  render?: (recap: Recap) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** The default title for [recap]: "Your 2026" for one whole calendar year, else "Your recap". */
export function recapTitle(recap: Recap, texts: RewardsTexts): string {
  const f = recap.from,
    to = recap.to;
  if (
    f != null &&
    to != null &&
    f.getUTCFullYear() === to.getUTCFullYear() &&
    f.getUTCMonth() === 0 &&
    f.getUTCDate() === 1 &&
    to.getUTCMonth() === 11 &&
    to.getUTCDate() === 31
  ) {
    return texts.recapCard.yearTitle(f.getUTCFullYear());
  }
  return texts.recapCard.rangeTitle;
}

/**
 * A shareable recap card ("Your 2026"): days active, best streak and badges as big numbers, what was done most, and
 * what was earned, from a [Recap] the app already loaded. No loading, no sharing: pass a ref and, after the user taps
 * the app's Share button, capture it with `captureRecapCard(ref)` from `@myind/rewards-react-native/view-shot`.
 */
export const RewardsRecapCard = forwardRef<unknown, RewardsRecapCardProps>(function RewardsRecapCard(props, ref) {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const t = kit.theme;
  const ratio = props.aspectRatio === undefined ? 4 / 5 : props.aspectRatio;
  const fixed = ratio != null;
  const r = props.recap;
  const x = texts.recapCard;
  let content: ReactNode;
  if (props.render) {
    content = props.render(r);
  } else {
    const fg = t.onAccent;
    const soft = alpha(fg, 0.8);
    const body = textStyle(t.bodyStyle, fg);
    const label = textStyle(t.bodyStyle, soft);
    const events = r.events.slice(0, props.maxEvents ?? 3);
    const grants = r.grants.slice(0, 3);
    const gap = (h: number): ReactNode => <View style={fixed ? styles.flex : { height: h }} />;
    const stat = (value: number, text: string): ReactNode => (
      <View style={styles.flex} accessible accessibilityLabel={`${value} ${text}`}>
        <Text adjustsFontSizeToFit numberOfLines={1} style={[textStyle(t.numberStyle, fg), styles.stat]}>
          {String(value)}
        </Text>
        <Text numberOfLines={2} style={label}>
          {text}
        </Text>
      </View>
    );
    content = (
      <View testID="rewards-recap-card" style={[styles.share, { backgroundColor: t.accent, borderRadius: t.radius }, fixed ? styles.flex : null]}>
        <Text accessibilityRole="header" numberOfLines={2} style={[styles.title, { color: fg }]}>
          {props.title ?? recapTitle(r, texts)}
        </Text>
        {props.subtitle != null ? (
          <Text numberOfLines={1} style={label}>
            {props.subtitle}
          </Text>
        ) : null}
        {gap(20)}
        <View style={styles.row}>
          {stat(r.daysActive, x.daysActive(r.daysActive))}
          {stat(r.bestStreak, x.bestStreak(r.bestStreak))}
          {stat(r.badges.length, x.badges(r.badges.length))}
        </View>
        {gap(20)}
        {events.length > 0 ? (
          <View style={styles.mb12}>
            <Text style={label}>{x.mostDone}</Text>
            {events.map((e, i) => (
              <Text key={i} numberOfLines={1} style={body}>
                {texts.programs.recapEvent(e.type, e.count)}
              </Text>
            ))}
          </View>
        ) : null}
        {grants.length > 0 ? (
          <View>
            <Text style={label}>{x.earned}</Text>
            <Text numberOfLines={2} style={body}>
              {grants.map((g) => texts.reward(new RewardSpec({ kind: g.kind, amount: g.amount }))).join(' · ')}
            </Text>
          </View>
        ) : null}
        {props.footer != null ? <View style={styles.m12}>{props.footer}</View> : null}
      </View>
    );
  }
  return (
    <View ref={ref as never} collapsable={false} style={[fixed ? { aspectRatio: ratio } : null, props.style]}>
      {content}
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  m8: { marginTop: 8 },
  m12: { marginTop: 12 },
  mb12: { marginBottom: 12 },
  share: { padding: 24 },
  title: { fontSize: 28, lineHeight: 36, fontWeight: '800' },
  stat: { fontSize: 40, lineHeight: 48 },
});
