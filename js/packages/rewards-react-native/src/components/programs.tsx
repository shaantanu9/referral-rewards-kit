import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  formatLeft,
  GrantState,
  OfferStatus,
  type OfferState,
  type QuestState,
  type RechargeState,
  type RewardGrant,
  type RewardsController,
  type RewardsTexts,
  type SurpriseOdd,
  type WindowState,
} from '@myind/rewards-core';
import { useRewardsKit } from '../context';
import { alpha, Button, cardStyle, ProgressBar, textStyle } from '../ui/primitives';
import { useAction } from '../ui/action';
import { Countdown, RewardsListener } from './base';

export interface OfferBannerProps {
  controller: RewardsController;
  program: string;
  title?: string;
  texts?: RewardsTexts;
  /** Your own look, for every state. `claim` resolves to null on success or a reason. */
  render?: (offer: OfferState, claim: () => Promise<string | null>) => ReactNode;
  onClaimed?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * A timed offer: the reward, the real time left, and Claim. The deadline and any stock come from the server and never
 * reset (ADR 0002 §8). The default look hides once the offer is claimed, expired or sold out; [render] gets every
 * state.
 */
export function OfferBanner(props: OfferBannerProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const c = props.controller;
  const { busy, reason, run } = useAction();
  const [expiredLocally, setExpiredLocally] = useState(false);
  const claim = (): Promise<string | null> =>
    run(async () => {
      const r = await c.claimOffer(props.program);
      if (r == null) props.onClaimed?.();
      return r;
    });
  return (
    <RewardsListener
      controller={c}
      render={() => {
        let o = c.state.offer(props.program);
        if (o == null) return null;
        if (expiredLocally && o.status === OfferStatus.active) o = o.copyWith({ status: OfferStatus.expired });
        if (props.render) return props.render(o, claim);
        if (o.status !== OfferStatus.active) return null;
        const t = kit.theme;
        return (
          <View testID="offer-banner" style={[cardStyle(t), props.style]}>
            {props.title != null ? <Text style={textStyle(t.titleStyle, t.onSurface)}>{props.title}</Text> : null}
            <Text style={textStyle(t.numberStyle, t.onSurface)}>{texts.rewards(o.rewards)}</Text>
            <View style={[styles.row, styles.m4, styles.wrap]}>
              <Countdown
                endsAt={o.endsAt}
                clock={c.clock}
                prefix={texts.offerEndsIn}
                hidden={c.state.choices.timersOff}
                style={textStyle(t.bodyStyle, t.warning)}
                onExpired={() => setExpiredLocally(true)}
              />
              {o.stockLeft != null ? <Text style={[textStyle(t.bodyStyle, t.muted), styles.ml12]}>{texts.stockLeft(o.stockLeft)}</Text> : null}
            </View>
            {reason != null ? <Text style={[textStyle(t.bodyStyle, t.warning), styles.m4]}>{texts.error(reason)}</Text> : null}
            <View style={[styles.start, styles.m12]}>
              <Button theme={t} testID="offer-claim" label={texts.claim} disabled={busy} onPress={() => void claim()} />
            </View>
          </View>
        );
      }}
    />
  );
}

export interface QuestListProps {
  controller: RewardsController;
  program: string;
  /** Default `texts.programs.questsTitle`. */
  title?: string;
  texts?: RewardsTexts;
  render?: (quest: QuestState, controller: RewardsController) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** A quest set: each task with its progress and reward, the bonus for finishing all, and the real time until reset. */
export function QuestList(props: QuestListProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const c = props.controller;
  return (
    <RewardsListener
      controller={c}
      render={() => {
        const q = c.state.quest(props.program);
        if (q == null) return null;
        if (props.render) return props.render(q, c);
        const t = kit.theme;
        const x = texts.programs;
        const muted = textStyle(t.bodyStyle, t.muted);
        return (
          <View testID="quest-list" style={[cardStyle(t), props.style]}>
            <View style={styles.row}>
              <Text accessibilityRole="header" style={[textStyle(t.titleStyle, t.onSurface), styles.flex]}>
                {props.title ?? x.questsTitle}
              </Text>
              <Countdown endsAt={q.endsAt} clock={c.clock} prefix={x.questResetsIn} hidden={c.state.choices.timersOff} style={muted} onExpired={() => void c.refresh()} />
            </View>
            {q.tasks.map((task) => (
              <View key={task.key} style={[styles.row, styles.task]} accessible accessibilityLabel={`${x.questTask(task)}, ${texts.progress(task.progress, task.count)}`}>
                <Text style={[styles.check, { color: task.done ? t.success : t.muted }]}>{task.done ? '●' : '○'}</Text>
                <View style={styles.flex}>
                  <Text style={textStyle(t.bodyStyle, t.onSurface)}>{x.questTask(task)}</Text>
                  {!task.done && task.count > 1 ? <ProgressBar value={task.fraction} color={t.accent} track={alpha(t.muted, 0.2)} height={4} /> : null}
                </View>
                <Text style={[muted, styles.ml8]}>{task.rewards.length === 0 ? texts.progress(task.progress, task.count) : texts.rewards(task.rewards)}</Text>
              </View>
            ))}
            {q.done ? (
              <Text style={textStyle(t.bodyStyle, t.success)}>{x.questDone}</Text>
            ) : q.bonus.length > 0 ? (
              <Text style={textStyle(t.bodyStyle, t.onSurface)}>{x.questBonus(texts.rewards(q.bonus))}</Text>
            ) : null}
          </View>
        );
      }}
    />
  );
}

export interface RechargeMeterProps {
  controller: RewardsController;
  program: string;
  texts?: RewardsTexts;
  /** A filled unit; default "♥". */
  icon?: string;
  /** An empty unit; default "♡". */
  emptyIcon?: string;
  /** A "Use one" button (`useRecharge`). Off by default: apps usually spend units in their own flow. */
  showUseButton?: boolean;
  /** Your own look. `use` spends one unit and resolves to null or a reason (`empty`). */
  render?: (recharge: RechargeState, use: () => Promise<string | null>) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Units that refill ("3 hearts"): filled and empty icons, and the real time until the next one comes back. At that
 * time the state is reloaded from the server (the phone never adds a unit itself).
 */
export function RechargeMeter(props: RechargeMeterProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const c = props.controller;
  const { busy, reason, run } = useAction();
  const use = (): Promise<string | null> => run(() => c.useRecharge(props.program));
  return (
    <RewardsListener
      controller={c}
      render={() => {
        const r = c.state.recharge(props.program);
        if (r == null) return null;
        if (props.render) return props.render(r, use);
        const t = kit.theme;
        const x = texts.programs;
        const muted = textStyle(t.bodyStyle, t.muted);
        return (
          <View testID="recharge-meter" style={[cardStyle(t), props.style]}>
            <View style={styles.row}>
              <Text accessible accessibilityLabel={`${r.units} / ${r.max}`} style={styles.units}>
                {Array.from({ length: r.max }, (_, i) => (
                  <Text key={i} style={{ color: i < r.units ? t.accent : t.muted }}>
                    {i < r.units ? (props.icon ?? '♥') : (props.emptyIcon ?? '♡')}
                  </Text>
                ))}
              </Text>
              <View style={[styles.flex, styles.ml12]}>
                {r.full || r.nextAt == null ? (
                  <Text style={muted}>{x.rechargeFull}</Text>
                ) : (
                  <Countdown endsAt={r.nextAt} clock={c.clock} prefix={x.rechargeNextIn} style={muted} onExpired={() => void c.refresh()} />
                )}
              </View>
            </View>
            {reason != null ? <Text style={textStyle(t.bodyStyle, t.warning)}>{texts.error(reason)}</Text> : null}
            {props.showUseButton ? (
              <View style={[styles.start, styles.m8]}>
                <Button theme={t} variant="outlined" label={x.rechargeUse} disabled={busy || r.empty} onPress={() => void use()} />
              </View>
            ) : null}
          </View>
        );
      }}
    />
  );
}

export interface WindowBadgeProps {
  controller: RewardsController;
  program: string;
  /** Default: the program's `public.title`, else `texts.programs.windowTitle`. */
  title?: string;
  texts?: RewardsTexts;
  /** Your own look; `open` is whether the window is open now (server clock). */
  render?: (window: WindowState, open: boolean) => ReactNode;
}

/**
 * A time window: "Happy hour: ends in 49m 59s" while open, "starts in 2h 00m" before. Both times are the server's; at
 * either edge the state is reloaded. With timers off an open window shows just its name and a coming one nothing.
 */
export function WindowBadge(props: WindowBadgeProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const c = props.controller;
  const [, bump] = useState(0);
  const edge = (): void => {
    bump((n) => n + 1);
    void c.refresh();
  };
  return (
    <RewardsListener
      controller={c}
      render={() => {
        const w = c.state.window(props.program);
        if (w == null) return null;
        const open = w.activeAt(c.clock.now());
        if (props.render) return props.render(w, open);
        const t = kit.theme;
        const x = texts.programs;
        const pub = c.state.program(props.program)?.public['title'];
        const name = props.title ?? (pub == null ? x.windowTitle : String(pub));
        const deadline = open ? w.endsAt : w.startsAt;
        if (deadline == null) return null;
        const color = open ? t.accent : t.muted;
        const noTimer = c.state.choices.timersOff;
        if (noTimer && !open) return <Countdown endsAt={deadline} clock={c.clock} onExpired={edge} hidden />;
        return (
          <View testID="window-badge" style={[styles.badge, { backgroundColor: alpha(color, 0.12), borderRadius: t.radius }]}>
            <Text accessibilityElementsHidden importantForAccessibility="no" style={{ color }}>
              {open ? '⚡︎' : '◷'}
            </Text>
            <Countdown
              endsAt={deadline}
              clock={c.clock}
              onExpired={edge}
              render={(left) => (
                <Text style={[textStyle(t.bodyStyle, t.onSurface), styles.shrink]}>
                  {noTimer ? name : `${name}: ${open ? x.windowEndsIn : x.windowStartsIn} ${formatLeft(left)}`}
                </Text>
              )}
            />
          </View>
        );
      }}
    />
  );
}

export interface SurpriseOddsProps {
  controller: RewardsController;
  /** Only this program's surprises; all when not given. */
  program?: string;
  /** Default `texts.reveal.oddsTitle` ("Surprises"). */
  title?: string;
  texts?: RewardsTexts;
  render?: (surprises: readonly SurpriseOdd[]) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * The odds of every surprise reward (ADR 0002 §18.6): "1 in 10 chance of 5–50 coins". The odds are always shown,
 * surprises are free only, and the server caps them per day. Nothing when there are none or surprises are off.
 */
export function SurpriseOdds(props: SurpriseOddsProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const c = props.controller;
  return (
    <RewardsListener
      controller={c}
      render={() => {
        const st = c.state;
        const list = props.program == null ? st.surprises : st.surprisesOf(props.program);
        if (list.length === 0 || st.choices.surprisesOff) return null;
        if (props.render) return props.render(list);
        const t = kit.theme;
        return (
          <View testID="surprise-odds" style={[cardStyle(t), styles.gap6, props.style]}>
            <Text accessibilityRole="header" style={textStyle(t.titleStyle, t.onSurface)}>
              {props.title ?? texts.reveal.oddsTitle}
            </Text>
            {list.map((s, i) => (
              <View key={i} style={styles.row}>
                <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.ml0, { color: t.accent }]}>
                  🎁
                </Text>
                <Text style={[textStyle(t.bodyStyle, t.muted), styles.flex, styles.ml8]}>{texts.surpriseOdds(s)}</Text>
              </View>
            ))}
          </View>
        );
      }}
    />
  );
}

export interface RewardInboxProps {
  controller: RewardsController;
  texts?: RewardsTexts;
  /** Show `texts.inboxEmpty` when there is nothing. Default false. */
  showEmpty?: boolean;
  /** Your own look for the whole list; `seen(ids)` marks granted ones seen. */
  render?: (inbox: readonly RewardGrant[], seen: (ids: readonly string[]) => Promise<string | null>) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Rewards not yet seen. Granted ones get "Got it" (marks them seen); pending ones (e.g. Premium days the server has
 * not given yet) show "On its way" and stay until they land.
 */
export function RewardInbox(props: RewardInboxProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const c = props.controller;
  return (
    <RewardsListener
      controller={c}
      render={() => {
        const inbox = c.state.inbox;
        if (props.render) return props.render(inbox, (ids) => c.markSeen(ids));
        const t = kit.theme;
        if (inbox.length === 0) return props.showEmpty ? <Text style={textStyle(t.bodyStyle, t.muted)}>{texts.inboxEmpty}</Text> : null;
        return (
          <View testID="reward-inbox" style={props.style}>
            {inbox.map((g) => (
              <View key={g.id} style={[cardStyle(t), styles.row, styles.mb8]}>
                <Text accessibilityElementsHidden importantForAccessibility="no" style={{ color: t.accent }}>
                  🎁
                </Text>
                <Text style={[textStyle(t.bodyStyle, t.onSurface), styles.flex, styles.ml12]}>{texts.gotReward(texts.reward(g.spec))}</Text>
                {g.state === GrantState.granted ? (
                  <Button theme={t} variant="text" label={texts.gotIt} testID={`inbox-seen-${g.id}`} onPress={() => void c.markSeen([g.id])} />
                ) : (
                  <Text style={textStyle(t.bodyStyle, t.muted)}>{texts.onItsWay}</Text>
                )}
              </View>
            ))}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  start: { alignItems: 'flex-start' },
  m4: { marginTop: 4 },
  m8: { marginTop: 8 },
  m12: { marginTop: 12 },
  mb8: { marginBottom: 8 },
  ml0: { marginLeft: 0 },
  ml8: { marginLeft: 8 },
  ml12: { marginLeft: 12 },
  task: { paddingVertical: 4 },
  check: { fontSize: 18, marginRight: 8 },
  units: { fontSize: 22, letterSpacing: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, alignSelf: 'flex-start' },
  gap6: { gap: 6 },
});
