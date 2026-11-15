/// Keeps the phone's follow-up notifications equal to the engine's plan (ADR 0002 §18.7). The package sends no
/// notification itself: the app implements [FollowupNotifier] with its own plugin (e.g. flutter_local_notifications).
library;

import 'dart:async';

import 'controller.dart';
import 'errors.dart';
import 'events.dart';

/// The app's notification plugin, as the scheduler needs it.
abstract class FollowupNotifier {
  /// Cancels the notifications with these ids (unknown ids are fine).
  Future<void> cancel(List<int> ids);

  /// Schedules (or replaces) notification [id] at [at] (phone-local time). Must be idempotent per id: the same id
  /// is scheduled again on every replan.
  Future<void> schedule({
    required int id,
    required DateTime at,
    required String title,
    required String body,
    required String payload,
  });
}

/// Where the scheduler remembers which ids it scheduled, so the next replan (or [FollowupScheduler.stop], even
/// after an app restart) can cancel them. Persist it (e.g. shared_preferences) in an app; [MemoryFollowupIdStore]
/// forgets on restart.
abstract class FollowupIdStore {
  Future<List<int>> read();
  Future<void> write(List<int> ids);
}

/// A [FollowupIdStore] in memory.
class MemoryFollowupIdStore implements FollowupIdStore {
  MemoryFollowupIdStore([List<int> ids = const []]) : _ids = [...ids];
  List<int> _ids;

  List<int> get ids => List.unmodifiable(_ids);

  @override
  Future<List<int>> read() async => [..._ids];

  @override
  Future<void> write(List<int> ids) async => _ids = [...ids];
}

/// Fetches `rewards_followups_plan` after every controller change (debounced), cancels what it scheduled before and
/// is no longer planned, and schedules every planned item still in the future. Call [stop] on sign-out.
///
/// Nothing runs in the constructor. Errors never escape: they are reported as `rewards_followups_failed` with a
/// reason, and the next change tries again.
class FollowupScheduler {
  FollowupScheduler({
    required this.controller,
    required this.notifier,
    FollowupIdStore? store,
    this.debounce = const Duration(seconds: 2),
    this.days = 14,
  }) : store = store ?? MemoryFollowupIdStore();

  final RewardsController controller;
  final FollowupNotifier notifier;
  final FollowupIdStore store;

  /// How long the controller must be quiet before a replan (a track and its refresh make one replan).
  final Duration debounce;

  /// How many days ahead to plan.
  final int days;

  Timer? _timer;
  bool _listening = false;
  int _generation = 0;
  Future<void>? _running;
  bool _again = false;

  /// True between [start] and [stop].
  bool get started => _listening;

  void _report(RewardsEventName name, Map<String, Object> props) => controller.client.report(RewardsEvent(name, props));

  /// Listens to the controller and plans once after [debounce]. Calling it again does nothing.
  void start() {
    if (_listening) return;
    _listening = true;
    controller.addListener(_changed);
    _changed();
  }

  void _changed() {
    if (!_listening) return;
    _timer?.cancel();
    _timer = Timer(debounce, () => unawaited(replanNow()));
  }

  /// Replans at once (also without [start]). A call while one runs makes it run once more afterwards.
  Future<void> replanNow() {
    _timer?.cancel();
    final r = _running;
    if (r != null) {
      _again = true;
      return r;
    }
    return _running = _loop().whenComplete(() => _running = null);
  }

  Future<void> _loop() async {
    do {
      _again = false;
      await _replan(_generation);
    } while (_again);
  }

  Future<void> _replan(int generation) async {
    var step = 'plan';
    try {
      final plan = await controller.client.followupsPlan(days: days);
      if (generation != _generation) return;
      final clock = controller.clock;
      final serverNow = plan.serverTime ?? clock.now();
      // Server minus phone, from this answer when it has a time: notifications fire on the phone's clock.
      final offset = plan.serverTime == null ? clock.offset : clock.offset + plan.serverTime!.difference(clock.now());
      final future = [
        for (final i in plan.items)
          if (i.at.isAfter(serverNow)) i,
      ];
      final keep = {for (final i in future) i.id};

      step = 'store';
      final previous = await store.read();
      final removed = [
        for (final id in previous.toSet())
          if (!keep.contains(id)) id,
      ];
      // Remember everything that may be on the phone before touching it, so a failure halfway is cancelled later.
      await store.write({...previous, ...keep}.toList());

      step = 'notifier';
      if (removed.isNotEmpty) await notifier.cancel(removed);
      for (final i in future) {
        if (generation != _generation) return;
        await notifier.schedule(
          id: i.id,
          at: i.at.subtract(offset).toLocal(),
          title: i.title,
          body: i.body,
          payload: i.payload,
        );
      }
      if (generation != _generation) return;

      step = 'store';
      await store.write(keep.toList());
      _report(RewardsEventName.followupsPlanned, {'count': future.length});
    } catch (e) {
      _report(RewardsEventName.followupsFailed, {'reason': followupFailureReason(e, step)});
    }
  }

  /// Stops listening and cancels every notification it scheduled (call on sign-out). Waits for a replan that is
  /// running, which then schedules nothing more.
  Future<void> stop() async {
    _generation++;
    _timer?.cancel();
    _timer = null;
    if (_listening) {
      _listening = false;
      try {
        controller.removeListener(_changed);
      } catch (_) {}
    }
    final r = _running;
    if (r != null) await r;
    var step = 'store';
    try {
      final ids = await store.read();
      step = 'notifier';
      if (ids.isNotEmpty) await notifier.cancel(ids.toSet().toList());
      step = 'store';
      await store.write(const []);
    } catch (e) {
      _report(RewardsEventName.followupsFailed, {'reason': followupFailureReason(e, step)});
    }
  }
}

/// The `reason` of a `rewards_followups_failed` event: the server's refusal, `unavailable`, `server_error` or
/// `offline` for a server call ([step] `plan`), otherwise `notifier_error` / `store_error`. Never a message.
String followupFailureReason(Object e, String step) {
  if (step == 'notifier') return 'notifier_error';
  if (step == 'store') return 'store_error';
  if (e is RewardsUnavailableException) return 'unavailable';
  if (e is RewardsException) return e.reason;
  if (e is RewardsServerError) return 'server_error';
  return 'offline';
}
