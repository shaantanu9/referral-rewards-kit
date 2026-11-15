// One analytics source (0.3.0): the client reports the whole funnel with the names the first app logged by hand,
// reward_granted once per reward, referral_feature_hidden once a day per reason, and an app's own code hasher.
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

import 'support/fake_rpc.dart';

void main() {
  group('zones', zoneTests);

  late List<ReferralEvent> events;
  setUp(() => events = []);

  ReferralClient client(FakeRpc rpc, {KeyValueStore? store, DateTime Function()? clock, ReferralCodeHasher? hasher}) =>
      ReferralClient(
        rpc: rpc.call,
        installIds: const FixedInstallIdStore(testInstallId),
        onEvent: events.add,
        eventStore: store,
        clock: clock,
        codeHasher: hasher,
      );

  test('wire names are the ones the first app logged, so switching breaks no data', () {
    // lib/analytics/app_events.dart in the first app's repo, 2026-11-13.
    const firstApp = {
      'invite_screen_viewed',
      'invite_code_copied',
      'invite_shared',
      'invite_link_opened',
      'code_entry_started',
      'code_submitted',
      'code_claim_result',
      'reward_granted',
      'referral_feature_hidden',
    };
    expect(ReferralEventName.values.map((e) => e.wire).toSet(), containsAll(firstApp));
    expect(ReferralEventName.values.map((e) => e.wire).toSet(), hasLength(ReferralEventName.values.length));
  });

  test('reward_granted once per granted reward, across clients sharing a store; banked ones wait', () async {
    final store = MemoryKeyValueStore();
    final rpc = FakeRpc();
    await client(rpc, store: store).pending();
    await client(rpc, store: store).pending(); // a new launch
    final granted = events.where((e) => e.wireName == 'reward_granted').toList();
    expect(granted, hasLength(1));
    expect(granted.single.props, {'kind': 'minutes', 'amount': 30, 'who': 'friend', 'event': 'joined'});

    // The banked reward is reported when the server says it was granted.
    rpc.responses['referral_pending'] = [
      {...(pendingJson()[1]! as Map<String, Object?>), 'state': 'granted'},
    ];
    await client(rpc, store: store).pending();
    expect(events.where((e) => e.wireName == 'reward_granted'), hasLength(2));
  });

  test('no onEvent: pending() remembers nothing and reports nothing', () async {
    final store = MemoryKeyValueStore();
    final c = ReferralClient(
      rpc: FakeRpc().call,
      installIds: const FixedInstallIdStore(testInstallId),
      eventStore: store,
    );
    await c.pending();
    await c.reportHidden('no_invite_url');
    expect(store.values, isEmpty);
  });

  test('referral_feature_hidden at most once a day per reason', () async {
    final store = MemoryKeyValueStore();
    var now = DateTime.utc(2026, 11, 14, 9);
    final rpc = FakeRpc()..error = const ReferralUnavailableException(ReferralUnavailableReason.notDeployed);
    final c = client(rpc, store: store, clock: () => now);
    for (var i = 0; i < 3; i++) {
      await c.availability();
    }
    await client(rpc, store: store, clock: () => now).availability(); // a new launch, same day
    await c.reportHidden('no_invite_url');
    await c.reportHidden('no_invite_url');
    await Future<void>.delayed(Duration.zero);
    expect(events.map((e) => e.props['reason']), ['not_deployed', 'no_invite_url']);
    expect(events.last.props['surface'], 'app');

    now = now.add(const Duration(days: 1));
    await client(rpc, store: store, clock: () => now).availability();
    await Future<void>.delayed(Duration.zero);
    expect(events.where((e) => e.props['reason'] == 'not_deployed'), hasLength(2));
  });

  test('availability() reports offline and server errors as hidden too', () async {
    await client(FakeRpc()..error = Exception('socket')).availability();
    await client(FakeRpc()..error = const ReferralServerError('referral_terms', 503)).availability();
    expect(events.map((e) => e.props['reason']), ['offline', 'server_error']);
  });

  test("an app's own code hasher keeps old and new code_hash values equal", () async {
    String firstAppHash(String c) => 'h-$c';
    final c = client(FakeRpc(), hasher: firstAppHash);
    expect(c.codeHash('abcd-efgh'), 'h-ABCDEFGH');
    await PendingClaimQueue(client: c, store: MemoryKeyValueStore()).claim('abcd efgh');
    expect(events.map((e) => e.props['code_hash']).toSet(), {'h-ABCDEFGH'});
    c.reportLinkOpened(' abcd-efgh ');
    expect(events.last.wireName, 'invite_link_opened');
    expect(events.last.props, {'code_hash': 'h-ABCDEFGH'});
  });

  test('reportLinkOpened ignores something that is not a code', () {
    client(FakeRpc()).reportLinkOpened('hello');
    expect(events, isEmpty);
  });

  test('legacy names stay available for apps that forwarded 0.2.0 events', () {
    expect(const ReferralEvent(ReferralEventName.codeClaimResult).legacyWireName, 'referral_claim_result');
    expect(const ReferralEvent(ReferralEventName.rewardGranted).legacyWireName, 'reward_granted');
  });

  test('a store that throws never breaks the flow', () async {
    final c = client(FakeRpc(), store: _BrokenStore());
    final items = await c.pending();
    expect(items, hasLength(2));
    expect(events.where((e) => e.wireName == 'reward_granted'), hasLength(1));
  });
}

/// A client built outside `testWidgets` (an app's setUp, or `main()` before `runApp`) must still answer inside it:
/// 0.3.0's first event memory chained on a future made in the constructor's zone and hung there.
void zoneTests() {
  late ReferralClient c;
  final seen = <String>[];
  setUp(() {
    c = ReferralClient(
      rpc: FakeRpc().call,
      installIds: const FixedInstallIdStore(testInstallId),
      onEvent: (e) => seen.add(e.wireName),
      eventStore: MemoryKeyValueStore(),
    );
  });

  testWidgets('pending() and reportHidden() complete in another zone', (tester) async {
    await tester.pumpWidget(const SizedBox());
    await c.pending();
    await c.reportHidden('no_invite_url');
    await c.pending();
    expect(seen, ['reward_granted', 'referral_feature_hidden']);
  });
}

class _BrokenStore implements KeyValueStore {
  @override
  Future<String?> getString(String key) async => throw StateError('disk');
  @override
  Future<void> remove(String key) async => throw StateError('disk');
  @override
  Future<void> setString(String key, String value) async => throw StateError('disk');
}
