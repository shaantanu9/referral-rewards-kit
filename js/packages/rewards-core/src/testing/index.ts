/**
 * `@myind/rewards-core/testing`: an in-memory stand-in for the rewards engine, so every rewards widget state can be
 * shown in demos, stories and tests with no server. A port of the Flutter example's fake server
 * (packages/rewards_kit/example/lib/fake_server.dart, fake_followups.dart, fake_league.dart), extended to every program
 * kind: streak (daily goal 2, freezes, repair), milestone with levels and a head start, a timed offer with stock, an
 * Instagram task, a 4-question daily quiz, quests, hearts that recharge, a happy-hour window, friend streaks, a
 * surprise bonus, a mystery reward, a weekly league, a recap, and the follow-up plan and choices.
 *
 * Every field is public, and the methods below move the story on ("a friend does today's part", "the week closes"),
 * so a demo can reach any state. Deterministic with a seed.
 */
import { RewardsClient, type RewardsClientOptions } from '../client';
import { ServerClock } from '../clock';
import { RewardsController } from '../controller';
import { RewardsException, RewardsNetworkError, RewardsServerError, RewardsUnavailableException } from '../errors';
import type { FollowupNotifier } from '../followup-scheduler';
import type { RewardsRpc } from '../http-rpc';

type Json = Record<string, unknown>;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (d: Date): string => d.toISOString();
const dayKey = (d: Date): string => d.toISOString().substring(0, 10);
const utcMidnight = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** A small seeded PRNG (mulberry32), so a demo with a seed is the same every run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 31-bit id per (program, day), like the engine's notification ids. */
export function followupIdOf(program: string, at: Date): number {
  const s = `${program}|${dayKey(at)}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h & 0x7fffffff;
}

interface QuizQ {
  kind: string;
  prompt: string;
  choices: string[];
  answer: number;
  explanation?: string;
}

/** Today's quiz: four questions (one true/false with its own labels, one without), 15 s each, 30 coins for 3+. */
export class FakeQuiz {
  static readonly questions: readonly QuizQ[] = [
    { kind: 'choice', prompt: 'Which planet is called the red planet?', choices: ['Venus', 'Mars', 'Jupiter'], answer: 1, explanation: 'Iron oxide dust makes Mars look red.' },
    { kind: 'true_false', prompt: 'The Pacific is the largest ocean.', choices: ['True', 'False'], answer: 0, explanation: 'It covers about a third of the Earth.' },
    { kind: 'odd_one_out', prompt: 'Oak, pine, rose, maple', choices: ['Oak', 'Pine', 'Rose', 'Maple'], answer: 2, explanation: 'A rose is a shrub; the others are trees.' },
    { kind: 'true_false', prompt: 'Sound travels faster than light.', choices: [], answer: 1 },
  ];
  limitSeconds = 15;
  status = 'not_started';
  current = 0;
  score = 0;
  attemptsLeft = 1;
  servedAt: Date | null = null;
  lastResult: Json | null = null;

  state(now: Date, endOfDay: Date): Json {
    return {
      program: 'quiz',
      state: this.status,
      day: dayKey(now),
      ends_at: iso(endOfDay),
      total: FakeQuiz.questions.length,
      current: this.current,
      score: this.score,
      attempts_left: this.attemptsLeft,
      last_result: this.lastResult,
    };
  }

  call(fn: string, p: Json, now: Date, endOfDay: Date): Json {
    switch (fn) {
      case 'rewards_quiz_start':
        if (this.attemptsLeft <= 0) throw new RewardsException('no_attempts_left');
        this.attemptsLeft--;
        this.status = 'in_progress';
        this.current = this.score = 0;
        this.servedAt = null;
        return this.state(now, endOfDay);
      case 'rewards_quiz_question': {
        if (this.status !== 'in_progress') throw new RewardsException('no_attempt');
        const served = (this.servedAt ??= now);
        const q = FakeQuiz.questions[this.current]!;
        return {
          index: this.current,
          total: FakeQuiz.questions.length,
          question: { id: `q${this.current}`, kind: q.kind, prompt: q.prompt, choices: q.choices },
          time_limit_s: this.limitSeconds,
          served_at: iso(served),
          ends_at: iso(new Date(served.getTime() + this.limitSeconds * 1000)),
        };
      }
      case 'rewards_quiz_answer': {
        if (this.status !== 'in_progress') throw new RewardsException('no_attempt');
        const q = FakeQuiz.questions[this.current]!;
        const late = now.getTime() > this.servedAt!.getTime() + (this.limitSeconds + 2) * 1000;
        const correct = !late && p['choice'] === q.answer;
        if (correct) this.score++;
        this.current++;
        this.servedAt = null;
        const finished = this.current >= FakeQuiz.questions.length;
        const grants: Json[] = finished && this.score >= 3 ? [{ program: 'quiz', kind: 'coins', amount: 30, params: {}, state: 'granted' }] : [];
        if (finished) {
          this.status = 'finished';
          this.lastResult = { score: this.score, total: FakeQuiz.questions.length, grants };
        }
        return { correct, answer: q.answer, explanation: q.explanation ?? null, timed_out: late, score: this.score, finished, grants };
      }
      default:
        return this.state(now, endOfDay);
    }
  }
}

/** Plans three notifications from the user's last activity, and keeps their reminder / email / fair-play choices. */
export class FakeFollowups {
  lastActivity: Date;
  prefs: Json = {
    notifications_off: false,
    emails_off: true,
    reminder_time: null,
    muted_groups: [],
    streaks_off: false,
    surprises_off: false,
    timers_off: false,
  };
  static readonly groups: Readonly<Record<string, string>> = { comeback: 'Comeback reminders', recap: 'Sunday recap' };
  static readonly keys = ['notifications_off', 'emails_off', 'reminder_time', 'muted_groups', 'streaks_off', 'surprises_off', 'timers_off'];

  constructor(now: Date) {
    this.lastActivity = now;
  }

  get choices(): Json {
    return { streaks_off: this.prefs['streaks_off'] === true, surprises_off: this.prefs['surprises_off'] === true, timers_off: this.prefs['timers_off'] === true };
  }

  private get muted(): Set<string> {
    const m = this.prefs['muted_groups'];
    return new Set(Array.isArray(m) ? m.filter((x): x is string => typeof x === 'string') : []);
  }

  private item(program: string, at: Date, body: string, group: string): Json {
    return { id: followupIdOf(program, at), program, at: iso(at), title: 'Rewards demo', body, payload: '/home', group };
  }

  plan(now: Date): Json {
    if (this.prefs['notifications_off'] === true) return { server_time: iso(now), plan: [] };
    const items = [
      ...(this.prefs['streaks_off'] !== true ? [this.item('streak_at_risk', new Date(now.getTime() + 20 * HOUR), 'Your streak is waiting for today.', 'comeback')] : []),
      this.item('inactive2', new Date(this.lastActivity.getTime() + 2 * DAY), 'Your next step is still here.', 'comeback'),
      this.item('weekly_recap', new Date(now.getTime() + 6 * DAY), 'Your week is ready to look back on.', 'recap'),
    ].filter((i) => !this.muted.has(i['group'] as string));
    return { server_time: iso(now), plan: items };
  }

  applyPrefs(patch: Json): Json {
    for (const k of FakeFollowups.keys) if (k in patch) this.prefs[k] = patch[k];
    return {
      ...this.prefs,
      groups: Object.entries(FakeFollowups.groups).map(([group, label]) => ({ group, label, muted: this.muted.has(group) })),
    };
  }
}

/** A weekly league with four named members and one without a name; the user joins with their own taps. */
export class FakeLeague {
  joined = false;
  /** Points since joining this week (each tracked event adds one). */
  score = 0;
  tier = 0;
  lastWeek: Json | null = null;
  live = true;
  others: Array<[string | null, number]> = [
    ['Asha', 9],
    ['Ravi', 6],
    [null, 4],
    ['Mo', 2],
    ['Lena', 0],
  ];
  static readonly tiers = ['Bronze', 'Silver', 'Gold'];

  call(fn: string, now: Date): Json {
    if (fn === 'rewards_league_join') {
      if (!this.live) throw new RewardsException('disabled');
      this.joined = true;
    }
    if (fn === 'rewards_league_leave') {
      this.joined = false;
      this.score = 0;
    }
    return this.state(now);
  }

  private weekStart(now: Date): Date {
    const today = utcMidnight(now);
    const weekday = (today.getUTCDay() + 6) % 7; // Monday = 0
    return new Date(today.getTime() - weekday * DAY);
  }

  state(now: Date): Json {
    const week = this.weekStart(now);
    const rows: Array<[string | null, number, boolean]> = [...this.others.map(([n, s]) => [n, s, false] as [string | null, number, boolean])];
    if (this.joined) rows.push(['You', this.score, true]);
    rows.sort((a, b) => b[1] - a[1]);
    const rankOf = (s: number): number | null => (s < 1 ? null : rows.findIndex((r) => r[1] === s) + 1);
    return {
      program: 'weekly',
      live: this.live,
      joined: this.joined,
      tier: this.tier,
      tier_name: FakeLeague.tiers[this.tier],
      tiers: FakeLeague.tiers,
      week: dayKey(week),
      starts_at: iso(week),
      ends_at: iso(new Date(week.getTime() + 7 * DAY)),
      server_time: iso(now),
      group_size: 20,
      promote: 2,
      demote: 0,
      min_score: 1,
      rank: this.joined ? rankOf(this.score) : null,
      score: this.joined ? this.score : 0,
      size: this.joined ? rows.length : 0,
      members: this.joined ? rows.map(([name, score, me]) => ({ rank: rankOf(score), name: me ? null : name, score, me })) : [],
      rewards: [
        { threshold: 1, kind: 'coins', amount: 100 },
        { threshold: 3, kind: 'coins', amount: 30 },
      ],
      last_week: this.lastWeek,
    };
  }

  /** `rewards_recap` for any range: made-up totals. */
  static recap(): Json {
    return {
      days_active: 212,
      best_streak: 31,
      events: [
        { type: 'chapter_read', count: 840 },
        { type: 'quiz_finished', count: 120 },
        { type: 'clip_made', count: 9 },
      ],
      grants: [
        { kind: 'coins', amount: 4200, count: 80 },
        { kind: 'streak_freeze', amount: 3, count: 3 },
      ],
      badges: [
        { badge: 'bookworm', granted_at: '2026-03-02T10:00:00Z' },
        { badge: 'night_owl', granted_at: '2026-07-19T23:10:00Z' },
      ],
    };
  }
}

export interface FakeRewardsServerOptions {
  /** The fake's clock. Default `() => new Date()`. */
  clock?: () => Date;
  /** Milliseconds each call waits. Default 0. */
  latencyMs?: number;
  /** Seed for the surprise draws. Default 7. */
  seed?: number;
  /** Chance of the surprise bonus per tracked event. Default 0.3. */
  surpriseChance?: number;
}

/** One recorded call. */
export interface FakeRewardsCall {
  readonly fn: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * The in-memory rewards engine. Answers every `rewards_*` RPC with the SQL's JSON shapes. Program keys: `daily`
 * (streak), `reader` (milestone), `welcome` (offer), `ig` (social tag), `quiz`, `daily_quests` (quest set), `hearts`
 * (recharge), `happy` (window), `buddies` (friend streak), `weekly` (league).
 */
export class FakeRewardsServer {
  clock: () => Date;
  latencyMs: number;
  random: () => number;
  readonly calls: FakeRewardsCall[] = [];

  /** False: every call throws `not_deployed`. */
  deployed = true;
  /** False: every call throws `signed_out`. */
  signedIn = true;
  /** True: every call throws a network error. */
  offline = false;
  /** True: every call throws a 500. */
  serverError = false;
  /** The engine's master switch. */
  enabled = true;

  // Streak
  streak = 2;
  longest = 4;
  todayCount = 0;
  todayDone = false;
  dailyGoal = 2;
  freezes = 1;
  weeklyFreeFreezesLeft = 1;
  bestDay = 2;
  /** Set by [breakStreak]: the repair offer. */
  repair: Json | null = null;
  repairedAt: Date | null = null;

  // Milestone
  chapters = 3;
  headStart = 1;

  // Offer
  offerStock = 7;
  offerClaimed = false;
  offerEndsAt: Date;
  offerStartedAt: Date;

  // Social
  social = 'none';
  socialPostUrl: string | null = null;

  // Recharge
  hearts = 2;
  heartsMax = 3;
  heartsEveryMinutes = 240;

  // Window
  windowActive = true;

  // Friends
  friends: Json[] = [];
  private inviteCodes = new Map<string, Date>();

  // Quests
  questProgress: Record<string, number> = { read: 1, quiz: 0, streak: 0 };

  // Surprises
  surpriseChance: number;
  surprisesToday = 0;
  static readonly surpriseDailyCap = 3;

  readonly inbox: Json[] = [];
  badges: Json[] = [{ badge: 'early', program: 'daily', granted_at: '2026-11-01T10:00:00Z' }];
  readonly quiz = new FakeQuiz();
  readonly followups: FakeFollowups;
  readonly league = new FakeLeague();
  private seq = 0;

  constructor(opts: FakeRewardsServerOptions = {}) {
    this.clock = opts.clock ?? (() => new Date());
    this.latencyMs = opts.latencyMs ?? 0;
    this.random = seededRandom(opts.seed ?? 7);
    this.surpriseChance = opts.surpriseChance ?? 0.3;
    const now = this.clock();
    this.offerStartedAt = now;
    this.offerEndsAt = new Date(now.getTime() + 30 * MIN);
    this.followups = new FakeFollowups(now);
    this.friends = [
      {
        program: 'buddies',
        pair_id: 'p1',
        friend_id: 'u2',
        friend_name: 'Asha',
        current: 4,
        longest: 6,
        today_me: false,
        today_friend: true,
        breaks_at: iso(this.endOfDay(now)),
        next_reward: { threshold: 7, kind: 'coins', amount: 30 },
      },
    ];
  }

  /** The [RewardsRpc] to give a `RewardsClient`. */
  readonly rpc: RewardsRpc = (fn, params) => this.call(fn, params);

  /** Calls made to [fn], newest last. */
  called(fn: string): Readonly<Record<string, unknown>>[] {
    return this.calls.filter((c) => c.fn === fn).map((c) => c.params);
  }

  private endOfDay(now: Date): Date {
    return new Date(utcMidnight(now).getTime() + DAY);
  }

  private grant(program: string, kind: string, amount: number, params: Json = {}): Json {
    return { id: `g${this.seq++}`, program, kind, amount, params, state: 'granted', created_at: iso(this.clock()) };
  }

  async call(fn: string, p: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ fn, params: p });
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.offline) throw new RewardsNetworkError(fn);
    if (!this.deployed) throw new RewardsUnavailableException('not_deployed');
    if (!this.signedIn) throw new RewardsUnavailableException('signed_out');
    if (this.serverError) throw new RewardsServerError(fn, 500);
    const now = this.clock();
    switch (fn) {
      case 'rewards_state':
        return this.state(now);
      case 'rewards_track':
        return this.track(now, String(p['type'] ?? ''));
      case 'rewards_offer_claim':
        return this.claimOffer(now);
      case 'rewards_social_start':
        if (this.social === 'verified') throw new RewardsException('already_posted');
        this.social = 'pending';
        return { code: 'DEMO-K7Q2HX', account: 'myapp', expires_at: iso(new Date(now.getTime() + 7 * DAY)) };
      case 'rewards_social_submit_link': {
        const url = String(p['url'] ?? '');
        if (this.social !== 'pending') throw new RewardsException('no_pending_post');
        if (!/^https:\/\/(www\.)?instagram\.com\//.test(url)) throw new RewardsException('bad_link');
        this.socialPostUrl = url;
        return this.socialJson(now);
      }
      case 'rewards_mark_seen': {
        const ids = (p['grant_ids'] as string[] | undefined) ?? [];
        let n = 0;
        for (let i = this.inbox.length - 1; i >= 0; i--) {
          if (ids.includes(this.inbox[i]!['id'] as string)) {
            this.inbox.splice(i, 1);
            n++;
          }
        }
        return n;
      }
      case 'rewards_history':
        return this.history(now, typeof p['weeks'] === 'number' ? p['weeks'] : 15);
      case 'rewards_recap':
        return FakeLeague.recap();
      case 'rewards_recharge_use': {
        const units = typeof p['units'] === 'number' ? p['units'] : 1;
        if (this.hearts < units) throw new RewardsException('empty');
        this.hearts -= units;
        return { program: 'hearts', units: this.hearts, max: this.heartsMax, next_at: this.heartsNextAt(now) };
      }
      case 'rewards_friend_invite': {
        const code = `F${String(1000000 + this.seq++).substring(1)}`;
        this.inviteCodes.set(code, new Date(now.getTime() + 7 * DAY));
        return { code, expires_at: iso(this.inviteCodes.get(code)!) };
      }
      case 'rewards_friend_accept': {
        const code = String(p['code'] ?? '');
        if (this.inviteCodes.has(code)) throw new RewardsException('own_code');
        if (!/^F[A-Z0-9]{7}$/.test(code)) throw new RewardsException('bad_code');
        if (this.friends.length >= 5) throw new RewardsException('too_many_friends');
        const pairId = `p${this.seq++}`;
        this.friends.push({
          program: 'buddies',
          pair_id: pairId,
          friend_id: `u${this.seq}`,
          friend_name: 'Sam',
          current: 0,
          longest: 0,
          today_me: false,
          today_friend: false,
          breaks_at: iso(this.endOfDay(now)),
          next_reward: { threshold: 7, kind: 'coins', amount: 30 },
        });
        return { pair_id: pairId, program: 'buddies' };
      }
      case 'rewards_friend_remove':
        this.friends = this.friends.filter((f) => f['pair_id'] !== p['pair_id']);
        return true;
      case 'rewards_quiz_today':
      case 'rewards_quiz_start':
      case 'rewards_quiz_question':
      case 'rewards_quiz_answer': {
        const r = this.quiz.call(fn, p, now, this.endOfDay(now));
        const grants = r['grants'];
        if (Array.isArray(grants)) {
          for (const g of grants as Json[]) {
            g['id'] = `g${this.seq++}`;
            this.inbox.unshift(g);
          }
          if (r['finished'] === true) this.questProgress['quiz'] = 1;
        }
        return r;
      }
      case 'rewards_followups_plan':
        return this.followups.plan(now);
      case 'rewards_followup_prefs':
        return this.followups.applyPrefs((p['patch'] as Json | undefined) ?? {});
      case 'rewards_league':
      case 'rewards_league_join':
      case 'rewards_league_leave':
        return this.league.call(fn, now);
      default:
        throw new RewardsUnavailableException('not_deployed');
    }
  }

  private heartsNextAt(now: Date): string | null {
    return this.hearts >= this.heartsMax ? null : iso(new Date(now.getTime() + 65 * MIN));
  }

  private track(now: Date, type: string): Json {
    this.followups.lastActivity = now;
    const grants: Json[] = [];
    this.todayCount++;
    if (this.league.joined) this.league.score++;
    if (!this.todayDone && this.todayCount >= this.dailyGoal) {
      this.todayDone = true;
      this.streak++;
      if (this.streak > this.longest) this.longest = this.streak;
      this.questProgress['streak'] = 1;
      if (this.streak === 3) grants.push(this.grant('daily', 'coins', 20));
      if (this.repair) {
        this.streak = (this.repair['restores_to'] as number) + 1;
        this.repair = null;
        this.repairedAt = now;
      }
    }
    for (const f of this.friends) f['today_me'] = true;
    if (type === 'chapter_read' || type === '') {
      this.chapters++;
      this.questProgress['read'] = (this.questProgress['read'] ?? 0) + 1;
    }
    const fixed = this.followups.prefs['surprises_off'] === true;
    if (fixed && this.chapters % 3 === 0) {
      grants.push(this.grant('reader', 'coins', 27, { range: [5, 50], fixed: true }));
    } else if (!fixed && this.surprisesToday < FakeRewardsServer.surpriseDailyCap && this.random() < this.surpriseChance) {
      this.surprisesToday++;
      grants.push(this.grant('reader', 'coins', 5 + Math.floor(this.random() * 46), { surprise: true, range: [5, 50] }));
    }
    if (this.chapters === 5) grants.push(this.grant('reader', 'badge', 1, { badge: 'bookworm' }));
    this.inbox.unshift(...grants);
    return { enabled: this.enabled, duplicate: false, grants, streaks: [this.streakJson(now)] };
  }

  private claimOffer(now: Date): Json {
    if (this.offerClaimed) throw new RewardsException('offer_claimed');
    if (now.getTime() >= this.offerEndsAt.getTime()) throw new RewardsException('offer_expired');
    if (this.offerStock <= 0) throw new RewardsException('sold_out');
    this.offerClaimed = true;
    this.offerStock--;
    const g = this.grant('welcome', 'coins', 100);
    this.inbox.unshift(g);
    return { grants: [g] };
  }

  private offerState(now: Date): string {
    if (this.offerClaimed) return 'claimed';
    if (now.getTime() >= this.offerEndsAt.getTime()) return 'expired';
    if (this.offerStock <= 0) return 'sold_out';
    if (now.getTime() < this.offerStartedAt.getTime()) return 'not_started';
    return 'active';
  }

  private history(now: Date, weeks: number): Json {
    const today = utcMidnight(now);
    const n = weeks * 7;
    const days: Json[] = [];
    for (let i = n - 1; i >= 0; i--) {
      days.push({ day: dayKey(new Date(today.getTime() - i * DAY)), count: i === 0 ? this.todayCount : (i * 7 + Math.floor(i / 3)) % 6, frozen: i === 9 || i === 40 });
    }
    return { program: 'daily', daily_goal: this.dailyGoal, days };
  }

  private streakJson(now: Date): Json {
    return {
      program: 'daily',
      current: this.streak,
      longest: this.longest,
      today_done: this.todayDone,
      daily_goal: this.dailyGoal,
      today_count: this.todayCount,
      freezes: this.freezes,
      weekly_free_freezes_left: this.weeklyFreeFreezesLeft,
      ends_today_at: iso(this.endOfDay(now)),
      breaks_at: iso(new Date(this.endOfDay(now).getTime() + (this.freezes + this.weeklyFreeFreezesLeft) * DAY)),
      next_reward: this.streak < 7 ? { threshold: 7, kind: 'coins', amount: 50 } : { threshold: 30, kind: 'mystery', amount: 0, odds: this.mysteryOdds() },
      hidden: this.followups.prefs['streaks_off'] === true,
      best_day_count: this.todayCount > this.bestDay ? this.todayCount : this.bestDay,
      record_today: this.todayCount > this.bestDay,
      repair: this.repair,
      repaired_at: this.repairedAt ? iso(this.repairedAt) : null,
    };
  }

  private mysteryOdds(): Json[] {
    return [
      { kind: 'coins', amount: 50, chance: 0.6 },
      { kind: 'streak_freeze', amount: 1, chance: 0.3 },
      { kind: 'entitlement_days', amount: 3, chance: 0.1 },
    ];
  }

  private socialJson(now: Date): Json {
    return {
      program: 'ig',
      platform: 'instagram',
      account: 'myapp',
      state: this.social,
      code: this.social === 'none' ? null : 'DEMO-K7Q2HX',
      expires_at: this.social === 'none' ? null : iso(new Date(now.getTime() + (this.social === 'cooldown' ? 3 * DAY : 7 * DAY))),
      rewards: [{ kind: 'coins', amount: 200 }],
      post_url: this.socialPostUrl,
    };
  }

  private milestoneJson(): Json {
    const c = this.chapters;
    return {
      program: 'reader',
      count: c,
      head_start: this.headStart,
      level: {
        number: c < 3 ? 1 : c < 6 ? 2 : 3,
        name: c < 3 ? 'Reader' : c < 6 ? 'Explorer' : 'Bookworm',
        at: c < 3 ? 1 : c < 6 ? 3 : 6,
        next_at: c < 3 ? 3 : c < 6 ? 6 : null,
      },
      next_reward: c < 5 ? { threshold: 5, kind: 'badge', amount: 1, params: { badge: 'bookworm' } } : null,
    };
  }

  private questJson(now: Date): Json {
    const tasks = [
      { key: 'read_3', event: 'chapter_read', count: 3, progress: Math.min(this.questProgress['read'] ?? 0, 3), rewards: [{ kind: 'coins', amount: 5 }] },
      { key: 'quiz', event: 'quiz_finished', count: 1, progress: this.questProgress['quiz'] ?? 0, rewards: [{ kind: 'coins', amount: 5 }] },
      { key: 'keep_streak', event: 'streak_done', count: 1, progress: this.questProgress['streak'] ?? 0, rewards: [] },
    ].map((t) => ({ ...t, done: t.progress >= t.count }));
    return {
      program: 'daily_quests',
      period: 'daily',
      ends_at: iso(this.endOfDay(now)),
      done: tasks.every((t) => t.done),
      tasks,
      bonus: [{ kind: 'coins', amount: 20 }],
    };
  }

  private windowJson(now: Date): Json {
    return this.windowActive
      ? { program: 'happy', active: true, starts_at: iso(new Date(now.getTime() - 10 * MIN)), ends_at: iso(new Date(now.getTime() + 50 * MIN)) }
      : { program: 'happy', active: false, starts_at: iso(new Date(now.getTime() + 2 * HOUR)), ends_at: iso(new Date(now.getTime() + 3 * HOUR)) };
  }

  /** The whole `rewards_state` object. */
  state(now: Date): Json {
    return {
      enabled: this.enabled,
      server_time: iso(now),
      programs: [
        { key: 'daily', kind: 'streak' },
        { key: 'reader', kind: 'milestone', public: { title: 'Read 5 chapters', head_start_label: 'Includes 1 chapter from us to get you going' } },
        { key: 'welcome', kind: 'offer', public: { title: 'Welcome gift' } },
        { key: 'ig', kind: 'social_tag' },
        { key: 'quiz', kind: 'quiz' },
        { key: 'daily_quests', kind: 'quest_set', public: { title: 'Today' } },
        { key: 'hearts', kind: 'recharge', public: { title: 'Hearts' } },
        { key: 'happy', kind: 'window', public: { title: 'Happy hour' } },
        { key: 'buddies', kind: 'friend_streak' },
        { key: 'weekly', kind: 'league' },
      ],
      streaks: [this.streakJson(now)],
      milestones: [this.milestoneJson()],
      offers: [
        {
          program: 'welcome',
          state: this.offerState(now),
          stock_left: this.offerStock,
          started_at: iso(this.offerStartedAt),
          ends_at: iso(this.offerEndsAt),
          rewards: [{ kind: 'coins', amount: 100 }],
        },
      ],
      social: [this.socialJson(now)],
      quizzes: [this.quiz.state(now, this.endOfDay(now))],
      quests: [this.questJson(now)],
      recharges: [{ program: 'hearts', units: this.hearts, max: this.heartsMax, every_minutes: this.heartsEveryMinutes, next_at: this.heartsNextAt(now) }],
      windows: [this.windowJson(now)],
      friends: this.friends,
      surprises: [{ program: 'reader', kind: 'coins', amount: 50, amount_range: [5, 50], chance: this.surpriseChance, params: {} }],
      inbox: this.inbox,
      badges: this.badges,
      choices: this.followups.choices,
    };
  }

  // ---- story moves ----

  /** The streak is at risk: today not done and the day ends soon (a clock near midnight shows the countdown). */
  streakAtRisk(): void {
    this.todayDone = false;
    this.todayCount = 0;
  }

  /** The streak broke overnight; doing [needed] events today brings back [restoresTo] days. */
  breakStreak(restoresTo = 20, needed = 2): void {
    this.repair = { restores_to: restoresTo, until: iso(this.endOfDay(this.clock())), needed, done: this.todayCount };
    this.streak = 0;
    this.todayDone = false;
  }

  /** The offer's deadline passes / the stock runs out. */
  expireOffer(): void {
    this.offerEndsAt = new Date(this.clock().getTime() - MIN);
  }
  sellOutOffer(): void {
    this.offerStock = 0;
  }

  /** The Meta webhook saw the post (verified), or could not match it (rejected). */
  verifySocial(): void {
    if (this.social !== 'pending') return;
    this.social = 'verified';
    this.inbox.unshift(this.grant('ig', 'coins', 200));
  }
  rejectSocial(): void {
    this.social = 'rejected';
  }

  /** The friend did today's part of every friend streak. */
  friendDoesToday(): void {
    for (const f of this.friends) {
      f['today_friend'] = true;
      if (f['today_me'] === true) f['current'] = (f['current'] as number) + 1;
    }
  }

  /** The week closed: the user ranked [rank] and moved up a tier, with a reward. */
  closeLeagueWeek(rank = 1): void {
    const now = this.clock();
    const grant = this.grant('weekly', 'coins', rank === 1 ? 100 : 30);
    this.league.lastWeek = {
      week: dayKey(new Date(utcMidnight(now).getTime() - 7 * DAY)),
      rank,
      score: this.league.score,
      tier_change: this.league.tier < FakeLeague.tiers.length - 1 ? 'up' : 'same',
      grants: [grant],
    };
    if (this.league.tier < FakeLeague.tiers.length - 1) this.league.tier++;
    this.league.score = 0;
    this.inbox.unshift(grant);
  }

  /** A mystery reward was opened: a reveal-worthy grant lands. */
  grantMystery(): void {
    this.inbox.unshift(this.grant('daily', 'streak_freeze', 1, { mystery: 'table_1' }));
  }

  /** A grant that is still being delivered (Premium days the Edge Function has not given yet). */
  grantPending(): void {
    this.inbox.unshift({ ...this.grant('welcome', 'entitlement_days', 3), state: 'queued' });
  }

  /** A new day starts: today's counts reset, the quiz has a new attempt. */
  newDay(): void {
    this.todayCount = 0;
    this.todayDone = false;
    this.surprisesToday = 0;
    this.quiz.status = 'not_started';
    this.quiz.attemptsLeft = 1;
    this.quiz.current = this.quiz.score = 0;
    this.quiz.lastResult = null;
    this.questProgress = { read: 0, quiz: 0, streak: 0 };
    for (const f of this.friends) f['today_me'] = f['today_friend'] = false;
  }
}

/** A [RewardsClient] and [RewardsController] on [server], with the server's clock as the device clock. */
export function fakeRewards(
  server: FakeRewardsServer,
  opts: Partial<Omit<RewardsClientOptions, 'rpc'>> = {},
): { client: RewardsClient; controller: RewardsController } {
  const client = new RewardsClient({ timezone: () => 'UTC', ...opts, rpc: server.rpc });
  const controller = new RewardsController({ client, clock: new ServerClock({ local: server.clock }) });
  return { client, controller };
}

/** A [FollowupNotifier] that only lists what it was asked to schedule (a demo's "notifications" panel). */
export class MemoryFollowupNotifier implements FollowupNotifier {
  readonly scheduled = new Map<number, { at: Date; title: string; body: string; payload: string }>();
  readonly cancelled: number[] = [];
  async cancel(ids: number[]): Promise<void> {
    for (const id of ids) {
      this.scheduled.delete(id);
      this.cancelled.push(id);
    }
  }
  async schedule(n: { id: number; at: Date; title: string; body: string; payload: string }): Promise<void> {
    this.scheduled.set(n.id, { at: n.at, title: n.title, body: n.body, payload: n.payload });
  }
}
