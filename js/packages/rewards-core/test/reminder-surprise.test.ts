// Port of packages/rewards_kit/test/reminder_test.dart and surprise_models_test.dart.
import { describe, expect, it } from 'vitest';
import { defaultRewardsTexts, formatChance, RewardGrant, RewardSpec, RewardsState, rewardsTexts, streakReminderAt, StreakState, SurpriseOdd } from '../src';
import { grant, sampleState, type Json } from './fakes';

const H = 3600 * 1000;
const local = (y: number, m: number, d: number, h = 0, min = 0): Date => new Date(y, m - 1, d, h, min);
const streak = (o: { done?: boolean; current?: number; endsLocal?: Date } = {}): StreakState =>
  new StreakState({ program: 'daily', current: o.current ?? 3, todayDone: o.done ?? false, endsTodayAt: o.endsLocal ?? local(2026, 11, 15) });

describe('streakReminderAt', () => {
  const morning = local(2026, 11, 14, 8);
  it('3 hours before the end of the day', () => expect(streakReminderAt(streak(), { now: morning })).toEqual(local(2026, 11, 14, 21)));
  it('null when done today, no streak, no deadline, or the time has passed', () => {
    expect(streakReminderAt(streak({ done: true }), { now: morning })).toBeNull();
    expect(streakReminderAt(streak({ current: 0 }), { now: morning })).toBeNull();
    expect(streakReminderAt(new StreakState({ program: 'd', current: 2 }), { now: morning })).toBeNull();
    expect(streakReminderAt(streak(), { now: local(2026, 11, 14, 21, 30) })).toBeNull();
  });
  it('inside quiet hours it moves earlier, to the minute before they start', () => {
    expect(streakReminderAt(streak(), { now: morning, beforeMs: H })).toEqual(local(2026, 11, 14, 21, 59));
    expect(streakReminderAt(streak({ endsLocal: local(2026, 11, 15, 4) }), { now: morning })).toEqual(local(2026, 11, 14, 21, 59));
    expect(streakReminderAt(streak(), { now: local(2026, 11, 14, 22, 10), beforeMs: H })).toBeNull();
  });
  it('custom and disabled quiet hours', () => {
    expect(streakReminderAt(streak(), { now: morning, quietFromHour: 20, quietToHour: 8 })).toEqual(local(2026, 11, 14, 19, 59));
    expect(streakReminderAt(streak(), { now: morning, beforeMs: H, quietFromHour: 0, quietToHour: 0 })).toEqual(local(2026, 11, 14, 23));
    expect(streakReminderAt(streak({ endsLocal: local(2026, 11, 14, 17) }), { now: morning, quietFromHour: 13, quietToHour: 15 })).toEqual(
      local(2026, 11, 14, 12, 59),
    );
  });
});

const spec = (params: Json, kind = 'coins', amount = 50): RewardSpec => RewardSpec.fromJson({ kind, amount, params });
const grantWith = (params: Json, kind = 'coins', amount = 23): RewardGrant => RewardGrant.fromJson({ id: 'g', program: 'reader', kind, amount, params });

describe('RewardSpec chance and amountRange', () => {
  it('read from params', () => {
    const s = spec({ chance: 0.1, amount_range: [5, 50] });
    expect(s.chance).toBe(0.1);
    expect(s.amountRange).toEqual([5, 50]);
    expect(spec({ chance: '0.25', amount_range: ['5', 50.0] }).chance).toBe(0.25);
    expect(spec({ amount_range: ['5', 50.0] }).amountRange).toEqual([5, 50]);
    expect(spec({ chance: 1 }).chance).toBe(1);
  });
  it('bad values are null, never a throw', () => {
    for (const bad of [null, 0, -0.2, 1.5, 10, 'x', Number.NaN, true, [], {}]) expect(spec({ chance: bad }).chance).toBeNull();
    for (const bad of [null, 5, 'x', [5], [5, 50, 60], [50, 5], [-1, 5], [5.5, 10], ['a', 10], [5, Infinity], { min: 5 }]) {
      expect(spec({ amount_range: bad }).amountRange).toBeNull();
    }
    expect(spec({}).chance).toBeNull();
    expect(spec({}).amountRange).toBeNull();
    expect(spec({ amount_range: [7, 7] }).amountRange).toEqual([7, 7]);
  });
  it('next_reward in the state carries them as they are', () => {
    const s = sampleState();
    (s['streaks'] as Json[])[0]!['next_reward'] = { threshold: 7, kind: 'coins', amount: 50, params: { chance: 0.5, amount_range: [10, 50] } };
    const r = RewardsState.fromJson(s).streak('daily')!.nextReward!;
    expect(r.chance).toBe(0.5);
    expect(r.amountRange).toEqual([10, 50]);
  });
});

describe('RewardGrant reveal flags', () => {
  it('surprise, mystery and range', () => {
    const g = grantWith({ surprise: true, range: [5, 50] });
    expect(g.isSurprise).toBe(true);
    expect(g.range).toEqual([5, 50]);
    expect(g.shouldReveal).toBe(true);
    expect(grantWith({ mystery: true }).isMystery).toBe(true);
    expect(grantWith({ mystery: 'gold_table' }).shouldReveal).toBe(true);
    expect(grantWith({ range: [1, 3] }).shouldReveal).toBe(true);
    expect(grantWith({ surprise: 'true' }).isSurprise).toBe(true);
  });
  it('plain grants and false / null flags do not reveal', () => {
    expect(grantWith({}).shouldReveal).toBe(false);
    expect(grantWith({ surprise: false, mystery: null, range: null }).shouldReveal).toBe(false);
    expect(grantWith({ mystery: false }).isMystery).toBe(false);
    expect(grantWith({ range: 'oops' }).range).toBeNull();
    expect(RewardGrant.fromJson(grant('a')).shouldReveal).toBe(false);
  });
});

describe('RewardsState.surprises', () => {
  it('parsed from the top level; chance / range also from params; bad chance skipped', () => {
    const s = {
      ...sampleState(),
      surprises: [
        { program: 'reader', kind: 'coins', amount: 50, amount_range: [5, 50], chance: 0.1, params: { note: 'x' } },
        { program: 'daily', kind: 'minutes', amount: 10, params: { chance: 0.35 } },
        { program: 'bad', kind: 'coins', amount: 5, chance: 3 },
        'not an object',
      ],
    };
    const state = RewardsState.fromJson(s);
    expect(state.surprises).toHaveLength(2);
    const a = state.surprises[0]!;
    expect([a.program, a.kind, a.amount, a.amountRange, a.chance]).toEqual(['reader', 'coins', 50, [5, 50], 0.1]);
    expect(a.spec.amountRange).toEqual([5, 50]);
    expect(a.spec.chance).toBe(0.1);
    expect(a.spec.params['note']).toBe('x');
    expect(state.surprises[1]!.chance).toBe(0.35);
    expect(state.surprisesOf('daily')[0]!.kind).toBe('minutes');
    expect(state.surprisesOf('nope')).toHaveLength(0);
    expect(state.copyWith({}).surprises).toHaveLength(2);
  });
  it('missing or not a list is empty', () => {
    expect(RewardsState.fromJson(sampleState()).surprises).toHaveLength(0);
    expect(RewardsState.fromJson({ ...sampleState(), surprises: { x: 1 } }).surprises).toHaveLength(0);
    expect(RewardsState.fromJson({ ...sampleState(), surprises: 'x' }).surprises).toHaveLength(0);
  });
});

describe('surprise texts', () => {
  const x = defaultRewardsTexts;
  it('a range reads "5–50 coins"', () => {
    expect(x.reward(spec({ amount_range: [5, 50] }))).toBe('5–50 coins');
    expect(x.reward(spec({ amount_range: [1, 3] }, 'entitlement_days', 3))).toBe('1–3 days of Premium');
    expect(x.reward(spec({ amount_range: [5, 50] }, 'rc_currency'))).toBe('5–50 coins');
    expect(x.reward(spec({ amount_range: 'bad' }))).toBe('50 coins');
    expect(x.reward(grantWith({ range: [5, 50] }).spec)).toBe('23 coins');
  });
  it('chance: "1 in N" near a whole number, else a percentage', () => {
    expect(formatChance(0.1)).toBe('1 in 10');
    expect(formatChance(1 / 3)).toBe('1 in 3');
    expect(formatChance(0.5)).toBe('1 in 2');
    expect(formatChance(0.35)).toBe('35 %');
    expect(formatChance(0.3)).toBe('30 %');
    expect(formatChance(0.025)).toBe('1 in 40');
    expect(formatChance(0.015)).toBe('1.5 %');
    expect(formatChance(1)).toBe('100 %');
  });
  it('odds line and reveal strings; overridable', () => {
    const odd = new SurpriseOdd({ program: 'reader', kind: 'coins', amount: 50, amountRange: [5, 50], chance: 0.1 });
    expect(x.surpriseOdds(odd)).toBe('1 in 10 chance of 5–50 coins');
    expect(x.surpriseOdds(new SurpriseOdd({ program: 'p', kind: 'minutes', amount: 10, chance: 0.35 }))).toBe('35 % chance of 10 minutes');
    expect([x.reveal.title, x.reveal.tapToOpen, x.reveal.open, x.reveal.nice]).toEqual(['Surprise!', 'Tap to open', 'Open', 'Nice!']);
    expect(x.reveal.youGot('23 coins')).toBe('You got 23 coins');
    const y = rewardsTexts({ reveal: { title: 'Bonus!', chance: (c) => `${Math.round(c * 100)} in 100`, odds: (c, r) => `${r}: ${c}` } });
    expect(y.reveal.title).toBe('Bonus!');
    expect(y.surpriseOdds(odd)).toBe('5–50 coins: 10 in 100');
  });
});
