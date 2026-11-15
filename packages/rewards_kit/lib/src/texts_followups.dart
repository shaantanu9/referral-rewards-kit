/// Strings of the 0.4 follow-up settings, English defaults, every one overridable:
/// `RewardsTexts(followups: FollowupTexts(reminders: 'Nudges'))`.
library;

/// `FollowupSettings`.
class FollowupTexts {
  const FollowupTexts({
    this.title = 'Reminders and emails',
    this.reminders = 'Reminders',
    this.remindersHint = 'A short note when your streak or a reward is waiting',
    this.emails = 'Emails about my progress',
    this.emailsHint = 'At most a few, and you can stop them any time',
    this.reminderTime = 'Reminder time',
    this.reminderTimeDefault = 'Default',
    this.retry = 'Retry',
  });

  /// The card's heading.
  final String title;

  /// The notifications switch (on = `notifications_off` false).
  final String reminders;
  final String remindersHint;

  /// The emails switch (on = `emails_off` false).
  final String emails;
  final String emailsHint;

  /// The row that opens the time picker.
  final String reminderTime;

  /// Shown when the user has not picked a time (the app's default applies).
  final String reminderTimeDefault;

  /// Loads the choices again after a failed load.
  final String retry;
}
