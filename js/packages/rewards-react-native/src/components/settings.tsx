import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  FollowupPrefs,
  formatReminderTime,
  RewardsChoices,
  RewardsEvent,
  RewardsEventName,
  RewardsException,
  RewardsServerError,
  RewardsUnavailableException,
  type RewardsController,
  type RewardsTexts,
  type RewardsTheme,
  type TimeOfDay,
} from '@myind/rewards-core';
import { useRewardsKit } from '../context';
import { alpha, Button, cardStyle, minTarget, textStyle } from '../ui/primitives';
import { RewardsListener } from './base';

/** Saves a patch of follow-up choices; resolves to null or a reason. */
export type FollowupPrefsSave = (patch: Readonly<Record<string, unknown>>) => Promise<string | null>;

/** Asks the user for a time; resolve null when they cancel. */
export type PickTime = (initial: TimeOfDay) => Promise<TimeOfDay | null>;

export interface FollowupSettingsProps {
  controller: RewardsController;
  texts?: RewardsTexts;
  /** The emails switch. Hide it in an app that never sends follow-up emails. Default true. */
  showEmails?: boolean;
  /** Where the picker starts when the user has not picked a time. Default 19:00. */
  defaultReminderTime?: TimeOfDay;
  /** The streak / surprise / timer switches (0.7). Default false. */
  showChoices?: boolean;
  /** Called after every successful save with what the server now holds (e.g. `scheduler.replanNow()`). */
  onChanged?: (prefs: FollowupPrefs) => void;
  /** Your own time picker (e.g. `@react-native-community/datetimepicker`); default a small built-in dialog. */
  pickTime?: PickTime;
  /** Your own look. `prefs` null until loaded (or on failure with `reason`). */
  render?: (prefs: FollowupPrefs | null, save: FollowupPrefsSave, reason: string | null) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

const reasonOf = (e: unknown): string =>
  e instanceof RewardsUnavailableException ? 'unavailable' : e instanceof RewardsException ? e.reason : e instanceof RewardsServerError ? 'server_error' : 'offline';

function SwitchRow(props: { t: RewardsTheme; title: string; hint?: string; value: boolean; disabled?: boolean; inset?: boolean; onChange: (on: boolean) => void; testID?: string }): ReactNode {
  const { t } = props;
  return (
    <View style={[styles.switchRow, props.inset ? styles.inset : null]}>
      <View style={styles.flex}>
        <Text style={textStyle(t.bodyStyle, props.disabled ? alpha(t.onSurface, 0.45) : t.onSurface)}>{props.title}</Text>
        {props.hint ? <Text style={textStyle(t.bodyStyle, t.muted)}>{props.hint}</Text> : null}
      </View>
      <Switch
        testID={props.testID}
        accessibilityLabel={props.title}
        accessibilityHint={props.hint}
        value={props.value}
        disabled={props.disabled ?? false}
        onValueChange={props.onChange}
        trackColor={{ true: t.accent, false: alpha(t.muted, 0.4) }}
      />
    </View>
  );
}

/** A small dialog with hour and minute steppers (5-minute steps), no extra dependency. */
function TimeDialog(props: { t: RewardsTheme; initial: TimeOfDay; title: string; onDone: (v: TimeOfDay | null) => void }): ReactNode {
  const { t } = props;
  const [h, setH] = useState(props.initial.hour);
  const [m, setM] = useState(props.initial.minute);
  const step = (label: string, onPress: () => void): ReactNode => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.stepper}>
      <Text style={textStyle(t.titleStyle, t.accent)}>{label.startsWith('+') || label.includes('later') ? '▲' : '▼'}</Text>
    </Pressable>
  );
  const two = (n: number): string => String(n).padStart(2, '0');
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => props.onDone(null)}>
      <View style={styles.scrim}>
        <View accessibilityViewIsModal style={[cardStyle(t), styles.dialog]}>
          <Text accessibilityRole="header" style={textStyle(t.titleStyle, t.onSurface)}>
            {props.title}
          </Text>
          <View style={styles.time} accessible accessibilityLabel={`${two(h)}:${two(m)}`}>
            <View style={styles.center}>
              {step('Hour later', () => setH((h + 1) % 24))}
              <Text style={textStyle(t.numberStyle, t.onSurface)}>{two(h)}</Text>
              {step('Hour earlier', () => setH((h + 23) % 24))}
            </View>
            <Text style={textStyle(t.numberStyle, t.onSurface)}>:</Text>
            <View style={styles.center}>
              {step('Minutes later', () => setM((m + 5) % 60))}
              <Text style={textStyle(t.numberStyle, t.onSurface)}>{two(m)}</Text>
              {step('Minutes earlier', () => setM((m + 55) % 60))}
            </View>
          </View>
          <View style={styles.actions}>
            <Button theme={t} variant="text" label="Cancel" onPress={() => props.onDone(null)} />
            <Button theme={t} testID="time-ok" label="OK" onPress={() => props.onDone({ hour: h, minute: m })} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The user's follow-up choices: "Reminders", one switch per kind of reminder (off while reminders are off), "Emails
 * about my progress" and the reminder time. Loads after mount and saves each change at once; a failed save is undone
 * and shows a short line. With [showChoices] a second section, "How rewards look", has the streak / surprise / timer
 * switches; a saved choice is applied to the controller at once (`controller.applyChoices`).
 */
export function FollowupSettings(props: FollowupSettingsProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const t = kit.theme;
  const c = props.controller;
  const [prefs, setPrefs] = useState<FollowupPrefs | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<TimeOfDay | null>(null);
  const alive = useRef(true);
  const current = useRef<FollowupPrefs | null>(null);
  current.current = prefs;

  const load = async (): Promise<void> => {
    setLoading(true);
    setReason(null);
    try {
      const p = await c.client.followupPrefs();
      if (alive.current) setPrefs(p);
    } catch (e) {
      if (alive.current) setReason(reasonOf(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  };

  useEffect(() => {
    alive.current = true;
    const id = setTimeout(() => void load(), 0);
    return () => {
      alive.current = false;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c]);

  const save: FollowupPrefsSave = async (patch) => {
    const before = current.current;
    if (before) setPrefs(before.patched(patch));
    setReason(null);
    try {
      const p = await c.client.followupPrefs(patch);
      if (alive.current) setPrefs(p);
      if (Object.keys(patch).some((k) => RewardsChoices.keys.has(k))) void c.applyChoices(p.choices);
      props.onChanged?.(p);
      return null;
    } catch (e) {
      const r = reasonOf(e);
      if (alive.current) {
        setPrefs(before);
        setReason(r);
      }
      return r;
    }
  };

  const pickTime = async (p: FollowupPrefs): Promise<void> => {
    const initial = p.reminderTime ?? props.defaultReminderTime ?? { hour: 19, minute: 0 };
    if (props.pickTime) {
      const v = await props.pickTime(initial);
      if (v != null && alive.current) await save({ [FollowupPrefs.reminderTimeKey]: v });
      return;
    }
    setPicking(initial);
  };

  if (props.render) return <>{props.render(prefs, save, reason)}</>;
  const x = texts.followups;
  const f = texts.fairPlay;
  const muted = textStyle(t.bodyStyle, t.muted);
  return (
    <View testID="followup-settings" style={[cardStyle(t), props.style]}>
      <Text accessibilityRole="header" style={textStyle(t.titleStyle, t.onSurface)}>
        {x.title}
      </Text>
      {prefs == null && loading ? <ActivityIndicator color={t.accent} style={styles.py12} /> : null}
      {prefs != null ? (
        <>
          <SwitchRow t={t} testID="followup-reminders" title={x.reminders} hint={x.remindersHint} value={!prefs.notificationsOff} onChange={(on) => void save({ [FollowupPrefs.notificationsOffKey]: !on })} />
          {prefs.groups.map((g) => (
            <SwitchRow
              key={g.group}
              t={t}
              inset
              testID={`followup-group-${g.group}`}
              title={g.label}
              value={!g.muted}
              disabled={prefs.notificationsOff}
              onChange={(on) => void save(prefs.groupMutedPatch(g.group, !on))}
            />
          ))}
          {(props.showEmails ?? true) ? (
            <SwitchRow t={t} testID="followup-emails" title={x.emails} hint={x.emailsHint} value={!prefs.emailsOff} onChange={(on) => void save({ [FollowupPrefs.emailsOffKey]: !on })} />
          ) : null}
          <Pressable
            testID="followup-time"
            accessibilityRole="button"
            accessibilityLabel={`${x.reminderTime}: ${formatReminderTime(prefs.reminderTime) ?? x.reminderTimeDefault}`}
            accessibilityState={{ disabled: prefs.notificationsOff }}
            disabled={prefs.notificationsOff}
            onPress={() => void pickTime(prefs)}
            style={[styles.switchRow, prefs.notificationsOff ? styles.dim : null]}
          >
            <Text style={[textStyle(t.bodyStyle, t.onSurface), styles.flex]}>{x.reminderTime}</Text>
            <Text style={muted}>{formatReminderTime(prefs.reminderTime) ?? x.reminderTimeDefault}</Text>
          </Pressable>
          {props.showChoices ? (
            <View style={styles.m12}>
              <Text accessibilityRole="header" style={textStyle(t.titleStyle, t.onSurface)}>
                {f.choicesTitle}
              </Text>
              <SwitchRow t={t} testID="choice-streaks" title={f.showStreaks} hint={f.showStreaksHint} value={!prefs.choices.streaksOff} onChange={(on) => void save({ [RewardsChoices.streaksOffKey]: !on })} />
              <SwitchRow t={t} testID="choice-surprises" title={f.surprises} hint={f.surprisesHint} value={!prefs.choices.surprisesOff} onChange={(on) => void save({ [RewardsChoices.surprisesOffKey]: !on })} />
              <SwitchRow t={t} testID="choice-timers" title={f.showTimers} hint={f.showTimersHint} value={!prefs.choices.timersOff} onChange={(on) => void save({ [RewardsChoices.timersOffKey]: !on })} />
            </View>
          ) : null}
        </>
      ) : null}
      {reason != null ? (
        <Text accessibilityLiveRegion="polite" style={textStyle(t.bodyStyle, t.warning)}>
          {texts.error(reason)}
        </Text>
      ) : null}
      {prefs == null && !loading && reason != null ? (
        <View style={styles.start}>
          <Button theme={t} variant="text" label={x.retry} onPress={() => void load()} />
        </View>
      ) : null}
      {picking != null ? (
        <TimeDialog
          t={t}
          title={x.reminderTime}
          initial={picking}
          onDone={(v) => {
            setPicking(null);
            if (v != null) void save({ [FollowupPrefs.reminderTimeKey]: v });
          }}
        />
      ) : null}
    </View>
  );
}

export interface RewardedAdButtonProps {
  controller: RewardsController;
  /** The app's text, e.g. "Watch an ad for 10 coins". */
  label: string;
  /** Shows the ad (RevenueCat's AdMob adapter); resolves true when the reward was verified. */
  onShowAd: () => Promise<boolean>;
  /** Hidden when false (your copy of `settings.ads_enabled` / ad availability). Default true. */
  enabled?: boolean;
  /** Reloads after a verified reward (RevenueCat's webhook arrives a little later). Default 5 s and 20 s. */
  refreshAfterMs?: readonly number[];
  texts?: RewardsTexts;
  /** Your own look. `show` is null while an ad is showing; `message` is the last not-verified / error line. */
  render?: (show: (() => void) | null, busy: boolean, message: string | null) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * "Watch an ad for 10 coins". The app shows the ad in [onShowAd]; the package depends on neither RevenueCat nor
 * AdMob. After a verified reward the state is reloaded now and after each of [refreshAfterMs].
 */
export function RewardedAdButton(props: RewardedAdButtonProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const c = props.controller;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
    };
  }, []);
  const report = (result: string): void => c.client.report(new RewardsEvent(RewardsEventName.adRewardShown, { result }));
  const show = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    let ok = false;
    let line: string | null = null;
    try {
      ok = await props.onShowAd();
      report(ok ? 'verified' : 'not_verified');
      if (!ok) line = texts.programs.adNotVerified;
    } catch {
      ok = false;
      report('error');
      line = texts.programs.adError;
    }
    if (ok) {
      void c.refresh();
      timers.current.forEach(clearTimeout);
      timers.current = (props.refreshAfterMs ?? [5000, 20000]).map((ms) => setTimeout(() => void c.refresh(), ms));
    }
    if (!alive.current) return;
    setBusy(false);
    setMessage(line);
  };
  if (props.enabled === false) return null;
  return (
    <RewardsListener
      controller={c}
      render={() => {
        const run = busy ? null : () => void show();
        if (props.render) return props.render(run, busy, message);
        const t = kit.theme;
        return (
          <View style={props.style}>
            <Button
              theme={t}
              variant="outlined"
              testID="rewarded-ad"
              label={props.label}
              icon={busy ? <ActivityIndicator size="small" color={t.accent} /> : '▶'}
              onPress={run}
            />
            {message != null ? <Text style={textStyle(t.bodyStyle, t.muted)}>{message}</Text> : null}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  start: { alignItems: 'flex-start' },
  center: { alignItems: 'center' },
  dim: { opacity: 0.45 },
  py12: { paddingVertical: 12 },
  m12: { marginTop: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: minTarget + 4, paddingVertical: 4 },
  inset: { paddingLeft: 24 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { alignSelf: 'stretch', maxWidth: 360 },
  time: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginVertical: 16 },
  stepper: { minWidth: minTarget, minHeight: minTarget, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
