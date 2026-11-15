import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';
import 'package:rewards_notifications_check/demo_rpc.dart';
import 'package:rewards_notifications_check/device_timezone.dart';
import 'package:rewards_notifications_check/local_followup_notifier.dart';
import 'package:timezone/timezone.dart' as tz;

/// Records what the adapter asks of flutter_local_notifications.
class FakePlugin extends Fake implements FlutterLocalNotificationsPlugin {
  final List<int> cancelled = [];
  final List<({int id, tz.TZDateTime at, String? title, String? body, String? payload, AndroidScheduleMode mode})>
  scheduled = [];

  @override
  Future<void> cancel({required int id, String? tag}) async => cancelled.add(id);

  @override
  Future<void> zonedSchedule({
    required int id,
    required tz.TZDateTime scheduledDate,
    required NotificationDetails notificationDetails,
    required AndroidScheduleMode androidScheduleMode,
    String? title,
    String? body,
    String? payload,
    DateTimeComponents? matchDateTimeComponents,
  }) async {
    expect(notificationDetails.android?.channelId, 'followups');
    scheduled.add((id: id, at: scheduledDate, title: title, body: body, payload: payload, mode: androidScheduleMode));
  }
}

void main() {
  setUpAll(() => setUpTimezones('Asia/Kolkata'));

  test('timezone setup sets tz.local; an unknown or missing name leaves UTC', () {
    expect(tz.local.name, 'Asia/Kolkata');
    setUpTimezones('Not/AZone');
    expect(tz.local.name, 'Etc/UTC');
    setUpTimezones(null);
    expect(tz.local.name, 'Etc/UTC');
    setUpTimezones('Asia/Kolkata');
    expect(tz.local.name, 'Asia/Kolkata');
  });

  test('schedule passes the same instant in tz.local, with title, body and payload', () async {
    final plugin = FakePlugin();
    final at = DateTime.utc(2026, 11, 14, 12, 30);
    await LocalFollowupNotifier(plugin).schedule(id: 7, at: at, title: 'T', body: 'B', payload: '/rewards');
    final s = plugin.scheduled.single;
    expect(s.id, 7);
    expect(s.at.isAtSameMomentAs(at), isTrue);
    expect(s.at.location.name, 'Asia/Kolkata');
    expect(s.at.hour, 18); // 12:30 UTC is 18:00 in India
    expect((s.title, s.body, s.payload), ('T', 'B', '/rewards'));
    expect(s.mode, AndroidScheduleMode.inexactAllowWhileIdle);
  });

  test('cancel cancels every id', () async {
    final plugin = FakePlugin();
    await LocalFollowupNotifier(plugin).cancel([1, 2, 3]);
    expect(plugin.cancelled, [1, 2, 3]);
  });

  test('FollowupScheduler drives the adapter: plan, then stop cancels it', () async {
    final plugin = FakePlugin();
    final demo = DemoRpc();
    final rewards = RewardsController(
      client: RewardsClient(rpc: demo.rpc, timezone: () => 'Asia/Kolkata'),
    );
    final scheduler = FollowupScheduler(controller: rewards, notifier: LocalFollowupNotifier(plugin));

    await scheduler.replanNow();
    expect(plugin.scheduled.single.id, 4201);
    expect(plugin.scheduled.single.payload, '/rewards');

    await scheduler.stop();
    expect(plugin.cancelled, [4201]);
  });

  test('the client sends the device timezone with rewards_track', () async {
    final demo = DemoRpc();
    final client = RewardsClient(rpc: demo.rpc, timezone: () async => 'Asia/Kolkata');
    await client.track('demo_action', dedupeKey: 'demo:1');
    expect(demo.lastTrackTimezone, 'Asia/Kolkata');
  });
}
