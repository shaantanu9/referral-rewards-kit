import 'dart:async';

import 'package:flutter/widgets.dart';

import 'client.dart';
import 'clock.dart';
import 'errors.dart';
import 'events.dart';
import 'fair_play_models.dart';
import 'league_models.dart';
import 'models.dart';
import 'programs.dart';
import 'quiz_models.dart';
import 'state.dart';
import 'tasks.dart';
import 'texts.dart';

/// Holds the last [RewardsState] for the widgets, the server clock, and a stream of grants as they land.
///
/// Nothing runs in the constructor: call [refresh] (the widgets do it on first build when [state] was never
/// loaded). Action methods return null on success, or a short reason (`offer_expired`, `sold_out`, `offline`,
/// `unavailable`, ...) so a widget can show the right line without try/catch.
class RewardsController extends ChangeNotifier {
  RewardsController({required this.client, ServerClock? clock}) : clock = clock ?? ServerClock();

  final RewardsClient client;
  final ServerClock clock;

  RewardsState _state = RewardsState.empty;
  bool _loaded = false;
  bool _loading = false;
  Object? _error;
  RewardsUnavailableReason? _unavailable;
  Future<void>? _inFlight;
  bool _disposed = false;
  final _emitted = <String>{};
  final _grants = StreamController<RewardGrant>.broadcast();
  final _moments = StreamController<void>.broadcast();
  final _histories = <String, StreakHistory>{};
  final _recaps = <String, Recap>{};
  final _invites = <String, FriendInvite>{};
  final _leagues = <String, LeagueState>{};
  final _transforms = <RewardsState Function(RewardsState state)>[];
  final _loadListeners = <void Function(RewardsState state)>[];
  final _refreshConditions = <bool Function(TrackResult result, RewardsState state)>[];
  final _seenListeners = <void Function(List<RewardGrant> grants)>[];

  RewardsState get state => _state;

  // ---- Extension hooks (0.8.1): an extension package adds its own server fields, events and widgets here. ----

  /// Runs [transform] on every state loaded from the server ([refresh]) and after a [track] merge, in the order
  /// added. Use it to read fields from [RewardsState.raw] into [RewardsState.extras], set [RewardsState.hidden] or a
  /// streak's goal override.
  void addStateTransform(RewardsState Function(RewardsState state) transform) {
    _transforms.add(transform);
    if (_loaded) _state = transform(_state);
  }

  /// Calls [listener] after each successful [refresh] with the new state.
  void addLoadListener(void Function(RewardsState state) listener) => _loadListeners.add(listener);

  /// After a [track], the state is reloaded when [test] returns true (as well as in the kit's own cases).
  void addRefreshCondition(bool Function(TrackResult result, RewardsState state) test) => _refreshConditions.add(test);

  /// Calls [listener] with the grants [markSeen] marked seen.
  void addSeenListener(void Function(List<RewardGrant> grants) listener) => _seenListeners.add(listener);

  /// A line shown under the odds of [program] by `SurpriseOdds`, `StreakCard` and `MilestoneProgress` (via
  /// `MysteryOdds.footer`), or null for nothing.
  Widget? Function(BuildContext context, String program, RewardsTexts texts)? oddsFooterBuilder;

  /// Replaces the state with [update]'s result (a local change after an extension's own server call) and, when
  /// [notify] is true, tells the widgets.
  void updateState(RewardsState Function(RewardsState state) update, {bool notify = true}) {
    _state = update(_state);
    if (notify) _notify();
  }

  /// Runs one server call with the controller's error handling, applies its answer, notifies; returns null or a
  /// short reason (`offline`, `unavailable`, the server's reason), like every action of this controller.
  Future<String?> runAction<T>(Future<T> Function() call, void Function(T value) apply) => _act(call, apply);

  RewardsState _transformed(RewardsState s) {
    var out = s;
    for (final t in _transforms) {
      out = t(out);
    }
    return out;
  }

  void _tell<T>(List<void Function(T)> listeners, T value) {
    for (final l in List.of(listeners)) {
      try {
        l(value);
      } catch (_) {}
    }
  }

  /// True once a [refresh] succeeded.
  bool get loaded => _loaded;
  bool get loading => _loading;

  /// The last failure that was not "unavailable" (offline, server error), or null.
  Object? get error => _error;

  /// Why rewards cannot be used (not deployed, signed out, no project), or null. Widgets hide while set.
  RewardsUnavailableReason? get unavailable => _unavailable;

  /// True when the widgets should show something.
  bool get visible => _loaded && _unavailable == null && _state.enabled;

  /// Each granted reward once per controller: what landed from tracking, claiming, or while the app was closed.
  Stream<RewardGrant> get newGrants => _grants.stream;

  /// Fires on [celebrateNow]: `RewardToastListener(holdUntilMoment: true)` shows what it held back.
  Stream<void> get moments => _moments.stream;

  /// Tells listeners that now is a good moment to celebrate (a chapter ended, a lesson closed). Grants that
  /// arrived meanwhile are shown now by every `RewardToastListener` with `holdUntilMoment: true`.
  void celebrateNow() {
    if (!_moments.isClosed) _moments.add(null);
  }

  /// Applies the user's streak / surprise / timer [choices] (0.7) at once, e.g. after `FollowupSettings` saved
  /// them, then reloads so each streak's `hidden` follows. Does nothing when they did not change.
  Future<void> applyChoices(RewardsChoices choices) async {
    if (_state.choices == choices) return;
    _state = _state.copyWith(choices: choices);
    _notify();
    if (_loaded) await refresh();
  }

  /// The last history loaded by [loadHistory] for [program] (null key = the first streak), or null.
  StreakHistory? history([String? program]) => _histories[program ?? ''];

  /// The last recap loaded by [loadRecap] for exactly these days, or null.
  Recap? recap(DateTime fromDay, DateTime toDay) => _recaps[_recapKey(fromDay, toDay)];

  /// The last league loaded by [loadLeague] / [joinLeague] / [leaveLeague] for [program], or null.
  LeagueState? league(String program) => _leagues[program];

  /// The last invite code made by [friendInvite] for [program] in this session, or null.
  FriendInvite? invite(String program) => _invites[program];

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _emit(Iterable<RewardGrant> grants) {
    for (final g in grants) {
      if (g.state != GrantState.granted || !_emitted.add(g.id)) continue;
      client.report(
        RewardsEvent(RewardsEventName.grantReceived, {
          'program': g.program,
          'kind': g.kind,
          'amount': g.amount,
          'state': g.state,
        }),
      );
      if (!_grants.isClosed) _grants.add(g);
    }
  }

  String _fail(Object e) {
    if (e is RewardsUnavailableException) {
      _unavailable = e.reason;
      client.report(RewardsEvent(RewardsEventName.unavailable, {'reason': e.reason.wire}));
      return 'unavailable';
    }
    if (e is RewardsException) return e.reason;
    _error = e;
    return e is RewardsServerError ? 'server_error' : 'offline';
  }

  /// Loads the state. Calls made while one is running share it.
  Future<void> refresh() => _inFlight ??= _refresh().whenComplete(() => _inFlight = null);

  Future<void> _refresh() async {
    _loading = true;
    _notify();
    try {
      final s = await client.state();
      clock.sync(s.serverTime);
      _state = _transformed(s);
      _loaded = true;
      _error = null;
      _unavailable = null;
      if (!s.enabled) client.report(const RewardsEvent(RewardsEventName.unavailable, {'reason': 'disabled'}));
      _emit(s.inbox);
      _tell(_loadListeners, _state);
    } catch (e) {
      _fail(e);
    } finally {
      _loading = false;
      _notify();
    }
  }

  /// Tracks one action and merges what changed. Refreshes afterwards when something else may have moved
  /// (a grant, a milestone count, an offer that starts on an event). Returns null or a reason.
  Future<String?> track(String type, {String? dedupeKey, Map<String, Object?> props = const {}}) async {
    final TrackResult r;
    try {
      r = await client.track(type, dedupeKey: dedupeKey, props: props);
    } catch (e) {
      final reason = _fail(e);
      _notify();
      return reason;
    }
    if (r.duplicate || !r.enabled) return null;
    _state = _transformed(
      _state.copyWith(
        streaks: mergeBy(_state.streaks, r.streaks, (s) => s.program),
        milestones: mergeBy(_state.milestones, r.milestones, (m) => m.program),
        quests: mergeBy(_state.quests, r.quests, (q) => q.program),
      ),
    );
    _updateHistories(r.streaks);
    applyGrants(r.grants, notify: false);
    _notify();
    final mayHaveMoved =
        r.grants.isNotEmpty ||
        _state.milestones.isNotEmpty ||
        _state.quests.isNotEmpty ||
        _state.friends.isNotEmpty ||
        _state.offers.any((o) => o.status == OfferStatus.notStarted) ||
        _refreshConditions.any((test) => test(r, _state));
    if (mayHaveMoved) await refresh();
    return null;
  }

  /// Claims an offer. On a refusal the offer's state is corrected locally (expired, sold out, claimed).
  Future<String?> claimOffer(String program) async {
    try {
      final grants = await client.claimOffer(program);
      _setOffer(program, OfferStatus.claimed);
      applyGrants(grants);
      return null;
    } catch (e) {
      final reason = _fail(e);
      final fixed = switch (reason) {
        RewardsReason.offerExpired => OfferStatus.expired,
        RewardsReason.soldOut => OfferStatus.soldOut,
        RewardsReason.offerClaimed => OfferStatus.claimed,
        _ => null,
      };
      if (fixed != null) _setOffer(program, fixed);
      _notify();
      return reason;
    }
  }

  void _setOffer(String program, OfferStatus status) {
    _state = _state.copyWith(
      offers: [for (final o in _state.offers) o.program == program ? o.copyWith(status: status) : o],
    );
  }

  /// Starts the Instagram task with [handle]; the task becomes pending with its code.
  Future<String?> startSocial(String program, String handle) async {
    try {
      final r = await client.startSocial(program, handle);
      _state = _state.copyWith(
        social: [
          for (final s in _state.social)
            s.program == program
                ? s.copyWith(
                    status: SocialTaskStatus.pending,
                    code: r.code,
                    expiresAt: r.expiresAt,
                    account: r.account.isEmpty ? null : r.account,
                  )
                : s,
        ],
      );
      _notify();
      return null;
    } catch (e) {
      final reason = _fail(e);
      _notify();
      return reason;
    }
  }

  /// Marks granted inbox items seen and removes them; pending ones stay until they land.
  Future<String?> markSeen(List<String> grantIds) async {
    final granted = _state.inbox.where((g) => grantIds.contains(g.id) && g.state == GrantState.granted);
    final ids = granted.map((g) => g.id).toList();
    if (ids.isEmpty) return null;
    try {
      await client.markSeen(ids);
      _tell(_seenListeners, granted.toList());
      _state = _state.copyWith(inbox: _state.inbox.where((g) => !ids.contains(g.id)).toList());
      _notify();
      return null;
    } catch (e) {
      final reason = _fail(e);
      _notify();
      return reason;
    }
  }

  // ---- 0.2 (ADR 0002 §18) ----

  /// Adds grants that reached the app outside [track] / [claimOffer] (a quiz finish, a custom flow) to the inbox
  /// and [newGrants], each once.
  void applyGrants(List<RewardGrant> grants, {bool notify = true}) {
    if (grants.isEmpty) return;
    _state = _state.copyWith(inbox: [...grants.where((g) => !_state.inbox.any((i) => i.id == g.id)), ..._state.inbox]);
    _emit(grants);
    if (notify) _notify();
  }

  /// Puts a quiz state from the server into [RewardsState.quizzes] (used by `QuizController`).
  void applyQuiz(QuizState quiz) {
    _state = _state.copyWith(quizzes: mergeBy(_state.quizzes, [quiz], (q) => q.program));
    _notify();
  }

  void _updateHistories(List<StreakState> changed) {
    for (final s in changed) {
      final h = _histories[s.program];
      if (h != null) _histories[s.program] = h.withTodayCount(s.todayCount);
      final first = _histories[''];
      if (first != null && first.program == s.program) _histories[''] = first.withTodayCount(s.todayCount);
    }
  }

  /// Runs one server call, applies its answer, notifies; returns null or the reason.
  Future<String?> _act<T>(Future<T> Function() call, void Function(T value) apply) async {
    try {
      apply(await call());
      _notify();
      return null;
    } catch (e) {
      final reason = _fail(e);
      _notify();
      return reason;
    }
  }

  /// Loads a streak's day-by-day history for the heatmap; read it with [history].
  Future<String?> loadHistory({String? program, int weeks = 15}) =>
      _act(() => client.history(program: program, weeks: weeks), (StreakHistory h) {
        _histories[program ?? ''] = h;
        if (program == null && h.program.isNotEmpty) _histories[h.program] = h;
      });

  /// Loads totals between two local days; read it with [recap].
  Future<String?> loadRecap(DateTime fromDay, DateTime toDay) =>
      _act(() => client.recap(fromDay, toDay), (Recap r) => _recaps[_recapKey(fromDay, toDay)] = r);

  /// Spends recharge units ("use a heart"). Refusal: `empty` (the meter is corrected to 0).
  Future<String?> useRecharge(String program, {int units = 1}) async {
    final r = await _act(() => client.useRecharge(program, units: units), (RechargeState n) {
      final old = _state.recharge(program);
      _setRecharge(old == null ? n : old.mergedWith(n));
    });
    if (r == RewardsReason.empty) {
      final old = _state.recharge(program);
      if (old != null) {
        _setRecharge(old.mergedWith(RechargeState(program: program, max: old.max, nextAt: old.nextAt)));
        _notify();
      }
    }
    return r;
  }

  void _setRecharge(RechargeState r) =>
      _state = _state.copyWith(recharges: mergeBy(_state.recharges, [r], (x) => x.program));

  /// Makes an invite code for a friend streak; read it with [invite] and hand it to the app's share sheet.
  Future<String?> friendInvite(String program) =>
      _act(() => client.friendInvite(program), (FriendInvite i) => _invites[program] = i);

  /// Accepts a friend's code, then reloads so the new friend streak shows.
  Future<String?> friendAccept(String code) async {
    final r = await _act(() => client.friendAccept(code), (_) {});
    if (r == null) await refresh();
    return r;
  }

  /// Ends a friend streak: removed at once, then reloaded.
  Future<String?> friendRemove(String pairId) async {
    final r = await _act(
      () => client.friendRemove(pairId),
      (_) => _state = _state.copyWith(friends: _state.friends.where((f) => f.pairId != pairId).toList()),
    );
    if (r == null) await refresh();
    return r;
  }

  /// Sends the link of the user's post for a pending social task. The task gets its `post_url`.
  Future<String?> submitSocialLink(String program, String url) =>
      _act(() => client.submitSocialLink(program, url), (SocialTaskState t) {
        final old = _state.socialTask(program);
        final merged = old == null
            ? t
            : old.copyWith(
                status: t.status == SocialTaskStatus.unknown ? null : t.status,
                postUrl: t.postUrl ?? url.trim(),
                code: t.code,
                expiresAt: t.expiresAt,
              );
        _state = _state.copyWith(social: mergeBy(_state.social, [merged], (s) => s.program));
      });

  /// Reloads today's quiz state into [RewardsState.quizzes].
  Future<String?> quizToday(String program) => _act(
    () => client.quizToday(program),
    (QuizState q) => _state = _state.copyWith(quizzes: mergeBy(_state.quizzes, [q], (x) => x.program)),
  );

  // ---- 0.4 (ADR 0002 §18.7) ----

  /// Call when the user opened a follow-up notification of [program] (its payload's route is the app's to open):
  /// tracks `followup_opened` once per local day, then reloads, which also replans a running `FollowupScheduler`.
  Future<String?> followupOpened(String program, {DateTime? now}) async {
    final r = await _act(() => client.trackFollowupOpened(program, now: now), (_) {});
    if (r == null) await refresh();
    return r;
  }

  // ---- 0.6 (ADR 0002 §18.10) ----

  void _setLeague(LeagueState l) {
    clock.sync(l.serverTime);
    _leagues[l.program] = l;
  }

  /// Loads this week's league (the board when joined); read it with [league]. When it brings a newly closed week
  /// with rewards, the state is reloaded so they reach the inbox and [newGrants] like any grant.
  Future<String?> loadLeague(String program) async {
    final before = _leagues[program]?.lastWeek?.week;
    final r = await _act(() => client.league(program), _setLeague);
    final after = _leagues[program]?.lastWeek;
    if (r == null && _loaded && after != null && after.grants.isNotEmpty && after.week != before) await refresh();
    return r;
  }

  /// Joins the league (opt-in) and loads its board. Refusals: `unknown_program`, `disabled`.
  Future<String?> joinLeague(String program) => _act(() => client.joinLeague(program), _setLeague);

  /// Leaves the league at once; the board empties for this user.
  Future<String?> leaveLeague(String program) => _act(() => client.leaveLeague(program), _setLeague);

  @override
  void dispose() {
    _disposed = true;
    _grants.close();
    _moments.close();
    super.dispose();
  }
}

String _recapKey(DateTime a, DateTime b) => '${formatDay(a)}..${formatDay(b)}';
