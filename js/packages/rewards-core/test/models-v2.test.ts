// Port of packages/rewards_kit/test/models_v2_test.dart.
import { describe, expect, it } from 'vitest';
import {
  formatDay,
  HistoryDay,
  MysteryOdd,
  ProgramKind,
  programKindFromWire,
  QuizAnswerResult,
  QuizQuestion,
  QuizQuestionKind,
  quizQuestionKindFromWire,
  QuizState,
  QuizStatus,
  quizStatusFromWire,
  Recap,
  RewardsException,
  RewardSpec,
  RewardsState,
  SocialTaskState,
  StreakHistory,
  StreakState,
  TrackResult,
} from '../src';
import { grant, HOUR, iso, MIN, plus, questionJson, quizStateJson, sampleState, sampleStateV2, serverNow, historyJson } from './fakes';

describe('0.2 state', () => {
  it('reads every new kind, list and finder', () => {
    const s = RewardsState.fromJson(sampleStateV2());
    expect(s.programs.map((p) => p.kind).slice(4)).toEqual([
      ProgramKind.quiz,
      ProgramKind.questSet,
      ProgramKind.comeback,
      ProgramKind.recharge,
      ProgramKind.window,
      ProgramKind.friendStreak,
    ]);
    const st = s.streak('daily')!;
    expect([st.dailyGoal, st.todayCount, st.weeklyFreeFreezesLeft]).toEqual([2, 1, 1]);
    expect(st.goalProgress).toBe(0.5);
    const q = s.quest('daily_quests')!;
    expect(q.period).toBe('daily');
    expect(q.endsAt).toEqual(plus(serverNow, 14 * HOUR));
    expect(q.tasks[0]!.fraction).toBeCloseTo(1 / 3, 9);
    expect(q.doneCount).toBe(1);
    expect(q.bonus[0]!.amount).toBe(20);
    const r = s.recharge('hearts')!;
    expect([r.units, r.max, r.everyMinutes]).toEqual([2, 3, 240]);
    expect(r.full).toBe(false);
    expect(r.nextAt).toEqual(plus(serverNow, HOUR + 5 * MIN));
    const w = s.window('happy')!;
    expect(w.active).toBe(true);
    expect(w.activeAt(serverNow)).toBe(true);
    expect(w.activeAt(plus(serverNow, HOUR))).toBe(false);
    const f = s.friendsOf('buddies')[0]!;
    expect([f.pairId, f.friendName, f.current]).toEqual(['p1', 'Asha', 4]);
    expect(f.todayBoth).toBe(false);
    expect(f.nextReward!.threshold).toBe(7);
    expect(s.friendsOf('nope')).toHaveLength(0);
    const quiz = s.quiz('quiz')!;
    expect(quiz.status).toBe(QuizStatus.notStarted);
    expect(quiz.canStart).toBe(true);
    expect([quiz.total, quiz.attemptsLeft]).toEqual([3, 1]);
  });

  it('old server: no new keys, defaults are safe', () => {
    const s = RewardsState.fromJson(sampleState());
    expect(s.quests).toHaveLength(0);
    expect(s.quizzes).toHaveLength(0);
    const st = s.streak('daily')!;
    expect([st.dailyGoal, st.todayCount, st.weeklyFreeFreezesLeft]).toEqual([1, 0, 0]);
    const done = StreakState.fromJson({ program: 'd', today_done: true, daily_goal: 0 });
    expect([done.dailyGoal, done.todayCount]).toEqual([1, 1]);
    expect(done.goalProgress).toBe(1);
  });

  it('unknown kinds and states become unknown, never throw', () => {
    expect(programKindFromWire('raffle')).toBe(ProgramKind.unknown);
    expect(programKindFromWire('unknown')).toBe(ProgramKind.unknown);
    expect(quizStatusFromWire('paused')).toBe(QuizStatus.unknown);
    expect(quizQuestionKindFromWire('drag_drop')).toBe(QuizQuestionKind.unknown);
    expect(quizQuestionKindFromWire('multiple_choice')).toBe(QuizQuestionKind.choice);
    expect(QuizState.fromJson({ program: 'q' }).status).toBe(QuizStatus.notStarted);
  });

  it('copyWith keeps the new lists', () => {
    const s = RewardsState.fromJson(sampleStateV2()).copyWith({ enabled: false });
    expect(s.enabled).toBe(false);
    expect([s.quests.length, s.recharges.length, s.windows.length, s.friends.length, s.quizzes.length]).toEqual([1, 1, 1, 1, 1]);
  });

  it('social post_url', () => {
    expect(SocialTaskState.fromJson({ program: 'ig', post_url: 'https://instagram.com/p/x' }).postUrl).not.toBeNull();
    expect(SocialTaskState.fromJson({ program: 'ig' }).postUrl).toBeNull();
  });

  it('track result reads quests', () => {
    expect(TrackResult.fromJson({ quests: [{ program: 'daily_quests', done: true }] }).quests[0]!.done).toBe(true);
  });
});

describe('mystery odds', () => {
  it('chances as sent', () => {
    const r = RewardSpec.fromJson({
      threshold: 7,
      kind: 'mystery',
      amount: 1,
      odds: [
        { kind: 'coins', amount: 10, chance: 0.75 },
        { kind: 'streak_freeze', amount: 1, chance: 0.25 },
      ],
    });
    expect(r.isMystery).toBe(true);
    expect(r.odds.map((o) => o.chance)).toEqual([0.75, 0.25]);
    expect(r.odds[0]!.spec.amount).toBe(10);
  });

  it('weights from params.table become chances; percentages become fractions', () => {
    const w = RewardSpec.fromJson({
      kind: 'mystery',
      params: {
        table: [
          { kind: 'coins', amount: 5, weight: 3 },
          { kind: 'coins', amount: 50, weight: 1 },
        ],
      },
    });
    expect(w.odds.map((o) => o.chance)).toEqual([0.75, 0.25]);
    const p = MysteryOdd.listFrom([
      { kind: 'a', chance: 90 },
      { kind: 'b', chance: 10 },
    ]);
    expect(p[0]!.chance).toBeCloseTo(0.9, 9);
    expect(p[1]!.chance).toBeCloseTo(0.1, 9);
    expect(MysteryOdd.listFrom('nope')).toHaveLength(0);
    expect(RewardSpec.fromJson({ kind: 'coins' }).odds).toHaveLength(0);
  });
});

describe('history and recap', () => {
  it('history days, levels and today', () => {
    const h = StreakHistory.fromJson(historyJson());
    expect(h.days).toHaveLength(14);
    expect(h.days[0]!.day).toEqual(new Date(Date.UTC(2026, 10, 1)));
    expect(h.today!.day).toEqual(new Date(Date.UTC(2026, 10, 14)));
    expect(h.today!.dayKey).toBe('2026-11-14');
    expect(h.days.filter((d) => d.frozen)).toHaveLength(1);
    expect([0, 1, 2, 3, 4, 5, 6, 9].map((n) => h.levelOf(n))).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
    expect(h.withTodayCount(5).today!.count).toBe(5);
    expect(HistoryDay.fromJson({ day: 'bad' }).day).toEqual(new Date(Date.UTC(1970, 0, 1)));
    expect(formatDay(new Date(2026, 2, 7, 23))).toBe('2026-03-07');
  });

  it('recap tolerates badge strings and objects', () => {
    const r = Recap.fromJson({
      days_active: 5,
      events: [{ type: 'chapter_read', count: 9 }],
      grants: [{ kind: 'coins', amount: 120, count: 4 }],
      best_streak: 6,
      badges: ['bookworm', { badge: 'night_owl', program: 'owl' }, 3],
    });
    expect(r.daysActive).toBe(5);
    expect(r.events[0]!.count).toBe(9);
    expect(r.grants[0]!.spec.amount).toBe(120);
    expect(r.badges.map((b) => b.badge)).toEqual(['bookworm', 'night_owl']);
  });
});

describe('quiz shapes', () => {
  it('question, media and window', () => {
    const q = QuizQuestion.fromJson(questionJson(1, { kind: 'listen', media: { sound_id: 'bird' }, limitS: 12 }));
    expect([q.index, q.total]).toEqual([1, 3]);
    expect(q.kind).toBe(QuizQuestionKind.listen);
    expect(q.soundId).toBe('bird');
    expect(q.windowMs).toBe(12000);
    expect(q.endsAt).toEqual(plus(serverNow, 12000));
    const p = QuizQuestion.fromJson({
      question: { kind: 'picture', media: { image: 'https://x/y.png' } },
      served_at: iso(serverNow),
      ends_at: iso(plus(serverNow, 8000)),
    });
    expect(p.imageUrl).toBe('https://x/y.png');
    expect(p.windowMs).toBe(8000);
  });

  it('answer result and last result', () => {
    const a = QuizAnswerResult.fromJson({ correct: true, answer: 2, explanation: '', score: 3, finished: true, grants: [grant('q1')] });
    expect(a.explanation).toBeNull();
    expect(a.grants[0]!.id).toBe('q1');
    expect(a.asTimedOut().timedOut).toBe(true);
    expect(a.asTimedOut().correct).toBe(false);
    expect(a.asTimedOut().score).toBe(3);
    const s = QuizState.fromJson(quizStateJson({ state: 'finished', attemptsLeft: 0, lastResult: { score: 2, total: 3, grants: [grant('q1')] } }));
    expect(s.canStart).toBe(false);
    expect(s.lastResult!.score).toBe(2);
  });
});

it('new reasons are known', () => {
  for (const r of ['empty', 'bad_code', 'own_code', 'too_many_friends', 'already_friends', 'bad_link', 'no_pending_post', 'no_attempts_left', 'not_enough_questions', 'no_attempt']) {
    expect(new RewardsException(r).isKnown).toBe(true);
  }
});
