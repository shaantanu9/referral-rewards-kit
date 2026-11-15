// The demo's stand-in for the follow-up part of the rewards engine (ADR 0002 §18.7).
import 'package:flutter/foundation.dart';
import 'package:rewards_kit/rewards_kit.dart';

/// Plans three notifications from the user's last activity, and keeps their reminder / email choices. Like the
/// engine: nothing while notifications are off, nothing of a muted group, and an activity moves the "inactive"
/// nudge forward.
class FakeFollowups {
  DateTime lastActivity = DateTime.now().toUtc();
  Map<String, Object?> prefs = {
    'notifications_off': false,
    'emails_off': true,
    'reminder_time': null,
    'muted_groups': <String>[],
  };

  /// The kinds of reminder the user can switch off one by one (ADR 0002 §18.8), with their labels.
  static const groups = {'comeback': 'Comeback reminders', 'recap': 'Sunday recap'};

  Set<String> get _muted => {...(prefs['muted_groups'] as List? ?? const []).whereType<String>()};

  /// A stable 31-bit id per (program, day), like the engine's.
  static int idOf(String program, DateTime at) => Object.hash(program, at.year, at.month, at.day) & 0x7fffffff;

  Map<String, Object?> _item(String program, DateTime at, String body, String group) => {
    'id': idOf(program, at),
    'program': program,
    'at': at.toIso8601String(),
    'title': 'rewards_kit demo',
    'body': body,
    'payload': '/home',
    'group': group,
  };

  Map<String, Object?> plan(DateTime now) => {
    'server_time': now.toIso8601String(),
    'plan': prefs['notifications_off'] == true
        ? <Object?>[]
        : [
            _item(
              'streak_at_risk',
              now.add(const Duration(hours: 20)),
              'Your streak is waiting for today.',
              'comeback',
            ),
            _item('inactive2', lastActivity.add(const Duration(days: 2)), 'Your next step is still here.', 'comeback'),
            _item('weekly_recap', now.add(const Duration(days: 6)), 'Your week is ready to look back on.', 'recap'),
          ].where((i) => !_muted.contains(i['group'])).toList(),
  };

  Map<String, Object?> applyPrefs(Map<String, Object?> patch) {
    for (final k in FollowupPrefs.keys) {
      if (patch.containsKey(k)) prefs[k] = patch[k];
    }
    return {
      ...prefs,
      'groups': [
        for (final g in groups.entries) {'group': g.key, 'label': g.value, 'muted': _muted.contains(g.key)},
      ],
    };
  }
}

/// A notifier that only lists what it was asked to schedule (an app uses flutter_local_notifications here).
class DemoNotifier extends ChangeNotifier implements FollowupNotifier {
  final scheduled = <int, (DateTime, String, String)>{};

  @override
  Future<void> cancel(List<int> ids) async {
    ids.forEach(scheduled.remove);
    notifyListeners();
  }

  @override
  Future<void> schedule({
    required int id,
    required DateTime at,
    required String title,
    required String body,
    required String payload,
  }) async {
    scheduled[id] = (at, title, body);
    notifyListeners();
  }
}
