// rewards_kit demo: every widget over an in-memory fake server, in the default look (tab 1), a fully custom look
// built only from builders (tab 2), the daily quiz with the activity heatmap (tab 3), and follow-ups (tab 4: what the
// scheduler put on the phone, and the reminder settings), and an opt-in weekly league with the year recap as a
// shareable card (tab 5), to show that each app keeps its own UI. "Read a chapter" sometimes pays a surprise bonus,
// which plays the reveal, and scores a point in the league once joined. Run: flutter run (after `flutter create .`
// once, to add the platform folders).
import 'package:flutter/material.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fake_followups.dart';
import 'fake_server.dart';
import 'league_tab.dart';
import 'reminders_tab.dart';

void main() => runApp(const DemoApp());

class DemoApp extends StatefulWidget {
  const DemoApp({super.key, this.server});

  /// The fake server; a new one by default (tests pass one with a fixed surprise chance).
  final FakeServer? server;

  @override
  State<DemoApp> createState() => _DemoAppState();
}

class _DemoAppState extends State<DemoApp> {
  late final server = widget.server ?? FakeServer();
  late final controller = RewardsController(
    client: RewardsClient(rpc: server.call, onEvent: (e) => debugPrint(e.toString())),
  );

  final notifier = DemoNotifier();
  late final scheduler = FollowupScheduler(controller: controller, notifier: notifier);

  @override
  void initState() {
    super.initState();
    scheduler.start();
  }

  @override
  void dispose() {
    scheduler.stop();
    notifier.dispose();
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    theme: ThemeData(colorSchemeSeed: Colors.indigo),
    home: DefaultTabController(
      length: 5,
      child: RewardToastListener(
        controller: controller,
        child: Scaffold(
          appBar: AppBar(
            title: const Text('rewards_kit'),
            bottom: const TabBar(
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              tabs: [
                Tab(text: 'Default look'),
                Tab(text: 'Custom look'),
                Tab(text: 'Quiz'),
                Tab(text: 'Follow-ups'),
                Tab(text: 'League'),
              ],
            ),
          ),
          floatingActionButton: FloatingActionButton.extended(
            onPressed: () => controller.track('chapter_read', dedupeKey: 'ch:${server.chapters + 1}'),
            label: const Text('Read a chapter'),
            icon: const Icon(Icons.menu_book),
          ),
          body: TabBarView(
            children: [
              RewardsHub(controller: controller, onOpenInstagram: (a) => debugPrint('open instagram.com/$a')),
              _CustomLook(controller: controller, server: server),
              _QuizTab(controller: controller),
              RemindersTab(controller: controller, scheduler: scheduler, notifier: notifier),
              LeagueTab(controller: controller),
            ],
          ),
        ),
      ),
    ),
  );
}

/// The same programs, drawn only through builders: no default card is used.
class _CustomLook extends StatelessWidget {
  const _CustomLook({required this.controller, required this.server});
  final RewardsController controller;
  final FakeServer server;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(16),
    children: [
      StreakCard(
        controller: controller,
        builder: (context, s, c) => ListTile(
          tileColor: Colors.black,
          textColor: Colors.amber,
          leading: Text('${s.current}', style: const TextStyle(fontSize: 40, color: Colors.amber)),
          title: Text(s.todayDone ? 'Streak safe' : 'Read today to keep it'),
          subtitle: s.todayDone
              ? null
              : Countdown(
                  endsAt: s.endsTodayAt,
                  clock: c.clock,
                  style: const TextStyle(color: Colors.white),
                ),
        ),
      ),
      const SizedBox(height: 12),
      OfferBanner(
        controller: controller,
        program: 'welcome',
        builder: (context, o, claim) => Card(
          color: Colors.deepPurple,
          child: ListTile(
            textColor: Colors.white,
            title: Text('GIFT · ${o.status.wire}'),
            subtitle: Countdown(
              endsAt: o.endsAt,
              clock: controller.clock,
              style: const TextStyle(color: Colors.white70),
            ),
            trailing: o.status == OfferStatus.active
                ? OutlinedButton(onPressed: claim, child: const Text('Take'))
                : null,
          ),
        ),
      ),
      const SizedBox(height: 12),
      OutlinedButton(
        onPressed: () {
          server.social = 'verified';
          controller.refresh();
        },
        child: const Text('Simulate Meta webhook (verify the Instagram post)'),
      ),
    ],
  );
}

/// The daily quiz card (opens the default quiz screen), today's goal ring and the activity heatmap.
class _QuizTab extends StatelessWidget {
  const _QuizTab({required this.controller});
  final RewardsController controller;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(16),
    children: [
      QuizCard(controller: controller, program: 'quiz'),
      const SizedBox(height: 16),
      Row(
        children: [
          DailyGoalRing(controller: controller),
          const SizedBox(width: 12),
          const Expanded(child: Text('Read 2 chapters a day to keep the streak')),
        ],
      ),
      const SizedBox(height: 16),
      ActivityHeatmap(controller: controller),
    ],
  );
}
