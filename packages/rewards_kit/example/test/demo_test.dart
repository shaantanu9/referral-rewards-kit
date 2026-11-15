import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';
import 'package:rewards_kit_example/fake_server.dart';
import 'package:rewards_kit_example/league_tab.dart';
import 'package:rewards_kit_example/main.dart';

void main() {
  testWidgets('demo: hub loads, the quiz tab shows the quiz, goal ring and heatmap, and the quiz runs', (t) async {
    await t.pumpWidget(const DemoApp());
    await t.pump(const Duration(milliseconds: 400));
    expect(find.byType(StreakCard), findsOneWidget);
    await t.tap(find.text('Quiz'));
    await t.pumpAndSettle(const Duration(milliseconds: 100));
    await t.pump(const Duration(milliseconds: 400));
    expect(find.text('Daily quiz'), findsOneWidget);
    expect(find.byType(DailyGoalRing), findsOneWidget);
    expect(find.byType(ActivityHeatmap), findsOneWidget);
    await t.tap(find.text('Start'));
    await t.pump(const Duration(milliseconds: 400));
    await t.pump(const Duration(milliseconds: 400));
    await t.tap(find.text('Start').last);
    await t.pump(const Duration(milliseconds: 400));
    await t.pump(const Duration(milliseconds: 400));
    expect(find.text('Which planet is called the red planet?'), findsOneWidget);
    await t.tap(find.text('Mars'));
    await t.pump(const Duration(milliseconds: 400));
    expect(find.text('Right!'), findsOneWidget);
    await t.tap(find.byType(BackButton));
    await t.pump(const Duration(seconds: 3));
  });

  testWidgets('demo: the hub shows the surprise odds and a surprise chapter plays the reveal', (t) async {
    await t.pumpWidget(DemoApp(server: FakeServer(surpriseChance: 1, random: Random(7))));
    await t.pump(const Duration(milliseconds: 400));
    expect(find.text('100 % chance of 5–50 coins'), findsOneWidget);
    await t.tap(find.text('Read a chapter'));
    await t.pump(const Duration(milliseconds: 400));
    await t.pumpAndSettle();
    expect(find.text('Surprise!'), findsOneWidget);
    await t.tap(find.text('Tap to open'));
    await t.pumpAndSettle();
    expect(find.descendant(of: find.byType(Dialog), matching: find.textContaining('You got ')), findsOneWidget);
    await t.tap(find.text('Nice!'));
    await t.pumpAndSettle();
    expect(find.text('Surprise!'), findsNothing);
  });

  testWidgets('demo: the follow-ups tab lists the scheduled plan and saves a setting', (t) async {
    await t.pumpWidget(const DemoApp());
    await t.pump(const Duration(seconds: 3));
    await t.tap(find.text('Follow-ups'));
    await t.pumpAndSettle(const Duration(milliseconds: 100));
    await t.pump(const Duration(milliseconds: 400));
    expect(find.text('Emails about my progress'), findsOneWidget);
    expect(find.byIcon(Icons.notifications_outlined), findsNWidgets(3));
    expect(find.text('Comeback reminders'), findsOneWidget);
    expect(find.text('Sunday recap'), findsOneWidget);
    await t.tap(find.text('Sunday recap'));
    await t.pump(const Duration(milliseconds: 400));
    await t.pump(const Duration(milliseconds: 400));
    expect(find.byIcon(Icons.notifications_outlined), findsNWidgets(2));
    await t.tap(find.text('Reminders'));
    await t.pump(const Duration(milliseconds: 400));
    await t.pump(const Duration(milliseconds: 400));
    expect(find.text('Nothing scheduled'), findsOneWidget);
  });

  testWidgets('demo: the league tab joins, scores a chapter, leaves; the recap card renders', (t) async {
    await t.pumpWidget(DemoApp(server: FakeServer(surpriseChance: 0)));
    await t.pump(const Duration(seconds: 3));
    await t.tap(find.text('League'));
    await t.pumpAndSettle(const Duration(milliseconds: 100));
    await t.pump(const Duration(milliseconds: 400));
    expect(find.text('Reading league'), findsOneWidget);
    expect(find.textContaining('Only your display name and score are shown'), findsOneWidget);
    await t.tap(find.text('Join'));
    await t.pump(const Duration(milliseconds: 400));
    expect(find.text('Asha'), findsOneWidget);
    expect(find.text('You'), findsOneWidget);
    expect(find.text('Top 2 move up to Silver'), findsOneWidget);
    await t.tap(find.text('Read a chapter'));
    await t.pump(const Duration(milliseconds: 400));
    final controller = t.widget<LeagueBoard>(find.byType(LeagueBoard)).controller;
    unawaited(controller.loadLeague('weekly'));
    await t.pump(const Duration(milliseconds: 400));
    expect(find.text('1 point'), findsOneWidget);
    await t.scrollUntilVisible(
      find.text('Share my year'),
      200,
      scrollable: find.descendant(of: find.byType(LeagueTab), matching: find.byType(Scrollable)).first,
    );
    expect(find.text('Your ${DateTime.now().year}'), findsOneWidget);
    expect(find.text('212'), findsOneWidget);
    // (the button sits under the floating action button here; the package tests tap it)
    unawaited(controller.leaveLeague('weekly'));
    await t.pump(const Duration(milliseconds: 400));
    await t.scrollUntilVisible(
      find.text('Join'),
      -200,
      scrollable: find.descendant(of: find.byType(LeagueTab), matching: find.byType(Scrollable)).first,
    );
    expect(find.text('Join'), findsOneWidget);
  });
}
