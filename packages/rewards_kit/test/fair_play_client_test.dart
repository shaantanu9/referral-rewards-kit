import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';

void main() {
  test('the prefs setter sends the three choices as booleans and reads them back', () async {
    final rpc = FakeRpc({
      'rewards_followup_prefs': (p) => {'notifications_off': false, ...(p['patch']! as Map<String, Object?>)},
    });
    final c = RewardsClient(rpc: rpc.call);
    final p = await c.followupPrefs({'streaks_off': true, 'surprises_off': 'true', 'timers_off': false, 'x': 1});
    expect(rpc.calls.single.$2, {
      'patch': {'streaks_off': true, 'surprises_off': true, 'timers_off': false},
    });
    expect(p.choices, const RewardsChoices(streaksOff: true, surprisesOff: true));
  });

  test('controller.applyChoices updates the state at once and reloads', () async {
    var hidden = false;
    final rpc = FakeRpc({
      'rewards_state': (_) => {
        ...sampleState(),
        'choices': {'streaks_off': hidden},
      },
    });
    final c = controllerOn(rpc);
    await c.refresh();
    expect(c.state.choices.streaksOff, isFalse);
    hidden = true;
    final done = c.applyChoices(const RewardsChoices(streaksOff: true));
    expect(c.state.choices.streaksOff, isTrue);
    await done;
    expect(rpc.called('rewards_state'), hasLength(2));
    await c.applyChoices(const RewardsChoices(streaksOff: true));
    expect(rpc.called('rewards_state'), hasLength(2));
  });
}
