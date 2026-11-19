// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../controller.dart';
import '../events.dart';
import '../tasks.dart';
import '../texts.dart';
import '../theme.dart';
import 'base.dart';
import 'countdown.dart';

/// "Tag us on Instagram" (ADR 0002 §6.3): username → code → post with the code → verified by the server.
/// Opening Instagram is the app's job ([onOpenInstagram], e.g. with url_launcher), so the package adds no plugin.
class SocialTagTask extends StatefulWidget {
  const SocialTagTask({
    super.key,
    required this.controller,
    required this.program,
    this.texts = const RewardsTexts(),
    this.onOpenInstagram,
    this.onCopy,
    this.showLinkField = false,
    this.builder,
  });

  final RewardsController controller;
  final String program;
  final RewardsTexts texts;

  /// Opens Instagram (the app or `https://instagram.com/<account>`). Hidden when null.
  final void Function(String account)? onOpenInstagram;

  /// Copies the code; default: the system clipboard.
  final Future<void> Function(String code)? onCopy;

  /// While pending, offer "Link to your post" (`rewards_social_submit_link`) for when the webhook misses it.
  final bool showLinkField;

  /// Your own look. `start(handle)` returns null on success or a reason.
  final Widget Function(BuildContext context, SocialTaskState task, Future<String?> Function(String handle) start)?
  builder;

  @override
  State<SocialTagTask> createState() => _SocialTagTaskState();
}

class _SocialTagTaskState extends State<SocialTagTask> {
  final _handle = TextEditingController();
  final _link = TextEditingController();
  bool _busy = false;
  String? _reason;
  bool _copied = false;

  @override
  void dispose() {
    _handle.dispose();
    _link.dispose();
    super.dispose();
  }

  Future<void> _sendLink() async {
    setState(() => _busy = true);
    final r = await widget.controller.submitSocialLink(widget.program, _link.text);
    if (mounted) {
      setState(() {
        _busy = false;
        _reason = r;
      });
    }
  }

  Future<String?> _start(String handle) async {
    setState(() => _busy = true);
    final r = await widget.controller.startSocial(widget.program, handle);
    if (mounted) {
      setState(() {
        _busy = false;
        _reason = r;
      });
    }
    return r;
  }

  Future<void> _copy(String code) async {
    final f = widget.onCopy;
    if (f != null) {
      await f(code);
    } else {
      await Clipboard.setData(ClipboardData(text: code));
    }
    widget.controller.client.report(RewardsEvent(RewardsEventName.socialCodeCopied, {'program': widget.program}));
    if (mounted) setState(() => _copied = true);
  }

  void _open(String account) {
    widget.controller.client.report(RewardsEvent(RewardsEventName.instagramOpened, {'program': widget.program}));
    widget.onOpenInstagram?.call(account);
  }

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: widget.controller,
    builder: (context) {
      final task = widget.controller.state.socialTask(widget.program);
      if (task == null) return const SizedBox.shrink();
      final b = widget.builder;
      if (b != null) return b(context, task, _start);
      final t = RewardsTheme.of(context);
      final x = widget.texts;
      final body = t.bodyStyle?.copyWith(color: t.muted);
      final clock = widget.controller.clock;
      final List<Widget> children = switch (task.status) {
        SocialTaskStatus.pending => [
          Text(x.socialSteps(task.account), style: body),
          const SizedBox(height: 8),
          Row(
            children: [
              SelectableText(task.code ?? '', style: t.numberStyle?.copyWith(fontFamily: 'monospace')),
              const SizedBox(width: 8),
              TextButton(onPressed: () => _copy(task.code ?? ''), child: Text(_copied ? x.codeCopied : x.copyCode)),
            ],
          ),
          Text(x.socialDisclose, style: body),
          if (widget.onOpenInstagram != null) ...[
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => _open(task.account),
              style: FilledButton.styleFrom(backgroundColor: t.accent, foregroundColor: t.onAccent),
              child: Text(x.openInstagram),
            ),
          ],
          const SizedBox(height: 8),
          Countdown(endsAt: task.expiresAt, clock: clock, prefix: x.socialCheckingIn, style: body),
          if (widget.showLinkField) ...[
            if (task.postUrl != null)
              Text(x.programs.postLinkSent, style: t.bodyStyle?.copyWith(color: t.success))
            else ...[
              TextField(
                controller: _link,
                keyboardType: TextInputType.url,
                autocorrect: false,
                decoration: InputDecoration(labelText: x.programs.postLinkLabel),
              ),
              if (_reason != null) Text(x.error(_reason!), style: t.bodyStyle?.copyWith(color: t.warning)),
              TextButton(onPressed: _busy ? null : _sendLink, child: Text(x.programs.postLinkSend)),
            ],
          ],
        ],
        SocialTaskStatus.verified => [Text(x.socialVerified, style: t.bodyStyle?.copyWith(color: t.success))],
        SocialTaskStatus.cooldown => [
          Text(x.socialVerified, style: t.bodyStyle?.copyWith(color: t.success)),
          Countdown(endsAt: task.expiresAt, clock: clock, prefix: x.socialCooldown, style: body),
        ],
        SocialTaskStatus.unknown => const [],
        _ => [
          if (task.status == SocialTaskStatus.rejected) Text(x.socialRejected, style: body),
          if (task.status == SocialTaskStatus.expired) Text(x.socialExpired, style: body),
          TextField(
            controller: _handle,
            autocorrect: false,
            enableSuggestions: false,
            decoration: InputDecoration(labelText: x.socialHandleLabel, prefixText: '@'),
          ),
          if (_reason != null) Text(x.error(_reason!), style: t.bodyStyle?.copyWith(color: t.warning)),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: _busy ? null : () => _start(_handle.text),
            style: FilledButton.styleFrom(backgroundColor: t.accent, foregroundColor: t.onAccent),
            child: Text(x.socialStart),
          ),
        ],
      };
      if (children.isEmpty) return const SizedBox.shrink();
      return Container(
        decoration: t.card,
        padding: t.padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(x.socialTitle(task.account), style: t.titleStyle),
            Text(x.rewards(task.rewards), style: t.bodyStyle?.copyWith(color: t.onSurface)),
            const SizedBox(height: 8),
            ...children,
          ],
        ),
      );
    },
  );
}
