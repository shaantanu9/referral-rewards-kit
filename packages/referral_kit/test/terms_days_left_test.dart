import 'package:flutter_test/flutter_test.dart';
import 'package:referral_kit/referral_kit.dart';

void main() {
  test('referral_terms carries the server count of days left to add a code', () {
    final t = ReferralTerms.fromJson({'enabled': true, 'paid_enabled': true, 'rules': [], 'claim_days_left': 2});
    expect(t.claimDaysLeft, 2);
  });
  test('older servers without claim_days_left give null (the widget falls back to eligibleFrom)', () {
    final t = ReferralTerms.fromJson({'enabled': true, 'paid_enabled': true, 'rules': []});
    expect(t.claimDaysLeft, isNull);
  });
}
