// The Follow-ups tab: what the scheduler put on the "phone", and the user's choices.
import 'package:flutter/material.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fake_followups.dart';

class RemindersTab extends StatelessWidget {
  const RemindersTab({super.key, required this.controller, required this.scheduler, required this.notifier});
  final RewardsController controller;
  final FollowupScheduler scheduler;
  final DemoNotifier notifier;

  @override
  // A Column, not a lazy ListView: the scheduled list under the (now taller) settings card is always built.
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: const EdgeInsets.all(16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FollowupSettings(controller: controller, showChoices: true, onChanged: (_) => scheduler.replanNow()),
        const SizedBox(height: 16),
        Text('Scheduled on this phone', style: Theme.of(context).textTheme.titleMedium),
        ListenableBuilder(
          listenable: notifier,
          builder: (context, _) {
            final items = notifier.scheduled.entries.toList()..sort((a, b) => a.value.$1.compareTo(b.value.$1));
            if (items.isEmpty) return const ListTile(title: Text('Nothing scheduled'));
            return Column(
              children: [
                for (final e in items)
                  ListTile(
                    leading: const Icon(Icons.notifications_outlined),
                    title: Text(e.value.$3),
                    subtitle: Text(
                      '${MaterialLocalizations.of(context).formatMediumDate(e.value.$1)} '
                      '${TimeOfDay.fromDateTime(e.value.$1).format(context)} · id ${e.key}',
                    ),
                  ),
              ],
            );
          },
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: () => controller.followupOpened('inactive2'),
          child: const Text('Simulate opening a reminder'),
        ),
      ],
    ),
  );
}
