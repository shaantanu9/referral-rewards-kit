/**
 * Follow-ups (ADR 0002 §18.7, §18.8): the notifications the engine plans for the next days, and the user's own
 * choices about reminders and emails. Every reader is tolerant.
 */
import { RewardsChoices } from './fair-play-models';
import { boolOr, isMap, optInt, str, time, type JsonMap } from './json';

/** A time of day (Flutter's `TimeOfDay`): the user's reminder time, local. */
export interface TimeOfDay {
  readonly hour: number;
  readonly minute: number;
}

/** One notification the engine planned. Schedule it with the app's own notification library under [id]. */
export class FollowupPlanItem {
  /** A stable 31-bit number per (program, local day): the phone's notification id. */
  readonly id: number;
  readonly program: string;
  /** When to show it, on the server's clock. */
  readonly at: Date;
  readonly title: string;
  /** Generic on purpose: the engine never names content in a notification. */
  readonly body: string;
  /** Where the notification opens (`/app/home`). */
  readonly payload: string;
  /** One notification per local day per group. */
  readonly group: string;

  constructor(init: { id: number; program: string; at: Date; title?: string; body?: string; payload?: string; group?: string }) {
    this.id = init.id;
    this.program = init.program;
    this.at = init.at;
    this.title = init.title ?? '';
    this.body = init.body ?? '';
    this.payload = init.payload ?? '';
    this.group = init.group ?? '';
  }

  /** Null when the item has no whole-number `id` or no valid `at`: such an item cannot be scheduled. */
  static fromJson(m: JsonMap): FollowupPlanItem | null {
    const id = optInt(m['id']);
    const at = time(m['at']);
    if (id == null || at == null) return null;
    return new FollowupPlanItem({
      id,
      program: str(m['program']),
      at,
      title: str(m['title']),
      body: str(m['body']),
      payload: str(m['payload']),
      group: str(m['group']),
    });
  }
}

/** `rewards_followups_plan`: the planned notifications, sorted by time. */
export class FollowupPlan {
  readonly serverTime: Date | null;
  readonly items: readonly FollowupPlanItem[];

  constructor(init: { serverTime?: Date | null; items?: readonly FollowupPlanItem[] } = {}) {
    this.serverTime = init.serverTime ?? null;
    this.items = init.items ?? [];
  }

  static fromJson(m: JsonMap): FollowupPlan {
    const raw = m['plan'];
    const items: FollowupPlanItem[] = [];
    if (Array.isArray(raw)) {
      for (const x of raw) {
        const i = isMap(x) ? FollowupPlanItem.fromJson(x) : null;
        if (i) items.push(i);
      }
    }
    items.sort((a, b) => a.at.getTime() - b.at.getTime());
    return new FollowupPlan({ serverTime: time(m['server_time']), items });
  }

  static readonly empty = new FollowupPlan();
}

/** One kind of follow-up notification the user can switch off on its own (ADR 0002 §18.8). */
export class FollowupGroup {
  constructor(
    /** The group name (`daily`, `recap`): what `muted_groups` holds. */
    readonly group: string,
    /** What the switch says. */
    readonly label: string,
    /** True when the user switched this kind off. */
    readonly muted: boolean,
  ) {}

  /** Null when the item has no group name. */
  static fromJson(m: JsonMap): FollowupGroup | null {
    const g = str(m['group']).trim();
    if (g === '') return null;
    const label = str(m['label']).trim();
    return new FollowupGroup(g, label === '' ? g : label, boolOr(m['muted']));
  }

  copyWith(patch: { muted?: boolean }): FollowupGroup {
    return new FollowupGroup(this.group, this.label, patch.muted ?? this.muted);
  }

  equals(o: FollowupGroup): boolean {
    return o.group === this.group && o.label === this.label && o.muted === this.muted;
  }
}

/** Dart `is Iterable`: an array, Set or other iterable object (a string is not). */
export const isIterableList = (v: unknown): v is Iterable<unknown> =>
  v != null && typeof v === 'object' && Symbol.iterator in (v as object);

/** `muted_groups` as a set of non-empty group names; anything that is not a list, and any non-string item, is left out. */
export function parseMutedGroups(v: unknown): ReadonlySet<string> {
  const out = new Set<string>();
  if (isIterableList(v)) {
    for (const x of v as Iterable<unknown>) if (typeof x === 'string' && x.trim() !== '') out.add(x.trim());
  }
  return out;
}

const hhmm = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/** "19:00" or "19:00:00" (Postgres `time`) as a [TimeOfDay]; a TimeOfDay passes through; anything else is null. */
export function parseReminderTime(v: unknown): TimeOfDay | null {
  if (isMap(v) && typeof v['hour'] === 'number' && typeof v['minute'] === 'number') {
    return { hour: v['hour'], minute: v['minute'] };
  }
  if (typeof v !== 'string') return null;
  const m = hhmm.exec(v.trim());
  if (!m) return null;
  const h = parseInt(m[1]!, 10),
    min = parseInt(m[2]!, 10),
    s = m[3] == null ? 0 : parseInt(m[3], 10);
  if (h > 23 || min > 59 || s > 59) return null;
  return { hour: h, minute: min };
}

/** A [TimeOfDay] as "HH:MM" (what the server takes), or null. */
export const formatReminderTime = (t: TimeOfDay | null | undefined): string | null =>
  t == null ? null : `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * `rewards_followup_prefs`: what the user chose. Every key of a patch is one of [FollowupPrefs.keys]:
 * `notifications_off`, `emails_off`, `reminder_time`, `muted_groups`, and (0.7) `streaks_off`, `surprises_off`,
 * `timers_off`.
 */
export class FollowupPrefs {
  static readonly notificationsOffKey = 'notifications_off';
  static readonly emailsOffKey = 'emails_off';
  static readonly reminderTimeKey = 'reminder_time';
  static readonly mutedGroupsKey = 'muted_groups';
  static readonly keys: ReadonlySet<string> = new Set([
    'notifications_off',
    'emails_off',
    'reminder_time',
    'muted_groups',
    ...RewardsChoices.keys,
  ]);

  /** No follow-up notifications at all. */
  readonly notificationsOff: boolean;
  /** No follow-up emails at all. */
  readonly emailsOff: boolean;
  /** The user's own reminder time (local), or null for the app's default. */
  readonly reminderTime: TimeOfDay | null;
  /** Groups of notifications the user switched off (0.5). */
  readonly mutedGroups: ReadonlySet<string>;
  /** The kinds of notification follow-ups the app runs, one switch each (0.5). */
  readonly groups: readonly FollowupGroup[];
  /** Streaks, surprises and timers on or off (0.7). */
  readonly choices: RewardsChoices;

  constructor(init: {
    notificationsOff?: boolean;
    emailsOff?: boolean;
    reminderTime?: TimeOfDay | null;
    mutedGroups?: ReadonlySet<string>;
    groups?: readonly FollowupGroup[];
    choices?: RewardsChoices;
  } = {}) {
    this.notificationsOff = init.notificationsOff ?? false;
    this.emailsOff = init.emailsOff ?? false;
    this.reminderTime = init.reminderTime ?? null;
    this.mutedGroups = init.mutedGroups ?? new Set();
    this.groups = init.groups ?? [];
    this.choices = init.choices ?? RewardsChoices.none;
  }

  static fromJson(m: JsonMap): FollowupPrefs {
    return new FollowupPrefs({
      notificationsOff: boolOr(m[FollowupPrefs.notificationsOffKey]),
      emailsOff: boolOr(m[FollowupPrefs.emailsOffKey]),
      reminderTime: parseReminderTime(m[FollowupPrefs.reminderTimeKey]),
      mutedGroups: parseMutedGroups(m[FollowupPrefs.mutedGroupsKey]),
      groups: FollowupPrefs.parseGroups(m['groups']),
      choices: RewardsChoices.fromJson(m),
    });
  }

  private static parseGroups(v: unknown): FollowupGroup[] {
    const out: FollowupGroup[] = [];
    const seen = new Set<string>();
    if (!Array.isArray(v)) return out;
    for (const x of v) {
      const g = isMap(x) ? FollowupGroup.fromJson(x) : null;
      if (g && !seen.has(g.group)) {
        seen.add(g.group);
        out.push(g);
      }
    }
    return out;
  }

  /** The patch that mutes or unmutes [group], computed from this value's [mutedGroups]. */
  groupMutedPatch(group: string, muted: boolean): Record<string, unknown> {
    const list = [...this.mutedGroups].filter((g) => g !== group);
    if (muted) list.push(group);
    return { [FollowupPrefs.mutedGroupsKey]: list };
  }

  copyWith(patch: {
    notificationsOff?: boolean;
    emailsOff?: boolean;
    reminderTime?: TimeOfDay | null;
    mutedGroups?: ReadonlySet<string>;
    groups?: readonly FollowupGroup[];
    choices?: RewardsChoices;
  }): FollowupPrefs {
    return new FollowupPrefs({
      notificationsOff: patch.notificationsOff ?? this.notificationsOff,
      emailsOff: patch.emailsOff ?? this.emailsOff,
      reminderTime: patch.reminderTime ?? this.reminderTime,
      mutedGroups: patch.mutedGroups ?? this.mutedGroups,
      groups: patch.groups ?? this.groups,
      choices: patch.choices ?? this.choices,
    });
  }

  /** This value with [patch] applied the way the server applies it (unknown keys ignored). */
  patched(patch: Readonly<Record<string, unknown>>): FollowupPrefs {
    const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(patch, k);
    const muted = has(FollowupPrefs.mutedGroupsKey) ? parseMutedGroups(patch[FollowupPrefs.mutedGroupsKey]) : this.mutedGroups;
    const flag = (k: string, current: boolean): boolean => (has(k) ? boolOr(patch[k]) : current);
    return new FollowupPrefs({
      notificationsOff: flag(FollowupPrefs.notificationsOffKey, this.notificationsOff),
      emailsOff: flag(FollowupPrefs.emailsOffKey, this.emailsOff),
      reminderTime: has(FollowupPrefs.reminderTimeKey) ? parseReminderTime(patch[FollowupPrefs.reminderTimeKey]) : this.reminderTime,
      mutedGroups: muted,
      groups: this.groups.map((g) => g.copyWith({ muted: muted.has(g.group) })),
      choices: new RewardsChoices({
        streaksOff: flag(RewardsChoices.streaksOffKey, this.choices.streaksOff),
        surprisesOff: flag(RewardsChoices.surprisesOffKey, this.choices.surprisesOff),
        timersOff: flag(RewardsChoices.timersOffKey, this.choices.timersOff),
      }),
    });
  }

  equals(o: FollowupPrefs): boolean {
    return (
      o.notificationsOff === this.notificationsOff &&
      o.emailsOff === this.emailsOff &&
      formatReminderTime(o.reminderTime) === formatReminderTime(this.reminderTime) &&
      sameSet(o.mutedGroups, this.mutedGroups) &&
      o.groups.length === this.groups.length &&
      o.groups.every((g, i) => g.equals(this.groups[i]!)) &&
      o.choices.equals(this.choices)
    );
  }
}
