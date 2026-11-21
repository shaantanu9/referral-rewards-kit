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

/// `referral_my_code` / `referral_rotate_code` → `{code, reason, next_allowed_at?}`, or `{left: true}` (migration 23)
/// when the user left the invite program.
/// Reasons: `ok`, `program_paused`, `anonymous_user`, `under_age`, `account_deleted`, `code_disabled`, `left`, and for
/// rotation `too_soon`.
class MyCodeResult {
  const MyCodeResult({required this.code, required this.reason, this.nextAllowedAt, this.left = false});

  factory MyCodeResult.fromJson(Object? json, [String what = 'referral_my_code']) {
    final m = asMap(json, what);
    final code = m['code'];
    final left = m['left'] == true || m['reason'] == 'left';
    return MyCodeResult(
      code: !left && code is String && code.isNotEmpty ? code : null,
      reason: _str(m['reason']),
      nextAllowedAt: _time(m['next_allowed_at']),
      left: left,
    );
  }

  final String? code;
  final String reason;
  final DateTime? nextAllowedAt;

  /// True when the user left the invite program (`referral_preferences_set` with `participating: false`): there is
  /// no code to share until they join again, which keeps the same code.
  final bool left;

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
    this.boost,
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
      boost: ReferralBoost.tryParse(m['boost']),
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

  /// The boost running now (migration 23), or null: none, an older server, or a malformed one. A future boost is
  /// never sent, so there is no countdown to a start.
  final ReferralBoost? boost;

  /// [boost] when it is still running at [now] (its end is in the future), else null.
  ReferralBoost? boostAt(DateTime now) {
    final b = boost;
    return b != null && b.isRunningAt(now) ? b : null;
  }

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

/// `referral_stats`.
///
/// [claimedCount] and [joinedCount] come from server migration 18 and are null from an older server. [paidCount] is
/// null below the server's `stats_floor` (it would reveal one friend's purchase). An older server also sends
/// [joinedCount] only from `stats_floor` joined friends.
class ReferralStats {
  const ReferralStats({
    required this.rewardsGranted,
    required this.pending,
    required this.banked,
    required this.skippedCap,
    this.claimedCount,
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
      claimedCount: _int(m['claimed_count']),
      joinedCount: _int(m['joined_count']),
      paidCount: _int(m['paid_count']),
    );
  }

  static const empty = ReferralStats(rewardsGranted: [], pending: [], banked: [], skippedCap: 0);

  final List<RewardItem> rewardsGranted;
  final List<RewardItem> pending;
  final List<RewardItem> banked;
  final int skippedCap;

  /// Friends who used the code and have not started using the app yet (still inside the activation window).
  final int? claimedCount;

  /// Friends who started using the app with the code.
  final int? joinedCount;

  /// Joined friends who bought; null below `stats_floor`.
  final int? paidCount;

  /// True when there is nothing to show yet: no friend used the code and no reward exists.
  bool get isEmpty =>
      rewardsGranted.isEmpty &&
      pending.isEmpty &&
      banked.isEmpty &&
      skippedCap == 0 &&
      (claimedCount ?? 0) == 0 &&
      (joinedCount ?? 0) == 0;
}

/// `referral_terms().boost`: a reward boost with a real, server-stored end that can never be extended once started
/// (ADR growth G8). Rewards for friends who claim inside `[startsAt, endsAt)` are multiplied.
class ReferralBoost {
  const ReferralBoost({
    required this.endsAt,
    required this.multiplier,
    this.startsAt,
    this.events = const ['joined'],
    this.who = const ['sharer', 'friend'],
  });

  /// Null for anything that is not a boost object with an end and a multiplier above 1.
  static ReferralBoost? tryParse(Object? json) {
    if (json is! Map) return null;
    final m = asMap(json, 'referral_terms.boost');
    final end = _time(m['ends_at']);
    final mult = _num(m['multiplier']);
    if (end == null || mult <= 1) return null;
    List<String> strings(Object? v, List<String> fallback) =>
        v is List ? v.map((e) => e.toString()).toList(growable: false) : fallback;
    return ReferralBoost(
      startsAt: _time(m['starts_at']),
      endsAt: end,
      multiplier: mult,
      events: strings(m['events'], const ['joined']),
      who: strings(m['who'], const ['sharer', 'friend']),
    );
  }

  final DateTime? startsAt;

  /// Exclusive: the boost covers claims made before this instant.
  final DateTime endsAt;

  /// Above 1 and at most 5 on the server, e.g. 2.
  final num multiplier;

  /// `joined` and/or `paid`.
  final List<String> events;

  /// `sharer` and/or `friend`.
  final List<String> who;

  bool get forSharer => who.contains('sharer');
  bool get forFriend => who.contains('friend');

  /// True from [startsAt] (when given) until just before [endsAt].
  bool isRunningAt(DateTime now) => now.isBefore(endsAt) && (startsAt == null || !now.isBefore(startsAt!));
}

/// `referral_preferences` / `referral_preferences_set` → `{show_name, display_name, participating}`, or
/// `{reason}` when a change was refused (`under_age`, `anonymous_user`, `invalid_name`).
class ReferralPreferences {
  const ReferralPreferences({this.showName = false, this.displayName, this.participating = true, this.reason});

  factory ReferralPreferences.fromJson(Object? json, [String what = 'referral_preferences']) {
    final m = asMap(json, what);
    final name = m['display_name'];
    return ReferralPreferences(
      showName: m['show_name'] == true,
      displayName: name is String && name.trim().isNotEmpty ? name : null,
      participating: m['participating'] != false,
      reason: m['reason'] is String && (m['reason'] as String).isNotEmpty ? m['reason'] as String : null,
    );
  }

  /// The sharer's first name is shown on their invite page (opt-in, default off).
  final bool showName;
  final String? displayName;

  /// False after "Leave the invite program".
  final bool participating;

  /// Why a change was refused, or null when it was saved.
  final String? reason;

  bool get isOk => reason == null;
}

/// A display name the server accepts (migration 23): 1–40 characters after trimming, at least one letter, no `@`
/// and no `://`. Returns null when [name] is fine, else a short reason (`empty`, `too_long`, `no_letter`,
/// `email_or_link`).
String? displayNameProblem(String name) {
  final t = name.trim();
  if (t.isEmpty) return 'empty';
  if (t.runes.length > 40) return 'too_long';
  if (t.contains('@') || t.contains('://')) return 'email_or_link';
  if (!RegExp(r'\p{L}', unicode: true).hasMatch(t)) return 'no_letter';
  return null;
}

/// The friend's own claim state in `referral_my_claim`.
enum MyClaimState {
  /// No code added.
  none,

  /// A code was added; the friend has not started using the app yet.
  claimed,

  /// The friend started using the app (also `paid`, `void` and any later state the server adds).
  joined,

  /// The activation window ended before the friend started.
  expired;

  static MyClaimState fromWire(Object? v) => switch (v) {
    null || '' || 'none' || 'no_referral' => none,
    'claimed' => claimed,
    'expired' => expired,
    _ => joined,
  };
}

/// One reward in `referral_my_claim.rewards`: what the friend gets on starting, with any boost already applied.
class MyClaimReward {
  const MyClaimReward({
    required this.kind,
    required this.amount,
    num? baseAmount,
    this.params = const {},
    this.boosted = false,
  }) : baseAmount = baseAmount ?? amount;

  factory MyClaimReward.fromJson(Object? json) {
    final m = asMap(json, 'referral_my_claim.rewards[]');
    final amount = _num(m['amount']);
    return MyClaimReward(
      kind: _str(m['kind']),
      amount: amount,
      baseAmount: m['base_amount'] == null ? amount : _num(m['base_amount']),
      params: m['params'] is Map ? asMap(m['params'], 'reward.params') : const {},
      boosted: m['boosted'] == true,
    );
  }

  final String kind;

  /// What the friend gets (after the boost).
  final num amount;

  /// Before the boost; equals [amount] when not boosted.
  final num baseAmount;
  final Map<String, Object?> params;
  final bool boosted;
}

/// `referral_my_claim`: the caller's own claim as a friend (migration 23).
class MyClaim {
  const MyClaim({
    required this.state,
    this.claimedAt,
    this.activateBy,
    this.daysLeft,
    this.joinedAt,
    this.rewards = const [],
  });

  factory MyClaim.fromJson(Object? json) {
    final m = asMap(json, 'referral_my_claim');
    return MyClaim(
      state: MyClaimState.fromWire(m['state']),
      claimedAt: _time(m['claimed_at']),
      activateBy: _time(m['activate_by']),
      daysLeft: _int(m['days_left']),
      joinedAt: _time(m['joined_at']),
      rewards: asList(m['rewards'], 'referral_my_claim.rewards').map(MyClaimReward.fromJson).toList(growable: false),
    );
  }

  static const none = MyClaim(state: MyClaimState.none);

  final MyClaimState state;
  final DateTime? claimedAt;
  final DateTime? activateBy;

  /// Days left to start using the app (claimed only).
  final int? daysLeft;
  final DateTime? joinedAt;
  final List<MyClaimReward> rewards;
}
