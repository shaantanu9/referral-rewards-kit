/// The whole `rewards_state` object and the `rewards_track` result (ADR 0002 §11).
library;

import 'fair_play_models.dart';
import 'json.dart';
import 'models.dart';
import 'programs.dart';
import 'quiz_models.dart';
import 'surprise_models.dart';
import 'tasks.dart';

/// Everything `rewards_state()` returns. Immutable; the controller replaces it with [copyWith].
class RewardsState {
  const RewardsState({
    this.enabled = false,
    this.serverTime,
    this.programs = const [],
    this.streaks = const [],
    this.milestones = const [],
    this.offers = const [],
    this.social = const [],
    this.inbox = const [],
    this.badges = const [],
    this.quests = const [],
    this.recharges = const [],
    this.windows = const [],
    this.friends = const [],
    this.quizzes = const [],
    this.surprises = const [],
    this.choices = RewardsChoices.none,
  });

  factory RewardsState.fromJson(Object? json) {
    final m = asMap(json, 'rewards_state');
    return RewardsState(
      enabled: boolOr(m['enabled']),
      serverTime: time(m['server_time']),
      programs: listOf(m['programs'], ProgramInfo.fromJson),
      streaks: listOf(m['streaks'], StreakState.fromJson),
      milestones: listOf(m['milestones'], MilestoneState.fromJson),
      offers: listOf(m['offers'], OfferState.fromJson),
      social: listOf(m['social'], SocialTaskState.fromJson),
      inbox: listOf(m['inbox'], RewardGrant.fromJson),
      badges: listOf(m['badges'], Badge.fromJson),
      quests: listOf(m['quests'], QuestState.fromJson),
      recharges: listOf(m['recharges'], RechargeState.fromJson),
      windows: listOf(m['windows'], WindowState.fromJson),
      friends: listOf(m['friends'], FriendStreakState.fromJson),
      quizzes: listOf(m['quizzes'], QuizState.fromJson),
      surprises: SurpriseOdd.listFrom(m['surprises']),
      choices: RewardsChoices.fromJson(m['choices']),
    );
  }

  /// An empty, disabled state.
  static const empty = RewardsState();

  /// The engine's master switch (`settings.enabled`). Widgets hide when false.
  final bool enabled;

  /// The server's clock when it built this object; feeds `ServerClock`.
  final DateTime? serverTime;
  final List<ProgramInfo> programs;
  final List<StreakState> streaks;
  final List<MilestoneState> milestones;
  final List<OfferState> offers;
  final List<SocialTaskState> social;

  /// Grants not yet seen (latest 50).
  final List<RewardGrant> inbox;
  final List<Badge> badges;
  final List<QuestState> quests;
  final List<RechargeState> recharges;

  /// The current window of each `window` program, or its next one.
  final List<WindowState> windows;

  /// Every friend streak, of every `friend_streak` program.
  final List<FriendStreakState> friends;
  final List<QuizState> quizzes;

  /// Odds of every surprise rule (`params.chance`) in a live program (ADR 0002 §18.6). Empty when none.
  final List<SurpriseOdd> surprises;

  /// The user's streak / surprise / timer choices (0.7). All on (nothing off) from an older server.
  final RewardsChoices choices;

  ProgramInfo? program(String key) => _find(programs, (p) => p.key == key);
  StreakState? streak(String program) => _find(streaks, (s) => s.program == program);
  MilestoneState? milestone(String program) => _find(milestones, (s) => s.program == program);
  OfferState? offer(String program) => _find(offers, (s) => s.program == program);
  SocialTaskState? socialTask(String program) => _find(social, (s) => s.program == program);
  QuestState? quest(String program) => _find(quests, (s) => s.program == program);
  RechargeState? recharge(String program) => _find(recharges, (s) => s.program == program);
  WindowState? window(String program) => _find(windows, (s) => s.program == program);
  QuizState? quiz(String program) => _find(quizzes, (s) => s.program == program);

  /// The surprise odds of one program.
  List<SurpriseOdd> surprisesOf(String program) => [
    for (final s in surprises)
      if (s.program == program) s,
  ];

  /// The friend streaks of one program.
  List<FriendStreakState> friendsOf(String program) => [
    for (final f in friends)
      if (f.program == program) f,
  ];

  RewardsState copyWith({
    bool? enabled,
    DateTime? serverTime,
    List<ProgramInfo>? programs,
    List<StreakState>? streaks,
    List<MilestoneState>? milestones,
    List<OfferState>? offers,
    List<SocialTaskState>? social,
    List<RewardGrant>? inbox,
    List<Badge>? badges,
    List<QuestState>? quests,
    List<RechargeState>? recharges,
    List<WindowState>? windows,
    List<FriendStreakState>? friends,
    List<QuizState>? quizzes,
    List<SurpriseOdd>? surprises,
    RewardsChoices? choices,
  }) => RewardsState(
    enabled: enabled ?? this.enabled,
    serverTime: serverTime ?? this.serverTime,
    programs: programs ?? this.programs,
    streaks: streaks ?? this.streaks,
    milestones: milestones ?? this.milestones,
    offers: offers ?? this.offers,
    social: social ?? this.social,
    inbox: inbox ?? this.inbox,
    badges: badges ?? this.badges,
    quests: quests ?? this.quests,
    recharges: recharges ?? this.recharges,
    windows: windows ?? this.windows,
    friends: friends ?? this.friends,
    quizzes: quizzes ?? this.quizzes,
    surprises: surprises ?? this.surprises,
    choices: choices ?? this.choices,
  );
}

T? _find<T>(List<T> list, bool Function(T) test) {
  for (final x in list) {
    if (test(x)) return x;
  }
  return null;
}

/// What `rewards_track` returns: `{"enabled": bool, "duplicate": bool, "grants": [grant], "streaks": [streak]}`
/// (only the changed ones). [milestones] and [quests] are read too when a server sends them; empty otherwise.
class TrackResult {
  const TrackResult({
    this.enabled = true,
    this.duplicate = false,
    this.grants = const [],
    this.streaks = const [],
    this.milestones = const [],
    this.quests = const [],
  });

  factory TrackResult.fromJson(Object? json) {
    final m = asMap(json, 'rewards_track');
    return TrackResult(
      enabled: boolOr(m['enabled'], true),
      duplicate: boolOr(m['duplicate']),
      grants: listOf(m['grants'], RewardGrant.fromJson),
      streaks: listOf(m['streaks'], StreakState.fromJson),
      milestones: listOf(m['milestones'], MilestoneState.fromJson),
      quests: listOf(m['quests'], QuestState.fromJson),
    );
  }

  /// False when the engine is switched off (nothing was stored).
  final bool enabled;
  final bool duplicate;
  final List<RewardGrant> grants;
  final List<StreakState> streaks;
  final List<MilestoneState> milestones;
  final List<QuestState> quests;
}

/// Replaces items of [base] whose key matches an item of [changed], appends the rest, keeps order.
List<T> mergeBy<T>(List<T> base, List<T> changed, String Function(T) key) {
  if (changed.isEmpty) return base;
  final byKey = {for (final c in changed) key(c): c};
  final out = [for (final b in base) byKey.remove(key(b)) ?? b];
  out.addAll(byKey.values);
  return out;
}
