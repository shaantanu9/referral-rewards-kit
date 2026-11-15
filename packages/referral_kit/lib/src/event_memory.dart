import 'dart:async';

import 'storage.dart';

/// Remembers which once-only events were already reported, so `reward_granted` fires once per reward and
/// `referral_feature_hidden` once a day per reason. Backed by a [KeyValueStore] (survives restarts) or, without one,
/// by memory (once per client instance). Never throws: a storage failure means an event may repeat, never that the
/// referral flow breaks.
class ReferralEventMemory {
  ReferralEventMemory({KeyValueStore? store, DateTime Function()? clock})
    : _store = store,
      _clock = clock ?? DateTime.now;

  final KeyValueStore? _store;
  final DateTime Function() _clock;

  /// Reward ids already reported (the last [maxRewards]).
  static const rewardsKey = 'events.rewards_reported';

  /// `<yyyy-mm-dd>|<reason>` marks for today's hidden reasons.
  static const hiddenKey = 'events.hidden_reported';
  static const maxRewards = 200;

  List<String>? _rewards;
  List<String>? _hidden;
  // No future is created in the constructor: a client built in one zone (e.g. a test's setUp, outside testWidgets)
  // and used in another must not chain on a future that completes in the first zone, or it never resumes.
  Future<Object?>? _tail;

  /// Runs [op] after the previous one, so two quick calls never both report.
  Future<T> _serial<T>(Future<T> Function() op) {
    final prev = _tail;
    final next = prev == null ? op() : prev.then((_) => op());
    final tail = next.then<Object?>((_) => null, onError: (_) => null);
    _tail = tail;
    unawaited(
      tail.whenComplete(() {
        if (identical(_tail, tail)) _tail = null;
      }),
    );
    return next;
  }

  Future<List<String>> _read(String key) async {
    try {
      final raw = await _store?.getString(key);
      if (raw == null || raw.isEmpty) return [];
      return raw.split('\n');
    } catch (_) {
      return [];
    }
  }

  Future<void> _write(String key, List<String> values) async {
    try {
      await _store?.setString(key, values.join('\n'));
    } catch (_) {
      // Memory still has it for this run.
    }
  }

  /// The ids in [ids] not reported before; remembers them.
  Future<List<String>> newRewards(Iterable<String> ids) => _serial(() => _newRewards(ids.toList()));

  Future<List<String>> _newRewards(List<String> ids) async {
    final seen = _rewards ??= await _read(rewardsKey);
    final fresh = <String>[];
    for (final id in ids) {
      if (id.isEmpty || seen.contains(id) || fresh.contains(id)) continue;
      fresh.add(id);
    }
    if (fresh.isEmpty) return fresh;
    seen.addAll(fresh);
    if (seen.length > maxRewards) seen.removeRange(0, seen.length - maxRewards);
    await _write(rewardsKey, seen);
    return fresh;
  }

  /// True the first time [reason] is seen today (UTC); remembers it.
  Future<bool> firstToday(String reason) => _serial(() => _firstToday(reason));

  Future<bool> _firstToday(String reason) async {
    final d = _clock().toUtc();
    final day = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    final mark = '$day|$reason';
    final had = _hidden ??= await _read(hiddenKey);
    if (had.contains(mark)) return false;
    had.removeWhere((m) => !m.startsWith('$day|'));
    had.add(mark);
    await _write(hiddenKey, had);
    return true;
  }
}
