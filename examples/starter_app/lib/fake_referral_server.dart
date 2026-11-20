// A stand-in for the kit's Supabase functions, so the whole flow runs with no server. It answers the same RPC names
// with the same JSON shapes (supabase/migrations/20261112000002…, 000003…, 000009…). A real app replaces it with
// `(fn, params) => Supabase.instance.client.rpc(fn, params: params)` or `ReferralHttpRpc` (lib/referral_setup.dart).
// It also plays the app's sign-in (a real app has its own auth) and the other people in the story: a friend who signs
// up with your code, then starts using the app.
import 'dart:async';

import 'package:referral_kit/referral_kit.dart';

class FakeReferralServer {
  /// The demo user's own code, and a friend's code that works.
  static const myCode = 'K7QM2XRA';
  static const friendCode = 'H4PZ8WNE';

  /// How long each call takes (a real server is not instant; tests set zero).
  Duration latency = const Duration(milliseconds: 150);

  /// Turn off to see the "not available yet" state an app shows before the server side is deployed.
  bool deployed = true;

  /// The app's sign-in, played here. A real app passes its auth stream (Supabase: `auth.onAuthStateChange`).
  bool get signedIn => _signedIn;
  bool _signedIn;
  final _signIns = StreamController<bool>.broadcast();
  Stream<bool> get signInChanges => _signIns.stream;
  set signedIn(bool v) {
    if (v == _signedIn) return;
    _signedIn = v;
    _signIns.add(v);
  }

  FakeReferralServer({bool signedIn = true}) : _signedIn = signedIn;

  /// The server's count of days left to add a code (the kit's `claim_days_left`).
  int claimDaysLeft = 3;
  bool claimed = false;

  /// Friends who signed up with your code and have not started yet (`claimed_count`, migration 18), and friends who
  /// started (`joined_count`).
  int claimedFriends = 0;
  int joinedFriends = 0;
  final List<Map<String, Object?>> _granted = [];
  final Set<String> _acked = {};
  int _nextId = 1;

  static const _terms = {
    'enabled': true,
    'paid_enabled': true,
    'rule_set_version': 1,
    'rules': [
      {'event': 'joined', 'who': 'friend', 'kind': 'chapters', 'amount': 4, 'params': {}},
      {'event': 'joined', 'who': 'sharer', 'kind': 'chapters', 'amount': 4, 'params': {}},
      {
        'event': 'paid',
        'who': 'sharer',
        'kind': 'entitlement_days',
        'amount': 5,
        'params': {'entitlement_id': 'plus'},
      },
    ],
    'claim_window_days': 7,
    'activate_window_days': 30,
    'paid_window_days': 90,
    'hold_hours': 72,
    'sharer_joins_per_30d': 10,
    'sharer_paid_per_365d': 6,
  };

  Future<Object?> call(String fn, Map<String, Object?> params) async {
    if (latency > Duration.zero) await Future<void>.delayed(latency);
    if (!deployed) throw const ReferralUnavailableException(ReferralUnavailableReason.notDeployed);
    if (!signedIn) throw const ReferralUnavailableException(ReferralUnavailableReason.signedOut);
    switch (fn) {
      case 'referral_my_code':
        return {'code': myCode, 'reason': 'ok'};
      case 'referral_terms':
        return {..._terms, 'claim_days_left': claimed ? null : claimDaysLeft};
      case 'referral_claim':
        return _claim(normaliseCode(params['code'] as String?));
      case 'referral_stats':
        return {
          'rewards_granted': [
            for (final r in _granted.where((r) => r['who'] == 'sharer')) {...r, 'at': DateTime.now().toIso8601String()},
          ],
          'pending': [],
          'banked': [],
          'skipped_cap': 0,
          'claimed_count': claimedFriends,
          'joined_count': joinedFriends,
          'paid_count': null,
        };
      case 'referral_pending':
        return [
          for (final r in _granted.where((r) => !_acked.contains(r['id']))) {...r, 'state': 'granted'},
        ];
      case 'referral_ack':
        final ids = (params['reward_ids'] as List).cast<String>();
        final before = _acked.length;
        _acked.addAll(ids);
        return {'acknowledged': _acked.length - before};
      case 'referral_check_activation':
        return {'state': claimed ? 'claimed' : 'no_referral'};
      default:
        throw StateError('unknown function $fn');
    }
  }

  Map<String, Object?> _claim(String code) {
    if (claimDaysLeft <= 0) return {'reason': 'window_closed'};
    if (code == myCode) return {'reason': 'own_code'};
    if (claimed) return {'reason': 'already_referred'};
    if (code != friendCode) return {'reason': 'unknown_code'};
    claimed = true;
    return {'reason': 'ok', 'days_left': 30};
  }

  /// The friend (this user, after adding a code) starts using the app: the friend's reward lands.
  bool youStartUsing() {
    if (!claimed || _granted.any((r) => r['who'] == 'friend')) return false;
    _grant('friend');
    return true;
  }

  /// A friend signs up with your code: nothing is earned yet, but you see "1 friend used your code".
  void aFriendSignsUp() => claimedFriends++;

  /// A friend who used your code starts using the app (the app's activation hook): your reward lands.
  void aFriendStarts() {
    if (claimedFriends > 0) claimedFriends--;
    joinedFriends++;
    _grant('sharer');
  }

  void dispose() => unawaited(_signIns.close());

  void _grant(String who) => _granted.add({
    'id': '00000000-0000-4000-8000-${(_nextId++).toString().padLeft(12, '0')}',
    'who': who,
    'event': 'joined',
    'kind': 'chapters',
    'amount': 4,
    'params': null,
  });
}
