import 'dart:async';

// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../client.dart';
import '../copy.dart';
import '../events.dart';
import '../models.dart';
import 'code_text.dart';

/// "Your invite page" (G7, G9): the sharer's opt-in to show their first name on the invite page, the disclosure of
/// what the friend sees, and "Leave the invite program" with a confirm. Loads `referral_preferences`; shows nothing
/// on a server without it (before migration 23) or when it cannot load.
///
/// [sharerRewarded]: the terms reward the sharer, so the friend's page says "{Name} gets a reward if you join" and
/// this block says so too. [onLeft] runs after leaving was saved (the invite screen reloads into its "You left"
/// state).
class ReferralInvitePageSettings extends StatefulWidget {
  const ReferralInvitePageSettings({
    super.key,
    required this.client,
    this.sharerRewarded = true,
    this.onLeft,
    this.onEvent,
    this.initialPreferences,
  });

  final ReferralClient client;

  /// Already loaded preferences (the invite screen loads them with the code); loaded here when null.
  final ReferralPreferences? initialPreferences;
  final bool sharerRewarded;
  final VoidCallback? onLeft;

  /// Analytics; [ReferralClient.onEvent] when null.
  final ReferralEventSink? onEvent;

  @override
  State<ReferralInvitePageSettings> createState() => _ReferralInvitePageSettingsState();
}

class _ReferralInvitePageSettingsState extends State<ReferralInvitePageSettings> {
  final _name = TextEditingController();
  ReferralPreferences? _prefs;
  bool _showName = false;
  bool _saving = false;
  String? _nameError;
  String? _status;

  @override
  void initState() {
    super.initState();
    final p = widget.initialPreferences;
    if (p == null) {
      unawaited(_load());
    } else {
      _apply(p);
    }
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final p = await widget.client.preferences();
      if (mounted) setState(() => _apply(p));
    } catch (_) {
      // Older server or offline: the block stays hidden.
    }
  }

  void _apply(ReferralPreferences p) {
    _prefs = p;
    _showName = p.showName;
    _name.text = p.displayName ?? '';
  }

  void _emit(Map<String, Object> props) => reportReferralEvent(
    widget.onEvent ?? widget.client.onEvent,
    ReferralEvent(ReferralEventName.invitePreferencesChanged, props),
  );

  bool get _dirty {
    final p = _prefs;
    if (p == null) return false;
    return _showName != p.showName || (_showName && _name.text.trim() != (p.displayName ?? ''));
  }

  Future<ReferralPreferences?> _save({bool? showName, String? displayName, bool? participating}) async {
    final l10n = referralL10n(context);
    setState(() {
      _saving = true;
      _status = null;
    });
    final props = <String, Object>{'show_name': ?showName, 'participating': ?participating};
    try {
      final p = await widget.client.setPreferences(
        showName: showName,
        displayName: displayName,
        participating: participating,
      );
      _emit({...props, 'result': p.reason ?? 'ok'});
      if (!mounted) return p;
      setState(() {
        if (p.isOk) {
          _prefs = p;
          _showName = p.showName;
          _name.text = p.displayName ?? _name.text;
          _status = l10n.saved;
        } else if (p.reason == 'invalid_name') {
          _nameError = l10n.nameErrEmailOrLink;
        } else {
          _status = l10n.errUnavailable;
        }
      });
      return p;
    } catch (_) {
      _emit({...props, 'result': 'failed'});
      if (mounted) setState(() => _status = l10n.saveFailed);
      return null;
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _saveName() async {
    final copy = ReferralCopy(l10n: referralL10n(context), terms: ReferralTerms.none);
    if (_showName) {
      final error = copy.displayNameError(displayNameProblem(_name.text));
      setState(() => _nameError = error);
      if (error != null) return;
      await _save(showName: true, displayName: _name.text);
    } else {
      await _save(showName: false);
    }
  }

  Future<void> _toggle(bool on) async {
    setState(() {
      _showName = on;
      _nameError = null;
      _status = null;
    });
    // Turning it off is saved at once (withdrawing is as easy as opting in); turning it on waits for the name.
    if (!on) await _save(showName: false);
  }

  Future<void> _leave() async {
    final l10n = referralL10n(context);
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.leaveConfirmTitle),
        content: Text(l10n.leaveConfirmBody),
        actions: [
          TextButton(
            key: const ValueKey('referral-leave-cancel'),
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.cancel),
          ),
          TextButton(
            key: const ValueKey('referral-leave-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.leaveConfirm),
          ),
        ],
      ),
    );
    if (yes != true || !mounted) return;
    final p = await _save(participating: false);
    if (p != null && p.isOk) widget.onLeft?.call();
  }

  @override
  Widget build(BuildContext context) {
    if (_prefs == null) return const SizedBox.shrink();
    final l10n = referralL10n(context);
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    const target = Size(48, 48);
    return Column(
      key: const ValueKey('referral-invite-page'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(l10n.invitePageTitle, style: theme.textTheme.titleSmall),
        SwitchListTile(
          key: const ValueKey('referral-show-name'),
          contentPadding: EdgeInsets.zero,
          title: Text(l10n.showFirstName),
          value: _showName,
          onChanged: _saving ? null : (v) => unawaited(_toggle(v)),
        ),
        Text(widget.sharerRewarded ? l10n.invitePageExplainRewarded : l10n.invitePageExplain, style: muted),
        if (_showName) ...[
          const SizedBox(height: 12),
          TextField(
            key: const ValueKey('referral-name-field'),
            controller: _name,
            enabled: !_saving,
            textCapitalization: TextCapitalization.words,
            autofillHints: const [AutofillHints.givenName],
            decoration: InputDecoration(
              labelText: l10n.firstNameLabel,
              errorText: _nameError,
              errorMaxLines: 3,
              border: const OutlineInputBorder(),
            ),
            onChanged: (_) => setState(() {
              _nameError = null;
              _status = null;
            }),
            onSubmitted: (_) => unawaited(_saveName()),
          ),
        ],
        if (_dirty) ...[
          const SizedBox(height: 8),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: FilledButton(
              key: const ValueKey('referral-name-save'),
              style: FilledButton.styleFrom(minimumSize: target),
              onPressed: _saving ? null : () => unawaited(_saveName()),
              child: Text(l10n.save),
            ),
          ),
        ],
        if (_status != null) ...[
          const SizedBox(height: 8),
          Semantics(
            liveRegion: true,
            child: Text(_status!, key: const ValueKey('referral-prefs-status'), style: muted),
          ),
        ],
        const SizedBox(height: 8),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton(
            key: const ValueKey('referral-leave'),
            style: TextButton.styleFrom(minimumSize: target, foregroundColor: theme.colorScheme.error),
            onPressed: _saving ? null : () => unawaited(_leave()),
            child: Text(l10n.leaveProgram),
          ),
        ),
      ],
    );
  }
}
