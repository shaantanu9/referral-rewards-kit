import 'package:flutter_test/flutter_test.dart';
import 'package:rewards_ads_check/check_config.dart';

void main() {
  test('missing values are listed with what to pass', () {
    final c = const CheckConfig().checks(signedIn: false, rcUser: null, uid: null);
    expect(c.where((x) => !x.ok).length, 6);
    expect(c.first.hint, contains('SUPABASE_URL'));
  });

  test('a secret RevenueCat key and the Google test ad unit are flagged', () {
    const cfg = CheckConfig(
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'anon',
      rcApiKey: 'sk_live_123',
      adUnitId: 'ca-app-pub-3940256099942544/5224354917',
    );
    final c = cfg.checks(signedIn: true, rcUser: 'u1', uid: 'u1');
    expect(c[1].ok, isFalse);
    expect(c[1].hint, contains('SECRET'));
    expect(c[2].ok, isFalse);
    expect(c[2].hint, contains('cannot verify'));
    expect(c[4].ok, isTrue);
  });

  test('RevenueCat user must be the Supabase user', () {
    const cfg = CheckConfig(
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'a',
      rcApiKey: 'appl_x',
      adUnitId: 'ca-app-pub-1/2',
    );
    final c = cfg.checks(signedIn: true, rcUser: r'$RCAnonymousID:abc', uid: 'u1');
    expect(c[4].ok, isFalse);
    expect(c[4].hint, contains('ignores'));
    expect(c.take(3).every((x) => x.ok), isTrue);
  });
}
