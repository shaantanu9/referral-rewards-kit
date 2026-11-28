// Port of packages/rewards_kit/test/client_test.dart and client_v2_test.dart.
import { describe, expect, it } from 'vitest';
import {
  QuizStatus,
  RewardsClient,
  RewardsEventName,
  RewardsException,
  rewardsHttpRpc,
  RewardsNetworkError,
  RewardsReason,
  RewardsServerError,
  RewardsUnavailableException,
  ServerClock,
  supabaseRewardsRpc,
  type RewardsEvent,
  type RewardsHttpResponse,
} from '../src';
import { FakeRpc, grant, historyJson, iso, questionJson, quizStateJson, sampleState, serverNow } from './fakes';

class PgError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }
  override toString(): string {
    return `PostgrestException(message: ${this.message}, code: ${this.code})`;
  }
}

describe('RewardsClient', () => {
  it('state, track, claim, social, mark seen: function and parameter names', async () => {
    const rpc = new FakeRpc({
      rewards_state: () => sampleState(),
      rewards_track: () => ({ duplicate: false, grants: [], streaks: [] }),
      rewards_offer_claim: () => ({ grants: [grant('g1')] }),
      rewards_social_start: () => ({ code: 'MYAPP-K7Q2HX', account: 'myapp', expires_at: iso(serverNow) }),
      rewards_mark_seen: () => 1,
    });
    const c = new RewardsClient({ rpc: rpc.call, timezone: () => 'Asia/Kolkata' });
    await c.state();
    await c.track('chapter_read', { dedupeKey: 'ch:1', props: { page: 3 } });
    expect(await c.claimOffer('welcome')).toHaveLength(1);
    expect((await c.startSocial('ig_tag', '@me')).code).toBe('MYAPP-K7Q2HX');
    expect(await c.markSeen(['g1'])).toBe(1);
    expect(await c.markSeen([])).toBe(0);
    expect(rpc.calls.map((x) => x[0])).toEqual(['rewards_state', 'rewards_track', 'rewards_offer_claim', 'rewards_social_start', 'rewards_mark_seen']);
    expect(rpc.called('rewards_track')[0]).toEqual({ type: 'chapter_read', dedupe_key: 'ch:1', props: { page: 3 }, timezone: 'Asia/Kolkata' });
    expect(rpc.called('rewards_offer_claim')[0]).toEqual({ program: 'welcome' });
    expect(rpc.called('rewards_social_start')[0]).toEqual({ program: 'ig_tag', handle: '@me' });
    expect(rpc.called('rewards_mark_seen')[0]).toEqual({ grant_ids: ['g1'] });
  });

  it('timezone null sends null; the default is the runtime IANA zone', async () => {
    const rpc = new FakeRpc({ rewards_track: () => ({}) });
    await new RewardsClient({ rpc: rpc.call, timezone: null }).track('x');
    expect(rpc.called('rewards_track')[0]!['timezone']).toBeNull();
    expect(rpc.called('rewards_track')[0]!['dedupe_key']).toBeNull();
    await new RewardsClient({ rpc: rpc.call }).track('x');
    expect(rpc.called('rewards_track')[1]!['timezone']).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('a JSON string result is decoded', async () => {
    const rpc = new FakeRpc({ rewards_state: () => JSON.stringify(sampleState()) });
    expect((await new RewardsClient({ rpc: rpc.call }).state()).enabled).toBe(true);
  });

  const errorOf = async (thrown: unknown): Promise<unknown> => {
    const rpc = new FakeRpc({
      rewards_offer_claim: () => {
        throw thrown;
      },
    });
    return new RewardsClient({ rpc: rpc.call }).claimOffer('x').then(
      () => {
        throw new Error('no error');
      },
      (e: unknown) => e,
    );
  };

  it('error mapping', async () => {
    expect(((await errorOf(new PgError('rewards: offer_expired'))) as RewardsException).reason).toBe('offer_expired');
    expect(((await errorOf(new PgError('rewards: not_signed_in'))) as RewardsUnavailableException).reason).toBe('signed_out');
    expect(((await errorOf(new PgError('Could not find the function', 'PGRST202'))) as RewardsUnavailableException).reason).toBe('not_deployed');
    expect(((await errorOf({ message: 'Could not find', code: 'PGRST202' })) as RewardsUnavailableException).reason).toBe('not_deployed');
    expect(((await errorOf({ message: 'rewards: sold_out', code: 'P0001' })) as RewardsException).reason).toBe('sold_out');
    expect(await errorOf(new Error('socket closed'))).toBeInstanceOf(RewardsNetworkError);
    expect(await errorOf(new RewardsServerError('x', 500))).toBeInstanceOf(RewardsServerError);
    expect(String(await errorOf(new RewardsException('sold_out')))).toContain('sold_out');
  });

  it('a new server reason still arrives as RewardsException', async () => {
    const e = (await errorOf(new PgError('rewards: quest_locked'))) as RewardsException;
    expect(e.reason).toBe('quest_locked');
    expect(e.isKnown).toBe(false);
    expect(new RewardsException(RewardsReason.handleTaken).isKnown).toBe(true);
  });

  it('events: loaded, tracked, claim results, social start; never a handle', async () => {
    const events: RewardsEvent[] = [];
    const rpc = new FakeRpc({
      rewards_state: () => sampleState(),
      rewards_track: () => ({ duplicate: true }),
      rewards_offer_claim: () => {
        throw new PgError('rewards: sold_out');
      },
      rewards_social_start: () => ({ code: 'MYAPP-K7Q2HX' }),
    });
    const c = new RewardsClient({ rpc: rpc.call, onEvent: (e) => events.push(e) });
    await c.state();
    await c.track('chapter_read');
    await expect(c.claimOffer('flash')).rejects.toBeInstanceOf(RewardsException);
    await c.startSocial('ig_tag', 'secret.handle');
    expect(events.map((e) => e.name)).toEqual([
      RewardsEventName.stateLoaded,
      RewardsEventName.tracked,
      RewardsEventName.offerClaimed,
      RewardsEventName.socialStarted,
    ]);
    expect(events[1]!.props).toEqual({ type: 'chapter_read', duplicate: true, grants: 0 });
    expect(events[2]!.props).toEqual({ program: 'flash', result: 'sold_out' });
    expect(events.map(String).join()).not.toContain('secret.handle');
    expect(events.map(String).join()).not.toContain('MYAPP-K7Q2HX');
  });

  it('a throwing analytics sink never breaks a call', async () => {
    const rpc = new FakeRpc({ rewards_state: () => sampleState() });
    const c = new RewardsClient({
      rpc: rpc.call,
      onEvent: () => {
        throw new Error('analytics down');
      },
    });
    expect((await c.state()).enabled).toBe(true);
  });
});

it('ServerClock learns the offset and corrects now and left', () => {
  let phone = new Date(Date.UTC(2026, 0, 1, 12));
  const clock = new ServerClock({ local: () => phone });
  expect(clock.offsetMs).toBe(0);
  clock.sync(new Date(Date.UTC(2026, 0, 1, 12, 5)));
  expect(clock.offsetMs).toBe(5 * 60000);
  expect(clock.now()).toEqual(new Date(Date.UTC(2026, 0, 1, 12, 5)));
  expect(clock.leftMs(new Date(Date.UTC(2026, 0, 1, 12, 15)))).toBe(10 * 60000);
  phone = new Date(phone.getTime() + 3600000);
  expect(clock.leftMs(new Date(Date.UTC(2026, 0, 1, 12, 15)))).toBe(0);
  expect(clock.leftMs(null)).toBeNull();
  clock.sync(null);
  expect(clock.offsetMs).toBe(5 * 60000);
});

describe('rewardsHttpRpc', () => {
  const http = (answer: () => RewardsHttpResponse, o: { token?: string | null; url?: string } = {}) =>
    rewardsHttpRpc({
      supabaseUrl: o.url ?? 'https://x.supabase.co/',
      anonKey: 'anon',
      accessToken: async () => ('token' in o ? o.token : 'jwt'),
      transport: async (u, h) => {
        expect(u).toBe('https://x.supabase.co/rest/v1/rpc/rewards_state');
        expect(h['Authorization']).toBe('Bearer jwt');
        expect(h['apikey']).toBe('anon');
        return answer();
      },
    });

  it('ok body decoded, empty body null', async () => {
    expect(await http(() => ({ status: 200, body: '{"enabled":true}' }))('rewards_state', {})).toEqual({ enabled: true });
    expect(await http(() => ({ status: 200, body: ' ' }))('rewards_state', {})).toBeNull();
  });

  it('no project, signed out, not deployed', async () => {
    const reason = (r: string) => expect.objectContaining({ name: 'RewardsUnavailableException', reason: r });
    await expect(http(() => ({ status: 200, body: '' }), { url: '' })('rewards_state', {})).rejects.toEqual(reason('no_project'));
    await expect(http(() => ({ status: 200, body: '' }), { token: null })('rewards_state', {})).rejects.toEqual(reason('signed_out'));
    await expect(http(() => ({ status: 404, body: '{"code":"PGRST202"}' }))('rewards_state', {})).rejects.toEqual(reason('not_deployed'));
  });

  it('a raised reason becomes RewardsException; other errors keep no body', async () => {
    await expect(http(() => ({ status: 400, body: '{"message":"rewards: daily_limit","code":"22023"}' }))('rewards_state', {})).rejects.toMatchObject({
      name: 'RewardsException',
      reason: 'daily_limit',
    });
    const e = await http(() => ({ status: 500, body: 'secret user data' }))('rewards_state', {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RewardsServerError);
    expect((e as RewardsServerError).status).toBe(500);
    expect(String(e)).not.toContain('secret');
    await expect(http(() => ({ status: 200, body: 'not json' }))('rewards_state', {})).rejects.toBeInstanceOf(RewardsServerError);
  });

  it('a transport failure is a network error', async () => {
    const rpc = rewardsHttpRpc({
      supabaseUrl: 'https://x.supabase.co',
      anonKey: 'anon',
      accessToken: () => 'jwt',
      transport: async () => {
        throw new Error('dns');
      },
    });
    await expect(rpc('rewards_state', {})).rejects.toBeInstanceOf(RewardsNetworkError);
  });

  it('supabaseRewardsRpc passes data and throws the error object', async () => {
    const rpc = supabaseRewardsRpc({
      rpc: async (fn) => (fn === 'rewards_state' ? { data: { enabled: true }, error: null } : { data: null, error: { message: 'rewards: empty' } }),
    });
    const c = new RewardsClient({ rpc });
    expect((await c.state()).enabled).toBe(true);
    await expect(c.useRecharge('hearts')).rejects.toMatchObject({ reason: 'empty' });
  });
});

describe('0.2 RPCs (client_v2_test.dart)', () => {
  it('exact function and parameter names (ADR 0002 §18.3)', async () => {
    const rpc = new FakeRpc({
      rewards_history: () => historyJson(),
      rewards_recap: () => ({ days_active: 3 }),
      rewards_recharge_use: () => ({ program: 'hearts', units: 1, max: 3, next_at: iso(serverNow) }),
      rewards_friend_invite: () => ({ code: 'FAB12CDE', expires_at: iso(serverNow) }),
      rewards_friend_accept: () => ({ pair_id: 'p9', program: 'buddies' }),
      rewards_friend_remove: () => true,
      rewards_social_submit_link: () => ({ program: 'ig', state: 'pending', post_url: 'https://i/p/1' }),
      rewards_quiz_today: () => quizStateJson(),
      rewards_quiz_start: () => quizStateJson({ state: 'in_progress' }),
      rewards_quiz_question: () => questionJson(0),
      rewards_quiz_answer: () => ({ correct: true, answer: 1, score: 1 }),
    });
    const c = new RewardsClient({ rpc: rpc.call });
    expect((await c.history({ program: 'daily', weeks: 2 })).days).toHaveLength(14);
    const recap = await c.recap(new Date(2026, 10, 1, 22), new Date(2026, 10, 14));
    expect(recap.daysActive).toBe(3);
    expect(recap.from).toEqual(new Date(Date.UTC(2026, 10, 1)));
    expect((await c.useRecharge('hearts', 2)).units).toBe(1);
    expect((await c.friendInvite('buddies')).code).toBe('FAB12CDE');
    expect((await c.friendAccept(' fab12cde ')).pairId).toBe('p9');
    expect(await c.friendRemove('p9')).toBe(true);
    expect((await c.submitSocialLink('ig', ' https://i/p/1 ')).postUrl).toBe('https://i/p/1');
    expect((await c.quizToday('quiz')).status).toBe(QuizStatus.notStarted);
    expect((await c.quizStart('quiz')).status).toBe(QuizStatus.inProgress);
    expect((await c.quizQuestion('quiz')).id).toBe('q0');
    expect((await c.quizAnswer('quiz', 0, 1)).correct).toBe(true);
    expect(rpc.calls).toEqual([
      ['rewards_history', { program: 'daily', weeks: 2 }],
      ['rewards_recap', { from_day: '2026-11-01', to_day: '2026-11-14' }],
      ['rewards_recharge_use', { program: 'hearts', units: 2 }],
      ['rewards_friend_invite', { program: 'buddies' }],
      ['rewards_friend_accept', { code: 'FAB12CDE' }],
      ['rewards_friend_remove', { pair_id: 'p9' }],
      ['rewards_social_submit_link', { program: 'ig', url: 'https://i/p/1' }],
      ['rewards_quiz_today', { program: 'quiz' }],
      ['rewards_quiz_start', { program: 'quiz' }],
      ['rewards_quiz_question', { program: 'quiz' }],
      ['rewards_quiz_answer', { program: 'quiz', index: 0, choice: 1 }],
    ]);
  });

  it('history defaults: null program, 15 weeks; recap takes YYYY-MM-DD strings', async () => {
    const rpc = new FakeRpc({ rewards_history: () => historyJson(), rewards_recap: () => ({}) });
    const c = new RewardsClient({ rpc: rpc.call });
    await c.history();
    await c.recap('2026-01-01', '2026-12-31');
    expect(rpc.called('rewards_history')[0]).toEqual({ program: null, weeks: 15 });
    expect(rpc.called('rewards_recap')[0]).toEqual({ from_day: '2026-01-01', to_day: '2026-12-31' });
  });

  it('refusals arrive with their reason and are reported without codes or ids', async () => {
    const events: RewardsEvent[] = [];
    const thrower = (r: string) => () => {
      throw new Error(`rewards: ${r}`);
    };
    const rpc = new FakeRpc({
      rewards_friend_accept: thrower('own_code'),
      rewards_recharge_use: thrower('empty'),
      rewards_quiz_start: thrower('no_attempts_left'),
      rewards_social_submit_link: thrower('bad_link'),
    });
    const c = new RewardsClient({ rpc: rpc.call, onEvent: (e) => events.push(e) });
    await expect(c.friendAccept('FSECRET1')).rejects.toBeInstanceOf(RewardsException);
    await expect(c.useRecharge('hearts')).rejects.toMatchObject({ reason: 'empty' });
    await expect(c.quizStart('quiz')).rejects.toBeInstanceOf(RewardsException);
    await expect(c.submitSocialLink('ig', 'https://secret.link')).rejects.toBeInstanceOf(RewardsException);
    expect(events.map((e) => [e.name, e.props['result']])).toEqual([
      [RewardsEventName.friendAccepted, 'own_code'],
      [RewardsEventName.rechargeUsed, 'empty'],
      [RewardsEventName.quizStarted, 'no_attempts_left'],
      [RewardsEventName.socialLinkSubmitted, 'bad_link'],
    ]);
    expect(events.map(String).join()).not.toContain('FSECRET1');
    expect(events.map(String).join()).not.toContain('secret.link');
  });

  it('quiz answer reports answered, and finished on the last one', async () => {
    const events: RewardsEvent[] = [];
    const rpc = new FakeRpc({ rewards_quiz_answer: () => ({ correct: false, timed_out: true, score: 2, finished: true, grants: [grant('q1')] }) });
    await new RewardsClient({ rpc: rpc.call, onEvent: (e) => events.push(e) }).quizAnswer('quiz', 2, -1);
    expect(events[0]!.name).toBe(RewardsEventName.quizAnswered);
    expect(events[0]!.props).toEqual({ program: 'quiz', index: 2, correct: false, timed_out: true });
    expect(events.at(-1)!.name).toBe(RewardsEventName.quizFinished);
    expect(events.at(-1)!.props).toEqual({ program: 'quiz', score: 2, total: 3, grants: 1 });
  });
});
