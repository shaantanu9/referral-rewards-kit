/// Server-corrected time for countdowns (ADR 0002 §8): every deadline comes from the server, and the phone's clock
/// may be wrong by minutes or days. [ServerClock] learns the offset from `server_time` and adds it to local time.
library;

/// `now()` on the server's clock, learnt from each `rewards_state` answer.
class ServerClock {
  ServerClock({DateTime Function()? local}) : _local = local ?? DateTime.now;

  final DateTime Function() _local;
  Duration _offset = Duration.zero;

  /// Server minus phone. Zero until the first [sync].
  Duration get offset => _offset;

  /// Learns the offset from a server time received at [receivedAt] (phone time; default now). Ignores null.
  void sync(DateTime? serverTime, {DateTime? receivedAt}) {
    if (serverTime == null) return;
    _offset = serverTime.toUtc().difference((receivedAt ?? _local()).toUtc());
  }

  /// The current time on the server's clock, in UTC.
  DateTime now() => _local().toUtc().add(_offset);

  /// Time left until [deadline] on the server's clock; never negative. Null deadline → null.
  Duration? left(DateTime? deadline) {
    if (deadline == null) return null;
    final d = deadline.difference(now());
    return d.isNegative ? Duration.zero : d;
  }
}
