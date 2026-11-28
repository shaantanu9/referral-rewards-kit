// Port of the non-widget part of packages/rewards_kit/test/league_test.dart.
import { describe, expect, it } from 'vitest';
import { LeagueState, LeagueTierChange, leagueTierChangeFromWire, ordinalSuffix, ProgramKind, programKindFromWire, RewardsClient, defaultRewardsTexts, type RewardsEvent } from '../src';
import { controllerOn, DAY, FakeRpc, HOUR, iso, plus, sampleState, serverNow, type Json } from './fakes';

const sampleLeague = (o: { joined?: boolean; live?: boolean; lastWeek?: Json | null } = {}): Json => {
  const joined = o.joined ?? true;
  return {
    program: 'weekly',
    live: o.live ?? true,
    joined,
    tier: 0,
    tier_name: 'Bronze',
    tiers: ['Bronze', 'Silver', '', 7],
    week: '2026-11-09',
    starts_at: '2026-11-09T00:00:00+00:00',
    ends_at: iso(plus(serverNow, 2 * DAY + 3 * HOUR)),
    server_time: iso(serverNow),
    group_size: 20,
    promote: 3,
    demote: 2,
    min_score: 1,
    rank: joined ? 2 : null,
    score: joined ? 5 : 0,
    size: joined ? 4 : 0,
    members: joined
      ? [
          { rank: 1, name: 'Asha', score: 9, me: false },
          { rank: 2, name: 'Ravi', score: 5, me: true },
          { rank: 2, name: '  ', score: 5, me: false },
          { rank: null, name: 'Mo', score: 0, me: false },
        ]
      : [],
    rewards: [
      { threshold: 1, kind: 'coins', amount: 100, params: {} },
      { threshold: 3, kind: 'coins', amount: 30, params: {} },
    ],
    last_week: o.lastWeek ?? null,
  };
};

const leagueRpc = (joined = true): FakeRpc => {
  let j = joined;
  return new FakeRpc({
    rewards_league: () => sampleLeague({ joined: j }),
    rewards_league_join: () => ((j = true), sampleLeague()),
    rewards_league_leave: () => ((j = false), sampleLeague({ joined: false })),
  });
};

describe('LeagueState', () => {
  it('parses the board; empty names are null; bad tiers are skipped; never an id', () => {
    const l = LeagueState.fromJson(sampleLeague({ lastWeek: { week: '2026-11-02', rank: 1, score: 12, tier_change: 'up' } }));
    expect(l.program).toBe('weekly');
    expect(l.tiers).toEqual(['Bronze', 'Silver']);
    expect(l.week).toEqual(new Date(Date.UTC(2026, 10, 9)));
    expect(l.endsAt).toEqual(plus(serverNow, 2 * DAY + 3 * HOUR));
    expect(l.members.map((m) => m.name)).toEqual(['Asha', 'Ravi', null, 'Mo']);
    expect(l.members[3]!.rank).toBeNull();
    expect(l.members.find((m) => m.me)!.score).toBe(5);
    expect(l.rewards.map((r) => r.threshold)).toEqual([1, 3]);
    expect(l.canMoveUp).toBe(true);
    expect(l.nextTierName).toBe('Silver');
    expect(l.lastWeek!.tierChange).toBe(LeagueTierChange.up);
    expect(l.lastWeek!.week).toEqual(new Date(Date.UTC(2026, 10, 2)));
  });

  it('tolerates a minimal answer', () => {
    const l = LeagueState.fromJson({ program: 'p' });
    expect([l.joined, l.live, l.members.length, l.lastWeek, l.canMoveUp]).toEqual([false, true, 0, null, false]);
    expect(leagueTierChangeFromWire('sideways')).toBe(LeagueTierChange.same);
    expect(programKindFromWire('league')).toBe(ProgramKind.league);
  });

  it('ordinals and league texts', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map((n) => `${n}${ordinalSuffix(n)}`)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st',
      '111th',
    ]);
    const t = defaultRewardsTexts.leagues;
    expect(t.lastWeek(2, 12)).toBe('Last week: 2nd with 12 points');
    expect(t.lastWeek(null, 1)).toBe('Last week: 1 point');
    expect(t.movesUp(3, 'Silver')).toBe('Top 3 move up to Silver');
    expect(t.placeReward(1, '100 coins')).toBe('1st: 100 coins');
    expect(t.placeReward(3, '30 coins')).toBe('Top 3: 30 coins');
  });
});

describe('client and controller', () => {
  it('calls the three RPCs with the program and reports join / leave without names', async () => {
    const events: RewardsEvent[] = [];
    const rpc = leagueRpc(false);
    const c = new RewardsClient({ rpc: rpc.call, onEvent: (e) => events.push(e) });
    expect((await c.league('weekly')).joined).toBe(false);
    expect((await c.joinLeague('weekly')).joined).toBe(true);
    expect((await c.leaveLeague('weekly')).joined).toBe(false);
    expect(rpc.calls.map((x) => x[0])).toEqual(['rewards_league', 'rewards_league_join', 'rewards_league_leave']);
    expect(rpc.calls.every((x) => Object.keys(x[1]).length === 1 && x[1]['program'] === 'weekly')).toBe(true);
    expect(events.map((e) => e.wireName)).toEqual(['rewards_league_joined', 'rewards_league_left']);
    expect(events.every((e) => Object.keys(e.props).sort().join() === 'program,result')).toBe(true);
  });

  it('a refusal is a reason, and the cached league stays', async () => {
    const c = controllerOn(
      new FakeRpc({
        rewards_league: () => sampleLeague({ joined: false }),
        rewards_league_join: () => {
          throw new Error('rewards: unknown_program');
        },
      }),
    );
    expect(await c.loadLeague('weekly')).toBeNull();
    expect(await c.joinLeague('weekly')).toBe('unknown_program');
    expect(c.league('weekly')!.joined).toBe(false);
    expect(c.getSnapshot().leagues['weekly']!.joined).toBe(false);
  });

  it('a newly closed week with rewards reloads the state once', async () => {
    let states = 0;
    const rpc = new FakeRpc({
      rewards_state: () => (states++, sampleState()),
      rewards_league: () =>
        sampleLeague({
          lastWeek: {
            week: '2026-11-02',
            rank: 1,
            score: 9,
            tier_change: 'up',
            grants: [{ id: 'g1', program: 'weekly', kind: 'coins', amount: 100, state: 'granted' }],
          },
        }),
    });
    const c = controllerOn(rpc);
    await c.refresh();
    await c.loadLeague('weekly');
    await c.loadLeague('weekly');
    expect(states).toBe(2);
  });
});
