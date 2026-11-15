/// Daily quiz shapes (ADR 0002 §18.2 `quiz`, §18.3 `rewards_quiz_*`). The server never sends an answer before it
/// is given; every deadline is a server time.
library;

import 'json.dart';
import 'models.dart';

/// Today's quiz for this user. [unknown] covers a state a newer server adds.
enum QuizStatus {
  notStarted('not_started'),
  inProgress('in_progress'),
  finished('finished'),
  unknown('unknown');

  const QuizStatus(this.wire);
  final String wire;

  static QuizStatus fromWire(Object? v) => values.firstWhere((s) => s.wire == v && s != unknown, orElse: () => unknown);
}

/// How a question is answered. Every kind is answered by picking one of `choices` by index; the kind only changes
/// the look. [unknown] (a kind a newer server adds) is shown as a plain choice list.
enum QuizQuestionKind {
  choice('choice'),
  trueFalse('true_false'),
  oddOneOut('odd_one_out'),
  listen('listen'),
  picture('picture'),
  unknown('unknown');

  const QuizQuestionKind(this.wire);
  final String wire;

  static QuizQuestionKind fromWire(Object? v) {
    if (v == 'multiple_choice' || v == 'mcq') return choice;
    return values.firstWhere((k) => k.wire == v && k != unknown, orElse: () => unknown);
  }
}

/// The score of a finished attempt and what it paid.
class QuizResult {
  const QuizResult({this.score = 0, this.total = 0, this.grants = const []});

  factory QuizResult.fromJson(Map<String, Object?> m) =>
      QuizResult(score: intOr(m['score']), total: intOr(m['total']), grants: listOf(m['grants'], RewardGrant.fromJson));

  final int score;
  final int total;
  final List<RewardGrant> grants;
}

/// `{"program","state","day","ends_at","total","current","score","attempts_left","last_result"}`. [endsAt] is when
/// today's quiz closes (the end of the user's local day); [current] is the index of the question being answered.
class QuizState {
  const QuizState({
    required this.program,
    this.status = QuizStatus.notStarted,
    this.day,
    this.endsAt,
    this.total = 0,
    this.current = 0,
    this.score = 0,
    this.attemptsLeft = 0,
    this.lastResult,
  });

  factory QuizState.fromJson(Map<String, Object?> m) => QuizState(
    program: str(m['program']),
    status: QuizStatus.fromWire(m['state'] ?? 'not_started'),
    day: optStr(m['day']),
    endsAt: time(m['ends_at']),
    total: intOr(m['total']),
    current: intOr(m['current']),
    score: intOr(m['score']),
    attemptsLeft: intOr(m['attempts_left']),
    lastResult: m['last_result'] is Map ? QuizResult.fromJson(optMap(m['last_result'])) : null,
  );

  final String program;
  final QuizStatus status;

  /// The local day (`2026-11-14`) as sent.
  final String? day;
  final DateTime? endsAt;
  final int total;
  final int current;
  final int score;
  final int attemptsLeft;

  /// The last finished attempt today, or null.
  final QuizResult? lastResult;

  /// A new attempt can start now.
  bool get canStart => status != QuizStatus.inProgress && attemptsLeft > 0;
}

/// A served question: `{"index","total","question":{"id","kind","prompt","choices","media"},"time_limit_s",
/// "served_at","ends_at"}`. [endsAt] is the server deadline; the server grants a few seconds of grace for the
/// network, so the countdown is exact and never generous.
class QuizQuestion {
  const QuizQuestion({
    required this.index,
    required this.total,
    required this.id,
    this.kind = QuizQuestionKind.choice,
    this.kindWire = 'choice',
    this.prompt = '',
    this.choices = const [],
    this.media = const {},
    this.timeLimit,
    this.servedAt,
    this.endsAt,
  });

  factory QuizQuestion.fromJson(Map<String, Object?> m) {
    final q = optMap(m['question']);
    final limit = optInt(m['time_limit_s']);
    return QuizQuestion(
      index: intOr(m['index']),
      total: intOr(m['total']),
      id: str(q['id']),
      kind: QuizQuestionKind.fromWire(q['kind']),
      kindWire: str(q['kind']),
      prompt: str(q['prompt']),
      choices: [for (final c in asList(q['choices'], 'choices')) str(c)],
      media: optMap(q['media']),
      timeLimit: limit == null ? null : Duration(seconds: limit),
      servedAt: time(m['served_at']),
      endsAt: time(m['ends_at']),
    );
  }

  /// 0-based position in the attempt.
  final int index;
  final int total;
  final String id;
  final QuizQuestionKind kind;
  final String kindWire;
  final String prompt;

  /// The options, answered by index. A `true_false` question with no choices is answered 0 = true, 1 = false.
  final List<String> choices;

  /// Kind-specific extras, passed to the app's callbacks: [soundId] for `listen`, [imageUrl] for `picture`.
  final Map<String, Object?> media;
  final Duration? timeLimit;
  final DateTime? servedAt;
  final DateTime? endsAt;

  /// `media.sound_id` (or `sound`): handed to the app's `onPlaySound`.
  String? get soundId => optStr(media['sound_id'] ?? media['sound']);

  /// `media.image_url` (or `image`, `url`): handed to the app's `imageBuilder`.
  String? get imageUrl => optStr(media['image_url'] ?? media['image'] ?? media['url']);

  /// The whole time allowed, from [timeLimit] or `ends_at - served_at`.
  Duration? get window {
    if (timeLimit != null) return timeLimit;
    final s = servedAt, e = endsAt;
    return s == null || e == null ? null : e.difference(s);
  }
}

/// `rewards_quiz_answer`: `{"correct","answer","explanation","timed_out","score","finished","grants"}`. [answer] is
/// the index of the right choice (sent only after answering).
class QuizAnswerResult {
  const QuizAnswerResult({
    this.correct = false,
    this.answer,
    this.explanation,
    this.timedOut = false,
    this.score = 0,
    this.finished = false,
    this.grants = const [],
  });

  factory QuizAnswerResult.fromJson(Map<String, Object?> m) => QuizAnswerResult(
    correct: boolOr(m['correct']),
    answer: optInt(m['answer']),
    explanation: (m['explanation'] is String && (m['explanation'] as String).isNotEmpty)
        ? m['explanation'] as String
        : null,
    timedOut: boolOr(m['timed_out']),
    score: intOr(m['score']),
    finished: boolOr(m['finished']),
    grants: listOf(m['grants'], RewardGrant.fromJson),
  );

  final bool correct;
  final int? answer;
  final String? explanation;
  final bool timedOut;

  /// The score so far in this attempt.
  final int score;

  /// This was the last question.
  final bool finished;

  /// Rewards paid on finish (only the highest tier reached).
  final List<RewardGrant> grants;

  QuizAnswerResult asTimedOut() => QuizAnswerResult(
    correct: false,
    answer: answer,
    explanation: explanation,
    timedOut: true,
    score: score,
    finished: finished,
    grants: grants,
  );
}
