import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';

/// 0.5 (ADR 0002 §18.8): per-kind reminder switches (`muted_groups`, `groups`).
void main() {
  group('parsing', () {
    test('muted_groups and groups are read', () {
      final p = FollowupPrefs.fromJson({
        'muted_groups': ['recap'],
        'groups': [
          {'group': 'daily', 'label': 'Comeback reminders', 'muted': false},
          {'group': 'recap', 'label': 'Sunday recap', 'muted': true},
        ],
      });
      expect(p.mutedGroups, {'recap'});
      expect(p.groups, const [
        FollowupGroup('daily', 'Comeback reminders', false),
        FollowupGroup('recap', 'Sunday recap', true),
      ]);
    });

    test('missing or bad values are empty; bad items skipped; label falls back to the group name', () {
      expect(FollowupPrefs.fromJson(const {}), const FollowupPrefs());
      expect(FollowupPrefs.fromJson({'muted_groups': 'recap', 'groups': 'x'}), const FollowupPrefs());
      final p = FollowupPrefs.fromJson({
        'muted_groups': ['recap', 7, null, '', '  ', ' daily ', 'recap'],
        'groups': [
          'not an object',
          {'label': 'No name'},
          {'group': '  ', 'label': 'Blank'},
          {'group': 'daily', 'label': null, 'muted': 'true'},
          {'group': 'daily', 'label': 'Duplicate'},
          {'group': 'recap', 'label': '', 'muted': 1},
        ],
      });
      expect(p.mutedGroups, {'recap', 'daily'});
      expect(p.groups, const [FollowupGroup('daily', 'daily', true), FollowupGroup('recap', 'recap', false)]);
      expect(parseMutedGroups(null), isEmpty);
    });

    test('groupMutedPatch adds or removes one name; patched updates every group', () {
      const p = FollowupPrefs(
        mutedGroups: {'recap'},
        groups: [FollowupGroup('daily', 'Daily', false), FollowupGroup('recap', 'Recap', true)],
      );
      expect(p.groupMutedPatch('daily', true), {
        'muted_groups': ['recap', 'daily'],
      });
      expect(p.groupMutedPatch('recap', false), {'muted_groups': <String>[]});
      expect(p.groupMutedPatch('recap', true), {
        'muted_groups': ['recap'],
      });
      final q = p.patched(p.groupMutedPatch('daily', true));
      expect(q.mutedGroups, {'recap', 'daily'});
      expect(q.groups.map((g) => g.muted), [true, true]);
      expect(p.patched({'emails_off': true}).mutedGroups, {'recap'});
    });
  });

  group('client', () {
    late FakeRpc rpc;
    late Map<String, Object?> server;
    late List<RewardsEvent> events;
    late RewardsClient c;

    setUp(() {
      server = {
        'notifications_off': false,
        'muted_groups': ['recap'],
      };
      events = [];
      rpc = FakeRpc({
        'rewards_followup_prefs': (p) {
          server.addAll(p['patch']! as Map<String, Object?>);
          return {...server};
        },
      });
      c = RewardsClient(rpc: rpc.call, onEvent: events.add);
    });

    List<Object?> patches() => [for (final p in rpc.called('rewards_followup_prefs')) p['patch']];

    test('followupPrefs sends muted_groups as a list of names; not a list is left out', () async {
      await c.followupPrefs({
        'muted_groups': {'daily', 7, ''},
      });
      await c.followupPrefs({'muted_groups': 'daily', 'emails_off': true});
      await c.followupPrefs({'muted_groups': null});
      expect(patches(), [
        {
          'muted_groups': ['daily'],
        },
        {'emails_off': true},
        <String, Object?>{},
      ]);
      expect(events.map((e) => e.props), [
        {'field': 'muted_groups'},
        {'field': 'emails_off'},
      ]);
    });

    test('setFollowupGroupMuted reads first, then sends the list from the last known prefs', () async {
      expect(c.lastFollowupPrefs, isNull);
      final p = await c.setFollowupGroupMuted('daily', true);
      expect(p.mutedGroups, {'recap', 'daily'});
      expect(c.lastFollowupPrefs, p);
      await c.setFollowupGroupMuted('recap', false);
      expect(patches(), [
        <String, Object?>{},
        {
          'muted_groups': ['recap', 'daily'],
        },
        {
          'muted_groups': ['daily'],
        },
      ]);
      expect(events.map((e) => e.props), [
        {'field': 'muted_groups', 'group': 'daily'},
        {'field': 'muted_groups', 'group': 'recap'},
      ]);
    });
  });

  group('FollowupSettings', () {
    late FakeRpc rpc;
    late Map<String, Object?> server;

    Map<String, Object?> reply() {
      final muted = (server['muted_groups']! as List).toSet();
      return {
        ...server,
        'groups': [
          {'group': 'comeback', 'label': 'Comeback reminders', 'muted': muted.contains('comeback')},
          {'group': 'recap', 'label': 'Sunday recap', 'muted': muted.contains('recap')},
        ],
      };
    }

    setUp(() {
      server = {'notifications_off': false, 'emails_off': true, 'reminder_time': null, 'muted_groups': <String>[]};
      rpc = FakeRpc({
        'rewards_followup_prefs': (p) {
          server.addAll(p['patch']! as Map<String, Object?>);
          return reply();
        },
      });
    });

    List<Object?> patches() => [for (final p in rpc.called('rewards_followup_prefs')) p['patch']];
    List<bool> values(WidgetTester t) => [for (final s in t.widgetList<Switch>(find.byType(Switch))) s.value];
    Switch switchOf(WidgetTester t, String label) => t.widget<Switch>(
      find.descendant(of: find.widgetWithText(SwitchListTile, label), matching: find.byType(Switch)),
    );

    Future<void> pump(WidgetTester t, {ValueChanged<FollowupPrefs>? onChanged}) async {
      await t.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FollowupSettings(controller: controllerOn(rpc), onChanged: onChanged),
            ),
          ),
        ),
      );
      await t.pump();
      await t.pump();
    }

    testWidgets('one switch per group under Reminders, in order, with the labels', (t) async {
      await pump(t);
      expect(find.text('Comeback reminders'), findsOneWidget);
      expect(find.text('Sunday recap'), findsOneWidget);
      expect(values(t), [true, true, true, false]);
      final y = [
        for (final s in ['Reminders', 'Comeback reminders', 'Sunday recap']) t.getTopLeft(find.text(s)).dy,
      ];
      expect(y, orderedEquals([...y]..sort()));
      expect(t.getTopLeft(find.text('Sunday recap')).dx, greaterThan(t.getTopLeft(find.text('Reminders')).dx));
    });

    testWidgets('toggling a group sends the new list and calls onChanged', (t) async {
      final changed = <FollowupPrefs>[];
      await pump(t, onChanged: changed.add);
      await t.tap(find.text('Sunday recap'));
      await t.pump();
      await t.tap(find.text('Comeback reminders'));
      await t.pump();
      await t.tap(find.text('Sunday recap'));
      await t.pump();
      expect(patches().skip(1), [
        {
          'muted_groups': ['recap'],
        },
        {
          'muted_groups': ['recap', 'comeback'],
        },
        {
          'muted_groups': ['comeback'],
        },
      ]);
      expect(changed.map((p) => p.mutedGroups), [
        {'recap'},
        {'recap', 'comeback'},
        {'comeback'},
      ]);
      expect(switchOf(t, 'Comeback reminders').value, isFalse);
      expect(switchOf(t, 'Sunday recap').value, isTrue);
    });

    testWidgets('group switches are disabled while reminders are off', (t) async {
      server['notifications_off'] = true;
      await pump(t);
      expect(switchOf(t, 'Comeback reminders').onChanged, isNull);
      expect(switchOf(t, 'Sunday recap').onChanged, isNull);
      await t.tap(find.text('Sunday recap'));
      await t.pump();
      expect(patches(), [<String, Object?>{}]);
      await t.tap(find.text('Reminders'));
      await t.pump();
      expect(switchOf(t, 'Sunday recap').onChanged, isNotNull);
    });

    testWidgets('a failed group save is undone and shows the error line', (t) async {
      final changed = <FollowupPrefs>[];
      await pump(t, onChanged: changed.add);
      rpc.handlers['rewards_followup_prefs'] = (_) => throw Exception('socket closed');
      await t.tap(find.text('Sunday recap'));
      await t.pump();
      await t.pump();
      expect(switchOf(t, 'Sunday recap').value, isTrue);
      expect(find.text('You are offline. Try again in a moment.'), findsOneWidget);
      expect(changed, isEmpty);
    });

    testWidgets('an older server without groups shows no group switches', (t) async {
      rpc.handlers['rewards_followup_prefs'] = (_) => {'notifications_off': false};
      await pump(t);
      expect(values(t), [true, true]);
      expect(find.text('Sunday recap'), findsNothing);
    });
  });
}
