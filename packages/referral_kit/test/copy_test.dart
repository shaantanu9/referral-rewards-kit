import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

import 'support/fake_rpc.dart';

final en = lookupReferralKitLocalizations(const Locale('en'));

ReferralCopy copyWith({bool friend = true, bool sharer = true, bool paid = true, bool paidEnabled = true}) =>
    ReferralCopy(
      l10n: en,
      terms: ReferralTerms.fromJson(
        termsJson(friendRule: friend, sharerJoinedRule: sharer, paidRule: paid, paidEnabled: paidEnabled),
      ),
      labels: RewardLabels(
        byKind: {'minutes': (n) => '${n.round()} min of natural voice'},
        entitlementNames: const {'premium': 'Premium'},
      ),
    );

void main() {
  group('both rules on (ADR 11.1 defaults)', () {
    final c = copyWith();
    test('rules and caps', () {
      expect(c.rules(), [
        'You and your friend each get 30 min of natural voice when they sign up and start using the app.',
        'You get 5 days of Premium when a friend you invited subscribes (after any free trial).',
      ]);
      expect(c.caps(), ['Up to 10 friends a month count.', 'Up to 6 subscribing friends a year count.']);
    });
    test('paywall line carries its condition', () {
      expect(c.paywallLine(), 'Or get 5 days of Premium free when a friend you invite subscribes.');
    });
    test('friend disclosure names both events', () {
      expect(c.friendDisclosure(), startsWith('Your inviter gets a reward when you start using the app, and another'));
    });
    test('share text wraps the code in an isolate', () {
      expect(
        c.shareText(appName: 'App', code: 'ABCDEFGH', link: 'https://x.test/i/ABCDEFGH'),
        "Here's 30 min of natural voice in App, on me: join with my code \u2066ABCD-EFGH\u2069 and we both get it "
        'once you start using the app. https://x.test/i/ABCDEFGH',
      );
    });
    test('empty state', () {
      expect(c.emptyState(), startsWith('No invites yet. Share your code: you each get 30 min of natural voice'));
    });
    test('reward cards', () {
      final p = pendingJson().map(RewardItem.fromJson).toList();
      expect(c.rewardCard(p[0]), 'Welcome bonus: 30 min of natural voice, thanks to your invite.');
      expect(c.rewardCard(p[1]), '5 days of Premium, added when your current plan ends.');
      expect(
        c.rewardCard(const RewardItem(id: 'x', who: 'sharer', event: 'paid', kind: 'entitlement_days', amount: 5)),
        'A friend you invited subscribed. You got 5 days of Premium.',
      );
    });
    test('pending line has a date', () {
      final r = RewardItem(id: 'p', kind: 'minutes', amount: 30, availableAt: DateTime.utc(2026, 11, 15, 12));
      expect(c.pendingLine(r), '30 min of natural voice, around Nov 15, 2026');
    });
  });

  group('friend rule off (D-R1 = no): sharer-only variants', () {
    final c = copyWith(friend: false);
    test('rules', () {
      expect(
        c.rules().first,
        'You get 30 min of natural voice when a friend you invited signs up and starts using the app.',
      );
    });
    test('share text says "I get a bonus"', () {
      expect(c.shareText(appName: 'App', code: 'ABCDEFGH', link: 'L'), contains('and I get a bonus: L'));
      expect(c.shareText(appName: 'App', code: 'ABCDEFGH', link: 'L'), isNot(contains('we both')));
    });
    test('empty state', () => expect(c.emptyState(), contains('you get 30 min of natural voice')));
    test('disclosure still names both sharer events', () => expect(c.friendDisclosure(), en.friendDisclosureBoth));
  });

  group('paid rule off', () {
    for (final (name, c) in [
      ('no paid rule', copyWith(paid: false)),
      ('paid_enabled false', copyWith(paidEnabled: false)),
    ]) {
      test(name, () {
        expect(c.rules(), hasLength(1));
        expect(c.caps(), ['Up to 10 friends a month count.']);
        expect(c.paywallLine(), isNull);
        expect(c.friendDisclosure(), en.friendDisclosureJoined);
      });
    }
  });

  test('only the paid rule: disclosure names only subscribing', () {
    final c = copyWith(friend: false, sharer: false);
    expect(c.friendDisclosure(), en.friendDisclosurePaid);
    expect(c.shareText(appName: 'A', code: 'ABCDEFGH', link: 'L'), contains('I get a bonus'));
    expect(c.emptyState(), en.emptyPlain);
  });

  test('no rules: no disclosure, plain share text', () {
    final c = copyWith(friend: false, sharer: false, paid: false);
    expect(c.friendDisclosure(), isNull);
    expect(c.rules(), isEmpty);
    expect(
      c.shareText(appName: 'A', code: 'ABCDEFGH', link: 'L'),
      "I'm using A. Join with my code \u2066ABCD-EFGH\u2069: L",
    );
  });

  test('different joined rewards are named separately', () {
    final t = ReferralTerms.fromJson({
      ...termsJson(paidRule: false),
      'rules': [
        {'event': 'joined', 'who': 'friend', 'kind': 'minutes', 'amount': 15, 'params': {}},
        {'event': 'joined', 'who': 'sharer', 'kind': 'coins', 'amount': 100, 'params': {}},
      ],
    });
    final c = ReferralCopy(l10n: en, terms: t);
    expect(
      c.rules().single,
      'You get 100 coins and your friend gets 15 min when they sign up and start using the app.',
    );
    expect(
      c.shareText(appName: 'A', code: 'ABCDEFGH', link: 'L'),
      startsWith("Here's 15 min in A, on me: join with my code"),
    );
    expect(c.shareText(appName: 'A', code: 'ABCDEFGH', link: 'L'), contains('(I get a bonus too)'));
  });

  test('default labels without app labels', () {
    final c = ReferralCopy(l10n: en, terms: ReferralTerms.none);
    expect(c.reward('minutes', 1), '1 min');
    expect(c.reward('entitlement_days', 1, {'entitlement_id': 'pro'}), '1 day of pro');
    expect(c.reward('entitlement_days', 5), '5 days of Premium');
  });

  group('claim messages per reason (ADR 11.2)', () {
    final c = copyWith();
    final expected = {
      ClaimReason.ownCode: "That's your own code. Share it with a friend instead.",
      ClaimReason.alreadyReferred: "You've already used an invite code.",
      ClaimReason.unknownCode:
          "We couldn't find that code. Codes have 8 letters or numbers and never contain O, 0, I, 1 or L.",
      ClaimReason.windowClosed: 'Invite codes can be added in your first 7 days.',
      ClaimReason.notVerified: "Confirm your email and we'll add your code then.",
      ClaimReason.sameInstall: "This code can't be used on this device.",
      ClaimReason.programPaused: 'Invites are paused right now.',
      ClaimReason.underAge: "Invites aren't available for this account.",
      ClaimReason.anonymousUser: "Invites aren't available for this account.",
      ClaimReason.unknown: "We couldn't add that code right now. Try again later.",
    };
    expected.forEach((reason, text) {
      test(reason.name, () => expect(c.claimMessage(ClaimResult(reason: reason)), text));
    });
    test('ok has no error message', () => expect(c.claimMessage(const ClaimResult(reason: ClaimReason.ok)), isNull));
    test('rate_limited rounds retry_after_seconds up to minutes', () {
      String msg(int s) => c.claimMessage(ClaimResult(reason: ClaimReason.rateLimited, retryAfterSeconds: s))!;
      expect(msg(3541), 'Too many tries. Try again in 60 min.');
      expect(msg(61), 'Too many tries. Try again in 2 min.');
      expect(msg(1), 'Too many tries. Try again in 1 min.');
      expect(retryMinutes(null), 1);
    });
    test('every reason has a message in hi and id', () {
      for (final loc in ['hi', 'id']) {
        final l = lookupReferralKitLocalizations(Locale(loc));
        for (final r in ClaimReason.values.where((r) => r != ClaimReason.ok)) {
          final m = claimReasonMessage(l, ClaimResult(reason: r, retryAfterSeconds: 120), claimWindowDays: 7);
          expect(m, isNotEmpty);
          expect(
            m,
            isNot(equals(claimReasonMessage(en, ClaimResult(reason: r, retryAfterSeconds: 120), claimWindowDays: 7))),
          );
        }
      }
    });
  });
}
