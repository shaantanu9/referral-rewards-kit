'use client';
import {
  formatReminderTime,
  FollowupPrefs,
  RewardsChoices,
  RewardsException,
  RewardsServerError,
  RewardsUnavailableException,
  type TimeOfDay,
} from '@myind/rewards-core';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useRewardsController, useRewardsTexts } from './context';
import { Card, cx, ProgressBar, type BaseProps } from './internal';

/** Saves a patch of follow-up choices; resolves to null or a reason. */
export type FollowupPrefsSave = (patch: Readonly<Record<string, unknown>>) => Promise<string | null>;

/** The short reason for a failed call (`unavailable`, a refusal, `server_error`, `offline`). */
export function reasonOf(e: unknown): string {
  if (e instanceof RewardsUnavailableException) return 'unavailable';
  if (e instanceof RewardsException) return e.reason;
  if (e instanceof RewardsServerError) return 'server_error';
  return 'offline';
}

/** An on / off switch: a `button` with `role="switch"`, its label and hint linked for screen readers. */
export function Switch(props: {
  readonly label: string;
  readonly hint?: string | null;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (on: boolean) => void;
  readonly nested?: boolean;
}): ReactNode {
  const id = useId();
  return (
    <div className={cx('rk-switch-row', props.nested && 'rk-switch-row--nested', props.disabled && 'rk-switch-row--disabled')}>
      <div className="rk-grow">
        <span id={`${id}-l`}>{props.label}</span>
        {props.hint ? (
          <span id={`${id}-h`} className="rk-muted rk-block">
            {props.hint}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        className="rk-switch"
        aria-checked={props.checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={props.hint ? `${id}-h` : undefined}
        disabled={props.disabled}
        onClick={() => props.onChange(!props.checked)}
      >
        <span className="rk-switch__thumb" aria-hidden="true" />
        <span className="rk-sr-only">{props.checked ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}

export interface FollowupSettingsProps extends BaseProps {
  /** Shows the emails switch. Default true; hide it in an app that never sends follow-up emails. */
  readonly showEmails?: boolean;
  /** Where the time input starts when the user has not picked a time. Default 19:00. */
  readonly defaultReminderTime?: TimeOfDay;
  /** Shows "How rewards look": streaks, surprises and timers on or off (0.7). Default false. */
  readonly showChoices?: boolean;
  /** Called after every successful save with what the server now holds (e.g. `() => scheduler.replanNow()`). */
  readonly onChanged?: (prefs: FollowupPrefs) => void;
  /**
   * Your own look. `prefs` is null until loaded (or when loading failed, with `reason` set); `save` applies a patch.
   * Per-kind switches: `prefs.groups`, saved with `save(prefs.groupMutedPatch(group, muted))`.
   */
  readonly render?: (prefs: FollowupPrefs | null, save: FollowupPrefsSave, reason: string | null) => ReactNode;
}

/**
 * The user's follow-up choices: "Reminders", one switch per kind of reminder under it (off while reminders are off),
 * "Emails about my progress", and the reminder time. Loads after mount and saves each change at once; a failed save
 * is undone and shows a short line. With [showChoices] a saved streak / surprise / timer choice is applied to the
 * controller at once (`applyChoices`), so every component follows it.
 */
export function FollowupSettings(props: FollowupSettingsProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const c = useRewardsController(props.controller);
  const [prefs, setPrefs] = useState<FollowupPrefs | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const prefsRef = useRef<FollowupPrefs | null>(null);
  prefsRef.current = prefs;
  const timeId = useId();

  const load = async (): Promise<void> => {
    setLoading(true);
    setReason(null);
    try {
      setPrefs(await c.client.followupPrefs());
    } catch (e) {
      setReason(reasonOf(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // Load once on mount, like the Flutter post-frame callback.
  }, [c]);

  const save: FollowupPrefsSave = async (patch) => {
    const before = prefsRef.current;
    if (before) setPrefs(before.patched(patch));
    setReason(null);
    try {
      const p = await c.client.followupPrefs(patch);
      setPrefs(p);
      if (Object.keys(patch).some((k) => RewardsChoices.keys.has(k))) void c.applyChoices(p.choices);
      props.onChanged?.(p);
      return null;
    } catch (e) {
      const r = reasonOf(e);
      setPrefs(before);
      setReason(r);
      return r;
    }
  };

  if (props.render) return <>{props.render(prefs, save, reason)}</>;
  const x = texts.followups;
  const f = texts.fairPlay;
  const p = prefs;
  const time = formatReminderTime(p?.reminderTime ?? null);
  return (
    <Card name="rk-followups" className={props.className} style={props.style} label={x.title}>
      <h3 className="rk-title">{x.title}</h3>
      {p == null && loading ? <ProgressBar value={0.3} label={x.title} className="rk-bar--busy" /> : null}
      {p != null ? (
        <>
          <Switch label={x.reminders} hint={x.remindersHint} checked={!p.notificationsOff} onChange={(on) => void save({ [FollowupPrefs.notificationsOffKey]: !on })} />
          {p.groups.map((g) => (
            <Switch key={g.group} nested label={g.label} checked={!g.muted} disabled={p.notificationsOff} onChange={(on) => void save(p.groupMutedPatch(g.group, !on))} />
          ))}
          {props.showEmails ?? true ? (
            <Switch label={x.emails} hint={x.emailsHint} checked={!p.emailsOff} onChange={(on) => void save({ [FollowupPrefs.emailsOffKey]: !on })} />
          ) : null}
          <div className={cx('rk-switch-row', p.notificationsOff && 'rk-switch-row--disabled')}>
            <label className="rk-grow" htmlFor={timeId}>
              {x.reminderTime}
              {time == null ? <span className="rk-muted rk-block">{x.reminderTimeDefault}</span> : null}
            </label>
            <input
              id={timeId}
              className="rk-input rk-input--time"
              type="time"
              disabled={p.notificationsOff}
              value={time ?? formatReminderTime(props.defaultReminderTime ?? { hour: 19, minute: 0 }) ?? ''}
              onChange={(e) => {
                if (/^\d{2}:\d{2}/.test(e.target.value)) void save({ [FollowupPrefs.reminderTimeKey]: e.target.value.substring(0, 5) });
              }}
            />
          </div>
          {props.showChoices ? (
            <>
              <h4 className="rk-title rk-followups__choices">{f.choicesTitle}</h4>
              <Switch label={f.showStreaks} hint={f.showStreaksHint} checked={!p.choices.streaksOff} onChange={(on) => void save({ [RewardsChoices.streaksOffKey]: !on })} />
              <Switch label={f.surprises} hint={f.surprisesHint} checked={!p.choices.surprisesOff} onChange={(on) => void save({ [RewardsChoices.surprisesOffKey]: !on })} />
              <Switch label={f.showTimers} hint={f.showTimersHint} checked={!p.choices.timersOff} onChange={(on) => void save({ [RewardsChoices.timersOffKey]: !on })} />
            </>
          ) : null}
        </>
      ) : null}
      {reason != null ? <p className="rk-warning" role="alert">{texts.error(reason)}</p> : null}
      {p == null && !loading && reason != null ? (
        <button type="button" className="rk-button rk-button--text" onClick={() => void load()}>
          {x.retry}
        </button>
      ) : null}
    </Card>
  );
}
