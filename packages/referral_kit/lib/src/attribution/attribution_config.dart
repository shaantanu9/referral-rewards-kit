/// Links and words for the small "Built with Myind" link (ADR 0003). The same values live in rewards_kit and in the
/// React / React Native ports, so a change here goes there too.
///
/// Nothing is forced: the link shows by default on the top-level screens and `showAttribution: false` hides it.
class MyindAttributionConfig {
  const MyindAttributionConfig._();

  /// This package's name, sent as `utm_source`.
  static const String defaultSource = 'referral_kit';

  static const String siteUrl = 'https://www.myind.ai';
  static const String homeUrl = 'https://www.myind.ai/referral-kit';
  static const String showcaseUrl = 'https://www.myind.ai/referral-kit/showcase';
  static const String proUrl = 'https://www.myind.ai/referral-kit/pro';
  static const String badgeUrl = 'https://www.myind.ai/referral-kit/badge.svg';
  static const String githubUrl = 'https://github.com/shaantanu9/referral-rewards-kit';
  static const String pubDevReferralKitUrl = 'https://pub.dev/packages/referral_kit';
  static const String pubDevRewardsKitUrl = 'https://pub.dev/packages/rewards_kit';

  /// The link texts, by index. Different words on different apps (ADR 0003, step 1).
  static const List<({String text, String url})> variants = [
    (text: 'Built with Myind referral kit', url: homeUrl),
    (text: 'Rewards by Myind', url: homeUrl),
    (text: 'Free referral kit by Myind', url: showcaseUrl),
    (text: 'Made with Myind', url: siteUrl),
  ];

  /// The variant at [index]; any int works (it wraps).
  static ({String text, String url}) variant(int index) => variants[index % variants.length];

  /// The variant's URL with `utm_source=<source>&utm_medium=attribution&utm_campaign=v<n>` added (an existing query
  /// is kept).
  static Uri link(int index, {String source = defaultSource}) {
    final n = index % variants.length;
    final base = Uri.parse(variants[n].url);
    return base.replace(
      queryParameters: {
        ...base.queryParameters,
        'utm_source': source,
        'utm_medium': 'attribution',
        'utm_campaign': 'v$n',
      },
    );
  }
}
