// Port of packages/rewards_kit/test/fair_play_client_test.dart, fair_play_models_test.dart,
// server_fixtures_0_7_test.dart (the real SQL JSON) and followup_models_test.dart.
import { describe, expect, it } from 'vitest';
import {
  FollowupPlan,
  FollowupPrefs,
  formatReminderTime,
  MilestoneLevel,
  MilestoneState,
  parseReminderTime,
  RewardGrant,
  RewardsChoices,
  RewardsClient,
  RewardSpec,
  RewardsState,
  StreakRepair,
  StreakState,
  TrackResult,
} from '../src';
import prefsFx from '../../../../packages/rewards_kit/test/fixtures/server_0_7_prefs.json';
import stateFx from '../../../../packages/rewards_kit/test/fixtures/server_0_7_state.json';
import trackFx from '../../../../packages/rewards_kit/test/fixtures/server_0_7_track.json';
import { controllerOn, DAY, FakeRpc, HOUR, iso, planItem, planJson, plus, sampleState, serverNow } from './fakes';

const choices = (o: { streaksOff?: boolean; surprisesOff?: boolean; timersOff?: boolean }): RewardsChoices => new RewardsChoices(o);

describe('fair play client', () => {
  it('the prefs setter sends the three choices as booleans and reads them back', async () => {
    const rpc = new FakeRpc({ rewards_followup_prefs: (p) => ({ notifications_off: false, ...(p['patch'] as object) }) });
    const p = await new RewardsClient({ rpc: rpc.call }).followupPrefs({ streaks_off: true, surprises_off: 'true', timers_off: false, x: 1 });
    expect(rpc.calls[0]![1]).toEqual({ patch: { streaks_off: true, surprises_off: true, timers_off: false } });
    expect(p.choices.equals(choices({ streaksOff: true, surprisesOff: true }))).toBe(true);
  });

  it('controller.applyChoices updates the state at once and reloads', async () => {
    let hidden = false;
    const rpc = new FakeRpc({ rewards_state: () => ({ ...sampleState(), choices: { streaks_off: hidden } }) });
    const c = controllerOn(rpc);
    await c.refresh();
    expect(c.state.choices.streaksOff).toBe(false);
    hidden = true;
    const done = c.applyChoices(choices({ streaksOff: true }));
    expect(c.state.choices.streaksOff).toBe(true);
    await done;
    expect(rpc.called('rewards_state')).toHaveLength(2);
    await c.applyChoices(choices({ streaksOff: true }));
    expect(rpc.called('rewards_state')).toHaveLength(2);
  });
});

describe('RewardsChoices', () => {
  it('rewards_state choices are read; missing means all on', () => {
    const s = RewardsState.fromJson({ enabled: true, choices: { streaks_off: true, surprises_off: false, timers_off: true } });
    expect(s.choices.equals(choices({ streaksOff: true, timersOff: true }))).toBe(true);
    expect(RewardsState.fromJson({ enabled: true }).choices.equals(RewardsChoices.none)).toBe(true);
    expect(RewardsState.fromJson({ enabled: true, choices: 'bad' }).choices.equals(RewardsChoices.none)).toBe(true);
    expect(choices({ timersOff: true }).toJson()).toEqual({ streaks_off: false, surprises_off: false, timers_off: true });
  });

  it('follow-up prefs carry the three choices and patch them', () => {
    const p = FollowupPrefs.fromJson({ notifications_off: false, surprises_off: true });
    expect(p.choices.equals(choices({ surprisesOff: true }))).toBe(true);
    expect(FollowupPrefs.fromJson({}).choices.equals(RewardsChoices.none)).toBe(true);
    const q = p.patched({ streaks_off: true, surprises_off: false });
    expect(q.choices.equals(choices({ streaksOff: true }))).toBe(true);
    expect(q.equals(p)).toBe(false);
    for (const k of RewardsChoices.keys) expect(FollowupPrefs.keys.has(k)).toBe(true);
  });
});

describe('StreakState 0.7', () => {
  it('reads hidden, repair, repaired_at, best_day_count, record_today', () => {
    const s = StreakState.fromJson({
      program: 'daily',
      current: 1,
      hidden: true,
      repair: { restores_to: 20, until: iso(plus(serverNow, 5 * HOUR)), needed: 2, done: 1 },
      repaired_at: iso(plus(serverNow, -HOUR)),
      best_day_count: 4,
      record_today: true,
    });
    expect(s.hidden).toBe(true);
    expect(s.repair!.restoresTo).toBe(20);
    expect(s.repair!.until).toEqual(plus(serverNow, 5 * HOUR));
    expect(s.repair!.left).toBe(1);
    expect(s.repairedAt).toEqual(plus(serverNow, -HOUR));
    expect(s.repairedRecently(serverNow)).toBe(true);
    expect(s.repairedRecently(plus(serverNow, 2 * DAY))).toBe(false);
    expect(s.bestDayCount).toBe(4);
    expect(s.recordToday).toBe(true);
  });
  it('an older server: no hidden, no repair, no record', () => {
    const s = StreakState.fromJson({ program: 'daily', current: 3 });
    expect([s.hidden, s.repair, s.repairedAt, s.repairedRecently(serverNow), s.bestDayCount, s.recordToday]).toEqual([false, null, null, false, 0, false]);
  });
  it('a malformed repair is null; done above needed leaves 0', () => {
    expect(StreakState.fromJson({ program: 'd', repair: 'x' }).repair).toBeNull();
    expect(StreakState.fromJson({ program: 'd', repair: {} }).repair).toBeNull();
    const r = StreakRepair.fromJson({ restores_to: 9, needed: 2, done: 5 })!;
    expect(r.left).toBe(0);
    expect(r.until).toBeNull();
  });
});

describe('MilestoneState 0.7', () => {
  it('reads head_start and level', () => {
    const m = MilestoneState.fromJson({
      program: 'read',
      count: 5,
      head_start: 2,
      level: { number: 3, name: 'Explorer', at: 4, next_at: 8 },
      next_reward: { threshold: 10, kind: 'coins', amount: 5 },
    });
    expect(m.headStart).toBe(2);
    expect([m.level!.number, m.level!.name, m.level!.at, m.level!.nextAt, m.level!.isTop]).toEqual([3, 'Explorer', 4, 8, false]);
    expect(m.level!.progress(m.count)).toBe(0.25);
  });
  it('an older server: no head start, no level', () => {
    const m = MilestoneState.fromJson({ program: 'read', count: 1 });
    expect(m.headStart).toBe(0);
    expect(m.level).toBeNull();
  });
  it('the top level has no next; a blank name is null; a bad level is null', () => {
    const top = MilestoneLevel.fromJson({ number: 5, name: ' ', at: 50, next_at: null })!;
    expect(top.isTop).toBe(true);
    expect(top.name).toBeNull();
    expect(top.progress(60)).toBe(1);
    expect(MilestoneLevel.fromJson({ name: 'x' })).toBeNull();
    expect(MilestoneState.fromJson({ program: 'p', head_start: -3 }).headStart).toBe(0);
  });
});

describe('fixed rewards', () => {
  it('a fixed grant is never revealed as a surprise', () => {
    const g = RewardGrant.fromJson({ id: 'g1', program: 'daily', kind: 'coins', amount: 25, params: { range: [0, 50], fixed: true } });
    expect(g.isFixed).toBe(true);
    expect(g.shouldReveal).toBe(false);
    const old = RewardGrant.fromJson({ id: 'g2', program: 'daily', kind: 'coins', params: { surprise: true } });
    expect(old.isFixed).toBe(false);
    expect(old.shouldReveal).toBe(true);
  });
  it('RewardSpec.fixed: a mystery gives its most likely entry, a range its midpoint', () => {
    const mystery = RewardSpec.fromJson({
      threshold: 7,
      kind: 'mystery',
      odds: [
        { kind: 'coins', amount: 10, chance: 0.7 },
        { kind: 'coins', amount: 100, chance: 0.3 },
      ],
    });
    expect([mystery.fixed.kind, mystery.fixed.amount, mystery.fixed.threshold]).toEqual(['coins', 10, 7]);
    const range = RewardSpec.fromJson({ kind: 'coins', amount: 50, params: { amount_range: [5, 50] } });
    expect(range.fixed.amount).toBe(27);
    expect(range.fixed.amountRange).toBeNull();
    const plain = new RewardSpec({ kind: 'coins', amount: 3 });
    expect(plain.fixed).toBe(plain);
  });
});

describe('the real SQL JSON (packages/rewards_kit/test/fixtures/server_0_7_*.json)', () => {
  it('rewards_state: choices, repair, head start, level, fixed grant', () => {
    const s = RewardsState.fromJson(stateFx);
    expect(s.choices.equals(choices({ surprisesOff: true, timersOff: true }))).toBe(true);
    expect(s.surprises).toHaveLength(0);
    const streak = s.streaks[0]!;
    expect(s.streaks).toHaveLength(1);
    expect(streak.hidden).toBe(false);
    expect([streak.repair!.restoresTo, streak.repair!.needed, streak.repair!.done]).toEqual([21, 2, 1]);
    expect(streak.repair!.until).not.toBeNull();
    const reads = s.milestones.find((m) => m.program === 'reads')!;
    expect([reads.count, reads.headStart]).toEqual([3, 2]);
    expect(s.program('reads')!.public['head_start_label']).toBe('A head start from us');
    const xp = s.milestones.find((m) => m.program === 'xp')!;
    expect([xp.level!.number, xp.level!.name, xp.level!.at, xp.level!.nextAt]).toEqual([1, 'Starter', 20, 60]);
    expect(s.milestones.find((m) => m.program === 'box')!.level).toBeNull();
    expect(s.inbox).toHaveLength(1);
    expect(s.inbox[0]!.isFixed).toBe(true);
    expect(s.inbox[0]!.shouldReveal).toBe(false);
  });
  it('rewards_track: the repaired streak', () => {
    const t = TrackResult.fromJson(trackFx);
    expect(t.streaks[0]!.current).toBe(21);
    expect(t.streaks[0]!.repairedAt).not.toBeNull();
    expect(t.streaks[0]!.repair).toBeNull();
  });
  it('rewards_followup_prefs: the three choices', () => {
    expect(FollowupPrefs.fromJson(prefsFx).choices.equals(choices({ surprisesOff: true, timersOff: true }))).toBe(true);
  });
});

describe('follow-up models', () => {
  it('plan: items parsed, sorted by time, server time read', () => {
    const p = FollowupPlan.fromJson(planJson([planItem(2, 30), planItem(1, 5)]));
    expect(p.serverTime).toEqual(serverNow);
    expect(p.items.map((i) => i.id)).toEqual([1, 2]);
    const i = p.items[0]!;
    expect(i.program).toBe('inactive2');
    expect(i.at).toEqual(plus(serverNow, 5 * HOUR));
    expect([i.title, i.body, i.payload, i.group]).toEqual(['App', 'Your next step is still here.', '/app/home', 'daily']);
  });
  it('plan: bad items are skipped, bad values tolerated, nothing throws', () => {
    const p = FollowupPlan.fromJson({
      server_time: 42,
      plan: [
        'not an object',
        { id: 'x', at: iso(serverNow) },
        { id: 3, at: 'yesterday' },
        { id: 4 },
        { id: '5', at: '2026-11-14T19:00:00', title: null, payload: 7 },
        { id: 6.0, at: '2026-11-14T20:00:00+05:30' },
      ],
    });
    expect(p.serverTime).toBeNull();
    expect(p.items.map((i) => i.id)).toEqual([6, 5]);
    expect(p.items[1]!.at).toEqual(new Date(Date.UTC(2026, 10, 14, 19)));
    expect(p.items[1]!.title).toBe('');
    expect(p.items[1]!.payload).toBe('7');
    expect(p.items[0]!.at).toEqual(new Date(Date.UTC(2026, 10, 14, 14, 30)));
    expect(FollowupPlan.fromJson({ plan: 'nope' }).items).toHaveLength(0);
    expect(FollowupPlan.fromJson({}).items).toHaveLength(0);
  });
  it('prefs: read, "HH:MM" and "HH:MM:SS", bad values are defaults', () => {
    const p = FollowupPrefs.fromJson({ notifications_off: true, emails_off: 'true', reminder_time: '07:30:00' });
    expect(p.notificationsOff).toBe(true);
    expect(p.emailsOff).toBe(true);
    expect(p.reminderTime).toEqual({ hour: 7, minute: 30 });
    expect(FollowupPrefs.fromJson({ reminder_time: '19:05' }).reminderTime).toEqual({ hour: 19, minute: 5 });
    for (const bad of [null, 7, '', '25:00', '12:60', '7pm', '12:00:61', '1900']) expect(parseReminderTime(bad)).toBeNull();
    expect(FollowupPrefs.fromJson({ notifications_off: 1, emails_off: null }).equals(new FollowupPrefs())).toBe(true);
    expect(formatReminderTime({ hour: 7, minute: 5 })).toBe('07:05');
    expect(formatReminderTime(null)).toBeNull();
  });
  it('prefs: patched applies only known keys', () => {
    const p = new FollowupPrefs({ reminderTime: { hour: 19, minute: 0 } });
    const q = p.patched({ notifications_off: true, reminder_time: '08:15', other: 1 });
    expect(q.equals(new FollowupPrefs({ notificationsOff: true, reminderTime: { hour: 8, minute: 15 } }))).toBe(true);
    expect(p.patched({ reminder_time: null }).reminderTime).toBeNull();
    expect(p.patched({ emails_off: true }).emailsOff).toBe(true);
  });
});
