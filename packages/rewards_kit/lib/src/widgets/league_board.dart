// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../controller.dart';
import '../league_models.dart';
import '../texts.dart';
import '../texts_leagues.dart';
import '../theme.dart';
import 'base.dart';
import 'countdown.dart';

/// An opt-in weekly league (ADR 0002 §18.10). Before joining: what it is, what is shared, and a Join button. After:
/// the tier, the real time left in the week, the board (display names and points only, the user's own row marked),
/// who moves up, what each place pays, last week's own result, and Leave. Nothing marks who moves down. Shows nothing
/// when the state hides leagues (`state.hideLeagues`).
///
/// Loads `rewards_league` itself after the first frame; the actions are the controller's (`joinLeague`,
/// `leaveLeague`, `loadLeague`), which return null or a reason.
class LeagueBoard extends StatefulWidget {
  const LeagueBoard({
    super.key,
    required this.controller,
    required this.program,
    this.title,
    this.texts = const RewardsTexts(),
    this.maxRows,
    this.builder,
  });

  final RewardsController controller;
  final String program;

  /// The heading; default: the program's `public.title`, else "Weekly league".
  final String? title;
  final RewardsTexts texts;

  /// Show at most this many rows (the user's own row is always shown). Null: the whole group.
  final int? maxRows;

  /// Your own look; use the controller's `joinLeague`, `leaveLeague`, `loadLeague`.
  final Widget Function(BuildContext context, LeagueState league, RewardsController controller)? builder;

  @override
  State<LeagueBoard> createState() => _LeagueBoardState();
}

class _LeagueBoardState extends State<LeagueBoard> {
  bool _busy = false;
  String? _reason;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final c = widget.controller;
      if (mounted && c.league(widget.program) == null && !c.state.hideLeagues) c.loadLeague(widget.program);
    });
  }

  Future<void> _do(Future<String?> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    final r = await action();
    if (!mounted) return;
    setState(() {
      _busy = false;
      _reason = r;
    });
  }

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: widget.controller,
    builder: (context) {
      final c = widget.controller;
      final l = c.league(widget.program);
      if (l == null || c.state.hideLeagues) return const SizedBox.shrink();
      final b = widget.builder;
      if (b != null) return b(context, l, c);
      final t = RewardsTheme.of(context);
      final texts = widget.texts;
      final x = texts.leagues;
      final body = t.bodyStyle?.copyWith(color: t.onSurface);
      final muted = t.bodyStyle?.copyWith(color: t.muted);
      final title = widget.title ?? c.state.program(widget.program)?.public['title']?.toString() ?? x.title;
      final rows = _rows(l.members, widget.maxRows);
      return Container(
        decoration: t.card,
        padding: t.padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Expanded(child: Text(title, style: t.titleStyle)),
                if (l.joined && l.tierName != null)
                  Chip(
                    avatar: Icon(Icons.emoji_events_outlined, color: t.accent, size: 18),
                    label: Text(l.tierName!),
                  ),
              ],
            ),
            if (!l.live)
              Text(x.notLive, style: muted)
            else if (!l.joined) ...[
              const SizedBox(height: 4),
              Text(x.pitch(l.groupSize), style: body),
              const SizedBox(height: 8),
              FilledButton.icon(
                onPressed: _busy ? null : () => _do(() => c.joinLeague(widget.program)),
                icon: const Icon(Icons.group_add_outlined),
                label: Text(x.join),
                style: FilledButton.styleFrom(backgroundColor: t.accent, foregroundColor: t.onAccent),
              ),
            ] else ...[
              Countdown(
                endsAt: l.endsAt,
                clock: c.clock,
                prefix: x.weekEndsIn,
                style: muted,
                hidden: c.state.hideTimers,
              ),
              if (l.lastWeek != null) ...[
                const SizedBox(height: 4),
                Text(x.lastWeek(l.lastWeek!.rank, l.lastWeek!.score), style: muted),
                if (l.lastWeek!.tierChange == LeagueTierChange.up)
                  Text(x.movedUp(l.tierName), style: body?.copyWith(color: t.success)),
              ],
              const SizedBox(height: 8),
              for (final m in rows) _row(t, x, m),
              if (l.canMoveUp) ...[const SizedBox(height: 8), Text(x.movesUp(l.promote, l.nextTierName), style: muted)],
            ],
            if (l.live && l.rewards.isNotEmpty) ...[
              const SizedBox(height: 8),
              for (final r in l.rewards)
                if (r.threshold != null) Text(x.placeReward(r.threshold!, texts.reward(r)), style: muted),
            ],
            if (l.joined)
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: TextButton(
                  onPressed: _busy ? null : () => _do(() => c.leaveLeague(widget.program)),
                  child: Text(x.leave),
                ),
              ),
            if (_reason != null) Text(texts.error(_reason!), style: t.bodyStyle?.copyWith(color: t.warning)),
          ],
        ),
      );
    },
  );

  Widget _row(RewardsTheme t, LeagueTexts x, LeagueMember m) {
    final style = t.bodyStyle?.copyWith(color: t.onSurface, fontWeight: m.me ? FontWeight.w700 : FontWeight.normal);
    final name = m.name ?? (m.me ? x.you : x.member);
    return Container(
      decoration: m.me
          ? BoxDecoration(color: t.accent?.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8))
          : null,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      child: Row(
        children: [
          SizedBox(width: 40, child: Text(m.rank == null ? '–' : x.place(m.rank!), style: style)),
          Expanded(
            child: Text(
              m.me && m.name != null ? '$name (${x.you})' : name,
              style: style,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Text(x.points(m.score), style: style),
        ],
      ),
    );
  }
}

/// The first [max] rows, plus the user's own row when it is further down.
List<LeagueMember> _rows(List<LeagueMember> all, int? max) {
  if (max == null || all.length <= max) return all;
  final top = all.take(max).toList();
  if (!top.any((m) => m.me)) {
    for (final m in all.skip(max)) {
      if (m.me) return [...top, m];
    }
  }
  return top;
}
