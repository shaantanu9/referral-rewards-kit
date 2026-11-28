import { useEffect, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  LeagueTierChange,
  RewardsEvent,
  RewardsEventName,
  SocialTaskStatus,
  type FriendStreakState,
  type LeagueMember,
  type LeagueState,
  type RewardsController,
  type RewardsTexts,
  type SocialTaskState,
} from '@myind/rewards-core';
import { useRewardsKit } from '../context';
import { alpha, announce, Button, cardStyle, textStyle } from '../ui/primitives';
import { Countdown, RewardsListener } from './base';
import { useAction } from '../ui/action';

const mono = { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) };

export interface SocialTagTaskProps {
  controller: RewardsController;
  program: string;
  texts?: RewardsTexts;
  /** Opens Instagram (the app or `https://instagram.com/<account>`, e.g. with `Linking`). Hidden when not given. */
  onOpenInstagram?: (account: string) => void;
  /** Copies the code; default the provider's `copyText`. Without either the code is selectable text only. */
  onCopy?: (code: string) => Promise<void>;
  /** While pending, offer "Link to your post" (`rewards_social_submit_link`) for when the webhook misses it. */
  showLinkField?: boolean;
  /** Your own look. `start(handle)` resolves to null or a reason. */
  render?: (task: SocialTaskState, start: (handle: string) => Promise<string | null>) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * "Tag us on Instagram" (ADR 0002 §6.3): username → code → post with the code → verified by the server. Opening
 * Instagram is the app's job ([onOpenInstagram]), so the package adds no dependency.
 */
export function SocialTagTask(props: SocialTagTaskProps): ReactNode {
  const kit = useRewardsKit();
  const x = props.texts ?? kit.texts;
  const c = props.controller;
  const { busy, reason, run } = useAction();
  const [handle, setHandle] = useState('');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const copyText = props.onCopy ?? kit.copyText;

  const start = (h: string): Promise<string | null> => run(() => c.startSocial(props.program, h));
  const copy = async (code: string): Promise<void> => {
    if (!copyText) return;
    try {
      await copyText(code);
    } catch {
      return;
    }
    c.client.report(new RewardsEvent(RewardsEventName.socialCodeCopied, { program: props.program }));
    setCopied(true);
    announce(x.codeCopied);
  };
  const open = (account: string): void => {
    c.client.report(new RewardsEvent(RewardsEventName.instagramOpened, { program: props.program }));
    props.onOpenInstagram?.(account);
  };

  return (
    <RewardsListener
      controller={c}
      render={() => {
        const task = c.state.socialTask(props.program);
        if (task == null) return null;
        if (props.render) return props.render(task, start);
        const t = kit.theme;
        const body = textStyle(t.bodyStyle, t.muted);
        const field = [textStyle(t.bodyStyle, t.onSurface), styles.field, { borderColor: t.muted }];
        let children: ReactNode;
        switch (task.status) {
          case SocialTaskStatus.pending:
            children = (
              <>
                <Text style={body}>{x.socialSteps(task.account)}</Text>
                <View style={[styles.row, styles.m8]}>
                  <Text selectable testID="social-code" style={[textStyle(t.numberStyle, t.onSurface), mono]}>
                    {task.code ?? ''}
                  </Text>
                  {copyText ? (
                    <Button theme={t} variant="text" label={copied ? x.codeCopied : x.copyCode} onPress={() => void copy(task.code ?? '')} />
                  ) : null}
                </View>
                <Text style={body}>{x.socialDisclose}</Text>
                {props.onOpenInstagram ? (
                  <View style={[styles.start, styles.m8]}>
                    <Button theme={t} label={x.openInstagram} onPress={() => open(task.account)} />
                  </View>
                ) : null}
                <View style={styles.m8}>
                  <Countdown endsAt={task.expiresAt} clock={c.clock} prefix={x.socialCheckingIn} style={body} />
                </View>
                {props.showLinkField ? (
                  task.postUrl != null ? (
                    <Text style={textStyle(t.bodyStyle, t.success)}>{x.programs.postLinkSent}</Text>
                  ) : (
                    <>
                      <TextInput
                        testID="social-link"
                        accessibilityLabel={x.programs.postLinkLabel}
                        placeholder={x.programs.postLinkLabel}
                        placeholderTextColor={t.muted}
                        value={link}
                        onChangeText={setLink}
                        keyboardType="url"
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={field}
                      />
                      {reason != null ? <Text style={textStyle(t.bodyStyle, t.warning)}>{x.error(reason)}</Text> : null}
                      <View style={styles.start}>
                        <Button theme={t} variant="text" label={x.programs.postLinkSend} disabled={busy} onPress={() => void run(() => c.submitSocialLink(props.program, link))} />
                      </View>
                    </>
                  )
                ) : null}
              </>
            );
            break;
          case SocialTaskStatus.verified:
            children = <Text style={textStyle(t.bodyStyle, t.success)}>{x.socialVerified}</Text>;
            break;
          case SocialTaskStatus.cooldown:
            children = (
              <>
                <Text style={textStyle(t.bodyStyle, t.success)}>{x.socialVerified}</Text>
                <Countdown endsAt={task.expiresAt} clock={c.clock} prefix={x.socialCooldown} style={body} />
              </>
            );
            break;
          case SocialTaskStatus.unknown:
            return null;
          default:
            children = (
              <>
                {task.status === SocialTaskStatus.rejected ? <Text style={body}>{x.socialRejected}</Text> : null}
                {task.status === SocialTaskStatus.expired ? <Text style={body}>{x.socialExpired}</Text> : null}
                <View style={[styles.row, field, styles.m8]}>
                  <Text style={textStyle(t.bodyStyle, t.muted)}>@</Text>
                  <TextInput
                    testID="social-handle"
                    accessibilityLabel={x.socialHandleLabel}
                    placeholder={x.socialHandleLabel}
                    placeholderTextColor={t.muted}
                    value={handle}
                    onChangeText={setHandle}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    style={[textStyle(t.bodyStyle, t.onSurface), styles.flex]}
                  />
                </View>
                {reason != null ? <Text style={textStyle(t.bodyStyle, t.warning)}>{x.error(reason)}</Text> : null}
                <View style={[styles.start, styles.m8]}>
                  <Button theme={t} label={x.socialStart} disabled={busy} onPress={() => void start(handle)} />
                </View>
              </>
            );
        }
        return (
          <View testID="social-tag-task" style={[cardStyle(t), props.style]}>
            <Text accessibilityRole="header" style={textStyle(t.titleStyle, t.onSurface)}>
              {x.socialTitle(task.account)}
            </Text>
            <Text style={[textStyle(t.bodyStyle, t.onSurface), styles.mb8]}>{x.rewards(task.rewards)}</Text>
            {children}
          </View>
        );
      }}
    />
  );
}

export interface FriendStreaksProps {
  controller: RewardsController;
  program: string;
  title?: string;
  texts?: RewardsTexts;
  /** Shares the invite code the app's way (e.g. React Native `Share`). Without it the code is shown to copy. */
  onShareInvite?: (code: string) => void;
  /** Your own look; use the controller's `friendInvite`, `invite`, `friendAccept`, `friendRemove`. */
  render?: (friends: readonly FriendStreakState[], controller: RewardsController) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Streaks kept with friends: each friend's days together and who still has to act today; invite, accept, end. */
export function FriendStreaks(props: FriendStreaksProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const c = props.controller;
  const { busy, reason, run } = useAction();
  const [code, setCode] = useState('');
  const invite = (): void => {
    void run(async () => {
      const r = await c.friendInvite(props.program);
      if (r == null) {
        const shared = c.invite(props.program)?.code;
        if (shared != null) props.onShareInvite?.(shared);
      }
      return r;
    });
  };
  const accept = (): void => {
    void run(async () => {
      const r = await c.friendAccept(code);
      if (r == null) setCode('');
      return r;
    });
  };
  return (
    <RewardsListener
      controller={c}
      render={() => {
        const friends = c.state.friendsOf(props.program);
        if (props.render) return props.render(friends, c);
        const t = kit.theme;
        const x = texts.programs;
        const muted = textStyle(t.bodyStyle, t.muted);
        const mine = c.invite(props.program);
        return (
          <View testID="friend-streaks" style={[cardStyle(t), props.style]}>
            <Text accessibilityRole="header" style={textStyle(t.titleStyle, t.onSurface)}>
              {props.title ?? x.friendsTitle}
            </Text>
            {friends.length === 0 ? <Text style={muted}>{x.friendsEmpty}</Text> : null}
            {friends.map((f) => (
              <View key={f.pairId} style={[styles.row, styles.py4]}>
                <Text accessibilityElementsHidden importantForAccessibility="no" style={{ color: f.todayBoth ? t.accent : t.muted }}>
                  🔥
                </Text>
                <View style={[styles.flex, styles.ml8]}>
                  <Text style={textStyle(t.bodyStyle, t.onSurface)}>{`${f.friendName}  ·  ${x.friendDays(f.current)}`}</Text>
                  <Text style={muted}>{f.todayBoth ? x.friendBothDone : f.todayMe ? x.friendWaiting(f.friendName) : x.friendYourTurn}</Text>
                </View>
                <Button theme={t} variant="text" label={x.friendRemove} disabled={busy} onPress={() => void run(() => c.friendRemove(f.pairId))} />
              </View>
            ))}
            <View style={[styles.start, styles.m8]}>
              <Button theme={t} icon="＋" label={x.friendInvite} disabled={busy} onPress={invite} />
            </View>
            {mine != null && !props.onShareInvite ? (
              <Text selectable testID="friend-invite-code" style={[textStyle(t.numberStyle, t.onSurface), mono]}>
                {mine.code}
              </Text>
            ) : null}
            <View style={[styles.row, styles.m8]}>
              <TextInput
                testID="friend-code"
                accessibilityLabel={x.friendCodeLabel}
                placeholder={x.friendCodeLabel}
                placeholderTextColor={t.muted}
                value={code}
                onChangeText={setCode}
                autoCapitalize="characters"
                autoCorrect={false}
                spellCheck={false}
                style={[textStyle(t.bodyStyle, t.onSurface), styles.field, styles.flex, { borderColor: t.muted }]}
              />
              <Button theme={t} variant="outlined" label={x.friendAccept} disabled={busy} onPress={accept} style={styles.ml8} />
            </View>
            {reason != null ? <Text style={textStyle(t.bodyStyle, t.warning)}>{texts.error(reason)}</Text> : null}
          </View>
        );
      }}
    />
  );
}

/** The first [max] rows, plus the user's own row when it is further down. */
export function leagueRows(all: readonly LeagueMember[], max: number | null | undefined): readonly LeagueMember[] {
  if (max == null || all.length <= max) return all;
  const top = all.slice(0, max);
  if (!top.some((m) => m.me)) {
    const me = all.slice(max).find((m) => m.me);
    if (me) return [...top, me];
  }
  return top;
}

export interface LeagueBoardProps {
  controller: RewardsController;
  program: string;
  /** Default: the program's `public.title`, else "Weekly league". */
  title?: string;
  texts?: RewardsTexts;
  /** At most this many rows (the user's own row is always shown). */
  maxRows?: number;
  /** Your own look; use the controller's `joinLeague`, `leaveLeague`, `loadLeague`. */
  render?: (league: LeagueState, controller: RewardsController) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * An opt-in weekly league (ADR 0002 §18.10). Before joining: what it is, what is shared, and Join. After: the tier,
 * the real time left, the board (display names and points only, the user's own row marked), who moves up, what each
 * place pays, last week's own result, and Leave. Nothing marks who moves down. Loads `rewards_league` itself.
 */
export function LeagueBoard(props: LeagueBoardProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const c = props.controller;
  const { busy, reason, run } = useAction();
  useEffect(() => {
    if (c.league(props.program) == null) void c.loadLeague(props.program);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, props.program]);
  return (
    <RewardsListener
      controller={c}
      render={() => {
        const l = c.league(props.program);
        if (l == null) return null;
        if (props.render) return props.render(l, c);
        const t = kit.theme;
        const x = texts.leagues;
        const body = textStyle(t.bodyStyle, t.onSurface);
        const muted = textStyle(t.bodyStyle, t.muted);
        const pub = c.state.program(props.program)?.public['title'];
        const title = props.title ?? (pub == null ? x.title : String(pub));
        const row = (m: LeagueMember, i: number): ReactNode => {
          const style = [body, m.me ? styles.bold : null];
          const name = m.name ?? (m.me ? x.you : x.member);
          return (
            <View key={i} testID={m.me ? 'league-me' : undefined} style={[styles.row, styles.member, m.me ? { backgroundColor: alpha(t.accent, 0.12), borderRadius: 8 } : null]}>
              <Text style={[style, styles.rank]}>{m.rank == null ? '–' : x.place(m.rank)}</Text>
              <Text numberOfLines={1} style={[style, styles.flex]}>
                {m.me && m.name != null ? `${name} (${x.you})` : name}
              </Text>
              <Text style={style}>{x.points(m.score)}</Text>
            </View>
          );
        };
        return (
          <View testID="league-board" style={[cardStyle(t), props.style]}>
            <View style={styles.row}>
              <Text accessibilityRole="header" style={[textStyle(t.titleStyle, t.onSurface), styles.flex]}>
                {title}
              </Text>
              {l.joined && l.tierName != null ? (
                <View style={[styles.chip, { borderColor: t.muted }]}>
                  <Text style={body}>{`🏆 ${l.tierName}`}</Text>
                </View>
              ) : null}
            </View>
            {!l.live ? (
              <Text style={muted}>{x.notLive}</Text>
            ) : !l.joined ? (
              <>
                <Text style={[body, styles.m4]}>{x.pitch(l.groupSize)}</Text>
                <View style={[styles.start, styles.m8]}>
                  <Button theme={t} label={x.join} disabled={busy} onPress={() => void run(() => c.joinLeague(props.program))} />
                </View>
              </>
            ) : (
              <>
                <Countdown endsAt={l.endsAt} clock={c.clock} prefix={x.weekEndsIn} style={muted} hidden={c.state.choices.timersOff} />
                {l.lastWeek != null ? (
                  <View style={styles.m4}>
                    <Text style={muted}>{x.lastWeek(l.lastWeek.rank, l.lastWeek.score)}</Text>
                    {l.lastWeek.tierChange === LeagueTierChange.up ? <Text style={textStyle(t.bodyStyle, t.success)}>{x.movedUp(l.tierName)}</Text> : null}
                  </View>
                ) : null}
                <View style={styles.m8}>{leagueRows(l.members, props.maxRows).map(row)}</View>
                {l.canMoveUp ? <Text style={[muted, styles.m8]}>{x.movesUp(l.promote, l.nextTierName)}</Text> : null}
              </>
            )}
            {l.live && l.rewards.length > 0 ? (
              <View style={styles.m8}>
                {l.rewards.map((r, i) =>
                  r.threshold != null ? (
                    <Text key={i} style={muted}>
                      {x.placeReward(r.threshold, texts.reward(r))}
                    </Text>
                  ) : null,
                )}
              </View>
            ) : null}
            {l.joined ? (
              <View style={styles.end}>
                <Button theme={t} variant="text" label={x.leave} disabled={busy} onPress={() => void run(() => c.leaveLeague(props.program))} />
              </View>
            ) : null}
            {reason != null ? <Text style={textStyle(t.bodyStyle, t.warning)}>{texts.error(reason)}</Text> : null}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  start: { alignItems: 'flex-start' },
  end: { alignItems: 'flex-end' },
  m4: { marginTop: 4 },
  m8: { marginTop: 8 },
  mb8: { marginBottom: 8 },
  ml8: { marginLeft: 8 },
  py4: { paddingVertical: 4 },
  field: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, minHeight: 48 },
  bold: { fontWeight: '700' },
  member: { paddingHorizontal: 8, paddingVertical: 6 },
  rank: { width: 40 },
  chip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
});
