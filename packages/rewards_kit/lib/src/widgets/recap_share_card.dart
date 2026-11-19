import 'dart:typed_data';
import 'dart:ui' as ui;

// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import '../models.dart';
import '../programs.dart';
import '../texts.dart';
import '../theme.dart';

/// The first and last day of calendar [year], for `controller.loadRecap(...)` and a "Your 2026" card.
(DateTime, DateTime) recapYear(int year) => (DateTime.utc(year, 1, 1), DateTime.utc(year, 12, 31));

/// Renders a [RewardsRecapCard] to an image for the app's own share sheet. Pass the same key to the card; the card
/// puts a `RepaintBoundary` with [boundaryKey] around itself. The package shares nothing itself.
class RecapShareKey {
  RecapShareKey();

  /// The key of the card's `RepaintBoundary`.
  final GlobalKey boundaryKey = GlobalKey(debugLabel: 'RewardsRecapCard');

  /// The card as an image at [pixelRatio] (3 is sharp on most phones), or null while it is not on screen.
  Future<ui.Image?> toImage({double pixelRatio = 3}) async {
    final o = boundaryKey.currentContext?.findRenderObject();
    if (o is! RenderRepaintBoundary) return null;
    var needsPaint = false;
    assert(() {
      needsPaint = o.debugNeedsPaint;
      return true;
    }());
    if (needsPaint) await WidgetsBinding.instance.endOfFrame;
    return o.toImage(pixelRatio: pixelRatio);
  }

  /// PNG bytes for the share sheet, e.g. share_plus `XFile.fromData(bytes, mimeType: 'image/png')`; null while the
  /// card is not on screen.
  Future<Uint8List?> toPngBytes({double pixelRatio = 3}) async {
    final image = await toImage(pixelRatio: pixelRatio);
    if (image == null) return null;
    try {
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      return data?.buffer.asUint8List();
    } finally {
      image.dispose();
    }
  }
}

/// A shareable recap card ("Your 2026"): days active, best streak and badges as big numbers, what was done most, and
/// what was earned, from a [Recap] the app already loaded (`controller.loadRecap`, `client.recap`). No futures, no
/// sharing: give it a [shareKey] and call `shareKey.toPngBytes()` when the user taps the app's Share button.
///
/// Fixed [aspectRatio] (default 4:5, a feed post; 9:16 for stories; null = natural height). The [builder] replaces
/// the whole look and is still wrapped in the boundary, so a custom card shares the same way.
class RewardsRecapCard extends StatelessWidget {
  const RewardsRecapCard({
    super.key,
    required this.recap,
    this.title,
    this.subtitle,
    this.footer,
    this.shareKey,
    this.aspectRatio = 4 / 5,
    this.maxEvents = 3,
    this.texts = const RewardsTexts(),
    this.builder,
  });

  final Recap recap;

  /// Default: "Your 2026" when the recap is one whole calendar year, else "Your recap".
  final String? title;

  /// A line under the title, e.g. the app's name.
  final String? subtitle;

  /// At the bottom, e.g. the app's logo or address.
  final Widget? footer;
  final RecapShareKey? shareKey;
  final double? aspectRatio;

  /// How many "most done" lines to show.
  final int maxEvents;
  final RewardsTexts texts;
  final Widget Function(BuildContext context, Recap recap)? builder;

  /// The default title for [recap].
  String titleFor(Recap r) {
    final f = r.from, to = r.to;
    final x = texts.recapCard;
    if (f != null && to != null && f.year == to.year && f.month == 1 && f.day == 1 && to.month == 12 && to.day == 31) {
      return x.yearTitle(f.year);
    }
    return x.rangeTitle;
  }

  @override
  Widget build(BuildContext context) {
    final custom = builder;
    final card = custom != null ? custom(context, recap) : _card(context);
    final sized = aspectRatio == null ? card : AspectRatio(aspectRatio: aspectRatio!, child: card);
    return RepaintBoundary(key: shareKey?.boundaryKey, child: sized);
  }

  Widget _card(BuildContext context) {
    final t = RewardsTheme.of(context);
    final x = texts.recapCard;
    final fg = t.onAccent;
    final soft = fg?.withValues(alpha: 0.8);
    final body = t.bodyStyle?.copyWith(color: fg);
    final label = t.bodyStyle?.copyWith(color: soft);
    final fixed = aspectRatio != null;
    final events = recap.events.take(maxEvents).toList();
    final grants = recap.grants.take(3).toList();
    Widget gap(double h) => fixed ? const Spacer() : SizedBox(height: h);
    return Container(
      decoration: BoxDecoration(color: t.accent, borderRadius: BorderRadius.circular(t.radius ?? 16)),
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: fixed ? MainAxisSize.max : MainAxisSize.min,
        children: [
          Text(
            title ?? titleFor(recap),
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: fg, fontWeight: FontWeight.w800),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          if (subtitle != null) Text(subtitle!, style: label, maxLines: 1, overflow: TextOverflow.ellipsis),
          gap(20),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: _Stat(value: recap.daysActive, label: x.daysActive(recap.daysActive), color: fg, theme: t),
              ),
              Expanded(
                child: _Stat(value: recap.bestStreak, label: x.bestStreak(recap.bestStreak), color: fg, theme: t),
              ),
              Expanded(
                child: _Stat(value: recap.badges.length, label: x.badges(recap.badges.length), color: fg, theme: t),
              ),
            ],
          ),
          gap(20),
          if (events.isNotEmpty) ...[
            Text(x.mostDone, style: label),
            for (final e in events)
              Text(
                texts.programs.recapEvent(e.type, e.count),
                style: body,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            const SizedBox(height: 12),
          ],
          if (grants.isNotEmpty) ...[
            Text(x.earned, style: label),
            Text(
              grants.map((g) => texts.reward(RewardSpec(kind: g.kind, amount: g.amount))).join(' · '),
              style: body,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          if (footer != null) ...[const SizedBox(height: 12), footer!],
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label, required this.color, required this.theme});
  final int value;
  final String label;
  final Color? color;
  final RewardsTheme theme;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      FittedBox(
        fit: BoxFit.scaleDown,
        alignment: AlignmentDirectional.centerStart,
        child: Text('$value', style: theme.numberStyle?.copyWith(color: color, fontSize: 40)),
      ),
      Text(
        label,
        style: theme.bodyStyle?.copyWith(color: color?.withValues(alpha: 0.8)),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
    ],
  );
}
