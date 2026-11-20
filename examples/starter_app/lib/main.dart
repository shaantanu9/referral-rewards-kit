// referral_kit starter: the whole referral journey in a small app, against a fake server (lib/fake_referral_server.dart).
// Copy lib/referral_setup.dart, lib/invite_link.dart, lib/invite_screens.dart and the Home parts below into a new
// app; docs/integration.md is the full guide, docs/user-journey.md the journey step by step.
//
// Try it (Demo section at the bottom):
//   You share:     Invite friends → Share / Copy → "A friend signs up with your code" → Home says "1 friend used your
//                  code" → "A friend starts using the app" → your reward card and "1 friend joined".
//   A friend:      switch "Signed in" off → "Open an invite link" → Sign in → "Use code H4PZ-8WNE" → Add code →
//                  "Almost yours" → "You start using the app" → the gift on Home.
// The Events list shows what your analytics would receive.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:referral_kit/referral_kit.dart';

import 'fake_referral_server.dart';
import 'invite_link.dart';
import 'invite_screens.dart';
import 'referral_setup.dart';

void main() => runApp(StarterApp(setup: ReferralSetup()));

/// Tells Home when it is back on top (after the invite screen or an invite link's screen closes), so it reloads.
final homeRoutes = RouteObserver<ModalRoute<void>>();

class StarterApp extends StatelessWidget {
  const StarterApp({super.key, required this.setup});
  final ReferralSetup setup;

  Route<void> _home() => MaterialPageRoute(
    settings: const RouteSettings(name: '/'),
    builder: (_) => HomeScreen(setup: setup),
  );

  Route<void> _inviteLink(String link) => MaterialPageRoute(
    settings: RouteSettings(name: link),
    builder: (_) => InviteLinkScreen(setup: setup, link: link),
  );

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
    navigatorObservers: [homeRoutes],
    // App Links (Android) / Associated Domains (iOS): `https://<site>/i/<CODE>` opens the app with the route
    // `/i/<CODE>`, at cold start (initial routes) or while it runs (a pushed route). Home stays underneath.
    onGenerateInitialRoutes: (initial) => [_home(), if (codeFromInviteLink(initial) != null) _inviteLink(initial)],
    onGenerateRoute: (settings) {
      final name = settings.name ?? '/';
      if (codeFromInviteLink(name) != null) return _inviteLink(name);
      return name == '/' ? _home() : null; // CHANGE: your app's other routes
    },
  );
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.setup});
  final ReferralSetup setup;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with RouteAware {
  final List<ReferralEvent> _events = [];
  late Future<ReferralAvailability> _available;
  late Future<ReferralStats?> _stats;
  late Future<String?> _linkCode;
  StreamSubscription<Object?>? _signIns;
  int _cardKey = 0;

  ReferralSetup get s => widget.setup;

  @override
  void initState() {
    super.initState();
    _load();
    // Events can arrive while a screen is building: show them after the frame.
    s.onAnalytics = (e) => scheduleMicrotask(() {
      if (mounted) setState(() => _events.insert(0, e));
    });
    _signIns = s.signInChanges.listen((_) => unawaited(_offerLinkCode()));
    // The Play install referrer (Android) is read once per install and kept like a link code.
    unawaited(s.start().then((kept) => kept ? _offerLinkCode() : (mounted ? _refresh() : null)));
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route != null) homeRoutes.subscribe(this, route);
  }

  /// Back on Home: a code may have been added, a reward granted, or a link code used.
  @override
  void didPopNext() => _refresh();

  @override
  void dispose() {
    homeRoutes.unsubscribe(this);
    unawaited(_signIns?.cancel());
    super.dispose();
  }

  void _load() {
    _available = s.client.availability();
    _stats = s.client.stats().then<ReferralStats?>((v) => v, onError: (_) => null);
    _linkCode = s.queue.linkCode();
  }

  void _refresh() => setState(() {
    _load();
    _cardKey++;
  });

  /// Right after a sign-in (or a code just read from the install referrer), a code kept from a link opens code entry,
  /// where the friend sees "Use code …" and taps once. Skipped while another screen (the link's own) is on top. On
  /// later starts Home only shows the waiting card, so a friend who chose another code is not asked on every open.
  Future<void> _offerLinkCode() async {
    if (!mounted) return;
    _refresh();
    if (await s.queue.linkCode() == null) return;
    if (!(await s.client.availability()).isAvailable) return;
    if (!mounted || !(ModalRoute.of(context)?.isCurrent ?? false)) return;
    await _openInvite(from: 'deeplink', section: InviteHubSection.enterCode);
  }

  Future<void> _openInvite({required String from, InviteHubSection? section}) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => InviteScreen(setup: s, from: from, section: section),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final fake = s.fake;
    return Scaffold(
      appBar: AppBar(title: const Text('Reader')),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          _waitingLinkCode(),
          // Rewards that landed, once per device; "Invite friends" as the next step. CHANGE: key it by user id so a
          // sign-out and sign-in as someone else starts clean.
          ReferralRewardCard(
            key: ValueKey('card-$_cardKey'),
            client: s.client,
            labels: rewardLabels,
            actionLabel: 'Invite friends',
            onAction: () => _openInvite(from: 'home'),
          ),
          _friendsLine(),
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

  /// A code a friend arrived with (link or install referrer) and has not used yet. Signed out: sign in first.
  /// Signed in: one tap to code entry, or "Not now" to forget it. The app's own words.
  Widget _waitingLinkCode() => FutureBuilder<List<Object?>>(
    future: Future.wait<Object?>([_linkCode, _available]),
    builder: (context, snap) {
      final code = snap.data?[0] as String?;
      final availability = snap.data?[1];
      final signedOut = availability == ReferralAvailability.signedOut;
      if (code == null || !(signedOut || availability == ReferralAvailability.available)) {
        return const SizedBox.shrink();
      }
      return Card(
        key: const ValueKey('home-waiting-code'),
        margin: const EdgeInsets.fromLTRB(16, 8, 16, 8),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'A friend\'s code ${formatCode(code)} is waiting for you',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              Text(signedOut ? 'Sign in to add it and get your welcome gift.' : 'Add it to get your welcome gift.'),
              OverflowBar(
                alignment: MainAxisAlignment.end,
                children: [
                  if (!signedOut)
                    TextButton(
                      key: const ValueKey('home-forget-code'),
                      onPressed: () async {
                        await s.queue.clearLinkCode();
                        _refresh();
                      },
                      child: const Text('Not now'),
                    ),
                  FilledButton(
                    key: ValueKey(signedOut ? 'home-sign-in' : 'home-use-code'),
                    onPressed: signedOut
                        ? () => signIn(context, s)
                        : () => _openInvite(from: 'home', section: InviteHubSection.enterCode),
                    child: Text(signedOut ? 'Sign in' : 'Add code'),
                  ),
                ],
              ),
            ],
          ),
        ),
      );
    },
  );

  /// What the sharer sees on Home, not only on the invite screen (server migration 18): friends who used the code,
  /// then friends who started. The package's own words.
  Widget _friendsLine() => FutureBuilder<ReferralStats?>(
    future: _stats,
    builder: (context, snap) {
      final st = snap.data;
      final claimed = st?.claimedCount ?? 0;
      final joined = st?.joinedCount ?? 0;
      if (claimed == 0 && joined == 0) return const SizedBox.shrink();
      final l10n = referralL10n(context);
      return ListTile(
        key: const ValueKey('home-friends'),
        leading: const Icon(Icons.people_outline),
        title: Text(joined > 0 ? l10n.joinedCount(joined) : l10n.claimedCount(claimed)),
        subtitle: joined > 0 && claimed > 0 ? Text(l10n.claimedCount(claimed)) : null,
        onTap: () => _openInvite(from: 'home'),
      );
    },
  );

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
      key: const ValueKey('demo-signed-in'),
      title: const Text('Signed in'),
      value: fake.signedIn,
      onChanged: (v) => fake.signedIn = v, // the sign-in stream refreshes Home
    ),
    ListTile(
      key: const ValueKey('demo-open-link'),
      title: const Text('Open an invite link'),
      subtitle: const Text('As if a friend tapped https://<site>/i/H4PZ-8WNE'),
      // The same route an App Link opens.
      onTap: () => Navigator.of(context).pushNamed('/i/H4PZ-8WNE'),
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
      key: const ValueKey('demo-friend-signs-up'),
      title: const Text('A friend signs up with your code'),
      subtitle: const Text('Home says a friend used your code'),
      onTap: () {
        fake.aFriendSignsUp();
        _refresh();
      },
    ),
    ListTile(
      key: const ValueKey('demo-friend-starts'),
      title: const Text('A friend starts using the app'),
      subtitle: const Text('Your reward lands, the joined count goes up'),
      onTap: () {
        fake.aFriendStarts();
        _refresh();
      },
    ),
  ];
}
