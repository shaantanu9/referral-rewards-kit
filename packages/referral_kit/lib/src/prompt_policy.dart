import 'storage.dart';

/// When the app may show its one "invite friends" prompt (ADR 11.4).
///
/// - never in the first session;
/// - at most one prompt per [minInterval] (14 days);
/// - only after the app reports a moment of value in the current session;
/// - never while a purchase is in progress, nor within [purchaseCooldown] after one finished, nor later in the
///   session in which a purchase happened.
///
/// On the paywall the invite line is secondary text, never a prompt, so it does not go through this policy.
///
/// Usage: call [startSession] once per app launch, [reportMomentOfValue] when the user got value, the purchase
/// hooks around store purchases, then `if (await policy.shouldPrompt()) { show(); await policy.markPrompted(); }`.
class ReferralPromptPolicy {
  ReferralPromptPolicy({
    required KeyValueStore store,
    DateTime Function()? clock,
    this.minInterval = const Duration(days: 14),
    this.purchaseCooldown = const Duration(hours: 24),
  }) : _store = store,
       _clock = clock ?? DateTime.now;

  final KeyValueStore _store;
  final DateTime Function() _clock;
  final Duration minInterval;
  final Duration purchaseCooldown;

  static const _sessionsKey = 'prompt.sessions';
  static const _lastPromptKey = 'prompt.last_prompt_at';
  static const _lastPurchaseKey = 'prompt.last_purchase_at';

  int _session = 0;
  bool _valueThisSession = false;
  bool _purchasing = false;
  bool _purchasedThisSession = false;

  /// Counts a new app session. Call once per launch, before [shouldPrompt].
  Future<void> startSession() async {
    final n = int.tryParse(await _store.getString(_sessionsKey) ?? '') ?? 0;
    _session = n + 1;
    _valueThisSession = false;
    _purchasing = false;
    _purchasedThisSession = false;
    await _store.setString(_sessionsKey, '$_session');
  }

  /// The app's own moment of value (a chapter finished, a goal met).
  void reportMomentOfValue() => _valueThisSession = true;

  void reportPurchaseStarted() {
    _purchasing = true;
    _purchasedThisSession = true;
  }

  /// Call when the purchase flow ends, whether it succeeded, failed or was cancelled.
  Future<void> reportPurchaseFinished() async {
    _purchasing = false;
    _purchasedThisSession = true;
    await _store.setString(_lastPurchaseKey, _clock().toUtc().toIso8601String());
  }

  Future<DateTime?> _time(String key) async {
    final v = await _store.getString(key);
    return v == null ? null : DateTime.tryParse(v);
  }

  Future<bool> shouldPrompt() async {
    if (_session <= 1) return false;
    if (!_valueThisSession || _purchasing || _purchasedThisSession) return false;
    final now = _clock();
    final purchase = await _time(_lastPurchaseKey);
    if (purchase != null && now.difference(purchase) < purchaseCooldown) return false;
    final last = await _time(_lastPromptKey);
    if (last != null && now.difference(last) < minInterval) return false;
    return true;
  }

  /// Records that the prompt was shown; the moment of value is used up.
  Future<void> markPrompted() async {
    _valueThisSession = false;
    await _store.setString(_lastPromptKey, _clock().toUtc().toIso8601String());
  }
}
