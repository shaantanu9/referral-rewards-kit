import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

/// A streak whose day ends at local midnight after [day] (phone-local wall clock, whatever the test machine's zone).
StreakState streak({bool done = false, int current = 3, DateTime? endsLocal}) => StreakState(
  program: 'daily',
  current: current,
  todayDone: done,
  endsTodayAt: (endsLocal ?? DateTime(2026, 11, 15)).toUtc(),
);

void main() {
  final morning = DateTime(2026, 11, 14, 8);

  test('3 hours before the end of the day', () {
    expect(streakReminderAt(streak(), now: morning), DateTime(2026, 11, 14, 21));
  });

  test('null when done today, no streak, no deadline, or the time has passed', () {
    expect(streakReminderAt(streak(done: true), now: morning), isNull);
    expect(streakReminderAt(streak(current: 0), now: morning), isNull);
    expect(streakReminderAt(const StreakState(program: 'd', current: 2), now: morning), isNull);
    expect(streakReminderAt(streak(), now: DateTime(2026, 11, 14, 21, 30)), isNull);
  });

  test('inside quiet hours it moves earlier, to the minute before they start', () {
    expect(streakReminderAt(streak(), now: morning, before: const Duration(hours: 1)), DateTime(2026, 11, 14, 21, 59));
    // A day that ends at 04:00 (late timezone): 01:00 is quiet → the evening before.
    expect(
      streakReminderAt(streak(endsLocal: DateTime(2026, 11, 15, 4)), now: morning),
      DateTime(2026, 11, 14, 21, 59),
    );
    // Moved time already past → null.
    expect(streakReminderAt(streak(), now: DateTime(2026, 11, 14, 22, 10), before: const Duration(hours: 1)), isNull);
  });

  test('custom and disabled quiet hours', () {
    expect(streakReminderAt(streak(), now: morning, quietFromHour: 20, quietToHour: 8), DateTime(2026, 11, 14, 19, 59));
    expect(
      streakReminderAt(streak(), now: morning, before: const Duration(hours: 1), quietFromHour: 0, quietToHour: 0),
      DateTime(2026, 11, 14, 23),
    );
    // Non-wrapping quiet hours 13..15.
    expect(
      streakReminderAt(streak(endsLocal: DateTime(2026, 11, 14, 17)), now: morning, quietFromHour: 13, quietToHour: 15),
      DateTime(2026, 11, 14, 12, 59),
    );
  });
}
