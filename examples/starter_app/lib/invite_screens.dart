// The one invite screen every entry point opens, and the screen an invite link lands on. Copy both.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:referral_kit/referral_kit.dart';

import 'referral_setup.dart';

/// CHANGE: open your sign-in screen. The fake server signs in at once.
void signIn(BuildContext context, ReferralSetup setup) {
  final fake = setup.fake;
  if (fake != null) {
    fake.signedIn = true;
    return;
  }
  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Open your sign-in screen here')));
}

/// `InviteHub` with the app's words, rebuilt after a sign-in so a signed-out friend who signs in from it sees their
/// code and "Use code …" without leaving the screen.
class InviteScreen extends StatefulWidget {
  const InviteScreen({super.key, required this.setup, required this.from, this.section});
  final ReferralSetup setup;

  /// Where it was opened from (`you`, `settings`, `home`, `deeplink`), reported with `invite_screen_viewed`.
  final String from;
  final InviteHubSection? section;

  @override
  State<InviteScreen> createState() => _InviteScreenState();
}

class _InviteScreenState extends State<InviteScreen> {
  StreamSubscription<Object?>? _signIns;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _signIns = widget.setup.signInChanges.listen((_) {
      if (mounted) setState(() => _generation++);
    });
  }

  @override
  void dispose() {
    unawaited(_signIns?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.setup;
    return InviteHub(
      key: ValueKey('hub-$_generation'),
      client: s.client,
      queue: s.queue,
      appName: 'Reader',
      from: widget.from,
      initialSection: widget.section,
      inviteLink: s.inviteLink,
      storeLink: storeLink,
      labels: rewardLabels,
      codeCache: s.store,
      texts: const ReferralTexts(
        activationStep: 'Read your first page',
        activationStepForFriends: 'Read their first page',
        almostActionLabel: 'Start reading',
      ),
      // CHANGE: go to the first real use (the activation step), e.g. the reader.
      onAlmostAction: () => Navigator.of(context).pop(),
      onSignIn: () => signIn(context, s),
    );
  }
}

/// Where `https://<site>/i/<CODE>` lands. The code is kept first (no server call, survives a restart); then the
/// friend sees the gift and taps "Use code …" once, signing in first if needed. Never claimed by itself (ADR §4.2).
class InviteLinkScreen extends StatefulWidget {
  const InviteLinkScreen({super.key, required this.setup, required this.link});
  final ReferralSetup setup;
  final String link;

  @override
  State<InviteLinkScreen> createState() => _InviteLinkScreenState();
}

class _InviteLinkScreenState extends State<InviteLinkScreen> {
  late final Future<String?> _kept = widget.setup.openedInviteLink(widget.link);

  @override
  Widget build(BuildContext context) => FutureBuilder<String?>(
    future: _kept,
    builder: (context, snap) {
      if (snap.connectionState != ConnectionState.done) {
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      }
      return InviteScreen(setup: widget.setup, from: 'deeplink', section: InviteHubSection.enterCode);
    },
  );
}
