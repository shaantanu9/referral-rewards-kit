// The "Built with Myind" link (ADR 0003): on by default on InviteHub and InviteFriendsScreen, hidden with
// showAttribution: false, opens the site with utm params through the injected launcher, never doubled in the hub.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

import 'support/fake_rpc.dart';
import 'support/harness.dart';

class _Launcher implements ReferralLauncher {
  final List<Uri> launched = [];
  @override
  Future<bool> canLaunch(Uri uri) async => true;
  @override
  Future<bool> launch(Uri uri) async {
    launched.add(uri);
    return true;
  }
}

const _link = ValueKey('myind-attribution');

void main() {
  group('MyindAttributionConfig', () {
    test('four variants with their URLs, and the index wraps', () {
      expect(MyindAttributionConfig.variants.map((v) => v.text), [
        'Built with Myind referral kit',
        'Rewards by Myind',
        'Free referral kit by Myind',
        'Made with Myind',
      ]);
      expect(MyindAttributionConfig.variant(2).url, 'https://www.myind.ai/referral-kit/showcase');
      expect(MyindAttributionConfig.variant(3).url, 'https://www.myind.ai');
      expect(MyindAttributionConfig.variant(5).text, 'Rewards by Myind');
      expect(MyindAttributionConfig.variant(-1).text, 'Made with Myind');
    });

    test('link adds utm params for this package', () {
      final u = MyindAttributionConfig.link(0);
      expect(u.toString().startsWith('https://www.myind.ai/referral-kit?'), isTrue);
      expect(u.queryParameters, {'utm_source': 'referral_kit', 'utm_medium': 'attribution', 'utm_campaign': 'v0'});
      expect(MyindAttributionConfig.link(6).queryParameters['utm_campaign'], 'v2');
      expect(MyindAttributionConfig.link(1, source: 'my_app').queryParameters['utm_source'], 'my_app');
    });

    test('the constants', () {
      expect(MyindAttributionConfig.showcaseUrl, 'https://www.myind.ai/referral-kit/showcase');
      expect(MyindAttributionConfig.proUrl, 'https://www.myind.ai/referral-kit/pro');
      expect(MyindAttributionConfig.badgeUrl, 'https://www.myind.ai/referral-kit/badge.svg');
      expect(MyindAttributionConfig.githubUrl, 'https://github.com/shaantanu9/referral-rewards-kit');
    });
  });

  group('MyindAttribution', () {
    Widget host(Widget child, {ThemeData? theme}) => MaterialApp(
      theme: theme,
      home: Scaffold(body: child),
    );

    testWidgets('tap opens the link with utm params through the injected opener', (tester) async {
      final opened = <Uri>[];
      await tester.pumpWidget(
        host(
          MyindAttribution(
            onOpen: (u) async {
              opened.add(u);
              return true;
            },
          ),
        ),
      );
      expect(find.text('Built with Myind referral kit'), findsOneWidget);
      await tester.tap(find.byKey(_link));
      expect(opened.single.toString(), startsWith('https://www.myind.ai/referral-kit?'));
      expect(opened.single.queryParameters['utm_source'], 'referral_kit');
      expect(opened.single.queryParameters['utm_medium'], 'attribution');
      expect(opened.single.queryParameters['utm_campaign'], 'v0');
    });

    testWidgets('variant wraps, has a link semantics label and a 44 dp tap target', (tester) async {
      final semantics = tester.ensureSemantics();
      await tester.pumpWidget(host(MyindAttribution(variant: 6, onOpen: (_) async => true)));
      expect(find.text('Free referral kit by Myind'), findsOneWidget);
      expect(find.bySemanticsLabel('Opens myind.ai: Free referral kit by Myind'), findsOneWidget);
      final data = tester.getSemantics(find.bySemanticsLabel('Opens myind.ai: Free referral kit by Myind'));
      expect(data.flagsCollection.isLink, isTrue);
      final box = tester.getSize(find.byType(InkWell));
      expect(box.height, greaterThanOrEqualTo(44));
      expect(box.width, greaterThanOrEqualTo(44));
      semantics.dispose();
    });

    testWidgets('dark theme: the text uses the theme colour, not a fixed grey', (tester) async {
      final dark = ThemeData(brightness: Brightness.dark);
      await tester.pumpWidget(host(MyindAttribution(onOpen: (_) async => true), theme: dark));
      final text = tester.widget<Text>(find.text('Built with Myind referral kit'));
      expect(text.style?.color, dark.colorScheme.onSurfaceVariant.withValues(alpha: 0.8));
      expect(text.style?.fontSize, 11);
      expect(tester.takeException(), isNull);
    });
  });

  group('screens', () {
    Widget friends(FakeRpc rpc, _Launcher launcher, {bool show = true, int variant = 0}) => InviteFriendsScreen(
      client: clientFor(rpc),
      appName: 'App',
      share: (_, _) async {},
      launcher: launcher,
      showAttribution: show,
      attributionVariant: variant,
    );

    Widget hub(FakeRpc rpc, _Launcher launcher, {bool show = true, int variant = 0}) {
      final client = clientFor(rpc);
      return InviteHub(
        client: client,
        queue: PendingClaimQueue(client: client, store: MemoryKeyValueStore()),
        appName: 'App',
        share: (_, _) async {},
        launcher: launcher,
        pastePlatform: TargetPlatform.android,
        showAttribution: show,
        attributionVariant: variant,
      );
    }

    Future<void> scrollToLink(WidgetTester tester) =>
        tester.scrollUntilVisible(find.byKey(_link), 200, scrollable: find.byType(Scrollable).first);

    testWidgets('InviteFriendsScreen shows it by default; a tap opens the site through its launcher', (tester) async {
      final launcher = _Launcher();
      await tester.pumpWidget(harness(friends(FakeRpc(), launcher)));
      await tester.pumpAndSettle();
      await scrollToLink(tester);
      expect(find.text('Built with Myind referral kit'), findsOneWidget);
      await tester.tap(find.byKey(_link));
      expect(launcher.launched.single.host, 'www.myind.ai');
      expect(launcher.launched.single.queryParameters['utm_medium'], 'attribution');
    });

    testWidgets('InviteFriendsScreen: showAttribution false hides it', (tester) async {
      await tester.pumpWidget(harness(friends(FakeRpc(), _Launcher(), show: false)));
      await tester.pumpAndSettle();
      expect(find.text('Share'), findsOneWidget);
      expect(find.byKey(_link, skipOffstage: false), findsNothing);
    });

    testWidgets('InviteHub shows it once (not again for the embedded invite part)', (tester) async {
      await tester.pumpWidget(harness(hub(FakeRpc(), _Launcher(), variant: 2)));
      await tester.pumpAndSettle();
      await scrollToLink(tester);
      expect(find.byKey(_link, skipOffstage: false), findsOneWidget);
      expect(find.text('Free referral kit by Myind'), findsOneWidget);
    });

    testWidgets('InviteHub: showAttribution false hides it', (tester) async {
      await tester.pumpWidget(harness(hub(FakeRpc(), _Launcher(), show: false)));
      await tester.pumpAndSettle();
      expect(find.text('Share'), findsOneWidget);
      expect(find.byKey(_link, skipOffstage: false), findsNothing);
    });

    testWidgets('InviteHub in dark mode renders the link without errors', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(brightness: Brightness.dark),
          localizationsDelegates: const [referralKitLocalizationsDelegate],
          home: hub(FakeRpc(), _Launcher()),
        ),
      );
      await tester.pumpAndSettle();
      await scrollToLink(tester);
      expect(find.text('Built with Myind referral kit'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
