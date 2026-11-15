/// Follow-ups (ADR 0002 §18.7, §18.8): the notifications the engine plans for the next days, and the user's own choices
/// about reminders and emails. Every reader is tolerant: a bad item is skipped, a bad value becomes null or false.
library;

import 'package:flutter/foundation.dart' show listEquals, setEquals;
import 'package:flutter/material.dart' show TimeOfDay;

import 'json.dart';

/// One notification the engine planned. Schedule it with the app's own notification plugin under [id].
class FollowupPlanItem {
  const FollowupPlanItem({
    required this.id,
    required this.program,
    required this.at,
    this.title = '',
    this.body = '',
    this.payload = '',
    this.group = '',
  });

  /// Null when the item has no whole-number `id` or no valid `at`: such an item cannot be scheduled.
  static FollowupPlanItem? fromJson(Map<String, Object?> m) {
    final id = optInt(m['id']);
    final at = time(m['at']);
    if (id == null || at == null) return null;
    return FollowupPlanItem(
      id: id,
      program: str(m['program']),
      at: at,
      title: str(m['title']),
      body: str(m['body']),
      payload: str(m['payload']),
      group: str(m['group']),
    );
  }

  /// A stable 31-bit number per (program, local day): the phone's notification id.
  final int id;
  final String program;

  /// When to show it, in UTC on the server's clock.
  final DateTime at;
  final String title;

  /// Generic on purpose: the engine never names content in a notification.
  final String body;

  /// Where the notification opens (`/app/home`).
  final String payload;

  /// One notification per local day per group.
  final String group;

  @override
  String toString() => 'FollowupPlanItem($id, $program, ${at.toIso8601String()})';
}

/// `rewards_followups_plan`: the planned notifications, sorted by time.
class FollowupPlan {
  const FollowupPlan({this.serverTime, this.items = const []});

  factory FollowupPlan.fromJson(Map<String, Object?> m) {
    final raw = m['plan'];
    final items = <FollowupPlanItem>[
      if (raw is List)
        for (final x in raw)
          if (x is Map) ?FollowupPlanItem.fromJson(optMap(x)),
    ]..sort((a, b) => a.at.compareTo(b.at));
    return FollowupPlan(serverTime: time(m['server_time']), items: items);
  }

  static const empty = FollowupPlan();

  final DateTime? serverTime;
  final List<FollowupPlanItem> items;
}

/// One kind of follow-up notification the user can switch off on its own (ADR 0002 §18.8): a `group` of live
/// notification follow-ups, its [label] (the app's `group_label`, else the group name) and whether it is [muted].
class FollowupGroup {
  const FollowupGroup(this.group, this.label, this.muted);

  /// Null when the item has no group name.
  static FollowupGroup? fromJson(Map<String, Object?> m) {
    final g = str(m['group']).trim();
    if (g.isEmpty) return null;
    final label = str(m['label']).trim();
    return FollowupGroup(g, label.isEmpty ? g : label, boolOr(m['muted']));
  }

  /// The group name (`daily`, `recap`): what `muted_groups` holds.
  final String group;

  /// What the switch says.
  final String label;

  /// True when the user switched this kind off.
  final bool muted;

  FollowupGroup copyWith({bool? muted}) => FollowupGroup(group, label, muted ?? this.muted);

  @override
  bool operator ==(Object other) =>
      other is FollowupGroup && other.group == group && other.label == label && other.muted == muted;

  @override
  int get hashCode => Object.hash(group, label, muted);

  @override
  String toString() => 'FollowupGroup($group, $label, $muted)';
}

/// `rewards_followup_prefs`: what the user chose. Every key of a patch is one of [notificationsOffKey],
/// [emailsOffKey], [reminderTimeKey], [mutedGroupsKey].
class FollowupPrefs {
  const FollowupPrefs({
    this.notificationsOff = false,
    this.emailsOff = false,
    this.reminderTime,
    this.mutedGroups = const {},
    this.groups = const [],
  });

  factory FollowupPrefs.fromJson(Map<String, Object?> m) => FollowupPrefs(
    notificationsOff: boolOr(m[notificationsOffKey]),
    emailsOff: boolOr(m[emailsOffKey]),
    reminderTime: parseReminderTime(m[reminderTimeKey]),
    mutedGroups: parseMutedGroups(m[mutedGroupsKey]),
    groups: _groups(m['groups']),
  );

  static const notificationsOffKey = 'notifications_off';
  static const emailsOffKey = 'emails_off';
  static const reminderTimeKey = 'reminder_time';
  static const mutedGroupsKey = 'muted_groups';
  static const keys = {notificationsOffKey, emailsOffKey, reminderTimeKey, mutedGroupsKey};

  /// No follow-up notifications at all.
  final bool notificationsOff;

  /// No follow-up emails at all.
  final bool emailsOff;

  /// The user's own reminder time (local), or null for the app's default.
  final TimeOfDay? reminderTime;

  /// Groups of notifications the user switched off (0.5): the engine plans none of them.
  final Set<String> mutedGroups;

  /// The kinds of notification follow-ups the app runs, one switch each (0.5). Empty from an older server.
  final List<FollowupGroup> groups;

  /// The patch that mutes or unmutes [group], computed from this value's [mutedGroups].
  Map<String, Object?> groupMutedPatch(String group, bool muted) => {
    mutedGroupsKey: [
      for (final g in mutedGroups)
        if (g != group) g,
      if (muted) group,
    ],
  };

  FollowupPrefs copyWith({
    bool? notificationsOff,
    bool? emailsOff,
    TimeOfDay? reminderTime,
    Set<String>? mutedGroups,
    List<FollowupGroup>? groups,
  }) => FollowupPrefs(
    notificationsOff: notificationsOff ?? this.notificationsOff,
    emailsOff: emailsOff ?? this.emailsOff,
    reminderTime: reminderTime ?? this.reminderTime,
    mutedGroups: mutedGroups ?? this.mutedGroups,
    groups: groups ?? this.groups,
  );

  /// This value with [patch] applied the way the server applies it (unknown keys ignored); a new `muted_groups`
  /// also sets each group's `muted`.
  FollowupPrefs patched(Map<String, Object?> patch) {
    final muted = patch.containsKey(mutedGroupsKey) ? parseMutedGroups(patch[mutedGroupsKey]) : mutedGroups;
    return FollowupPrefs(
      notificationsOff: patch.containsKey(notificationsOffKey) ? boolOr(patch[notificationsOffKey]) : notificationsOff,
      emailsOff: patch.containsKey(emailsOffKey) ? boolOr(patch[emailsOffKey]) : emailsOff,
      reminderTime: patch.containsKey(reminderTimeKey) ? parseReminderTime(patch[reminderTimeKey]) : reminderTime,
      mutedGroups: muted,
      groups: [for (final g in groups) g.copyWith(muted: muted.contains(g.group))],
    );
  }

  static List<FollowupGroup> _groups(Object? v) {
    final out = <FollowupGroup>[], seen = <String>{};
    if (v is! List) return out;
    for (final x in v) {
      final g = x is Map ? FollowupGroup.fromJson(optMap(x)) : null;
      if (g != null && seen.add(g.group)) out.add(g);
    }
    return out;
  }

  @override
  bool operator ==(Object other) =>
      other is FollowupPrefs &&
      other.notificationsOff == notificationsOff &&
      other.emailsOff == emailsOff &&
      other.reminderTime == reminderTime &&
      setEquals(other.mutedGroups, mutedGroups) &&
      listEquals(other.groups, groups);

  @override
  int get hashCode => Object.hash(
    notificationsOff,
    emailsOff,
    reminderTime,
    Object.hashAllUnordered(mutedGroups),
    Object.hashAll(groups),
  );

  @override
  String toString() =>
      'FollowupPrefs($notificationsOff, $emailsOff, ${formatReminderTime(reminderTime)}, $mutedGroups, $groups)';
}

/// `muted_groups` as a set of non-empty group names; anything that is not a list, and any item that is not a
/// string, is left out.
Set<String> parseMutedGroups(Object? v) => {
  if (v is Iterable)
    for (final x in v)
      if (x is String && x.trim().isNotEmpty) x.trim(),
};

final _hhmm = RegExp(r'^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$');

/// "19:00" or "19:00:00" (Postgres `time`) as a [TimeOfDay]; a [TimeOfDay] passes through; anything else, or an
/// hour above 23 or a minute above 59, is null.
TimeOfDay? parseReminderTime(Object? v) {
  if (v is TimeOfDay) return v;
  if (v is! String) return null;
  final m = _hhmm.firstMatch(v.trim());
  if (m == null) return null;
  final h = int.parse(m.group(1)!), min = int.parse(m.group(2)!);
  final s = m.group(3) == null ? 0 : int.parse(m.group(3)!);
  if (h > 23 || min > 59 || s > 59) return null;
  return TimeOfDay(hour: h, minute: min);
}

/// A [TimeOfDay] as "HH:MM" (what the server takes), or null.
String? formatReminderTime(TimeOfDay? t) =>
    t == null ? null : '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
