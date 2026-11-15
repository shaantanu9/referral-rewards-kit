/// Typed results of the `public.referral_*` RPCs. Field names follow the JSON built in
/// `supabase/migrations/20261112000002_referral_codes_claim.sql` and `20261112000003_referral_joined.sql`.
library;

/// Raised when an RPC returns something that does not have the documented shape.
class ReferralFormatException implements Exception {
  ReferralFormatException(this.message);
  final String message;
  @override
  String toString() => 'ReferralFormatException: $message';
}

Map<String, Object?> asMap(Object? v, String what) {
  if (v is Map) return v.map((k, value) => MapEntry(k.toString(), value));
  throw ReferralFormatException('$what: expected an object, got ${v.runtimeType}');
}

List<Object?> asList(Object? v, String what) {
  if (v == null) return const [];
  if (v is List) return v;
  throw ReferralFormatException('$what: expected a list, got ${v.runtimeType}');
}

int? _int(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
num _num(Object? v) => v is num ? v : (v is String ? num.tryParse(v) ?? 0 : 0);
DateTime? _time(Object? v) => v is String ? DateTime.tryParse(v) : null;
String _str(Object? v) => v?.toString() ?? '';

/// Claim reasons (ADR 7). [unknown] covers any reason a newer server adds.
enum ClaimReason {
  ok,
  ownCode,
  alreadyReferred,
  unknownCode,
  windowClosed,
  rateLimited,
  notVerified,
  anonymousUser,
  sameInstall,
  programPaused,
  underAge,
  unknown;

  static const Map<String, ClaimReason> _wire = {
    'ok': ok,
    'own_code': ownCode,
    'already_referred': alreadyReferred,
    'unknown_code': unknownCode,
    'window_closed': windowClosed,
    'rate_limited': rateLimited,
    'not_verified': notVerified,
    'anonymous_user': anonymousUser,
    'same_install': sameInstall,
    'program_paused': programPaused,
    'under_age': underAge,
  };

  static ClaimReason fromWire(Object? v) => _wire[v] ?? unknown;
}

/// `referral_claim` → `{reason, retry_after_seconds?, days_left?}`.
class ClaimResult {
  const ClaimResult({required this.reason, this.rawReason, this.retryAfterSeconds, this.daysLeft});

  factory ClaimResult.fromJson(Object? json) {
    final m = asMap(json, 'referral_claim');
    return ClaimResult(
      reason: ClaimReason.fromWire(m['reason']),
      rawReason: m['reason']?.toString(),
      retryAfterSeconds: _int(m['retry_after_seconds']),
      daysLeft: _int(m['days_left']),
    );
  }

  final ClaimReason reason;

  /// The reason string as sent, kept for logging when [reason] is [ClaimReason.unknown].
  final String? rawReason;

  /// Only with [ClaimReason.rateLimited].
  final int? retryAfterSeconds;

  /// Only with [ClaimReason.ok]: days left to start using the app for the joined rewards.
  final int? daysLeft;

  bool get isOk => reason == ClaimReason.ok;
}

/// `referral_my_code` / `referral_rotate_code` → `{code, reason, next_allowed_at?}`.
/// Reasons: `ok`, `program_paused`, `anonymous_user`, `account_deleted`, `code_disabled`, and for rotation `too_soon`.
class MyCodeResult {
  const MyCodeResult({required this.code, required this.reason, this.nextAllowedAt});

  factory MyCodeResult.fromJson(Object? json, [String what = 'referral_my_code']) {
    final m = asMap(json, what);
    final code = m['code'];
    return MyCodeResult(
      code: code is String && code.isNotEmpty ? code : null,
      reason: _str(m['reason']),
      nextAllowedAt: _time(m['next_allowed_at']),
    );
  }

  final String? code;
  final String reason;
  final DateTime? nextAllowedAt;

  bool get hasCode => code != null;
}

/// One active rule from `referral_terms().rules`.
class ReferralRule {
  const ReferralRule({
    required this.event,
    required this.who,
    required this.kind,
    required this.amount,
    this.params = const {},
  });

  factory ReferralRule.fromJson(Object? json) {
    final m = asMap(json, 'rule');
    return ReferralRule(
      event: _str(m['event']),
      who: _str(m['who']),
      kind: _str(m['kind']),
      amount: _num(m['amount']),
      params: m['params'] == null ? const {} : asMap(m['params'], 'rule.params'),
    );
  }

  /// `joined` or `paid`.
  final String event;

  /// `sharer` or `friend`.
  final String who;

  /// `entitlement_days` or an app kind such as `minutes`.
  final String kind;
  final num amount;
  final Map<String, Object?> params;
}

/// `referral_terms` → rules, caps and windows (ADR 11.1).
class ReferralTerms {
  const ReferralTerms({
    required this.enabled,
    required this.paidEnabled,
    required this.rules,
    required this.claimWindowDays,
    required this.activateWindowDays,
    required this.paidWindowDays,
    required this.holdHours,
    required this.sharerJoinsPer30d,
    required this.sharerPaidPer365d,
    this.ruleSetVersion,
    this.claimDaysLeft,
    this.hasClaimDaysLeft = false,
  });

  factory ReferralTerms.fromJson(Object? json) {
    final m = asMap(json, 'referral_terms');
    return ReferralTerms(
      enabled: m['enabled'] == true,
      paidEnabled: m['paid_enabled'] == true,
      ruleSetVersion: _int(m['rule_set_version']),
      rules: asList(m['rules'], 'referral_terms.rules').map(ReferralRule.fromJson).toList(growable: false),
      claimWindowDays: _int(m['claim_window_days']) ?? 7,
      activateWindowDays: _int(m['activate_window_days']) ?? 30,
      paidWindowDays: _int(m['paid_window_days']) ?? 90,
      holdHours: _int(m['hold_hours']) ?? 72,
      sharerJoinsPer30d: _int(m['sharer_joins_per_30d']) ?? 0,
      sharerPaidPer365d: _int(m['sharer_paid_per_365d']) ?? 0,
      claimDaysLeft: _int(m['claim_days_left']),
      hasClaimDaysLeft: m.containsKey('claim_days_left'),
    );
  }

  /// No rules: used when terms could not be loaded (e.g. offline), so no sentence promises a reward.
  static const none = ReferralTerms(
    enabled: true,
    paidEnabled: false,
    rules: [],
    claimWindowDays: 7,
    activateWindowDays: 30,
    paidWindowDays: 90,
    holdHours: 72,
    sharerJoinsPer30d: 0,
    sharerPaidPer365d: 0,
  );

  final bool enabled;
  final bool paidEnabled;
  final int? ruleSetVersion;
  final List<ReferralRule> rules;
  final int claimWindowDays;
  final int activateWindowDays;
  final int paidWindowDays;
  final int holdHours;
  final int sharerJoinsPer30d;
  final int sharerPaidPer365d;

  /// Days the caller still has to add a code, from the server (`claim_days_left`); null when they cannot add one
  /// (not verified yet, or already referred) or when an older server does not send it.
  final int? claimDaysLeft;

  /// True when the server sent `claim_days_left` at all (migration 9 and later), so a null [claimDaysLeft] means
  /// "this account cannot add a code" rather than "an older server did not say".
  final bool hasClaimDaysLeft;

  /// The rule for [event] and [who], or null. Paid rules count only while `paid_enabled` is on.
  ReferralRule? rule(String event, String who) {
    if (event == 'paid' && !paidEnabled) return null;
    for (final r in rules) {
      if (r.event == event && r.who == who) return r;
    }
    return null;
  }
}

/// `referral_check_activation` → `{state}`: `no_referral`, `claimed`, `joined`, `expired`, or a later state.
class ActivationResult {
  const ActivationResult(this.state);
  factory ActivationResult.fromJson(Object? json) =>
      ActivationResult(_str(asMap(json, 'referral_check_activation')['state']));
  final String state;
  bool get joined => state == 'joined' || state == 'paid';
}

/// One reward as `referral_stats` and `referral_pending` list it. Fields missing from a list are null or defaults.
class RewardItem {
  const RewardItem({
    required this.id,
    required this.kind,
    required this.amount,
    this.who,
    this.event,
    this.state,
    this.at,
    this.availableAt,
    this.params = const {},
  });

  factory RewardItem.fromJson(Object? json) {
    final m = asMap(json, 'reward');
    return RewardItem(
      id: _str(m['id']),
      who: m['who']?.toString(),
      event: m['event']?.toString(),
      kind: _str(m['kind']),
      amount: _num(m['amount']),
      state: m['state']?.toString(),
      at: _time(m['at']),
      availableAt: _time(m['available_at']),
      params: m['params'] == null ? const {} : asMap(m['params'], 'reward.params'),
    );
  }

  final String id;
  final String? who;
  final String? event;
  final String kind;
  final num amount;

  /// `granted` or `banked` in `referral_pending`.
  final String? state;

  /// When it was granted (`rewards_granted[].at`).
  final DateTime? at;

  /// Approximate date a pending reward lands (`pending[].available_at`).
  final DateTime? availableAt;
  final Map<String, Object?> params;
}

/// `referral_stats`. Counts are null below the server's `stats_floor`.
class ReferralStats {
  const ReferralStats({
    required this.rewardsGranted,
    required this.pending,
    required this.banked,
    required this.skippedCap,
    this.joinedCount,
    this.paidCount,
  });

  factory ReferralStats.fromJson(Object? json) {
    final m = asMap(json, 'referral_stats');
    List<RewardItem> list(String k) =>
        asList(m[k], 'referral_stats.$k').map(RewardItem.fromJson).toList(growable: false);
    return ReferralStats(
      rewardsGranted: list('rewards_granted'),
      pending: list('pending'),
      banked: list('banked'),
      skippedCap: _int(m['skipped_cap']) ?? 0,
      joinedCount: _int(m['joined_count']),
      paidCount: _int(m['paid_count']),
    );
  }

  static const empty = ReferralStats(rewardsGranted: [], pending: [], banked: [], skippedCap: 0);

  final List<RewardItem> rewardsGranted;
  final List<RewardItem> pending;
  final List<RewardItem> banked;
  final int skippedCap;
  final int? joinedCount;
  final int? paidCount;

  bool get isEmpty => rewardsGranted.isEmpty && pending.isEmpty && banked.isEmpty && skippedCap == 0;
}
