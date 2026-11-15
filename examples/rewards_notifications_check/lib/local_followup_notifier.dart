// The FollowupNotifier from packages/rewards_kit/README.md ("Follow-ups"), compiled here against
// flutter_local_notifications 22.3.3 and timezone 0.11.2. Copy this file into an app; keep the README snippet equal to it.
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:rewards_kit/rewards_kit.dart';
import 'package:timezone/timezone.dart' as tz;

class LocalFollowupNotifier implements FollowupNotifier {
  LocalFollowupNotifier(this.plugin);
  final FlutterLocalNotificationsPlugin plugin;

  @override
  Future<void> cancel(List<int> ids) async {
    for (final id in ids) {
      await plugin.cancel(id: id);
    }
  }

  @override
  Future<void> schedule({
    required int id,
    required DateTime at,
    required String title,
    required String body,
    required String payload,
  }) => plugin.zonedSchedule(
    id: id,
    scheduledDate: tz.TZDateTime.from(at, tz.local),
    notificationDetails: const NotificationDetails(
      android: AndroidNotificationDetails('followups', 'Reminders'),
      iOS: DarwinNotificationDetails(),
    ),
    androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
    title: title,
    body: body,
    payload: payload,
  );
}
