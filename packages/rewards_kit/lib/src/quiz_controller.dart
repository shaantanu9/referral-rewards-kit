import 'dart:async';

import 'package:flutter/foundation.dart';

import 'client.dart';
import 'clock.dart';
import 'controller.dart';
import 'errors.dart';
import 'models.dart';
import 'quiz_models.dart';

/// Where a quiz screen is.
enum QuizPhase {
  /// Nothing loaded yet: call [QuizController.open].
  idle,

  /// Waiting for the server.
  loading,

  /// Today's quiz before an attempt: rules and Start (when [QuizController.canStart]).
  intro,

  /// A question is shown and its countdown runs.
  question,

  /// An answer was sent; waiting for the result.
  answering,

  /// Right / wrong is shown; [QuizController.next] (or the auto-advance) moves on.
  reveal,

  /// The attempt is over: score and rewards.
  finished,

  /// Rewards are not deployed, signed out, or no project ([QuizController.unavailable]).
  unavailable,

  /// Offline or refused ([QuizController.reason]); [QuizController.retry] repeats the last step.
  error,
}

/// Runs one daily quiz program (ADR 0002 §18.2): today → start → question with a server countdown → answer →
/// reveal → next … → finished. Resumes from the server after a restart (the same question, the same deadline).
///
/// Nothing runs in the constructor: call [open]. Pass the app's [RewardsController] as [rewards] so grants reach
/// `newGrants` / the inbox and the countdown uses its synced [ServerClock]. When the time runs out the answer `-1`
/// (no answer) is sent by itself. Actions return null or a reason, like the rewards controller.
class QuizController extends ChangeNotifier {
  QuizController({
    required this.client,
    required this.program,
    this.rewards,
    ServerClock? clock,
    this.revealFor = const Duration(seconds: 2),
    this.tickEvery = const Duration(milliseconds: 200),
  }) : clock = clock ?? rewards?.clock ?? ServerClock();

  final RewardsClient client;
  final String program;
  final RewardsController? rewards;
  final ServerClock clock;

  /// How long right / wrong stays before the next question; null = wait for [next].
  final Duration? revealFor;

  /// How often listeners hear the countdown move.
  final Duration tickEvery;

  QuizPhase _phase = QuizPhase.idle;
  QuizState? _quiz;
  QuizQuestion? _question;
  QuizAnswerResult? _answer;
  int? _picked;
  String? _reason;
  RewardsUnavailableReason? _unavailable;
  Future<void> Function()? _retry;
  Timer? _ticker;
  Timer? _advance;
  bool _disposed = false;

  QuizPhase get phase => _phase;

  /// Today's quiz state from the server, or null before [open].
  QuizState? get quiz => _quiz;

  /// The question being shown (also during reveal), or null.
  QuizQuestion? get question => _question;

  /// The result of the last answer (during reveal and finished), or null.
  QuizAnswerResult? get lastAnswer => _answer;

  /// The choice the user picked for [question] (null for a timeout).
  int? get picked => _picked;

  /// The refusal or failure reason in [QuizPhase.error].
  String? get reason => _reason;
  RewardsUnavailableReason? get unavailable => _unavailable;

  bool get canStart => _quiz?.canStart ?? false;

  /// Time left on the current question (server clock), or null.
  Duration? get timeLeft => clock.left(_question?.endsAt);

  /// 1 at the start of the question, 0 when its time is up.
  double get timeFraction {
    final left = timeLeft, window = _question?.window;
    if (left == null || window == null || window <= Duration.zero) return 0;
    return (left.inMilliseconds / window.inMilliseconds).clamp(0, 1).toDouble();
  }

  void _set(QuizPhase p) {
    _phase = p;
    if (!_disposed) notifyListeners();
  }

  void _setQuiz(QuizState q) {
    _quiz = q;
    rewards?.applyQuiz(q);
  }

  Future<String?> _run(Future<void> Function() step) async {
    _retry = step;
    try {
      await step();
      _reason = null;
      return null;
    } catch (e) {
      _stopTimers();
      if (e is RewardsUnavailableException) {
        _unavailable = e.reason;
        _set(QuizPhase.unavailable);
        return 'unavailable';
      }
      final r = e is RewardsException ? e.reason : (e is RewardsServerError ? 'server_error' : 'offline');
      _reason = r;
      _set(QuizPhase.error);
      return r;
    }
  }

  /// Loads today's quiz. In progress → loads the current question (resume after a restart).
  Future<String?> open() => _run(() async {
    _set(QuizPhase.loading);
    final q = await client.quizToday(program);
    _setQuiz(q);
    if (q.status == QuizStatus.inProgress) return _loadQuestion();
    _set(q.status == QuizStatus.finished ? QuizPhase.finished : QuizPhase.intro);
  });

  /// Starts a new attempt and shows its first question. `no_attempts_left` reloads today's state.
  Future<String?> start() async {
    final r = await _run(() async {
      _set(QuizPhase.loading);
      _setQuiz(await client.quizStart(program));
      _answer = null;
      await _loadQuestion();
    });
    if (r == RewardsReason.noAttemptsLeft) await open();
    return r;
  }

  Future<void> _loadQuestion() async {
    _stopTimers();
    _set(QuizPhase.loading);
    final QuizQuestion q;
    try {
      q = await client.quizQuestion(program);
    } on RewardsException catch (e) {
      // `no_attempt`: the attempt ended elsewhere; show today's state again.
      if (e.reason != RewardsReason.noAttempt) rethrow;
      final today = await client.quizToday(program);
      _setQuiz(today);
      _set(today.status == QuizStatus.finished ? QuizPhase.finished : QuizPhase.intro);
      return;
    }
    _question = q;
    _picked = null;
    _answer = null;
    _set(QuizPhase.question);
    _ticker = Timer.periodic(tickEvery, (_) => tick());
    tick();
  }

  /// Checks the countdown; sends "no answer" once the time is up. The timer calls it; tests may too.
  @visibleForTesting
  void tick() {
    if (_phase != QuizPhase.question || _disposed) return;
    if (timeLeft == Duration.zero) {
      unawaited(_send(-1, timedOut: true));
    } else {
      notifyListeners();
    }
  }

  /// Answers the current question with [choice] (an index into its choices).
  Future<String?> answer(int choice) {
    if (_phase != QuizPhase.question) return Future.value('not_ready');
    return _send(choice);
  }

  Future<String?> _send(int choice, {bool timedOut = false}) {
    final q = _question!;
    _ticker?.cancel();
    _picked = timedOut ? null : choice;
    _set(QuizPhase.answering);
    return _run(() async {
      var a = await client.quizAnswer(program, q.index, choice);
      if (timedOut && !a.timedOut) a = a.asTimedOut();
      _answer = a;
      rewards?.applyGrants(a.grants);
      _set(QuizPhase.reveal);
      final wait = revealFor;
      if (wait != null) _advance = Timer(wait, () => unawaited(next()));
    });
  }

  /// Leaves the reveal: the next question, or the finished result.
  Future<String?> next() async {
    if (_phase != QuizPhase.reveal) return null;
    _advance?.cancel();
    if (_answer?.finished ?? false) return _run(_finish);
    return _run(_loadQuestion);
  }

  Future<void> _finish() async {
    _set(QuizPhase.loading);
    _setQuiz(await client.quizToday(program));
    _set(QuizPhase.finished);
    // `quiz_finished` may move a streak, milestone or quest.
    final r = rewards;
    if (r != null) unawaited(r.refresh());
  }

  /// Repeats the step that failed.
  Future<String?> retry() async {
    final step = _retry;
    if (step == null) return open();
    return _run(step);
  }

  /// The grants of the finished attempt (from the last answer, else today's last result).
  List<RewardGrant> get finishedGrants => _answer?.grants ?? _quiz?.lastResult?.grants ?? const [];

  void _stopTimers() {
    _ticker?.cancel();
    _advance?.cancel();
  }

  @override
  void dispose() {
    _disposed = true;
    _stopTimers();
    super.dispose();
  }
}
