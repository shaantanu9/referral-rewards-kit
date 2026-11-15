/// Offer and social-tag task states (ADR 0002 §6.3, §6.4, §11).
library;

import 'json.dart';
import 'models.dart';

/// Offer states. [unknown] covers a state a newer server adds; it is never thrown on.
enum OfferStatus {
  notStarted('not_started'),
  active('active'),
  claimed('claimed'),
  expired('expired'),
  soldOut('sold_out'),
  unknown('unknown');

  const OfferStatus(this.wire);
  final String wire;

  static OfferStatus fromWire(Object? v) =>
      values.firstWhere((s) => s.wire == v && s != unknown, orElse: () => unknown);
}

/// A timed offer for this user. [endsAt] is a server deadline that never resets.
class OfferState {
  const OfferState({
    required this.program,
    this.status = OfferStatus.unknown,
    this.startedAt,
    this.endsAt,
    this.stockLeft,
    this.rewards = const [],
  });

  factory OfferState.fromJson(Map<String, Object?> m) => OfferState(
    program: str(m['program']),
    status: OfferStatus.fromWire(m['state']),
    startedAt: time(m['started_at']),
    endsAt: time(m['ends_at']),
    stockLeft: optInt(m['stock_left']),
    rewards: listOf(m['rewards'], RewardSpec.fromJson),
  );

  final String program;
  final OfferStatus status;
  final DateTime? startedAt;
  final DateTime? endsAt;

  /// The real number left, only when the app chose to show stock (`config.show_stock`); null otherwise.
  final int? stockLeft;
  final List<RewardSpec> rewards;

  OfferState copyWith({OfferStatus? status, int? stockLeft}) => OfferState(
    program: program,
    status: status ?? this.status,
    startedAt: startedAt,
    endsAt: endsAt,
    stockLeft: stockLeft ?? this.stockLeft,
    rewards: rewards,
  );
}

/// Social tag task states. [unknown] covers a state a newer server adds.
enum SocialTaskStatus {
  none('none'),
  pending('pending'),
  verified('verified'),
  rejected('rejected'),
  expired('expired'),
  cooldown('cooldown'),
  unknown('unknown');

  const SocialTaskStatus(this.wire);
  final String wire;

  static SocialTaskStatus fromWire(Object? v) =>
      values.firstWhere((s) => s.wire == v && s != unknown, orElse: () => unknown);
}

/// The "tag us on Instagram" task. [expiresAt] is when a pending code stops counting, or for [SocialTaskStatus
/// .cooldown] when a new one is allowed. Never carries the user's handle.
class SocialTaskState {
  const SocialTaskState({
    required this.program,
    this.platform = 'instagram',
    this.account = '',
    this.status = SocialTaskStatus.none,
    this.code,
    this.expiresAt,
    this.rewards = const [],
    this.postUrl,
  });

  factory SocialTaskState.fromJson(Map<String, Object?> m) => SocialTaskState(
    program: str(m['program']),
    platform: m['platform'] == null ? 'instagram' : str(m['platform']),
    account: str(m['account']),
    status: SocialTaskStatus.fromWire(m['state'] ?? 'none'),
    code: optStr(m['code']),
    expiresAt: time(m['expires_at']),
    rewards: listOf(m['rewards'], RewardSpec.fromJson),
    postUrl: optStr(m['post_url']),
  );

  final String program;
  final String platform;

  /// The app's account to tag, without `@`.
  final String account;
  final SocialTaskStatus status;
  final String? code;
  final DateTime? expiresAt;
  final List<RewardSpec> rewards;

  /// The link the user sent for their post (`rewards_social_submit_link`), or null.
  final String? postUrl;

  SocialTaskState copyWith({
    SocialTaskStatus? status,
    String? code,
    DateTime? expiresAt,
    String? account,
    String? postUrl,
  }) => SocialTaskState(
    program: program,
    platform: platform,
    account: account ?? this.account,
    status: status ?? this.status,
    code: code ?? this.code,
    expiresAt: expiresAt ?? this.expiresAt,
    rewards: rewards,
    postUrl: postUrl ?? this.postUrl,
  );
}

/// What `rewards_social_start` returns: `{"code": "MYAPP-K7Q2", "account": "myapp", "expires_at": ts}`.
class SocialStartResult {
  const SocialStartResult({required this.code, this.account = '', this.expiresAt});

  factory SocialStartResult.fromJson(Map<String, Object?> m) =>
      SocialStartResult(code: str(m['code']), account: str(m['account']), expiresAt: time(m['expires_at']));

  final String code;
  final String account;
  final DateTime? expiresAt;
}
