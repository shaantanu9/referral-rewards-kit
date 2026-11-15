import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';
import 'fakes_followups.dart';

void main() {
  late FakeRpc rpc;
  late FakeNotifier notifier;
  late MemoryFollowupIdStore store;
  late List<RewardsEvent> events;
  late List<Map<String, Object?>> plan;

  FollowupScheduler make({DateTime Function()? local}) {
    final c = controllerOn(rpc, events: events, local: local);
    return FollowupScheduler(controller: c, notifier: notifier, store: store);
  }

  setUp(() {
    plan = [planItem(1, -1), planItem(2, 3), planItem(3, 27)];
    rpc = FakeRpc({'rewards_followups_plan': (_) => planJson(plan), 'rewards_state': (_) => sampleState()});
    notifier = FakeNotifier();
    store = MemoryFollowupIdStore();
    events = [];
  });

  int plans() => rpc.called('rewards_followups_plan').length;
  List<Object?> failures() => [
    for (final e in events)
      if (e.name == RewardsEventName.followupsFailed) e.props['reason'],
  ];

  testWidgets('the constructor starts nothing', (t) async {
    make();
    await t.pump(const Duration(seconds: 10));
    expect(rpc.calls, isEmpty);
    expect(notifier.scheduled, isEmpty);
    expect(notifier.cancelled, isEmpty);
  });

  testWidgets('start plans after the debounce; past items are skipped; ids remembered', (t) async {
    final s = make()..start();
    await t.pump(const Duration(milliseconds: 1900));
    expect(plans(), 0);
    await t.pump(const Duration(milliseconds: 200));
    expect(plans(), 1);
    expect(rpc.called('rewards_followups_plan').single, {'days': 14});
    expect(notifier.scheduledIds, [2, 3]);
    final first = notifier.scheduled.first;
    expect(first.$2, serverNow.add(const Duration(hours: 3)).toLocal());
    expect((first.$3, first.$4, first.$5), ('App', 'Your next step is still here.', '/app/home'));
    expect(store.ids, [2, 3]);
    expect(events.last.name, RewardsEventName.followupsPlanned);
    expect(events.last.props, {'count': 2});
    await s.stop();
  });

  testWidgets('controller changes are debounced into one replan', (t) async {
    final s = make()..start();
    for (var i = 0; i < 4; i++) {
      await s.controller.refresh();
      await t.pump(const Duration(milliseconds: 1500));
    }
    expect(plans(), 0);
    await t.pump(const Duration(milliseconds: 600));
    expect(plans(), 1);
    await s.controller.track('chapter_read');
    await t.pump(const Duration(seconds: 3));
    expect(plans(), 2);
    await s.stop();
  });

  testWidgets('ids no longer planned are cancelled; kept ones are scheduled again', (t) async {
    await store.write([2, 99, 1]);
    final s = make();
    await s.replanNow();
    expect(notifier.cancelled, [
      [99, 1],
    ]);
    expect(notifier.scheduledIds, [2, 3]);
    plan = [planItem(3, 27), planItem(4, 50)];
    await s.replanNow();
    expect(notifier.cancelled.last, [2]);
    expect(notifier.scheduledIds.skip(2), [3, 4]);
    expect(store.ids, [3, 4]);
  });

  testWidgets('a wrong phone clock: times are moved onto the phone clock, "past" uses the server time', (t) async {
    // The phone is 10 minutes behind the server.
    final s = make(local: () => serverNow.subtract(const Duration(minutes: 10)));
    plan = [planItem(1, -0.1), planItem(2, 1)];
    await s.replanNow();
    expect(notifier.scheduledIds, [2]);
    expect(notifier.scheduled.single.$2, serverNow.add(const Duration(minutes: 50)).toLocal());
  });

  testWidgets('stop cancels everything it scheduled and stops listening', (t) async {
    final s = make()..start();
    await t.pump(const Duration(seconds: 3));
    expect(s.started, isTrue);
    await s.stop();
    expect(s.started, isFalse);
    expect(notifier.cancelled.last, [2, 3]);
    expect(store.ids, isEmpty);
    await s.controller.refresh();
    await t.pump(const Duration(seconds: 5));
    expect(plans(), 1);
  });

  testWidgets('stop before the debounce fires: no plan is fetched', (t) async {
    final s = make()..start();
    await t.pump(const Duration(seconds: 1));
    await s.stop();
    await t.pump(const Duration(seconds: 5));
    expect(plans(), 0);
  });

  testWidgets('errors are swallowed and reported with a reason, never a message', (t) async {
    rpc.handlers['rewards_followups_plan'] = (_) => throw Exception('socket closed at 10.0.0.1');
    final s = make();
    await s.replanNow();
    rpc.handlers['rewards_followups_plan'] = (_) => throw Exception('rewards: not_signed_in');
    await s.replanNow();
    rpc.handlers['rewards_followups_plan'] = (_) => planJson(plan);
    notifier.failSchedule = true;
    await s.replanNow();
    expect(store.ids, [2, 3], reason: 'what may be on the phone stays remembered');
    notifier.failCancel = true;
    await s.stop();
    expect(failures(), ['offline', 'unavailable', 'notifier_error', 'notifier_error']);
    expect(events.toString(), isNot(contains('socket')));
  });

  testWidgets('a replan asked for while one runs runs once more afterwards', (t) async {
    final s = make();
    final a = s.replanNow();
    final b = s.replanNow();
    await Future.wait([a, b]);
    expect(plans(), 2);
  });
}

/// Records what the scheduler asked of the phone; throws on [schedule] / [cancel] when told to.
class FakeNotifier implements FollowupNotifier {
  final scheduled = <(int, DateTime, String, String, String)>[];
  final cancelled = <List<int>>[];
  bool failSchedule = false;
  bool failCancel = false;

  @override
  Future<void> cancel(List<int> ids) async {
    if (failCancel) throw StateError('plugin down');
    cancelled.add(ids);
  }

  @override
  Future<void> schedule({
    required int id,
    required DateTime at,
    required String title,
    required String body,
    required String payload,
  }) async {
    if (failSchedule) throw StateError('plugin down');
    scheduled.add((id, at, title, body, payload));
  }

  List<int> get scheduledIds => [for (final s in scheduled) s.$1];
}
