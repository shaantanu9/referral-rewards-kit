import 'dart:async';

// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../controller.dart';
import '../errors.dart';
import '../fair_play_models.dart';
import '../followup_models.dart';
import '../texts.dart';
import '../theme.dart';

/// Saves a patch of follow-up choices (`notifications_off`, `emails_off`, `reminder_time` as a [TimeOfDay],
/// `muted_groups` as a list; build it with [FollowupPrefs.groupMutedPatch]); returns null or a reason.
typedef FollowupPrefsSave = Future<String?> Function(Map<String, Object?> patch);

/// The user's follow-up choices: a "Reminders" switch, under it one switch per kind of reminder
/// ([FollowupPrefs.groups], 0.5; off while reminders are off), an "Emails about my progress" switch and the reminder
/// time (opens `showTimePicker`). Loads the choices after the first frame and saves each change at once; a failed save
/// is undone and shows a short line.
///
/// With [showChoices] (0.7, needs server migration 20261120000022) a second section, "How rewards look", has three
/// switches: "Show streaks", "Surprise rewards" (off = fixed rewards) and "Show timers" (`streaks_off`,
/// `surprises_off`, `timers_off`, strings in `RewardsTexts.fairPlay`). A saved choice is applied to the controller at
/// once (`controller.applyChoices`), so every widget follows it.
///
/// Pass `onChanged: (_) => scheduler.replanNow()` so the phone's notifications follow the new choices.
class FollowupSettings extends StatefulWidget {
  const FollowupSettings({
    super.key,
    required this.controller,
    this.texts = const RewardsTexts(),
    this.showEmails = true,
    this.defaultReminderTime = const TimeOfDay(hour: 19, minute: 0),
    this.onChanged,
    this.builder,
    this.showChoices = false,
  });

  final RewardsController controller;
  final RewardsTexts texts;

  /// Shows the emails switch. Hide it in an app that never sends follow-up emails.
  final bool showEmails;

  /// Where the time picker starts when the user has not picked a time.
  final TimeOfDay defaultReminderTime;

  /// Shows the streak / surprise / timer switches (0.7). Default false: the card is as before.
  final bool showChoices;

  /// Called after every successful save with what the server now holds.
  final ValueChanged<FollowupPrefs>? onChanged;

  /// Your own look. `prefs` is null until loaded (or when loading failed, with `reason` set); `save` applies a patch
  /// and returns null or a reason. The per-kind switches: `prefs.groups`, saved with
  /// `save(prefs.groupMutedPatch(group, muted))`.
  final Widget Function(BuildContext context, FollowupPrefs? prefs, FollowupPrefsSave save, String? reason)? builder;

  @override
  State<FollowupSettings> createState() => _FollowupSettingsState();
}

class _FollowupSettingsState extends State<FollowupSettings> {
  FollowupPrefs? _prefs;
  String? _reason;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  static String _reasonOf(Object e) => switch (e) {
    RewardsUnavailableException() => 'unavailable',
    RewardsException(:final reason) => reason,
    RewardsServerError() => 'server_error',
    _ => 'offline',
  };

  Future<void> _load() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _reason = null;
    });
    try {
      final p = await widget.controller.client.followupPrefs();
      if (mounted) setState(() => _prefs = p);
    } catch (e) {
      if (mounted) setState(() => _reason = _reasonOf(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<String?> _save(Map<String, Object?> patch) async {
    final before = _prefs;
    setState(() {
      if (before != null) _prefs = before.patched(patch);
      _reason = null;
    });
    try {
      final p = await widget.controller.client.followupPrefs(patch);
      if (mounted) setState(() => _prefs = p);
      if (patch.keys.any(RewardsChoices.keys.contains)) unawaited(widget.controller.applyChoices(p.choices));
      widget.onChanged?.call(p);
      return null;
    } catch (e) {
      final reason = _reasonOf(e);
      if (mounted) {
        setState(() {
          _prefs = before;
          _reason = reason;
        });
      }
      return reason;
    }
  }

  Future<void> _pickTime(FollowupPrefs p) async {
    final picked = await showTimePicker(context: context, initialTime: p.reminderTime ?? widget.defaultReminderTime);
    if (picked != null && mounted) await _save({FollowupPrefs.reminderTimeKey: picked});
  }

  List<Widget> _choices(FollowupPrefs p, RewardsTheme t) {
    final x = widget.texts.fairPlay;
    final c = p.choices;
    final muted = t.bodyStyle?.copyWith(color: t.muted);
    Widget toggle(String title, String hint, bool off, String key) => SwitchListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(title, style: t.bodyStyle),
      subtitle: Text(hint, style: muted),
      value: !off,
      onChanged: (on) => _save({key: !on}),
    );
    return [
      const SizedBox(height: 12),
      Text(x.choicesTitle, style: t.titleStyle),
      toggle(x.showStreaks, x.showStreaksHint, c.streaksOff, RewardsChoices.streaksOffKey),
      toggle(x.surprises, x.surprisesHint, c.surprisesOff, RewardsChoices.surprisesOffKey),
      toggle(x.showTimers, x.showTimersHint, c.timersOff, RewardsChoices.timersOffKey),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.builder;
    if (b != null) return b(context, _prefs, _save, _reason);
    final t = RewardsTheme.of(context);
    final x = widget.texts.followups;
    final p = _prefs;
    final muted = t.bodyStyle?.copyWith(color: t.muted);
    // A Material, not a decorated Container: the list tiles paint their background and ink on the nearest
    // Material, and Flutter 3.50 asserts when a coloured DecoratedBox sits between them.
    final card = t.card;
    return Material(
      color: card.color,
      shape: RoundedRectangleBorder(borderRadius: card.borderRadius ?? BorderRadius.zero),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: t.padding ?? EdgeInsets.zero,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(x.title, style: t.titleStyle),
            if (p == null && _loading)
              const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: LinearProgressIndicator()),
            if (p != null) ...[
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(x.reminders, style: t.bodyStyle),
                subtitle: Text(x.remindersHint, style: muted),
                value: !p.notificationsOff,
                onChanged: (on) => _save({FollowupPrefs.notificationsOffKey: !on}),
              ),
              for (final g in p.groups)
                SwitchListTile(
                  contentPadding: const EdgeInsetsDirectional.only(start: 24),
                  dense: true,
                  title: Text(g.label, style: t.bodyStyle),
                  value: !g.muted,
                  onChanged: p.notificationsOff ? null : (on) => _save(p.groupMutedPatch(g.group, !on)),
                ),
              if (widget.showEmails)
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(x.emails, style: t.bodyStyle),
                  subtitle: Text(x.emailsHint, style: muted),
                  value: !p.emailsOff,
                  onChanged: (on) => _save({FollowupPrefs.emailsOffKey: !on}),
                ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                enabled: !p.notificationsOff,
                title: Text(x.reminderTime, style: t.bodyStyle),
                trailing: Text(p.reminderTime?.format(context) ?? x.reminderTimeDefault, style: muted),
                onTap: () => _pickTime(p),
              ),
              if (widget.showChoices) ..._choices(p, t),
            ],
            if (_reason != null) Text(widget.texts.error(_reason!), style: t.bodyStyle?.copyWith(color: t.warning)),
            if (p == null && !_loading && _reason != null) TextButton(onPressed: _load, child: Text(x.retry)),
          ],
        ),
      ),
    );
  }
}
