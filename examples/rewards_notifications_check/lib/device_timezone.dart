// The phone's IANA timezone, read once with flutter_timezone 5.1.1 and used twice: as the `timezone` of RewardsClient
// (streak days are counted in it, sent with every rewards_track) and as tz.local for scheduled notifications.
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:timezone/data/latest.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

/// The IANA name (`Asia/Kolkata`), or null when the platform does not answer. Since flutter_timezone 5,
/// `getLocalTimezone()` returns a `TimezoneInfo`; the name is its `identifier`.
Future<String?> deviceTimezone() async {
  try {
    return (await FlutterTimezone.getLocalTimezone()).identifier;
  } catch (_) {
    return null;
  }
}

/// Loads the timezone database and sets tz.local to [name] (unknown or null names keep UTC). Call once at start-up,
/// before the first notification is scheduled.
void setUpTimezones(String? name) {
  tzdata.initializeTimeZones();
  if (name == null) return;
  try {
    tz.setLocalLocation(tz.getLocation(name));
  } on tz.LocationNotFoundException {
    // Keep UTC: TZDateTime.from keeps the instant, so notifications still fire on time.
  }
}
