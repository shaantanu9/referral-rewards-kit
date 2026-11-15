import 'package:referral_kit/referral_kit.dart';

/// JSON shapes exactly as the SQL builds them (jsonb_build_object in migrations 2 and 3). Timestamps are how
/// PostgREST serialises timestamptz; numeric amounts arrive as JSON numbers.
Map<String, Object?> termsJson({
  bool enabled = true,
  bool paidEnabled = true,
  bool friendRule = true,
  bool sharerJoinedRule = true,
  bool paidRule = true,
}) => {
  'enabled': enabled,
  'paid_enabled': paidEnabled,
  'rule_set_version': 1,
  'rules': [
    if (friendRule) {'event': 'joined', 'who': 'friend', 'kind': 'minutes', 'amount': 30, 'params': {}},
    if (sharerJoinedRule) {'event': 'joined', 'who': 'sharer', 'kind': 'minutes', 'amount': 30, 'params': {}},
    if (paidRule)
      {
        'event': 'paid',
        'who': 'sharer',
        'kind': 'entitlement_days',
        'amount': 5,
        'params': {'entitlement_id': 'premium'},
      },
  ],
  'claim_window_days': 7,
  'activate_window_days': 30,
  'paid_window_days': 90,
  'hold_hours': 72,
  'sharer_joins_per_30d': 10,
  'sharer_paid_per_365d': 6,
};

Map<String, Object?> statsJson({bool empty = false}) => empty
    ? {'rewards_granted': [], 'pending': [], 'banked': [], 'skipped_cap': 0, 'joined_count': null, 'paid_count': null}
    : {
        'rewards_granted': [
          {
            'id': '0b9a3f4e-1111-4c2d-9a51-000000000001',
            'who': 'sharer',
            'event': 'joined',
            'kind': 'minutes',
            'amount': 30,
            'at': '2026-11-10T08:15:30.123456+00:00',
          },
        ],
        'pending': [
          {
            'id': '0b9a3f4e-1111-4c2d-9a51-000000000002',
            'event': 'paid',
            'kind': 'entitlement_days',
            'amount': 5,
            'available_at': '2026-11-15T09:00:00+00:00',
          },
        ],
        'banked': [
          {'id': '0b9a3f4e-1111-4c2d-9a51-000000000003', 'kind': 'entitlement_days', 'amount': 5},
        ],
        'skipped_cap': 2,
        'joined_count': 4,
        'paid_count': 1,
      };

List<Object?> pendingJson() => [
  {
    'id': '0b9a3f4e-1111-4c2d-9a51-000000000004',
    'who': 'friend',
    'event': 'joined',
    'kind': 'minutes',
    'amount': 30,
    'state': 'granted',
    'params': null,
  },
  {
    'id': '0b9a3f4e-1111-4c2d-9a51-000000000005',
    'who': 'sharer',
    'event': 'paid',
    'kind': 'entitlement_days',
    'amount': 5,
    'state': 'banked',
    'params': {'entitlement_id': 'premium'},
  },
];

/// Records every call and answers from [responses] (a value, or a function of the params). Throws [error] when set.
class FakeRpc {
  FakeRpc([Map<String, Object?>? responses])
    : responses = {
        'referral_my_code': {'code': 'ABCDEFGH', 'reason': 'ok'},
        'referral_terms': termsJson(),
        'referral_stats': statsJson(),
        'referral_pending': pendingJson(),
        'referral_ack': {'acknowledged': 1},
        'referral_claim': {'reason': 'ok', 'days_left': 30},
        'referral_check_activation': {'state': 'joined'},
        'referral_rotate_code': {
          'code': 'ABCDEFGH',
          'reason': 'too_soon',
          'next_allowed_at': '2026-12-01T00:00:00+00:00',
        },
        ...?responses,
      };

  final Map<String, Object?> responses;
  final List<(String, Map<String, Object?>)> calls = [];
  Object? error;

  Future<Object?> call(String fn, Map<String, Object?> params) async {
    calls.add((fn, params));
    if (error != null) throw error!;
    final r = responses[fn];
    if (r is Object? Function(Map<String, Object?>)) return r(params);
    return r;
  }

  List<String> get names => calls.map((c) => c.$1).toList();
}

const testInstallId = '3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b';

ReferralClient clientFor(FakeRpc rpc) =>
    ReferralClient(rpc: rpc.call, installIds: const FixedInstallIdStore(testInstallId));
