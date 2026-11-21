import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:referral_kit/referral_kit.dart';

import 'support/fake_rpc.dart';
import 'support/growth_json.dart';

final en = lookupReferralKitLocalizations(const Locale('en'));
const labels = RewardLabels(byKind: {'chapters': _chapters});
String _chapters(num n) => '${n.round()} free chapters';

ReferralCopy copyFor(List<Map<String, Object?>> rules, {Map<String, Object?>? boost, bool paid = false}) =>
    ReferralCopy(
      l10n: en,
      terms: ReferralTerms.fromJson({...termsJson(paidEnabled: paid), 'rules': rules, 'boost': boost}),
      labels: labels,
    );

Map<String, Object?> rule(String who, num amount, {String event = 'joined'}) => {
  'event': event,
  'who': who,
  'kind': 'chapters',
  'amount': amount,
  'params': {},
};

void main() {
  setUpAll(() => initializeDateFormatting());

  group('G1 give-first', () {
    test('share text leads with the friend\'s reward, condition in the same sentence', () {
      final c = copyFor([rule('friend', 4), rule('sharer', 4)]);
      expect(
        c.shareText(appName: 'Reader', code: 'ABCDEFGH', link: 'https://x.test/i/ABCDEFGH'),
        "Here's 4 free chapters in Reader, on me: join with my code \u2066ABCD-EFGH\u2069 and we both get it once "
        'you start using the app. https://x.test/i/ABCDEFGH',
      );
      expect(
        c.inviteHeadline(),
        'Give a friend 4 free chapters, and get the same, when they join with your code and '
        'start using the app',
      );
    });

    test('different rewards: the friend\'s first, the sharer\'s bonus disclosed', () {
      final c = copyFor([rule('friend', 4), rule('sharer', 2)]);
      expect(c.shareText(appName: 'R', code: 'ABCDEFGH', link: 'L'), contains('(I get a bonus too)'));
      expect(c.inviteHeadline(), startsWith('Give a friend 4 free chapters and get 2 free chapters when'));
      expect(c.shareTextNoLink(appName: 'R', code: 'ABCDEFGH', storeLink: 'S'), contains('(I get a bonus too). S'));
    });

    test('friend only: no "we both", no bonus', () {
      final c = copyFor([rule('friend', 4)]);
      final t = c.shareText(appName: 'R', code: 'ABCDEFGH', link: 'L');
      expect(t, startsWith("Here's 4 free chapters in R, on me"));
      expect(t, isNot(contains('bonus')));
      expect(c.inviteHeadline(), 'Give a friend 4 free chapters when they join with your code and start using the app');
    });

    test('sharer only: never claims the friend gets something', () {
      final c = copyFor([rule('sharer', 4)]);
      final t = c.shareText(appName: 'R', code: 'ABCDEFGH', link: 'L');
      expect(t, isNot(contains("Here's")));
      expect(t, contains('and I get a bonus'));
      expect(c.inviteHeadline(), 'Get 4 free chapters when a friend joins with your code and starts using the app');
    });

    test('no rules: no headline', () => expect(copyFor([]).inviteHeadline(), isNull));
  });

  group('G4 waiting line on claimedCount', () {
    test('both, one friend, with the app\'s step', () {
      final c = copyFor([rule('friend', 4), rule('sharer', 4)]);
      expect(
        c.waitingLine(1, appName: 'Reader', activationStep: 'Read your first page'),
        '1 friend used your code. Their next step: Read your first page. When they do it, you both get 4 free '
        'chapters.',
      );
      expect(c.waitingLine(3, appName: 'Reader'), contains('Their next step: Start using Reader.'));
      expect(
        c.waitingLine(3, appName: 'Reader'),
        endsWith('For each friend who does it, you both get 4 free chapters.'),
      );
    });

    test('each side its own, sharer only, friend only, none', () {
      expect(
        copyFor([rule('friend', 4), rule('sharer', 2)]).waitingLine(1, appName: 'R'),
        endsWith('you get 2 free chapters and they get 4 free chapters.'),
      );
      expect(copyFor([rule('sharer', 2)]).waitingLine(1, appName: 'R'), endsWith('you get 2 free chapters.'));
      expect(copyFor([rule('friend', 4)]).waitingLine(1, appName: 'R'), endsWith('they get 4 free chapters.'));
      expect(copyFor([]).waitingLine(1, appName: 'R'), '1 friend used your code. Their next step: Start using R.');
    });

    test('null or zero: no line', () {
      final c = copyFor([rule('friend', 4)]);
      expect(c.waitingLine(0, appName: 'R'), isNull);
      expect(c.waitingLine(null, appName: 'R'), isNull);
    });
  });

  group('G8 boost line', () {
    final now = DateTime.utc(2026, 11, 20, 12);
    test('×2 says "Double" with the weekday and the last day (end is exclusive)', () {
      // Ends at local midnight starting Mon 23 Nov 2026 → the last day is Sun 22 Nov.
      final end = DateTime(2026, 11, 23).toUtc().toIso8601String();
      final c = copyFor([rule('friend', 4), rule('sharer', 4)], boost: boostJson(endsAt: end));
      expect(c.boostLine(now), 'Double rewards until Sun, 22 Nov for every friend who adds your code by then.');
    });

    test('×3 and ×1.5 use the number', () {
      final end = DateTime(2026, 11, 22, 18).toUtc().toIso8601String();
      expect(
        copyFor([], boost: boostJson(endsAt: end, multiplier: 3)).boostLine(now),
        startsWith('3× rewards until Sun, 22 Nov'),
      );
      expect(copyFor([], boost: boostJson(endsAt: end, multiplier: 1.5)).boostLine(now), startsWith('1.5× rewards'));
    });

    test('friend-only boost talks about the welcome gift', () {
      final end = DateTime(2026, 11, 22, 18).toUtc().toIso8601String();
      expect(
        copyFor(
          [],
          boost: boostJson(endsAt: end, who: ['friend']),
        ).boostLine(now),
        'Double welcome gift until Sun, 22 Nov for friends who add your code by then.',
      );
    });

    test('ended or absent: no line', () {
      expect(copyFor([], boost: boostJson(endsAt: '2026-11-20T11:00:00Z')).boostLine(now), isNull);
      expect(copyFor([]).boostLine(now), isNull);
    });

    test('localized date (hi, id)', () {
      final end = DateTime(2026, 11, 22, 18).toUtc().toIso8601String();
      final terms = ReferralTerms.fromJson({...termsJson(), 'boost': boostJson(endsAt: end)});
      final hi = ReferralCopy(l10n: lookupReferralKitLocalizations(const Locale('hi')), terms: terms);
      final id = ReferralCopy(l10n: lookupReferralKitLocalizations(const Locale('id')), terms: terms);
      expect(hi.boostLine(now), contains('22'));
      expect(hi.boostLine(now), isNot(contains('Sun')));
      expect(id.boostLine(now), contains('Min, 22 Nov'));
    });
  });

  group('G2/G3 friend lines', () {
    final c = copyFor([rule('friend', 4), rule('sharer', 4)]);
    test('welcome waiting with the boosted reward and days left', () {
      final claim = MyClaim.fromJson({
        ...myClaimClaimed,
        'rewards': [
          {'kind': 'chapters', 'amount': 8, 'base_amount': 4, 'boosted': true},
        ],
      });
      expect(
        c.welcomeWaiting(claim, appName: 'Reader', activationStep: 'Read your first page'),
        'Your welcome gift of 8 free chapters is waiting: Read your first page. 12 days left.',
      );
      expect(
        c.welcomeWaiting(const MyClaim(state: MyClaimState.claimed, daysLeft: 1), appName: 'Reader'),
        'Your welcome gift is waiting: Start using Reader. Last day.',
      );
    });

    test('pass it on', () {
      expect(
        c.passItOn(appName: 'Reader'),
        'Pass it on: give a friend 4 free chapters when they join with your code and start using the app.',
      );
      expect(copyFor([rule('sharer', 4)]).passItOn(appName: 'Reader'), 'Pass it on: invite a friend to Reader.');
    });

    test('name errors', () {
      expect(c.displayNameError(displayNameProblem('')), 'Enter your first name.');
      expect(c.displayNameError(displayNameProblem('a@b')), "A name can't contain @ or a link.");
      expect(c.displayNameError(null), isNull);
    });
  });
}
