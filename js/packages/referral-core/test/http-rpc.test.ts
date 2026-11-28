// Port of packages/referral_kit/test/http_rpc_test.dart, plus the supabase-js adapter.
import { expect, it } from 'vitest';
import {
  FixedInstallIdStore,
  ReferralAvailability,
  ReferralClient,
  referralHttpRpc,
  ReferralNetworkError,
  ReferralServerError,
  ReferralUnavailableException,
  supabaseRpc,
  type HttpResponseLike,
} from '../src';

class Transport {
  readonly sent: Array<[string, Readonly<Record<string, string>>, string]> = [];
  constructor(public answer: () => HttpResponseLike) {}
  readonly call = async (url: string, headers: Readonly<Record<string, string>>, body: string): Promise<HttpResponseLike> => {
    this.sent.push([url, headers, body]);
    return this.answer();
  };
}

const rpc = (t: Transport, o: { url?: string | null; key?: string | null; token?: string | null } = {}) =>
  referralHttpRpc({
    supabaseUrl: 'url' in o ? o.url : 'https://ref.supabase.co/',
    anonKey: 'key' in o ? o.key : 'anon',
    accessToken: async () => ('token' in o ? o.token : 'jwt'),
    transport: t.call,
  });

const unavailable = (reason: string) => expect.objectContaining({ name: 'ReferralUnavailableException', reason });

it('POSTs the params to /rest/v1/rpc/<fn> with apikey and bearer token, and decodes the body', async () => {
  const t = new Transport(() => ({ status: 200, body: '{"reason":"ok"}' }));
  expect(await rpc(t)('referral_claim', { code: 'ABCDEFGH', install_id: 'x' })).toEqual({ reason: 'ok' });
  const [url, headers, body] = t.sent[0]!;
  expect(url).toBe('https://ref.supabase.co/rest/v1/rpc/referral_claim');
  expect(headers['apikey']).toBe('anon');
  expect(headers['Authorization']).toBe('Bearer jwt');
  expect(headers['Content-Type']).toBe('application/json');
  expect(JSON.parse(body)).toEqual({ code: 'ABCDEFGH', install_id: 'x' });
});

it('empty body is null', async () => {
  expect(await rpc(new Transport(() => ({ status: 204, body: '' })))('referral_ack', {})).toBeNull();
});

it('404 is not deployed', async () => {
  const t = new Transport(() => ({ status: 404, body: '{"code":"PGRST202"}' }));
  await expect(rpc(t)('referral_terms', {})).rejects.toEqual(unavailable('not_deployed'));
});

it('other statuses and bad JSON are server errors without the body', async () => {
  const t = new Transport(() => ({ status: 500, body: 'secret detail' }));
  const e = await rpc(t)('referral_terms', {}).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ReferralServerError);
  expect((e as ReferralServerError).status).toBe(500);
  expect(String(e)).not.toContain('secret');
  t.answer = () => ({ status: 200, body: '<html>' });
  await expect(rpc(t)('referral_terms', {})).rejects.toBeInstanceOf(ReferralServerError);
});

it('no answer is a network error', async () => {
  const t = new Transport(() => {
    throw new Error('SocketException');
  });
  await expect(rpc(t)('referral_terms', {})).rejects.toBeInstanceOf(ReferralNetworkError);
});

it('no project or signed out: unavailable, nothing sent', async () => {
  const t = new Transport(() => ({ status: 200, body: '{}' }));
  await expect(rpc(t, { url: null })('referral_terms', {})).rejects.toEqual(unavailable('no_project'));
  await expect(rpc(t, { key: '' })('referral_terms', {})).rejects.toEqual(unavailable('no_project'));
  await expect(rpc(t, { token: null })('referral_terms', {})).rejects.toEqual(unavailable('signed_out'));
  expect(t.sent).toHaveLength(0);
});

it('with ReferralClient: availability() reports not deployed', async () => {
  const t = new Transport(() => ({ status: 404, body: '' }));
  const client = new ReferralClient({ rpc: rpc(t), installIds: new FixedInstallIdStore('id') });
  expect(await client.availability()).toBe(ReferralAvailability.notDeployed);
  t.answer = () => ({ status: 200, body: JSON.stringify({ enabled: true, rules: [] }) });
  expect(await client.availability()).toBe(ReferralAvailability.available);
});

it('the default transport uses fetch with the timeout', async () => {
  const calls: Array<[string, RequestInit]> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return new Response('{"enabled":true}', { status: 200 });
  }) as typeof fetch;
  try {
    const r = await referralHttpRpc({ supabaseUrl: 'https://x.supabase.co', anonKey: 'k', accessToken: () => 't' })('referral_terms', {
      install_id: 'i',
    });
    expect(r).toEqual({ enabled: true });
    expect(calls[0]![0]).toBe('https://x.supabase.co/rest/v1/rpc/referral_terms');
    expect(calls[0]![1].method).toBe('POST');
    expect(calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  } finally {
    globalThis.fetch = original;
  }
});

it('supabaseRpc adapts supabase-js and PGRST202 reads as not deployed', async () => {
  const supabase = {
    rpc: async (fn: string) =>
      fn === 'referral_terms'
        ? { data: { enabled: true, rules: [] }, error: null }
        : { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } },
  };
  const client = new ReferralClient({ rpc: supabaseRpc(supabase), installIds: new FixedInstallIdStore('id') });
  expect((await client.terms()).enabled).toBe(true);
  await expect(client.stats()).rejects.toBeInstanceOf(ReferralUnavailableException);
});
