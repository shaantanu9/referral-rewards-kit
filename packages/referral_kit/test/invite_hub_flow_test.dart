// InviteHub covers the first app's whole invite screen (0.3.0): Copy callback, share without an invite page,
// "almost yours" after a code, the reasons a code can't be added, the last-day chip from the theme, the app's own
// words, embedding without nested scrolling, Sign in when signed out, and the link-opened event.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

import 'support/fake_rpc.dart';
import 'support/harness.dart';

void main() {
  late List<ReferralEvent> events;
  late List<String> shared;
  setUp(() {
    events = [];
    shared = [];
  });

  ReferralClient client(FakeRpc rpc) => ReferralClient(
    rpc: rpc.call,
    installIds: const FixedInstallIdStore(testInstallId),
    onEvent: events.add,
    codeHashSalt: 't',
  );

  Widget hub(
    FakeRpc rpc, {
    Uri? Function(String code)? inviteLink,
    Uri? storeLink,
    ValueChanged<String>? onCopied,
    VoidCallback? onAlmostAction,
    ReferralTexts? texts,
    String? initialCode,
    VoidCallback? onSignIn,
    String? from,
    bool showInvite = true,
  }) {
    final c = client(rpc);
    return InviteHub(
      client: c,
      queue: PendingClaimQueue(client: c, store: MemoryKeyValueStore()),
      appName: 'Reader',
      inviteLink: inviteLink,
      storeLink: storeLink,
      share: (text, _) async => shared.add(text),
      onCopied: onCopied,
      onAlmostAction: onAlmostAction,
      texts: texts,
      initialCode: initialCode,
      onSignIn: onSignIn,
      from: from,
      showInvite: showInvite,
      pastePlatform: TargetPlatform.android,
    );
  }

  Map<String, Object?> terms({int? daysLeft, bool send = true}) => {
    ...termsJson(),
    if (send) 'claim_days_left': daysLeft,
  };

  Future<void> scrollToEntry(WidgetTester tester) async {
    final scroll = find
        .descendant(of: find.byKey(const ValueKey('referral-hub-scroll')), matching: find.byType(Scrollable))
        .first;
    await tester.scrollUntilVisible(find.byKey(const ValueKey('referral-gift-title')), 200, scrollable: scroll);
  }

  testWidgets('Copy calls back with the formatted code and reports has_link', (tester) async {
    ClipboardSpy(tester);
    final copied = <String>[];
    await tester.pumpWidget(
      harness(hub(FakeRpc(), inviteLink: (c) => Uri.parse('https://x.test/i/$c'), onCopied: copied.add)),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Copy code'));
    await tester.pumpAndSettle();
    expect(copied, ['ABCD-EFGH']);
    expect(events.where((e) => e.wireName == 'invite_code_copied').single.props, {'has_link': true});
  });

  testWidgets('no invite page: Share sends the code and the store link, a line says how', (tester) async {
    await tester.pumpWidget(harness(hub(FakeRpc(), storeLink: Uri.parse('https://apps.apple.com/app/id1'))));
    await tester.pumpAndSettle();
    expect(find.text('Your friend gets Reader from the app store and types this code in.'), findsOneWidget);
    await tester.tap(find.text('Share'));
    await tester.pumpAndSettle();
    expect(shared.single, contains('ABCD-EFGH'));
    expect(shared.single, contains('https://apps.apple.com/app/id1'));
    expect(shared.single, startsWith("Here's 30 min"));
    expect(events.where((e) => e.wireName == 'invite_shared').single.props['has_link'], false);
    // The screen reports once a day that it runs without an invite page.
    expect(events.where((e) => e.wireName == 'referral_feature_hidden').single.props, {
      'reason': 'no_invite_url',
      'surface': 'invite',
    });
  });

  testWidgets('a non-https link counts as no link', (tester) async {
    await tester.pumpWidget(harness(hub(FakeRpc(), inviteLink: (c) => Uri.parse('http://x.test/i/$c'))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Share'));
    await tester.pumpAndSettle();
    expect(shared.single, isNot(contains('http://')));
    expect(shared.single, contains('ABCD-EFGH'));
  });

  testWidgets('the friend part: gift, real days left, steps; after a code "almost yours" with the next step', (
    tester,
  ) async {
    var went = 0;
    await tester.pumpWidget(
      harness(hub(FakeRpc({'referral_terms': terms(daysLeft: 3)}), showInvite: false, onAlmostAction: () => went++)),
    );
    await tester.pumpAndSettle();
    expect(find.text('A gift is waiting for you: 30 min'), findsOneWidget);
    expect(find.text('Only 3 days left to add a code'), findsOneWidget);
    expect(find.text('How you get it'), findsOneWidget);
    expect(find.text('30 min lands for you, and for your friend'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('referral-code-field')), 'ABCDEFGH');
    await tester.tap(find.text('Add code'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('referral-almost')), findsOneWidget);
    expect(find.text('Start using the app and your 30 min unlocks. Your friend gets theirs too.'), findsOneWidget);
    expect(find.text('1 of 2 done: code added'), findsOneWidget);
    expect(find.byKey(const ValueKey('referral-code-field')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('referral-almost-action')));
    expect(went, 1);
  });

  testWidgets('last day: the chip uses the theme error container', (tester) async {
    final theme = ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal));
    await tester.pumpWidget(
      harness(Theme(data: theme, child: hub(FakeRpc({'referral_terms': terms(daysLeft: 1)}), showInvite: false))),
    );
    await tester.pumpAndSettle();
    expect(find.text('Last day to add a code'), findsOneWidget);
    final box = tester.widget<DecoratedBox>(find.byKey(const ValueKey('referral-deadline')));
    expect((box.decoration as BoxDecoration).color, theme.colorScheme.errorContainer);
  });

  testWidgets('window over: no field, one line why, reported once', (tester) async {
    await tester.pumpWidget(harness(hub(FakeRpc({'referral_terms': terms(daysLeft: 0)}), showInvite: false)));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('referral-code-field')), findsNothing);
    expect(find.text('Codes are for your first 7 days, and yours have passed.'), findsOneWidget);
    expect(events.where((e) => e.props['reason'] == 'window_closed'), hasLength(1));
  });

  testWidgets('not eligible (server sends no days left): no field, one line why', (tester) async {
    await tester.pumpWidget(harness(hub(FakeRpc({'referral_terms': terms()}), showInvite: false)));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('referral-code-field')), findsNothing);
    expect(find.textContaining("This account can't add one now."), findsOneWidget);
  });

  testWidgets('an older server without claim_days_left still shows the field', (tester) async {
    await tester.pumpWidget(harness(hub(FakeRpc({'referral_terms': terms(send: false)}), showInvite: false)));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('referral-code-field')), findsOneWidget);
    expect(find.byKey(const ValueKey('referral-deadline')), findsNothing);
  });

  testWidgets('a sharer-only program names no gift for the friend', (tester) async {
    await tester.pumpWidget(
      harness(
        hub(
          FakeRpc({
            'referral_terms': {...termsJson(friendRule: false), 'claim_days_left': 4},
          }),
          showInvite: false,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Have an invite code?'), findsOneWidget);
    expect(find.textContaining('gift'), findsNothing);
    expect(find.text('How you get it'), findsNothing);
  });

  testWidgets("the app's own words win", (tester) async {
    await tester.pumpWidget(
      harness(
        hub(
          FakeRpc({'referral_terms': terms(daysLeft: 2)}),
          showInvite: false,
          texts: ReferralTexts(
            giftTitle: (r) => '$r are waiting for you',
            deadline: (d) => '$d days to go',
            activationStep: 'Hear your first page read aloud',
            almostActionLabel: 'Start reading',
          ),
          onAlmostAction: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('30 min are waiting for you'), findsOneWidget);
    expect(find.text('2 days to go'), findsOneWidget);
    expect(find.text('Hear your first page read aloud'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('referral-code-field')), 'ABCDEFGH');
    await tester.tap(find.text('Add code'));
    await tester.pumpAndSettle();
    expect(find.text('Start reading'), findsOneWidget);
  });

  testWidgets('signed out: one sentence and a Sign in button', (tester) async {
    var signIns = 0;
    await tester.pumpWidget(
      harness(
        hub(
          FakeRpc()..error = const ReferralUnavailableException(ReferralUnavailableReason.signedOut),
          onSignIn: () => signIns++,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text("Sign in to get your invite code and to add a friend's code."), findsOneWidget);
    await tester.tap(find.text('Sign in'));
    expect(signIns, 1);
    expect(find.byKey(const ValueKey('referral-code-field')), findsNothing);
  });

  testWidgets('a code from a link: invite_link_opened with the hash, prefilled one-tap confirm', (tester) async {
    await tester.pumpWidget(
      harness(hub(FakeRpc({'referral_terms': terms(daysLeft: 5)}), initialCode: 'abcd-efgh', from: 'deeplink')),
    );
    await tester.pumpAndSettle();
    expect(events.first.wireName, 'invite_screen_viewed');
    expect(events.first.props, {'from': 'deeplink', 'focus': 'share'});
    final opened = events.where((e) => e.wireName == 'invite_link_opened').single;
    expect(opened.props, {'code_hash': referralCodeHash('ABCDEFGH', salt: 't')});
    await scrollToEntry(tester);
    expect(find.text('Use code ABCD-EFGH'), findsOneWidget);
  });

  testWidgets('scrollable: false sits in the app ListView with no nested scrolling', (tester) async {
    smallPhone(tester, height: 480);
    final key = GlobalKey<InviteHubState>();
    final rpc = FakeRpc({'referral_terms': terms(daysLeft: 5)});
    final c = client(rpc);
    await tester.pumpWidget(
      harness(
        Scaffold(
          body: ListView(
            children: [
              const SizedBox(height: 300, child: Text('app content')),
              InviteHub(
                key: key,
                client: c,
                queue: PendingClaimQueue(client: c, store: MemoryKeyValueStore()),
                appName: 'Reader',
                scrollable: false,
                share: (_, _) async {},
                pastePlatform: TargetPlatform.android,
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.byKey(const ValueKey('referral-hub-scroll')), findsNothing);
    expect(find.byType(ListView), findsOneWidget, reason: 'only the app scroll view');
    expect(find.byType(SingleChildScrollView), findsNothing);
    unawaited(key.currentState!.scrollTo(InviteHubSection.enterCode));
    await tester.pumpAndSettle();
    final top = tester.getTopLeft(find.byKey(const ValueKey('referral-gift-title'))).dy;
    expect(top, inInclusiveRange(0, 480));
  });
}
