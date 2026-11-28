// Port of packages/rewards_kit/test/fakes.dart, fakes_v2.dart and fakes_followups.dart.
import { RewardsClient, RewardsController, ServerClock, type RewardsEvent } from '../src';

type Handler = (p: Record<string, unknown>) => unknown;

/** Scripted RPC: each function answers from its handler; every call is recorded. */
export class FakeRpc {
  readonly calls: Array<[string, Record<string, unknown>]> = [];
  constructor(readonly handlers: Record<string, Handler> = {}) {}
  readonly call = async (fn: string, params: Record<string, unknown>): Promise<unknown> => {
    this.calls.push([fn, params]);
    const h = this.handlers[fn];
    if (!h) throw new Error(`no fake for ${fn}`);
    return h(params);
  };
  called(fn: string): Record<string, unknown>[] {
    return this.calls.filter((c) => c[0] === fn).map((c) => c[1]);
  }
}

export const serverNow = new Date(Date.UTC(2026, 10, 14, 10));
export const iso = (d: Date): string => d.toISOString();
export const plus = (d: Date, ms: number): Date => new Date(d.getTime() + ms);
export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export type Json = Record<string, unknown>;

/** The ADR 0002 §11 example state, with every 0.1 program kind live. */
export function sampleState(o: { enabled?: boolean; offerState?: string; socialState?: string; inbox?: Json[]; todayDone?: boolean } = {}): Json {
  const { enabled = true, offerState = 'active', socialState = 'none', inbox = [], todayDone = false } = o;
  return {
    enabled,
    server_time: iso(serverNow),
    programs: [
      { key: 'daily', kind: 'streak', starts_at: null, ends_at: null, public: {} },
      { key: 'invite3', kind: 'milestone', public: { title: 'Invite 3 friends' } },
      { key: 'welcome', kind: 'offer', public: {} },
      { key: 'ig_tag', kind: 'social_tag', public: {} },
    ],
    streaks: [
      {
        program: 'daily',
        current: 3,
        longest: 5,
        today_done: todayDone,
        freezes: 1,
        ends_today_at: iso(plus(serverNow, 2 * HOUR)),
        breaks_at: iso(plus(serverNow, 2 * DAY)),
        next_reward: { threshold: 7, kind: 'coins', amount: 50, params: {} },
      },
    ],
    milestones: [{ program: 'invite3', count: 1, next_reward: { threshold: 3, kind: 'badge', amount: 1, params: { badge: 'connector' } } }],
    offers: [
      {
        program: 'welcome',
        state: offerState,
        started_at: iso(plus(serverNow, -HOUR)),
        ends_at: iso(plus(serverNow, 30 * MIN)),
        stock_left: 12,
        rewards: [{ kind: 'coins', amount: 100, params: {} }],
      },
    ],
    social: [
      {
        program: 'ig_tag',
        platform: 'instagram',
        account: 'myapp',
        state: socialState,
        code: socialState === 'none' ? null : 'MYAPP-K7Q2HX',
        expires_at: socialState === 'none' ? null : iso(plus(serverNow, 7 * DAY)),
        rewards: [{ kind: 'coins', amount: 200, params: {} }],
      },
    ],
    inbox,
    badges: [{ badge: 'early', program: 'daily', granted_at: iso(serverNow) }],
  };
}

export const grant = (id: string, o: { state?: string; kind?: string; amount?: number } = {}): Json => ({
  id,
  program: 'daily',
  kind: o.kind ?? 'coins',
  amount: o.amount ?? 10,
  params: {},
  state: o.state ?? 'granted',
  created_at: iso(serverNow),
});

/** A controller on [rpc] whose clock reads [serverNow] as device time too (offset zero). */
export function controllerOn(rpc: FakeRpc, o: { events?: RewardsEvent[]; local?: () => Date } = {}): RewardsController {
  const events = o.events;
  return new RewardsController({
    client: new RewardsClient({ rpc: rpc.call, timezone: () => 'Asia/Kolkata', onEvent: events ? (e) => events.push(e) : null }),
    clock: new ServerClock({ local: o.local ?? (() => serverNow) }),
  });
}

export const quizStateJson = (o: { state?: string; attemptsLeft?: number; current?: number; score?: number; lastResult?: Json | null } = {}): Json => ({
  program: 'quiz',
  state: o.state ?? 'not_started',
  day: '2026-11-14',
  ends_at: iso(plus(serverNow, 14 * HOUR)),
  total: 3,
  current: o.current ?? 0,
  score: o.score ?? 0,
  attempts_left: o.attemptsLeft ?? 1,
  last_result: o.lastResult ?? null,
});

/** A served question; kind `choice` by default. */
export function questionJson(index: number, o: { kind?: string; choices?: string[]; media?: Json; servedAt?: Date; limitS?: number } = {}): Json {
  const served = o.servedAt ?? serverNow;
  const limit = o.limitS ?? 10;
  return {
    index,
    total: 3,
    question: { id: `q${index}`, kind: o.kind ?? 'choice', prompt: `Question ${index}?`, choices: o.choices ?? ['Alpha', 'Beta', 'Gamma'], media: o.media ?? {} },
    time_limit_s: limit,
    served_at: iso(served),
    ends_at: iso(plus(served, limit * 1000)),
  };
}

export function historyJson(o: { weeks?: number; dailyGoal?: number } = {}): Json {
  const today = new Date(Date.UTC(2026, 10, 14));
  const n = (o.weeks ?? 2) * 7;
  const days: Json[] = [];
  for (let i = n - 1; i >= 0; i--) days.push({ day: iso(plus(today, -i * DAY)).substring(0, 10), count: i % 4, frozen: i === 5 });
  return { program: 'daily', daily_goal: o.dailyGoal ?? 2, days };
}

/** The 0.1 sample state plus every 0.2 kind (ADR 0002 §18.2, §18.3). */
export function sampleStateV2(o: { windowActive?: boolean; rechargeUnits?: number; quizState?: string; attemptsLeft?: number; friends?: Json[] } = {}): Json {
  const { windowActive = true, rechargeUnits = 2, quizState = 'not_started', attemptsLeft = 1 } = o;
  const s = sampleState();
  s['programs'] = [
    ...(s['programs'] as Json[]),
    { key: 'quiz', kind: 'quiz', public: {} },
    { key: 'daily_quests', kind: 'quest_set', public: { title: 'Today' } },
    { key: 'back', kind: 'comeback', public: {} },
    { key: 'hearts', kind: 'recharge', public: {} },
    { key: 'happy', kind: 'window', public: { title: 'Happy hour' } },
    { key: 'buddies', kind: 'friend_streak', public: {} },
  ];
  Object.assign((s['streaks'] as Json[])[0]!, { daily_goal: 2, today_count: 1, weekly_free_freezes_left: 1 });
  s['quests'] = [
    {
      program: 'daily_quests',
      period: 'daily',
      ends_at: iso(plus(serverNow, 14 * HOUR)),
      done: false,
      tasks: [
        { key: 'read', event: 'chapter_read', count: 3, progress: 1, done: false, rewards: [{ kind: 'coins', amount: 5 }] },
        { key: 'quiz', event: 'quiz_finished', count: 1, progress: 1, done: true, rewards: [] },
      ],
      bonus: [{ kind: 'coins', amount: 20 }],
    },
  ];
  s['recharges'] = [
    { program: 'hearts', units: rechargeUnits, max: 3, every_minutes: 240, next_at: rechargeUnits >= 3 ? null : iso(plus(serverNow, HOUR + 5 * MIN)) },
  ];
  s['windows'] = [
    {
      program: 'happy',
      active: windowActive,
      starts_at: iso(windowActive ? plus(serverNow, -10 * MIN) : plus(serverNow, 2 * HOUR)),
      ends_at: iso(plus(serverNow, (windowActive ? 50 : 180) * MIN)),
    },
  ];
  s['friends'] = o.friends ?? [
    {
      program: 'buddies',
      pair_id: 'p1',
      friend_id: 'u2',
      friend_name: 'Asha',
      current: 4,
      longest: 6,
      today_me: true,
      today_friend: false,
      breaks_at: iso(plus(serverNow, 14 * HOUR)),
      next_reward: { threshold: 7, kind: 'coins', amount: 30 },
    },
  ];
  s['quizzes'] = [quizStateJson({ state: quizState, attemptsLeft })];
  return s;
}

/** One `rewards_followups_plan` item, [hours] from [serverNow]. */
export const planItem = (id: number, hours: number, program = 'inactive2'): Json => ({
  id,
  program,
  at: iso(plus(serverNow, Math.round(hours * 60) * MIN)),
  title: 'App',
  body: 'Your next step is still here.',
  payload: '/app/home',
  group: 'daily',
});

export const planJson = (items: Json[], serverTime?: Date): Json => ({ server_time: iso(serverTime ?? serverNow), plan: items });

export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
