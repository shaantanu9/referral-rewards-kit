// The 0.7 models against JSON the real SQL produced (migration 20261120000022 on a throwaway Postgres; how to
// regenerate: run that migration on a throwaway Postgres and save each RPC result). Catches a server/client field mismatch that hand-written fakes cannot.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

Object? _fixture(String name) => jsonDecode(File('test/fixtures/$name').readAsStringSync());

void main() {
  test('rewards_state from the server: choices, repair, head start, level, fixed grant', () {
    final s = RewardsState.fromJson(_fixture('server_0_7_state.json'));
    expect(s.choices, const RewardsChoices(surprisesOff: true, timersOff: true));
    expect(s.surprises, isEmpty);

    final streak = s.streaks.single;
    expect(streak.hidden, isFalse);
    expect(streak.repair, isNotNull);
    expect(streak.repair!.restoresTo, 21);
    expect(streak.repair!.needed, 2);
    expect(streak.repair!.done, 1);
    expect(streak.repair!.until, isNotNull);

    final reads = s.milestones.firstWhere((m) => m.program == 'reads');
    expect(reads.count, 3);
    expect(reads.headStart, 2);
    expect(s.programs.firstWhere((p) => p.key == 'reads').public['head_start_label'], 'A head start from us');

    final xp = s.milestones.firstWhere((m) => m.program == 'xp');
    expect(xp.level!.number, 1);
    expect(xp.level!.name, 'Starter');
    expect(xp.level!.at, 20);
    expect(xp.level!.nextAt, 60);
    expect(s.milestones.firstWhere((m) => m.program == 'box').level, isNull);

    final g = s.inbox.single;
    expect(g.isFixed, isTrue);
    expect(g.shouldReveal, isFalse);
  });

  test('rewards_track from the server: the repaired streak', () {
    final t = TrackResult.fromJson(_fixture('server_0_7_track.json'));
    expect(t.streaks.single.current, 21);
    expect(t.streaks.single.repairedAt, isNotNull);
    expect(t.streaks.single.repair, isNull);
  });

  test('rewards_followup_prefs from the server: the three choices', () {
    final p = FollowupPrefs.fromJson((_fixture('server_0_7_prefs.json')! as Map).cast<String, Object?>());
    expect(p.choices, const RewardsChoices(surprisesOff: true, timersOff: true));
  });
}
