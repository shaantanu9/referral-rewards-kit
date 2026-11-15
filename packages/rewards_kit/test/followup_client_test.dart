import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';
import 'fakes_followups.dart';

void main() {
  test('0.4 RPCs: exact function and parameter names (ADR 0002 §18.7)', () async {
    final events = <RewardsEvent>[];
    final rpc = FakeRpc({
      'rewards_followups_plan': (_) => planJson([planItem(1, 2)]),
      'rewards_followup_prefs': (_) => {'notifications_off': false, 'emails_off': true, 'reminder_time': '08:00:00'},
    });
    final c = RewardsClient(rpc: rpc.call, onEvent: events.add);
    expect((await c.followupsPlan()).items.single.id, 1);
    await c.followupsPlan(days: 3);
    expect((await c.followupPrefs()).emailsOff, isTrue);
    final p = await c.followupPrefs({
      'notifications_off': true,
      'reminder_time': const TimeOfDay(hour: 8, minute: 0),
      'secret_key': 'x',
    });
    expect(p.reminderTime, const TimeOfDay(hour: 8, minute: 0));
    await c.followupPrefs({'reminder_time': '21:30:00'});
    await c.followupPrefs({'reminder_time': null});

    expect(rpc.calls.map((c) => c.$1), [
      'rewards_followups_plan',
      'rewards_followups_plan',
      'rewards_followup_prefs',
      'rewards_followup_prefs',
      'rewards_followup_prefs',
      'rewards_followup_prefs',
    ]);
    expect(rpc.calls[0].$2, {'days': 14});
    expect(rpc.calls[1].$2, {'days': 3});
    expect(rpc.calls[2].$2, {'patch': <String, Object?>{}});
    expect(rpc.calls[3].$2, {
      'patch': {'notifications_off': true, 'reminder_time': '08:00'},
    });
    expect(rpc.calls[4].$2, {
      'patch': {'reminder_time': '21:30'},
    });
    expect(rpc.calls[5].$2, {
      'patch': {'reminder_time': null},
    });
    expect(events.where((e) => e.name == RewardsEventName.followupPrefsChanged).map((e) => e.props['field']), [
      'notifications_off',
      'reminder_time',
      'reminder_time',
      'reminder_time',
    ]);
    expect(events.toString(), isNot(contains('08:00')));
  });

  test('trackFollowupOpened: followup_opened, "<program>:<local day>", props {program}', () async {
    final events = <RewardsEvent>[];
    final rpc = FakeRpc({
      'rewards_track': (_) => {'duplicate': false},
    });
    final c = RewardsClient(rpc: rpc.call, timezone: () => 'Asia/Kolkata', onEvent: events.add);
    await c.trackFollowupOpened('inactive2', now: DateTime(2026, 11, 14, 23, 59));
    expect(rpc.called('rewards_track').single, {
      'type': 'followup_opened',
      'dedupe_key': 'inactive2:2026-11-14',
      'props': {'program': 'inactive2'},
      'timezone': 'Asia/Kolkata',
    });
    expect(followupOpenedKey('p', DateTime(2026, 1, 2, 0, 1)), 'p:2026-01-02');
    expect(events.last.name, RewardsEventName.followupOpened);
    expect(events.last.props, {'program': 'inactive2'});
  });

  test('controller.followupOpened tracks with the day key, then reloads; a failure is a reason', () async {
    final rpc = FakeRpc({
      'rewards_track': (_) => {'duplicate': false},
      'rewards_state': (_) => sampleState(),
    });
    final c = controllerOn(rpc);
    expect(await c.followupOpened('streak_risk', now: DateTime(2026, 11, 14, 9)), isNull);
    expect(rpc.called('rewards_track').single['dedupe_key'], 'streak_risk:2026-11-14');
    expect(rpc.calls.last.$1, 'rewards_state');
    expect(c.loaded, isTrue);

    final down = controllerOn(FakeRpc({'rewards_track': (_) => throw Exception('socket closed')}));
    expect(await down.followupOpened('streak_risk'), 'offline');
  });
}
