import 'dart:async';

import 'package:flutter/widgets.dart';

import '../clock.dart';
import '../texts.dart';

/// A live countdown to a server deadline (ADR 0002 §8). Ticks every second on the server-corrected [clock], never
/// shows a negative time, and calls [onExpired] once when it reaches zero. It never invents a deadline: no [endsAt],
/// nothing shown.
class Countdown extends StatefulWidget {
  const Countdown({
    super.key,
    required this.endsAt,
    required this.clock,
    this.onExpired,
    this.builder,
    this.style,
    this.prefix,
  });

  final DateTime? endsAt;
  final ServerClock clock;
  final VoidCallback? onExpired;

  /// Your own look: gets the time left (zero at the end).
  final Widget Function(BuildContext context, Duration left)? builder;
  final TextStyle? style;

  /// Text before the time, e.g. "Ends in".
  final String? prefix;

  @override
  State<Countdown> createState() => _CountdownState();
}

class _CountdownState extends State<Countdown> {
  Timer? _timer;
  bool _fired = false;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void didUpdateWidget(Countdown old) {
    super.didUpdateWidget(old);
    if (old.endsAt != widget.endsAt) {
      _fired = false;
      _start();
    }
  }

  void _start() {
    _timer?.cancel();
    if (widget.endsAt == null) return;
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
    _check();
  }

  void _tick() {
    if (!mounted) return;
    setState(() {});
    _check();
  }

  void _check() {
    final left = widget.clock.left(widget.endsAt);
    if (left == Duration.zero && !_fired) {
      _fired = true;
      _timer?.cancel();
      final cb = widget.onExpired;
      if (cb != null) scheduleMicrotask(() => mounted ? cb() : null);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final left = widget.clock.left(widget.endsAt);
    if (left == null) return const SizedBox.shrink();
    final b = widget.builder;
    if (b != null) return b(context, left);
    final p = widget.prefix;
    return Text(p == null ? formatLeft(left) : '$p ${formatLeft(left)}', style: widget.style);
  }
}
