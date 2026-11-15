import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';

void main() {
  late FakeRpc rpc;
  late Map<String, Object?> server;

  setUp(() {
    server = {'notifications_off': false, 'emails_off': true, 'reminder_time': null};
    rpc = FakeRpc({
      'rewards_followup_prefs': (p) {
        final patch = p['patch']! as Map<String, Object?>;
        server.addAll(patch);
        return {...server};
      },
    });
  });

  List<Object?> patches() => [for (final p in rpc.called('rewards_followup_prefs')) p['patch']];

  Future<RewardsController> pumpSettings(WidgetTester t, {ValueChanged<FollowupPrefs>? onChanged}) async {
    final c = controllerOn(rpc);
    await t.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: FollowupSettings(controller: c, onChanged: onChanged),
          ),
        ),
      ),
    );
    await t.pump();
    await t.pump();
    return c;
  }

  testWidgets('loads after the first frame and shows both switches and the time', (t) async {
    await pumpSettings(t);
    expect(patches(), [<String, Object?>{}]);
    expect(find.text('Reminders'), findsOneWidget);
    expect(find.text('Emails about my progress'), findsOneWidget);
    expect(find.text('Reminder time'), findsOneWidget);
    expect(find.text('Default'), findsOneWidget);
    final switches = t.widgetList<Switch>(find.byType(Switch)).toList();
    expect(switches.map((s) => s.value), [true, false]);
  });

  testWidgets('toggles send the inverted keys and report the change', (t) async {
    final changed = <FollowupPrefs>[];
    await pumpSettings(t, onChanged: changed.add);
    await t.tap(find.text('Reminders'));
    await t.pump();
    await t.tap(find.text('Emails about my progress'));
    await t.pump();
    expect(patches().skip(1), [
      {'notifications_off': true},
      {'emails_off': false},
    ]);
    expect(changed.last, const FollowupPrefs(notificationsOff: true));
    expect(t.widgetList<Switch>(find.byType(Switch)).map((s) => s.value), [false, true]);
  });

  testWidgets('the time picker result is saved as "HH:MM"', (t) async {
    await pumpSettings(t);
    await t.tap(find.text('Reminder time'));
    await t.pumpAndSettle();
    await t.tap(find.text('OK'));
    await t.pumpAndSettle();
    expect(patches().last, {'reminder_time': '19:00'});
    expect(find.text('7:00 PM'), findsOneWidget);
  });

  testWidgets('a failed save is undone and shows a short line', (t) async {
    await pumpSettings(t);
    rpc.handlers['rewards_followup_prefs'] = (_) => throw Exception('socket closed');
    await t.tap(find.text('Reminders'));
    await t.pump();
    await t.pump();
    expect(t.widgetList<Switch>(find.byType(Switch)).first.value, isTrue);
    expect(find.text('You are offline. Try again in a moment.'), findsOneWidget);
  });

  testWidgets('a failed load shows the line and a retry; texts and the emails switch are overridable', (t) async {
    rpc.handlers['rewards_followup_prefs'] = (_) => throw Exception('socket closed');
    final c = controllerOn(rpc);
    await t.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: FollowupSettings(
            controller: c,
            showEmails: false,
            texts: const RewardsTexts(
              followups: FollowupTexts(reminders: 'Nudges', retry: 'Again'),
            ),
          ),
        ),
      ),
    );
    await t.pump();
    await t.pump();
    expect(find.text('Again'), findsOneWidget);
    rpc.handlers['rewards_followup_prefs'] = (_) => {'notifications_off': false};
    await t.tap(find.text('Again'));
    await t.pump();
    await t.pump();
    expect(find.text('Nudges'), findsOneWidget);
    expect(find.text('Emails about my progress'), findsNothing);
  });

  testWidgets('builder gets the prefs and a save function', (t) async {
    final c = controllerOn(rpc);
    await t.pumpWidget(
      MaterialApp(
        home: FollowupSettings(
          controller: c,
          builder: (context, prefs, save, reason) => TextButton(
            onPressed: () => save({'reminder_time': const TimeOfDay(hour: 8, minute: 5)}),
            child: Text(prefs == null ? 'loading' : 'off:${prefs.notificationsOff}'),
          ),
        ),
      ),
    );
    expect(find.text('loading'), findsOneWidget);
    await t.pump();
    await t.pump();
    await t.tap(find.text('off:false'));
    await t.pump();
    expect(patches().last, {'reminder_time': '08:05'});
  });
}
