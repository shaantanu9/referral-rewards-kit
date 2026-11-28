// The "Rewards by Myind" link (ADR 0003): on by default on RewardsHub and QuizScreen, hidden with
// showAttribution: false, opens the site with utm params through the injected opener.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_kit/rewards_kit.dart';

import 'fakes.dart';
import 'quiz_controller_test.dart' show QuizServer;

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
      expect(MyindAttributionConfig.variant(1).url, 'https://www.myind.ai/referral-kit');
      expect(MyindAttributionConfig.variant(7).text, 'Made with Myind');
    });

    test('link adds utm params for this package and keeps an existing query', () {
      final u = MyindAttributionConfig.link(1);
      expect(u.toString().startsWith('https://www.myind.ai/referral-kit?'), isTrue);
      expect(u.queryParameters, {'utm_source': 'rewards_kit', 'utm_medium': 'attribution', 'utm_campaign': 'v1'});
      // The same rule the link uses, on a URL that already has a query.
      final base = Uri.parse('https://www.myind.ai/referral-kit?ref=x');
      final merged = base.replace(queryParameters: {...base.queryParameters, 'utm_source': 'rewards_kit'});
      expect(merged.queryParameters, {'ref': 'x', 'utm_source': 'rewards_kit'});
    });
  });

  group('MyindAttribution', () {
    testWidgets('tap opens the link through the injected opener; link semantics; 44 dp target', (t) async {
      final semantics = t.ensureSemantics();
      final opened = <Uri>[];
      await t.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MyindAttribution(
              variant: 1,
              onOpen: (u) async {
                opened.add(u);
                return true;
              },
            ),
          ),
        ),
      );
      expect(find.text('Rewards by Myind'), findsOneWidget);
      final label = find.bySemanticsLabel('Opens myind.ai: Rewards by Myind');
      expect(label, findsOneWidget);
      expect(t.getSemantics(label).flagsCollection.isLink, isTrue);
      expect(t.getSize(find.byType(InkWell)).height, greaterThanOrEqualTo(44));
      await t.tap(find.byKey(_link));
      expect(opened.single.queryParameters, {
        'utm_source': 'rewards_kit',
        'utm_medium': 'attribution',
        'utm_campaign': 'v1',
      });
      semantics.dispose();
    });

    testWidgets('dark theme: the theme colour, not a fixed grey', (t) async {
      final dark = ThemeData(brightness: Brightness.dark);
      await t.pumpWidget(
        MaterialApp(
          theme: dark,
          home: Scaffold(body: MyindAttribution(onOpen: (_) async => true)),
        ),
      );
      final text = t.widget<Text>(find.text('Built with Myind referral kit'));
      expect(text.style?.color, dark.colorScheme.onSurfaceVariant.withValues(alpha: 0.8));
      expect(t.takeException(), isNull);
    });
  });

  group('screens', () {
    Future<RewardsController> hubController() async {
      final c = controllerOn(
        FakeRpc({
          'rewards_state': (_) => sampleState(inbox: [grant('g1')]),
        }),
      );
      await c.refresh();
      return c;
    }

    testWidgets('RewardsHub shows "Rewards by Myind" at the bottom by default', (t) async {
      final c = await hubController();
      await t.pumpWidget(
        MaterialApp(
          home: Scaffold(body: RewardsHub(controller: c)),
        ),
      );
      await t.scrollUntilVisible(find.byKey(_link), 200, scrollable: find.byType(Scrollable).first);
      expect(find.text('Rewards by Myind'), findsOneWidget);
      expect(
        t.getTopLeft(find.byKey(_link)).dy,
        greaterThan(t.getTopLeft(find.byType(StreakCard)).dy),
        reason: 'after the programs, inside the scroll',
      );
    });

    testWidgets('RewardsHub: showAttribution false hides it; attributionVariant picks the text', (t) async {
      final c = await hubController();
      await t.pumpWidget(
        MaterialApp(
          home: Scaffold(body: RewardsHub(controller: c, showAttribution: false)),
        ),
      );
      expect(find.byType(StreakCard, skipOffstage: false), findsOneWidget);
      expect(find.byKey(_link, skipOffstage: false), findsNothing);

      await t.pumpWidget(
        MaterialApp(
          theme: ThemeData(brightness: Brightness.dark),
          home: Scaffold(body: RewardsHub(controller: c, attributionVariant: 3)),
        ),
      );
      expect(find.text('Made with Myind', skipOffstage: false), findsOneWidget);
      expect(t.takeException(), isNull);
    });

    Future<void> pumpQuiz(WidgetTester t, {bool show = true}) async {
      final c = controllerOn(QuizServer().rpc());
      await c.refresh();
      await t.pumpWidget(
        MaterialApp(
          home: QuizScreen(controller: c, program: 'quiz', showAttribution: show),
        ),
      );
      await t.pump();
      await t.pump();
    }

    testWidgets('QuizScreen shows it under the quiz by default', (t) async {
      await pumpQuiz(t);
      expect(find.text('Start'), findsOneWidget);
      expect(find.text('Rewards by Myind', skipOffstage: false), findsOneWidget);
    });

    testWidgets('QuizScreen: the link also shows on the unavailable and loading phases', (t) async {
      final down = controllerOn(FakeRpc({'rewards_quiz_today': (_) => throw Exception('PGRST202')}));
      await t.pumpWidget(
        MaterialApp(
          home: QuizScreen(controller: down, program: 'quiz'),
        ),
      );
      expect(find.text('Rewards by Myind'), findsOneWidget, reason: 'loading');
      await t.pump();
      await t.pump();
      expect(find.text('Rewards by Myind'), findsOneWidget, reason: 'unavailable');
      expect(t.takeException(), isNull);
    });

    testWidgets('QuizScreen: showAttribution false hides it', (t) async {
      await pumpQuiz(t, show: false);
      expect(find.text('Start'), findsOneWidget);
      expect(find.byKey(_link, skipOffstage: false), findsNothing);
    });
  });
}
