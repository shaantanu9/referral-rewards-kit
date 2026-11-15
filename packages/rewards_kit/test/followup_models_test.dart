import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';
import 'fakes_followups.dart';

void main() {
  test('plan: items parsed, sorted by time, server time read', () {
    final p = FollowupPlan.fromJson(planJson([planItem(2, 30), planItem(1, 5)]));
    expect(p.serverTime, serverNow);
    expect(p.items.map((i) => i.id), [1, 2]);
    final i = p.items.first;
    expect(i.program, 'inactive2');
    expect(i.at, serverNow.add(const Duration(hours: 5)));
    expect(i.at.isUtc, isTrue);
    expect((i.title, i.body, i.payload, i.group), ('App', 'Your next step is still here.', '/app/home', 'daily'));
  });

  test('plan: bad items are skipped, bad values tolerated, nothing throws', () {
    final p = FollowupPlan.fromJson({
      'server_time': 42,
      'plan': [
        'not an object',
        {'id': 'x', 'at': iso(serverNow)},
        {'id': 3, 'at': 'yesterday'},
        {'id': 4},
        {'id': '5', 'at': '2026-11-14T19:00:00', 'title': null, 'payload': 7},
        {'id': 6.0, 'at': '2026-11-14T20:00:00+05:30'},
      ],
    });
    expect(p.serverTime, isNull);
    expect(p.items.map((i) => i.id), [6, 5]);
    expect(p.items.last.at, DateTime.utc(2026, 11, 14, 19));
    expect(p.items.last.title, '');
    expect(p.items.last.payload, '7');
    expect(p.items.first.at, DateTime.utc(2026, 11, 14, 14, 30));
    expect(FollowupPlan.fromJson({'plan': 'nope'}).items, isEmpty);
    expect(FollowupPlan.fromJson(const {}).items, isEmpty);
  });

  test('prefs: read, "HH:MM" and "HH:MM:SS", bad values are defaults', () {
    final p = FollowupPrefs.fromJson({'notifications_off': true, 'emails_off': 'true', 'reminder_time': '07:30:00'});
    expect(p.notificationsOff, isTrue);
    expect(p.emailsOff, isTrue);
    expect(p.reminderTime, const TimeOfDay(hour: 7, minute: 30));
    expect(FollowupPrefs.fromJson({'reminder_time': '19:05'}).reminderTime, const TimeOfDay(hour: 19, minute: 5));
    for (final bad in [null, 7, '', '25:00', '12:60', '7pm', '12:00:61', '1900']) {
      expect(parseReminderTime(bad), isNull, reason: '$bad');
    }
    final d = FollowupPrefs.fromJson({'notifications_off': 1, 'emails_off': null});
    expect(d, const FollowupPrefs());
    expect(formatReminderTime(const TimeOfDay(hour: 7, minute: 5)), '07:05');
    expect(formatReminderTime(null), isNull);
  });

  test('prefs: patched applies only the three keys', () {
    const p = FollowupPrefs(reminderTime: TimeOfDay(hour: 19, minute: 0));
    final q = p.patched({'notifications_off': true, 'reminder_time': '08:15', 'other': 1});
    expect(q, const FollowupPrefs(notificationsOff: true, reminderTime: TimeOfDay(hour: 8, minute: 15)));
    expect(p.patched({'reminder_time': null}).reminderTime, isNull);
    expect(p.patched({'emails_off': true}).emailsOff, isTrue);
  });
}
