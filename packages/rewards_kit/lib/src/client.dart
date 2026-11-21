import 'dart:async';

import 'errors.dart';
import 'events.dart';
import 'fair_play_models.dart';
import 'followup_models.dart';
import 'json.dart';
import 'league_models.dart';
import 'models.dart';
import 'programs.dart';
import 'quiz_models.dart';
import 'state.dart';
import 'tasks.dart';

/// Calls one Postgres function through PostgREST and returns its JSON result.
///
/// With supabase_flutter: `(fn, params) => Supabase.instance.client.rpc(fn, params: params)`.
/// Without: [RewardsHttpRpc] (`RewardsHttpRpc(...).call`). A JSON string result is accepted too.
typedef RewardsRpc = Future<Object?> Function(String fn, Map<String, Object?> params);

/// Typed client for the user RPCs (ADR 0002 §11 and §18.3).
class RewardsClient {
  RewardsClient({required RewardsRpc rpc, this.timezone, this.onEvent}) : _rpc = rpc;

  final RewardsRpc _rpc;

  /// The phone's IANA timezone (`Asia/Kolkata`), e.g. from the `flutter_timezone` package. Streak days are counted
  /// in it. Null: the server keeps the last one it stored, or the app's default. Dart's `timeZoneName` is an
  /// abbreviation (`IST`), not IANA, so it is not used.
  final FutureOr<String?> Function()? timezone;

  final RewardsEventSink? onEvent;

  void report(RewardsEvent e) => reportRewardsEvent(onEvent, e);

  Future<Object?> _call(String fn, Map<String, Object?> params) async {
    try {
      return decodeResult(await _rpc(fn, params));
    } on RewardsUnavailableException {
      rethrow;
    } on RewardsException {
      rethrow;
    } on RewardsServerError {
      rethrow;
    } on RewardsNetworkError {
      rethrow;
    } on RewardsFormatException {
      rethrow;
    } catch (e) {
      final reason = rewardsReasonOf(e);
      if (reason == RewardsReason.notSignedIn) {
        throw const RewardsUnavailableException(RewardsUnavailableReason.signedOut);
      }
      if (reason != null) throw RewardsException(reason);
      if (isRewardsNotDeployed(e)) throw const RewardsUnavailableException(RewardsUnavailableReason.notDeployed);
      throw RewardsNetworkError(fn);
    }
  }

  /// Everything the app shows (ADR 0002 §11). Also starts `first_seen` offer windows on the server.
  Future<RewardsState> state() async {
    final s = RewardsState.fromJson(await _call('rewards_state', const {}));
    report(RewardsEvent(RewardsEventName.stateLoaded, {'programs': s.programs.length, 'inbox': s.inbox.length}));
    return s;
  }

  /// Records one action. [dedupeKey] makes it count once (e.g. `chapter:42`); null counts once per local day.
  Future<TrackResult> track(String type, {String? dedupeKey, Map<String, Object?> props = const {}}) async {
    final tz = await timezone?.call();
    final r = TrackResult.fromJson(
      await _call('rewards_track', {'type': type, 'dedupe_key': dedupeKey, 'props': props, 'timezone': tz}),
    );
    report(RewardsEvent(RewardsEventName.tracked, {'type': type, 'duplicate': r.duplicate, 'grants': r.grants.length}));
    return r;
  }

  /// Claims a live offer. Refusals arrive as [RewardsException] (`offer_expired`, `sold_out`, ...).
  Future<List<RewardGrant>> claimOffer(String program) async {
    try {
      final m = asMap(await _call('rewards_offer_claim', {'program': program}), 'rewards_offer_claim');
      report(RewardsEvent(RewardsEventName.offerClaimed, {'program': program, 'result': 'ok'}));
      return listOf(m['grants'], RewardGrant.fromJson);
    } on RewardsException catch (e) {
      report(RewardsEvent(RewardsEventName.offerClaimed, {'program': program, 'result': e.reason}));
      rethrow;
    }
  }

  /// Starts (or returns the pending) Instagram task with the user's handle; returns the code for the caption.
  Future<SocialStartResult> startSocial(String program, String handle) async {
    try {
      final r = SocialStartResult.fromJson(
        asMap(await _call('rewards_social_start', {'program': program, 'handle': handle}), 'rewards_social_start'),
      );
      report(RewardsEvent(RewardsEventName.socialStarted, {'program': program, 'result': 'ok'}));
      return r;
    } on RewardsException catch (e) {
      report(RewardsEvent(RewardsEventName.socialStarted, {'program': program, 'result': e.reason}));
      rethrow;
    }
  }

  /// Marks granted inbox items as seen; returns how many were marked.
  Future<int> markSeen(List<String> grantIds) async {
    if (grantIds.isEmpty) return 0;
    final n = intOr(await _call('rewards_mark_seen', {'grant_ids': grantIds}));
    report(RewardsEvent(RewardsEventName.inboxSeen, {'count': n}));
    return n;
  }

  /// Runs [call] and reports [name] with `result` `ok` or the refusal reason (plus [props]).
  Future<T> _reported<T>(RewardsEventName name, Map<String, Object> props, Future<T> Function() call) async {
    try {
      final r = await call();
      report(RewardsEvent(name, {...props, 'result': 'ok'}));
      return r;
    } on RewardsException catch (e) {
      report(RewardsEvent(name, {...props, 'result': e.reason}));
      rethrow;
    }
  }

  // ---- 0.2 (ADR 0002 §18.3) ----

  /// A streak's events per local day, oldest first, [weeks] × 7 days ending today. [program] null = the first
  /// streak program.
  Future<StreakHistory> history({String? program, int weeks = 15}) async => StreakHistory.fromJson(
    asMap(await _call('rewards_history', {'program': program, 'weeks': weeks}), 'rewards_history'),
  );

  /// Totals between two local days, both included (dates only; the time of day is ignored).
  Future<Recap> recap(DateTime fromDay, DateTime toDay) async => Recap.fromJson(
    asMap(await _call('rewards_recap', {'from_day': formatDay(fromDay), 'to_day': formatDay(toDay)}), 'rewards_recap'),
    from: DateTime.utc(fromDay.year, fromDay.month, fromDay.day),
    to: DateTime.utc(toDay.year, toDay.month, toDay.day),
  );

  /// Spends [units] of a recharge program. Refusal: `empty`.
  Future<RechargeState> useRecharge(String program, {int units = 1}) => _reported(
    RewardsEventName.rechargeUsed,
    {'program': program, 'units': units},
    () async => RechargeState.fromJson(
      asMap(await _call('rewards_recharge_use', {'program': program, 'units': units}), 'rewards_recharge_use'),
    ),
  );

  /// A code a friend can accept to start a friend streak (valid 7 days).
  Future<FriendInvite> friendInvite(String program) => _reported(
    RewardsEventName.friendInvited,
    {'program': program},
    () async => FriendInvite.fromJson(
      asMap(await _call('rewards_friend_invite', {'program': program}), 'rewards_friend_invite'),
    ),
  );

  /// Accepts a friend's code. Refusals: `bad_code`, `own_code`, `too_many_friends`, `already_friends`.
  Future<FriendAcceptResult> friendAccept(String code) => _reported(
    RewardsEventName.friendAccepted,
    const {},
    () async => FriendAcceptResult.fromJson(
      asMap(await _call('rewards_friend_accept', {'code': code.trim().toUpperCase()}), 'rewards_friend_accept'),
    ),
  );

  /// Ends a friend streak for both friends.
  Future<bool> friendRemove(String pairId) => _reported(
    RewardsEventName.friendRemoved,
    const {},
    () async => boolOr(await _call('rewards_friend_remove', {'pair_id': pairId}), true),
  );

  /// Sends the link of the user's post for a pending social task (when the webhook did not see it). Refusals:
  /// `bad_link`, `no_pending_post`.
  Future<SocialTaskState> submitSocialLink(String program, String url) => _reported(
    RewardsEventName.socialLinkSubmitted,
    {'program': program},
    () async => SocialTaskState.fromJson(
      asMap(
        await _call('rewards_social_submit_link', {'program': program, 'url': url.trim()}),
        'rewards_social_submit_link',
      ),
    ),
  );

  /// Today's quiz for this user.
  Future<QuizState> quizToday(String program) async =>
      QuizState.fromJson(asMap(await _call('rewards_quiz_today', {'program': program}), 'rewards_quiz_today'));

  /// Starts an attempt. Refusals: `no_attempts_left`, `not_enough_questions`.
  Future<QuizState> quizStart(String program) => _reported(
    RewardsEventName.quizStarted,
    {'program': program},
    () async =>
        QuizState.fromJson(asMap(await _call('rewards_quiz_start', {'program': program}), 'rewards_quiz_start')),
  );

  /// The current question of the attempt (the same one again until it is answered, with the same deadline).
  /// Refusal: `no_attempt`.
  Future<QuizQuestion> quizQuestion(String program) async =>
      QuizQuestion.fromJson(asMap(await _call('rewards_quiz_question', {'program': program}), 'rewards_quiz_question'));

  /// Answers question [index] with [choice] (an index into its choices; `-1` = no answer, sent when time ran out).
  Future<QuizAnswerResult> quizAnswer(String program, int index, int choice) async {
    final r = QuizAnswerResult.fromJson(
      asMap(
        await _call('rewards_quiz_answer', {'program': program, 'index': index, 'choice': choice}),
        'rewards_quiz_answer',
      ),
    );
    report(
      RewardsEvent(RewardsEventName.quizAnswered, {
        'program': program,
        'index': index,
        'correct': r.correct,
        'timed_out': r.timedOut,
      }),
    );
    if (r.finished) {
      report(
        RewardsEvent(RewardsEventName.quizFinished, {
          'program': program,
          'score': r.score,
          'total': index + 1,
          'grants': r.grants.length,
        }),
      );
    }
    return r;
  }

  // ---- 0.4 (ADR 0002 §18.7) ----

  /// The notifications planned for the next [days] days, sorted by time (`FollowupScheduler` schedules them).
  Future<FollowupPlan> followupsPlan({int days = 14}) async =>
      FollowupPlan.fromJson(asMap(await _call('rewards_followups_plan', {'days': days}), 'rewards_followups_plan'));

  /// Reads the user's follow-up choices, or saves [patch] first and returns the result. Keys: `notifications_off`,
  /// `emails_off`, `reminder_time` (a [TimeOfDay] or "HH:MM"; sent as "HH:MM", null clears it), `muted_groups` (a
  /// list of group names, 0.5; sent as a list of non-empty strings, left out when it is not a list), and (0.7)
  /// `streaks_off`, `surprises_off`, `timers_off` (booleans, [RewardsChoices.keys]). Other keys are not sent. Reports `rewards_followup_prefs_changed` once per saved key. The result is kept as
  /// [lastFollowupPrefs].
  Future<FollowupPrefs> followupPrefs([Map<String, Object?> patch = const {}]) => _followupPrefs(patch, const {});

  Future<FollowupPrefs> _followupPrefs(Map<String, Object?> patch, Map<String, Object> extra) async {
    final body = <String, Object?>{
      for (final e in patch.entries)
        if (FollowupPrefs.keys.contains(e.key) && (e.key != FollowupPrefs.mutedGroupsKey || e.value is Iterable))
          e.key: switch (e.key) {
            FollowupPrefs.reminderTimeKey => _reminderTimeWire(e.value),
            FollowupPrefs.mutedGroupsKey => parseMutedGroups(e.value).toList(),
            RewardsChoices.streaksOffKey ||
            RewardsChoices.surprisesOffKey ||
            RewardsChoices.timersOffKey => boolOr(e.value),
            _ => e.value,
          },
    };
    final p = FollowupPrefs.fromJson(
      asMap(await _call('rewards_followup_prefs', {'patch': body}), 'rewards_followup_prefs'),
    );
    _lastFollowupPrefs = p;
    for (final k in body.keys) {
      report(
        RewardsEvent(RewardsEventName.followupPrefsChanged, {
          'field': k,
          if (k == FollowupPrefs.mutedGroupsKey) ...extra,
        }),
      );
    }
    return p;
  }

  FollowupPrefs? _lastFollowupPrefs;

  /// What the server returned on the last [followupPrefs] call, or null before the first.
  FollowupPrefs? get lastFollowupPrefs => _lastFollowupPrefs;

  /// Mutes or unmutes the follow-up notifications of [group] (0.5): computes the new `muted_groups` from
  /// [lastFollowupPrefs] (read first when there is none yet) and saves it. Reports
  /// `rewards_followup_prefs_changed` with `field: muted_groups` and `group`.
  Future<FollowupPrefs> setFollowupGroupMuted(String group, bool muted) async {
    final current = _lastFollowupPrefs ?? await followupPrefs();
    return _followupPrefs(current.groupMutedPatch(group, muted), {'group': group});
  }

  /// Records that a follow-up notification of [program] was opened: `followup_opened`, once per program and local
  /// day ([followupOpenedKey]).
  Future<TrackResult> trackFollowupOpened(String program, {DateTime? now}) async {
    final r = await track(
      'followup_opened',
      dedupeKey: followupOpenedKey(program, now ?? DateTime.now()),
      props: {'program': program},
    );
    report(RewardsEvent(RewardsEventName.followupOpened, {'program': program}));
    return r;
  }

  // ---- 0.6 (ADR 0002 §18.10) ----

  /// This week's league for the user: the board (display names and scores only) when they joined, the rules and the
  /// real week end either way. Also closes an ended week on the server, so last week's result is never late.
  Future<LeagueState> league(String program) async =>
      LeagueState.fromJson(asMap(await _call('rewards_league', {'program': program}), 'rewards_league'));

  /// Opts in (the user's own tap; nobody is enrolled by the engine) and returns the league with this week's board.
  Future<LeagueState> joinLeague(String program) => _reported(
    RewardsEventName.leagueJoined,
    {'program': program},
    () async =>
        LeagueState.fromJson(asMap(await _call('rewards_league_join', {'program': program}), 'rewards_league_join')),
  );

  /// Leaves at once: off this week's board, no more placement; the tier is kept for a later join.
  Future<LeagueState> leaveLeague(String program) => _reported(
    RewardsEventName.leagueLeft,
    {'program': program},
    () async =>
        LeagueState.fromJson(asMap(await _call('rewards_league_leave', {'program': program}), 'rewards_league_leave')),
  );
}

/// `"<program>:<yyyy-mm-dd>"` with the phone's local day of [now].
String followupOpenedKey(String program, DateTime now) => '$program:${formatDay(now.toLocal())}';

Object? _reminderTimeWire(Object? v) {
  if (v == null) return null;
  return formatReminderTime(parseReminderTime(v)) ?? v;
}
