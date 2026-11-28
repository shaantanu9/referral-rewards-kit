// Port of packages/rewards_kit/test/models_test.dart.
import { describe, expect, it } from 'vitest';
import {
  defaultRewardsTexts,
  formatLeft,
  MilestoneState,
  mergeBy,
  OfferState,
  OfferStatus,
  offerStatusFromWire,
  ProgramKind,
  programKindFromWire,
  RewardsFormatException,
  RewardSpec,
  RewardsState,
  rewardsTexts,
  SocialTaskState,
  SocialTaskStatus,
  socialTaskStatusFromWire,
  StreakState,
  TrackResult,
} from '../src';
import { grant, HOUR, sampleState, serverNow, type Json } from './fakes';

describe('RewardsState.fromJson', () => {
  it('reads the whole ADR example', () => {
    const s = RewardsState.fromJson(sampleState({ inbox: [grant('g1')] }));
    expect(s.enabled).toBe(true);
    expect(s.serverTime).toEqual(serverNow);
    expect(s.programs.map((p) => p.kind)).toEqual([ProgramKind.streak, ProgramKind.milestone, ProgramKind.offer, ProgramKind.socialTag]);
    expect(s.program('invite3')!.public['title']).toBe('Invite 3 friends');
    const st = s.streak('daily')!;
    expect([st.current, st.longest, st.freezes]).toEqual([3, 5, 1]);
    expect(st.nextReward!.equals(new RewardSpec({ kind: 'coins', amount: 50, threshold: 7 }))).toBe(true);
    expect(st.daysToNextReward).toBe(4);
    expect(s.milestone('invite3')!.target).toBe(3);
    expect(s.milestone('invite3')!.nextReward!.badge).toBe('connector');
    expect(s.offer('welcome')!.status).toBe(OfferStatus.active);
    expect(s.offer('welcome')!.stockLeft).toBe(12);
    expect(s.socialTask('ig_tag')!.status).toBe(SocialTaskStatus.none);
    expect(s.inbox[0]!.id).toBe('g1');
    expect(s.badges[0]!.badge).toBe('early');
  });

  it('missing lists and fields fall back, never throw', () => {
    const s = RewardsState.fromJson({ enabled: true });
    expect(s.programs).toHaveLength(0);
    expect(s.inbox).toHaveLength(0);
    const st = StreakState.fromJson({ program: 'x' });
    expect([st.current, st.longest, st.freezes]).toEqual([0, 0, 0]);
    expect(st.nextReward).toBeNull();
    expect(st.daysToNextReward).toBeNull();
  });

  it('a non-object state is a format error', () => {
    expect(() => RewardsState.fromJson([1])).toThrow(RewardsFormatException);
  });

  it('unknown kinds and states map to unknown', () => {
    expect(programKindFromWire('quest')).toBe(ProgramKind.unknown);
    expect(offerStatusFromWire('paused')).toBe(OfferStatus.unknown);
    expect(socialTaskStatusFromWire('appealed')).toBe(SocialTaskStatus.unknown);
    expect(socialTaskStatusFromWire(null)).toBe(SocialTaskStatus.unknown);
    expect(SocialTaskState.fromJson({ program: 'x' }).status).toBe(SocialTaskStatus.none);
  });

  it('times without a zone are read as UTC', () => {
    expect(OfferState.fromJson({ program: 'x', ends_at: '2026-11-14T12:00:00' }).endsAt).toEqual(new Date(Date.UTC(2026, 10, 14, 12)));
    expect(OfferState.fromJson({ program: 'x', ends_at: '2026-11-14T12:00:00+05:30' }).endsAt).toEqual(new Date(Date.UTC(2026, 10, 14, 6, 30)));
    expect(OfferState.fromJson({ program: 'x', ends_at: '2026-11-14 12:00:00+00' }).endsAt).toEqual(new Date(Date.UTC(2026, 10, 14, 12)));
  });

  it('amounts may arrive as strings (numeric from Postgres)', () => {
    expect(RewardSpec.fromJson({ kind: 'coins', amount: '12.5' }).amount).toBe(12.5);
  });
});

it('MilestoneState.progress: fraction of the target, 1 when all earned', () => {
  expect(MilestoneState.fromJson({ program: 'm', count: 1, next_reward: { threshold: 4, kind: 'c' } }).progress).toBe(0.25);
  expect(new MilestoneState({ program: 'm', count: 9 }).progress).toBe(1);
});

describe('StreakState.atRisk', () => {
  const s = StreakState.fromJson((sampleState()['streaks'] as Json[])[0]!);
  it('not done today and close to midnight', () => {
    expect(s.atRisk(serverNow)).toBe(true);
    expect(s.atRisk(serverNow, HOUR)).toBe(false);
  });
  it('never at risk when done or no streak', () => {
    expect(new StreakState({ program: 'd', current: 3, todayDone: true, endsTodayAt: serverNow }).atRisk(serverNow)).toBe(false);
    expect(new StreakState({ program: 'd', current: 0, endsTodayAt: serverNow }).atRisk(serverNow)).toBe(false);
  });
});

describe('TrackResult', () => {
  it('defaults enabled true, reads grants and streaks', () => {
    const r = TrackResult.fromJson({ duplicate: false, grants: [grant('g1')], streaks: [{ program: 'daily', current: 4 }] });
    expect(r.enabled).toBe(true);
    expect(r.grants[0]!.id).toBe('g1');
    expect(r.streaks[0]!.current).toBe(4);
  });
  it('disabled engine', () => expect(TrackResult.fromJson({ enabled: false }).enabled).toBe(false));
});

it('mergeBy replaces by key, keeps order, appends new', () => {
  expect(mergeBy([1, 2, 3], [20, 40], (x) => `${x % 10 === 0 ? x / 10 : x}`)).toEqual([1, 20, 3, 40]);
});

describe('texts', () => {
  const t = defaultRewardsTexts;
  it('reward kinds', () => {
    expect(t.reward(new RewardSpec({ kind: 'entitlement_days', amount: 5 }))).toBe('5 days of Premium');
    expect(t.reward(new RewardSpec({ kind: 'entitlement_days', amount: 1 }))).toBe('1 day of Premium');
    expect(t.reward(new RewardSpec({ kind: 'minutes', amount: 30 }))).toBe('30 minutes');
    expect(t.reward(new RewardSpec({ kind: 'badge', amount: 1, params: { badge: 'three_day' } }))).toBe('"Three day" badge');
    expect(t.reward(new RewardSpec({ kind: 'streak_freeze', amount: 2 }))).toBe('2 streak freezes');
    expect(t.reward(new RewardSpec({ kind: 'bonus_coins', amount: 2.5 }))).toBe('2.5 bonus coins');
  });
  it('every string can be replaced', () => {
    const x = rewardsTexts({ reward: (r) => `${r.amount} gems`, claim: 'Grab it', error: (r) => `E:${r}` });
    expect(x.reward(new RewardSpec({ kind: 'coins', amount: 3 }))).toBe('3 gems');
    expect(x.rewards([new RewardSpec({ kind: 'coins', amount: 3 }), new RewardSpec({ kind: 'coins', amount: 4 })])).toBe('3 gems + 4 gems');
    expect(x.claim).toBe('Grab it');
    expect(x.error('sold_out')).toBe('E:sold_out');
  });
  it('error lines follow overridden strings', () => {
    const x = rewardsTexts({ soldOut: 'Gone!', quiz: { comeBack: 'Tomorrow' } });
    expect(x.error('sold_out')).toBe('Gone!');
    expect(x.error('no_attempts_left')).toBe('Tomorrow');
    expect(x.quiz.start).toBe('Start');
    expect(x.error('whatever')).toBe('Something went wrong. Try again.');
  });
  it('formatLeft', () => {
    expect(formatLeft((2 * 24 * 60 + 4 * 60 + 9) * 60000)).toBe('2d 4h');
    expect(formatLeft((3 * 60 + 5) * 60000)).toBe('3h 05m');
    expect(formatLeft((4 * 60 + 9) * 1000)).toBe('4m 09s');
    expect(formatLeft(9000)).toBe('9s');
    expect(formatLeft(-5000)).toBe('0s');
  });
});
