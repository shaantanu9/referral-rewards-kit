// An offline stand-in for the rewards RPCs, so this check runs without a Supabase project. A real app passes
// `(fn, params) => Supabase.instance.client.rpc(fn, params: params)` instead.
import 'package:rewards_kit/rewards_kit.dart';

class DemoRpc {
  DemoRpc({DateTime Function()? now, this.lead = const Duration(minutes: 1)}) : _now = now ?? DateTime.now;

  final DateTime Function() _now;

  /// How far ahead the one planned follow-up is.
  final Duration lead;

  /// Every call made, in order: (function, params).
  final List<(String, Map<String, Object?>)> calls = [];

  /// The `timezone` the client sent with the last `rewards_track`.
  String? get lastTrackTimezone {
    for (final c in calls.reversed) {
      if (c.$1 == 'rewards_track') return c.$2['timezone'] as String?;
    }
    return null;
  }

  Future<Object?> call(String fn, Map<String, Object?> params) async {
    calls.add((fn, params));
    final now = _now().toUtc();
    switch (fn) {
      case 'rewards_followups_plan':
        return {
          'server_time': now.toIso8601String(),
          'plan': [
            {
              'id': 4201,
              'program': 'demo_followup',
              'at': now.add(lead).toIso8601String(),
              'title': 'Your streak is waiting',
              'body': 'One quick session keeps it going.',
              'payload': '/rewards',
              'group': 'daily',
            },
          ],
        };
      case 'rewards_track':
        return {'enabled': true, 'duplicate': false};
      default:
        return <String, Object?>{};
    }
  }

  RewardsRpc get rpc => call;
}
