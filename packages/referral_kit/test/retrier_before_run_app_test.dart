import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

import 'support/fake_rpc.dart';

/// Apps build their referral setup before runApp (the starter app does). The retrier's app-resume listener needs the
/// Flutter binding, so building it first used to throw a null-check error and the app showed a blank screen.
/// Deliberately no TestWidgetsFlutterBinding.ensureInitialized() here.
void main() {
  test('a retrier can be built before the binding exists', () {
    final queue = PendingClaimQueue(client: clientFor(FakeRpc()), store: MemoryKeyValueStore());
    final retrier = PendingClaimRetrier(queue: queue);
    expect(WidgetsBinding.instance, isNotNull);
    retrier.dispose();
  });
}
