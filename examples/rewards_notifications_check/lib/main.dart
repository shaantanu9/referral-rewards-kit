import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'demo_rpc.dart';
import 'device_timezone.dart';
import 'local_followup_notifier.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 1. The device timezone: one read, used for streak days (RewardsClient.timezone) and for tz.local.
  final zone = await deviceTimezone();
  setUpTimezones(zone);

  // 2. The notification plugin.
  final plugin = FlutterLocalNotificationsPlugin();
  await plugin.initialize(
    settings: const InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      iOS: DarwinInitializationSettings(
        requestAlertPermission: false,
        requestBadgePermission: false,
        requestSoundPermission: false,
      ),
    ),
  );

  // 3. The rewards client takes the timezone as a function; it is read on every rewards_track.
  final demo = DemoRpc();
  final rewards = RewardsController(
    client: RewardsClient(rpc: demo.rpc, timezone: deviceTimezone),
  );
  final scheduler = FollowupScheduler(controller: rewards, notifier: LocalFollowupNotifier(plugin));

  runApp(CheckApp(zone: zone, demo: demo, rewards: rewards, scheduler: scheduler, plugin: plugin));
}

class CheckApp extends StatefulWidget {
  const CheckApp({
    super.key,
    required this.zone,
    required this.demo,
    required this.rewards,
    required this.scheduler,
    required this.plugin,
  });

  final String? zone;
  final DemoRpc demo;
  final RewardsController rewards;
  final FollowupScheduler scheduler;
  final FlutterLocalNotificationsPlugin plugin;

  @override
  State<CheckApp> createState() => _CheckAppState();
}

class _CheckAppState extends State<CheckApp> {
  final List<String> _log = [];

  void _add(String line) => setState(() => _log.insert(0, line));

  Future<void> _track() async {
    await widget.rewards.client.track('demo_action', dedupeKey: 'demo:${DateTime.now().millisecondsSinceEpoch}');
    _add('rewards_track sent timezone: ${widget.demo.lastTrackTimezone ?? '(none)'}');
  }

  Future<void> _plan() async {
    final android = widget.plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    final ios = widget.plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
    final allowed =
        await android?.requestNotificationsPermission() ??
        await ios?.requestPermissions(alert: true, badge: true, sound: true) ??
        false;
    if (!allowed) {
      _add('Notifications not allowed: nothing scheduled');
      return;
    }
    await widget.scheduler.replanNow();
    final pending = await widget.plugin.pendingNotificationRequests();
    _add('Planned; pending on the phone: ${pending.map((p) => '${p.id} "${p.title}"').join(', ')}');
  }

  Future<void> _stop() async {
    await widget.scheduler.stop();
    final pending = await widget.plugin.pendingNotificationRequests();
    _add('Stopped (sign-out); pending: ${pending.length}');
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Rewards notifications check',
      home: Scaffold(
        appBar: AppBar(title: const Text('Rewards notifications check')),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Device timezone: ${widget.zone ?? '(unknown)'}'),
            const SizedBox(height: 12),
            FilledButton(onPressed: () => unawaited(_track()), child: const Text('Send a rewards_track')),
            const SizedBox(height: 8),
            FilledButton(onPressed: () => unawaited(_plan()), child: const Text('Plan follow-ups (one in 1 minute)')),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: () => unawaited(_stop()), child: const Text('Stop (sign-out)')),
            const Divider(height: 32),
            for (final l in _log) Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(l)),
          ],
        ),
      ),
    );
  }
}
