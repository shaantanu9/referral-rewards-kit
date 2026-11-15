// referral_kit starter: the whole invite flow in a small app, against a fake server (lib/fake_referral_server.dart).
// Copy lib/referral_setup.dart and the two entry points below into a new app; docs/integration.md is the full guide.
//
// Try it: Invite friends → Share / Copy; "Got a code from a friend?" → type H4PZ-8WNE → "Almost yours" → Demo:
// "You start using the app" → the reward card on Home. The Events list shows what your analytics would receive.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:referral_kit/referral_kit.dart';

import 'fake_referral_server.dart';
import 'referral_setup.dart';

void main() => runApp(StarterApp(setup: ReferralSetup()));

class StarterApp extends StatelessWidget {
  const StarterApp({super.key, required this.setup});
  final ReferralSetup setup;

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Reader',
    theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo)),
    darkTheme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo, brightness: Brightness.dark),
    ),
    // The package's strings (en, hi, id; English for any other language) next to the app's own.
    localizationsDelegates: const [
      referralKitLocalizationsDelegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    supportedLocales: const [Locale('en'), Locale('hi'), Locale('id')],
    home: HomeScreen(setup: setup),
  );
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.setup});
  final ReferralSetup setup;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final List<ReferralEvent> _events = [];
  late Future<ReferralAvailability> _available = widget.setup.client.availability();
  int _cardKey = 0;

  ReferralSetup get s => widget.setup;

  @override
  void initState() {
    super.initState();
    // Events can arrive while a screen is building: show them after the frame.
    s.onAnalytics = (e) => scheduleMicrotask(() {
      if (mounted) setState(() => _events.insert(0, e));
    });
  }

  void _refresh() => setState(() {
    _available = s.client.availability();
    _cardKey++;
  });

  Future<void> _openInvite({required String from, InviteHubSection? section}) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) => InviteHub(
          client: s.client,
          queue: s.queue,
          appName: 'Reader',
          from: from,
          initialSection: section,
          inviteLink: s.inviteLink,
          storeLink: storeLink,
          labels: rewardLabels,
          codeCache: s.store,
          texts: const ReferralTexts(activationStep: 'Read your first page', almostActionLabel: 'Start reading'),
          onAlmostAction: () => Navigator.of(context).pop(),
          onSignIn: () => Navigator.of(context).pop(),
        ),
      ),
    );
    _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final fake = s.fake;
    return Scaffold(
      appBar: AppBar(title: const Text('Reader')),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          // Rewards that landed, once per device; "Invite friends" as the next step.
          ReferralRewardCard(
            key: ValueKey('card-$_cardKey'),
            client: s.client,
            labels: rewardLabels,
            actionLabel: 'Invite friends',
            onAction: () => _openInvite(from: 'home'),
          ),
          // Entry points only when referrals work for this user (hidden before the server side is deployed).
          FutureBuilder<ReferralAvailability>(
            future: _available,
            builder: (context, snap) {
              if (snap.data?.isAvailable != true) return const SizedBox.shrink();
              return Column(
                children: [
                  ListTile(
                    key: const ValueKey('row-invite'),
                    leading: const Icon(Icons.card_giftcard),
                    title: const Text('Invite friends'),
                    onTap: () => _openInvite(from: 'you'),
                  ),
                  ListTile(
                    key: const ValueKey('row-code'),
                    leading: const Icon(Icons.redeem),
                    title: const Text('Got a code from a friend?'),
                    onTap: () => _openInvite(from: 'settings', section: InviteHubSection.enterCode),
                  ),
                ],
              );
            },
          ),
          if (fake != null) ..._demoControls(fake),
          const Divider(),
          ListTile(title: Text('Events (${_events.length})', style: Theme.of(context).textTheme.titleSmall)),
          for (final e in _events.take(20))
            ListTile(dense: true, title: Text(e.wireName), subtitle: Text('${e.props}')),
        ],
      ),
    );
  }

  List<Widget> _demoControls(FakeReferralServer fake) => [
    const Divider(),
    const ListTile(title: Text('Demo (fake server)')),
    SwitchListTile(
      key: const ValueKey('demo-deployed'),
      title: const Text('Server side deployed'),
      value: fake.deployed,
      onChanged: (v) {
        fake.deployed = v;
        _refresh();
      },
    ),
    SwitchListTile(
      title: const Text('Signed in'),
      value: fake.signedIn,
      onChanged: (v) {
        fake.signedIn = v;
        _refresh();
      },
    ),
    ListTile(
      key: const ValueKey('demo-start-using'),
      title: const Text('You start using the app'),
      subtitle: const Text('After adding a code: your gift lands'),
      onTap: () {
        fake.youStartUsing();
        _refresh();
      },
    ),
    ListTile(
      title: const Text('A friend joins with your code'),
      subtitle: const Text('Your reward lands, the joined count goes up'),
      onTap: () {
        fake.aFriendJoins();
        _refresh();
      },
    ),
  ];
}
