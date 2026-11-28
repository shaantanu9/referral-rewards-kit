/// Analytics events for the rewards funnel. Forward `onEvent` to your analytics; the package logs nothing itself.
/// Props never carry a user id, an Instagram handle, a social code, a post link, an invite code, or a friend's id
/// or name.
library;

enum RewardsEventName {
  /// `rewards_state` loaded. Props: `programs` (count), `inbox` (count).
  stateLoaded('rewards_state_loaded'),

  /// An event was tracked. Props: `type`, `duplicate`, `grants` (count).
  tracked('rewards_tracked'),

  /// A grant reached the app (each id once per controller). Props: `program`, `kind`, `amount`, `state`.
  grantReceived('rewards_grant_received'),

  /// An offer was claimed. Props: `program`, `result` (`ok` or the refusal reason).
  offerClaimed('rewards_offer_claimed'),

  /// An offer was shown after its deadline. Props: `program`.
  offerExpiredSeen('rewards_offer_expired_seen'),

  /// A social task got its code. Props: `program`, `result` (`ok` or the refusal reason).
  socialStarted('rewards_social_started'),

  /// The social code was copied. Props: `program`.
  socialCodeCopied('rewards_social_code_copied'),

  /// The app's Instagram opener was called. Props: `program`.
  instagramOpened('rewards_instagram_opened'),

  /// Inbox items were marked seen. Props: `count`.
  inboxSeen('rewards_inbox_seen'),

  /// A quiz attempt started. Props: `program`, `result` (`ok` or the refusal reason).
  quizStarted('rewards_quiz_started'),

  /// A quiz question was answered. Props: `program`, `index`, `correct`, `timed_out`.
  quizAnswered('rewards_quiz_answered'),

  /// A quiz attempt finished. Props: `program`, `score`, `total`, `grants` (count).
  quizFinished('rewards_quiz_finished'),

  /// Recharge units were spent. Props: `program`, `units`, `result` (`ok` or the refusal reason).
  rechargeUsed('rewards_recharge_used'),

  /// A friend-streak invite code was made. Props: `program`, `result`.
  friendInvited('rewards_friend_invited'),

  /// An invite code was accepted. Props: `result` (`ok` or the refusal reason). Never the code.
  friendAccepted('rewards_friend_accepted'),

  /// A friend streak was ended. Props: `result`. Never the pair or friend id.
  friendRemoved('rewards_friend_removed'),

  /// A post link was sent for a social task. Props: `program`, `result`. Never the link.
  socialLinkSubmitted('rewards_social_link_submitted'),

  /// A rewarded ad finished (shown by the app through RevenueCat). Props: `result` (`verified` | `not_verified` |
  /// `error`).
  adRewardShown('rewards_ad_reward_shown'),

  /// A surprise / mystery / range reward was opened in `RewardReveal` (once per reveal). Props: `program`, `kind`.
  revealOpened('rewards_reveal_opened'),

  /// A follow-up notification was opened (tracked as `followup_opened`). Props: `program`.
  followupOpened('rewards_followup_opened'),

  /// `FollowupScheduler` scheduled the plan. Props: `count` (notifications scheduled, all in the future).
  followupsPlanned('rewards_followups_planned'),

  /// A follow-up preference was saved, once per key. Props: `field` (`notifications_off` | `emails_off` |
  /// `reminder_time` | `muted_groups`), and `group` when `setFollowupGroupMuted` saved it (a group name is app
  /// config, not personal). Never the value.
  followupPrefsChanged('rewards_followup_prefs_changed'),

  /// `FollowupScheduler` could not plan, cancel or schedule. Props: `reason` (`offline` | `server_error` |
  /// `unavailable` | a refusal reason | `notifier_error` | `store_error`). Never an error message.
  followupsFailed('rewards_followups_failed'),

  /// The user joined a weekly league. Props: `program`, `result` (`ok` or the refusal reason).
  leagueJoined('rewards_league_joined'),

  /// The user left a weekly league. Props: `program`, `result`. Never a name, a rank or a score of anyone else.
  leagueLeft('rewards_league_left'),

  /// Rewards cannot be used right now. Props: `reason` (`not_deployed` | `signed_out` | `no_project` | `offline` |
  /// `server_error` | `disabled`).
  unavailable('rewards_unavailable'),

  /// An event an extension package names itself ([RewardsEvent.custom]); its real name is [RewardsEvent.wire].
  custom('custom');

  const RewardsEventName(this.wire);
  final String wire;
}

/// One analytics event: a [name], its [props], and [context], top-level fields an event decorator added
/// (`RewardsClient.eventDecorator`). [toJson] gives the flat map for an analytics SDK.
class RewardsEvent {
  const RewardsEvent(this.name, [this.props = const {}, this.context = const {}, this.onceKey]) : _wire = null;

  /// An event named by an extension package: [name] is [RewardsEventName.custom] and [wire] is [wireName].
  const RewardsEvent.custom(String wireName, {this.props = const {}, this.context = const {}, this.onceKey})
    : name = RewardsEventName.custom,
      _wire = wireName;

  final RewardsEventName name;
  final Map<String, Object> props;
  final String? _wire;

  /// Top-level fields next to `event` and `props` (e.g. an A/B variant or a session id added by a decorator). A
  /// `DateTime` value is written as UTC ISO-8601 by [toJson].
  final Map<String, Object> context;

  /// When set, `RewardsClient.report` sends this event once per key for that client.
  final String? onceKey;

  /// The wire name: [name]'s, or the custom one.
  String get wire => _wire ?? name.wire;

  /// This event with [more] context fields added; fields already set are kept.
  RewardsEvent withContext(Map<String, Object> more) {
    if (more.isEmpty) return this;
    final merged = {...more, ...context};
    return _wire == null
        ? RewardsEvent(name, props, merged, onceKey)
        : RewardsEvent.custom(_wire, props: props, context: merged, onceKey: onceKey);
  }

  /// The whole event as a flat map: `event`, the [context] fields, and `props`.
  Map<String, Object> toJson() => {
    'event': wire,
    for (final e in context.entries)
      e.key: e.value is DateTime ? (e.value as DateTime).toUtc().toIso8601String() : e.value,
    'props': props,
  };

  @override
  String toString() => 'RewardsEvent($wire, $props)';
}

typedef RewardsEventSink = void Function(RewardsEvent event);

/// Sends [event] to [sink]; an exception from the app's analytics never reaches the UI.
void reportRewardsEvent(RewardsEventSink? sink, RewardsEvent event) {
  if (sink == null) return;
  try {
    sink(event);
  } catch (_) {}
}
