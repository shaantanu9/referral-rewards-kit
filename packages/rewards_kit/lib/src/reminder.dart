/// When to remind a user about their streak. Pure: the package sends no notifications (ADR 0002 §14, Apple 4.5.4).
library;

import 'models.dart';

/// The instant (phone-local `DateTime`) to remind the user that today's streak is not done yet, or null when no
/// reminder is needed.
///
/// Schedule your own local notification at this time (e.g. with `flutter_local_notifications`), **at most one a
/// day**, only for users who opted in, and cancel it when [StreakState.todayDone] turns true. Call it again after
/// each `refresh` / `track`.
///
/// - The reminder is [before] the server's `ends_today_at` (the end of the user's local day).
/// - Null when today is done, there is no streak to lose (`current` 0), the server sent no deadline, or the time
///   has already passed at [now].
/// - Quiet hours run from [quietFromHour]:00 to [quietToHour]:00 local time (wrapping midnight when from > to;
///   none when they are equal). A time inside them moves **earlier**, to the last minute before they start (21:59
///   with the defaults), never later; if that is already past, null.
DateTime? streakReminderAt(
  StreakState s, {
  required DateTime now,
  Duration before = const Duration(hours: 3),
  int quietFromHour = 22,
  int quietToHour = 9,
}) {
  final end = s.endsTodayAt;
  if (s.todayDone || s.current <= 0 || end == null) return null;
  var at = end.subtract(before).toLocal();
  if (_quiet(at.hour, quietFromHour, quietToHour)) {
    var start = DateTime(at.year, at.month, at.day, quietFromHour);
    if (start.isAfter(at)) start = DateTime(at.year, at.month, at.day - 1, quietFromHour);
    at = start.subtract(const Duration(minutes: 1));
  }
  if (!at.isAfter(now) || !at.isBefore(end)) return null;
  return at;
}

bool _quiet(int hour, int from, int to) {
  if (from == to) return false;
  return from > to ? (hour >= from || hour < to) : (hour >= from && hour < to);
}
