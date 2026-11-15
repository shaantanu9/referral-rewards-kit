// What the check needs, read from --dart-define (public values only), and the checklist the screen shows.

class CheckItem {
  const CheckItem(this.label, this.ok, [this.hint]);
  final String label;
  final bool ok;
  final String? hint;
}

class CheckConfig {
  const CheckConfig({this.supabaseUrl = '', this.supabaseAnonKey = '', this.rcApiKey = '', this.adUnitId = ''});

  const CheckConfig.fromEnvironment()
    : supabaseUrl = const String.fromEnvironment('SUPABASE_URL'),
      supabaseAnonKey = const String.fromEnvironment('SUPABASE_ANON_KEY'),
      rcApiKey = const String.fromEnvironment('RC_API_KEY'),
      adUnitId = const String.fromEnvironment('AD_UNIT_ID');

  final String supabaseUrl, supabaseAnonKey, rcApiKey, adUnitId;

  bool get hasSupabase => supabaseUrl.startsWith('https://') && supabaseAnonKey.isNotEmpty;
  bool get hasRevenueCat => rcApiKey.isNotEmpty;
  bool get hasAdUnit => adUnitId.isNotEmpty;

  /// Google's sample ad units load and show but never verify server-side.
  bool get isTestAdUnit => adUnitId.startsWith('ca-app-pub-3940256099942544/');

  /// A secret RevenueCat key (sk_…) must never be in an app.
  bool get rcKeyLooksSecret => rcApiKey.startsWith('sk_');

  List<CheckItem> checks({required bool signedIn, required String? rcUser, required String? uid}) => [
    CheckItem(
      'Supabase URL and anon key',
      hasSupabase,
      hasSupabase ? null : 'pass --dart-define=SUPABASE_URL / SUPABASE_ANON_KEY',
    ),
    CheckItem(
      'RevenueCat public SDK key',
      hasRevenueCat && !rcKeyLooksSecret,
      rcKeyLooksSecret
          ? 'that is a SECRET key (sk_): use the public appl_/goog_ key'
          : (hasRevenueCat ? null : 'pass RC_API_KEY'),
    ),
    CheckItem(
      'Rewarded ad unit',
      hasAdUnit && !isTestAdUnit,
      isTestAdUnit
          ? "Google's test unit shows ads but RevenueCat cannot verify them: use a real unit with SSV to RevenueCat"
          : (hasAdUnit ? null : 'pass AD_UNIT_ID'),
    ),
    CheckItem('Signed in', signedIn),
    CheckItem(
      'RevenueCat user is the Supabase user',
      uid != null && rcUser == uid,
      uid == null
          ? null
          : (rcUser == uid ? null : 'RevenueCat user is $rcUser; the engine ignores ads it cannot tie to a user'),
    ),
    const CheckItem(
      'Ads switched on in the engine',
      false,
      "rewards_admin_save_settings({\"ads_enabled\": true}) or the admin page's Settings; then watch the log for ad_watched",
    ),
  ];
}
