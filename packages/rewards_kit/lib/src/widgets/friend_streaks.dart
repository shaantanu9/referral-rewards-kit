// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../controller.dart';
import '../programs.dart';
import '../texts.dart';
import '../theme.dart';
import 'base.dart';

/// Streaks kept with friends: each friend's days together and who still has to act today; invite (the code goes to
/// the app's share sheet through [onShareInvite]), accept a friend's code, end a streak.
class FriendStreaks extends StatefulWidget {
  const FriendStreaks({
    super.key,
    required this.controller,
    required this.program,
    this.title,
    this.texts = const RewardsTexts(),
    this.onShareInvite,
    this.builder,
  });

  final RewardsController controller;
  final String program;
  final String? title;
  final RewardsTexts texts;

  /// Shares the invite code the app's way (e.g. `share_plus`). Without it the code is shown to copy.
  final void Function(String code)? onShareInvite;

  /// Your own look; use the controller's `friendInvite`, `invite`, `friendAccept`, `friendRemove`.
  final Widget Function(BuildContext context, List<FriendStreakState> friends, RewardsController controller)? builder;

  @override
  State<FriendStreaks> createState() => _FriendStreaksState();
}

class _FriendStreaksState extends State<FriendStreaks> {
  final _code = TextEditingController();
  bool _busy = false;
  String? _reason;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _do(Future<String?> Function() action, [void Function()? onOk]) async {
    if (_busy) return;
    setState(() => _busy = true);
    final r = await action();
    if (!mounted) return;
    setState(() {
      _busy = false;
      _reason = r;
    });
    if (r == null) onOk?.call();
  }

  void _invite() => _do(() => widget.controller.friendInvite(widget.program), () {
    final code = widget.controller.invite(widget.program)?.code;
    if (code != null) widget.onShareInvite?.call(code);
  });

  void _accept() => _do(() => widget.controller.friendAccept(_code.text), _code.clear);

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: widget.controller,
    builder: (context) {
      final c = widget.controller;
      final friends = c.state.friendsOf(widget.program);
      final b = widget.builder;
      if (b != null) return b(context, friends, c);
      final t = RewardsTheme.of(context);
      final x = widget.texts.programs;
      final muted = t.bodyStyle?.copyWith(color: t.muted);
      final invite = c.invite(widget.program);
      return Container(
        decoration: t.card,
        padding: t.padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(widget.title ?? x.friendsTitle, style: t.titleStyle),
            if (friends.isEmpty) Text(x.friendsEmpty, style: muted),
            for (final f in friends)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Icon(Icons.local_fire_department, color: f.todayBoth ? t.accent : t.muted),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${f.friendName}  ·  ${x.friendDays(f.current)}',
                            style: t.bodyStyle?.copyWith(color: t.onSurface),
                          ),
                          Text(
                            f.todayBoth
                                ? x.friendBothDone
                                : (f.todayMe ? x.friendWaiting(f.friendName) : x.friendYourTurn),
                            style: muted,
                          ),
                        ],
                      ),
                    ),
                    TextButton(
                      onPressed: _busy ? null : () => _do(() => c.friendRemove(f.pairId)),
                      child: Text(x.friendRemove),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: _busy ? null : _invite,
              icon: const Icon(Icons.person_add_alt),
              label: Text(x.friendInvite),
              style: FilledButton.styleFrom(backgroundColor: t.accent, foregroundColor: t.onAccent),
            ),
            if (invite != null && widget.onShareInvite == null)
              SelectableText(invite.code, style: t.numberStyle?.copyWith(fontFamily: 'monospace')),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _code,
                    autocorrect: false,
                    enableSuggestions: false,
                    textCapitalization: TextCapitalization.characters,
                    decoration: InputDecoration(labelText: x.friendCodeLabel),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(onPressed: _busy ? null : _accept, child: Text(x.friendAccept)),
              ],
            ),
            if (_reason != null) Text(widget.texts.error(_reason!), style: t.bodyStyle?.copyWith(color: t.warning)),
          ],
        ),
      );
    },
  );
}
