import 'package:rewards_kit/rewards_kit.dart';

/// Scripted RPC: each function answers from its handler; every call is recorded.
class FakeRpc {
  FakeRpc([Map<String, Object? Function(Map<String, Object?> p)>? handlers]) : handlers = handlers ?? {};
  final Map<String, Object? Function(Map<String, Object?> p)> handlers;
  final calls = <(String, Map<String, Object?>)>[];

  Future<Object?> call(String fn, Map<String, Object?> params) async {
    calls.add((fn, params));
    final h = handlers[fn];
    if (h == null) throw StateError('no fake for $fn');
    return h(params);
  }

  List<Map<String, Object?>> called(String fn) => [
    for (final c in calls)
      if (c.$1 == fn) c.$2,
  ];
}

final serverNow = DateTime.utc(2026, 11, 14, 10);
String iso(DateTime d) => d.toUtc().toIso8601String();

/// The ADR 0002 §11 example state, with every program kind live.
Map<String, Object?> sampleState({
  bool enabled = true,
  String offerState = 'active',
  String socialState = 'none',
  List<Map<String, Object?>>? inbox,
  bool todayDone = false,
}) => {
  'enabled': enabled,
  'server_time': iso(serverNow),
  'programs': [
    {'key': 'daily', 'kind': 'streak', 'starts_at': null, 'ends_at': null, 'public': {}},
    {
      'key': 'invite3',
      'kind': 'milestone',
      'public': {'title': 'Invite 3 friends'},
    },
    {'key': 'welcome', 'kind': 'offer', 'public': {}},
    {'key': 'ig_tag', 'kind': 'social_tag', 'public': {}},
  ],
  'streaks': [
    {
      'program': 'daily',
      'current': 3,
      'longest': 5,
      'today_done': todayDone,
      'freezes': 1,
      'ends_today_at': iso(serverNow.add(const Duration(hours: 2))),
      'breaks_at': iso(serverNow.add(const Duration(days: 2))),
      'next_reward': {'threshold': 7, 'kind': 'coins', 'amount': 50, 'params': {}},
    },
  ],
  'milestones': [
    {
      'program': 'invite3',
      'count': 1,
      'next_reward': {
        'threshold': 3,
        'kind': 'badge',
        'amount': 1,
        'params': {'badge': 'connector'},
      },
    },
  ],
  'offers': [
    {
      'program': 'welcome',
      'state': offerState,
      'started_at': iso(serverNow.subtract(const Duration(hours: 1))),
      'ends_at': iso(serverNow.add(const Duration(minutes: 30))),
      'stock_left': 12,
      'rewards': [
        {'kind': 'coins', 'amount': 100, 'params': {}},
      ],
    },
  ],
  'social': [
    {
      'program': 'ig_tag',
      'platform': 'instagram',
      'account': 'myapp',
      'state': socialState,
      'code': socialState == 'none' ? null : 'MYAPP-K7Q2HX',
      'expires_at': socialState == 'none' ? null : iso(serverNow.add(const Duration(days: 7))),
      'rewards': [
        {'kind': 'coins', 'amount': 200, 'params': {}},
      ],
    },
  ],
  'inbox': inbox ?? [],
  'badges': [
    {'badge': 'early', 'program': 'daily', 'granted_at': iso(serverNow)},
  ],
};

Map<String, Object?> grant(String id, {String state = 'granted', String kind = 'coins', num amount = 10}) => {
  'id': id,
  'program': 'daily',
  'kind': kind,
  'amount': amount,
  'params': {},
  'state': state,
  'created_at': iso(serverNow),
};

/// A controller on [rpc] whose clock reads [serverNow] as phone time too (offset zero).
RewardsController controllerOn(FakeRpc rpc, {List<RewardsEvent>? events, DateTime Function()? local}) =>
    RewardsController(
      client: RewardsClient(rpc: rpc.call, timezone: () => 'Asia/Kolkata', onEvent: events?.add),
      clock: ServerClock(local: local ?? () => serverNow),
    );
