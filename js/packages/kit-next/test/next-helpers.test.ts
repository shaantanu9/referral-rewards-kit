import { describe, expect, it } from 'vitest';
import webTemplate from '../../../../web/invite/index.html?raw';
import {
  createInviteRoute,
  createReferralRpc,
  createServerReferralClient,
  createTermsRoute,
  INVITE_STRINGS,
  INVITE_TEMPLATE,
  inviteCodeFromParams,
  inviteCodeFromPath,
  inviteCodeFromUrl,
  inviteMetadata,
  inviteOgModel,
  invitePageModel,
  isSecretSupabaseKey,
  lineText,
  loadInvitePageModel,
  renderOgSvg,
  withReferralKit,
  type InviteConfig,
  type Terms,
} from '../src';

const cfg: InviteConfig = {
  appName: 'Example',
  appStoreUrl: 'https://apps.apple.com/app/id000000000',
  playPackage: 'com.example.app',
  siteUrl: 'https://example.test',
  ogImageUrl: 'https://example.test/og/invite?lang=en',
};

const preview = {
  valid: true,
  name: 'Priya',
  friend_rewards: [{ kind: 'minutes', amount: 60 }],
  sharer_rewarded: true,
  boost: { ends_at: '2026-11-23T00:00:00Z', multiplier: 2 },
};

function fakeFetch(body: unknown, status = 200): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

describe('the template and strings are the web/invite ones', () => {
  it('INVITE_TEMPLATE equals web/invite/index.html', () => {
    expect(INVITE_TEMPLATE).toBe(webTemplate);
  });

  it('INVITE_STRINGS equal web/invite/strings.ts', async () => {
    const path = '../../../../web/invite/strings.ts';
    const web = (await import(/* @vite-ignore */ path)) as { STRINGS: unknown };
    expect(INVITE_STRINGS).toEqual(web.STRINGS);
  });
});

describe('code from the URL', () => {
  it('reads /i/<code> in any form and refuses anything else', () => {
    expect(inviteCodeFromPath('/i/abcd-efgh')).toBe('ABCDEFGH');
    expect(inviteCodeFromPath('/i/ABCDEFGH/')).toBe('ABCDEFGH');
    expect(inviteCodeFromPath('/i/ABCD%E2%80%90EFGH')).toBe('ABCDEFGH');
    expect(inviteCodeFromPath('/i/ABCDEFG0')).toBeNull();
    expect(inviteCodeFromPath('/i/ABCDEFGH/x')).toBeNull();
    expect(inviteCodeFromPath('/i/')).toBeNull();
    expect(inviteCodeFromPath('/join/ABCDEFGH', '/join/')).toBe('ABCDEFGH');
    expect(inviteCodeFromPath('/x/ABCDEFGH')).toBeNull();
  });

  it('reads params (string or array) and URLs (path, ?code=, ?referrer=)', () => {
    expect(inviteCodeFromParams({ code: 'abcd-efgh' })).toBe('ABCDEFGH');
    expect(inviteCodeFromParams({ code: ['ABCDEFGH'] })).toBe('ABCDEFGH');
    expect(inviteCodeFromParams({ code: '<script>' })).toBeNull();
    expect(inviteCodeFromParams(null)).toBeNull();
    expect(inviteCodeFromUrl('https://example.test/i/ABCD-EFGH')).toBe('ABCDEFGH');
    expect(inviteCodeFromUrl('https://example.test/?code=abcdefgh')).toBe('ABCDEFGH');
    expect(inviteCodeFromUrl('https://example.test/?referrer=code%3DABCDEFGH')).toBe('ABCDEFGH');
    expect(inviteCodeFromUrl('/nothing')).toBeNull();
  });
});

describe('page model and metadata', () => {
  it('the model carries the code, store links and the preview lines as text', () => {
    const m = invitePageModel({ config: cfg, code: 'abcd-efgh', lang: 'en', preview, now: new Date('2026-11-18T10:00:00Z') });
    expect(m.code).toBe('ABCDEFGH');
    expect(m.codeDisplay).toBe('ABCD-EFGH');
    expect(m.codeSpoken).toBe('A B C D E F G H');
    expect(lineText(m.headline)).toBe('Priya invited you to Example');
    expect(m.headline.find((s) => s.name)?.text).toBe('Priya');
    expect(lineText(m.disclosure)).toBe('Priya gets a reward if you join.');
    expect(lineText(m.reward)).toBe('You get a welcome reward when you start using the app.');
    expect(lineText(m.boost)).toBe('Double rewards until Sun, 22 Nov');
    expect(m.playUrl).toBe('https://play.google.com/store/apps/details?id=com.example.app&referrer=code%3DABCDEFGH');
    expect(m.title).toBe("Example: you're invited");
    expect(m.description).not.toContain('Priya');
  });

  it('a bad code: no code, the "not complete" lead, no preview', () => {
    const m = invitePageModel({ config: cfg, code: 'nope', acceptLanguage: 'id-ID', preview });
    expect(m.lang).toBe('id');
    expect(m.code).toBeNull();
    expect(lineText(m.lead)).toContain('tidak lengkap');
    expect(m.disclosure).toBeNull();
    expect(m.canonicalUrl).toBe('https://example.test/i/');
  });

  it('metadata: noindex, canonical, OG and Twitter image, never the name', () => {
    const md = inviteMetadata({ config: cfg, code: 'ABCDEFGH', acceptLanguage: 'hi' });
    expect(md.robots).toEqual({ index: false, follow: false });
    expect(md.alternates.canonical).toBe('https://example.test/i/ABCDEFGH');
    expect(md.openGraph.images[0]).toEqual({ url: cfg.ogImageUrl, width: 1200, height: 630 });
    expect(md.twitter.card).toBe('summary_large_image');
    expect(md.title).toBe(INVITE_STRINGS.hi.title.replace('{app}', 'Example'));
    expect(JSON.stringify(md)).not.toContain('Priya');
  });

  it('loadInvitePageModel fetches the preview with the anon key on the server', async () => {
    const f = fakeFetch(preview);
    const m = await loadInvitePageModel({
      config: { ...cfg, supabaseUrl: 'https://ref.supabase.co', anonKey: 'sb_publishable_x' },
      code: 'ABCDEFGH',
      lang: 'en',
      fetch: f.fetch,
    });
    expect(lineText(m.headline)).toBe('Priya invited you to Example');
    expect(f.calls[0]!.url).toBe('https://ref.supabase.co/rest/v1/rpc/referral_invite_preview');
  });
});

describe('createInviteRoute', () => {
  const ctx = (code: string) => ({ params: Promise.resolve({ code }) });

  it('renders the page with the code, noindex headers, the language and cache headers', async () => {
    const { GET } = createInviteRoute({ config: cfg });
    const res = await GET(new Request('https://example.test/i/abcd-efgh', { headers: { 'accept-language': 'hi-IN' } }), ctx('abcd-efgh'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('content-language')).toBe('hi');
    expect(res.headers.get('cache-control')).toContain('s-maxage=300');
    const html = await res.text();
    expect(html).toContain('<html lang="hi">');
    expect(html).toContain('>ABCD-EFGH</output>');
    expect(html).toContain('<meta property="og:image" content="https://example.test/og/invite?lang=en">');
    expect(html).toContain('<link rel="canonical" href="https://example.test/i/ABCDEFGH">');
  });

  it('a hostile code is never echoed: the "not complete" page, status 200', async () => {
    const { GET } = createInviteRoute({ config: cfg });
    const res = await GET(new Request('https://example.test/i/x'), ctx('%3Cscript%3E'));
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain('<script>x');
    expect(html).toContain('id="code-box" hidden');
  });

  it('with keys: the preview is fetched on the server, rendered, and the page is not cached', async () => {
    const f = fakeFetch(preview);
    const { GET } = createInviteRoute({
      config: { ...cfg, supabaseUrl: 'https://ref.supabase.co', anonKey: 'eyJanon' },
      fetch: f.fetch,
      now: () => new Date('2026-11-18T10:00:00Z'),
    });
    const res = await GET(new Request('https://example.test/i/ABCDEFGH'), { params: { code: 'ABCDEFGH' } });
    const html = await res.text();
    expect(html).toContain('<bdi>Priya</bdi> invited you to Example');
    expect(html).toContain('<script type="application/json" id="preview-data">{}</script>');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const head = html.split('<body>')[0]!;
    expect(head).not.toContain('Priya');
    expect((f.calls[0]!.init.headers as Record<string, string>)['authorization']).toBe('Bearer eyJanon');
  });

  it('serverPreview false leaves the preview to the browser script', async () => {
    const { GET } = createInviteRoute({
      config: { ...cfg, supabaseUrl: 'https://ref.supabase.co', anonKey: 'sb_publishable_x' },
      serverPreview: false,
    });
    const html = await (await GET(new Request('https://example.test/i/ABCDEFGH'), ctx('ABCDEFGH'))).text();
    expect(html).toContain('"url":"https://ref.supabase.co/rest/v1/rpc/referral_invite_preview"');
  });
});

describe('createTermsRoute', () => {
  it('renders the terms from the live rules', async () => {
    const terms: Terms = {
      enabled: true,
      paid_enabled: false,
      rules: [{ event: 'joined', who: 'sharer', kind: 'minutes', amount: 30 }],
      claim_window_days: 7,
      activate_window_days: 30,
      paid_window_days: 90,
      hold_hours: 72,
      sharer_joins_per_30d: 10,
      sharer_paid_per_365d: 6,
    };
    const { GET } = createTermsRoute({ config: cfg, terms: async () => terms, labels: { minutes: (n) => `${n} min` } });
    const res = await GET(new Request('https://example.test/terms'));
    const html = await res.text();
    expect(html).toContain('you get 30 min.');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
});

describe('createReferralRpc', () => {
  it('refuses a service-role or secret key', () => {
    const payload = btoa(JSON.stringify({ role: 'service_role' })).replace(/=+$/, '');
    expect(isSecretSupabaseKey(`eyJhbGciOiJIUzI1NiJ9.${payload}.sig`)).toBe(true);
    expect(isSecretSupabaseKey('sb_secret_abc')).toBe(true);
    expect(isSecretSupabaseKey('sb_publishable_abc')).toBe(false);
    const anon = btoa(JSON.stringify({ role: 'anon' })).replace(/=+$/, '');
    expect(isSecretSupabaseKey(`eyJhbGciOiJIUzI1NiJ9.${anon}.sig`)).toBe(false);
    expect(() => createReferralRpc({ supabaseUrl: 'https://x.supabase.co', anonKey: 'sb_secret_abc', accessToken: 't' })).toThrow(
      /never a service-role or secret key/,
    );
  });

  it('calls PostgREST with the public key and the user token, uncached', async () => {
    const f = fakeFetch({ code: 'K7QM2XRA', reason: 'ok' });
    const client = createServerReferralClient({
      supabaseUrl: 'https://ref.supabase.co/',
      anonKey: 'sb_publishable_x',
      accessToken: async () => 'user-jwt',
      installId: '11111111-2222-4333-8444-555555555555',
      fetch: f.fetch,
    });
    const r = await client.myCode();
    expect(r.code).toBe('K7QM2XRA');
    const call = f.calls[0]!;
    expect(call.url).toBe('https://ref.supabase.co/rest/v1/rpc/referral_my_code');
    expect(call.init.cache).toBe('no-store');
    const h = call.init.headers as Record<string, string>;
    expect(h['apikey']).toBe('sb_publishable_x');
    expect(h['Authorization']).toBe('Bearer user-jwt');
    expect(JSON.parse(call.init.body as string)).toEqual({ install_id: '11111111-2222-4333-8444-555555555555' });
  });

  it('signed out: signed_out, no request', async () => {
    const f = fakeFetch({});
    const client = createServerReferralClient({
      supabaseUrl: 'https://ref.supabase.co',
      anonKey: 'sb_publishable_x',
      accessToken: null,
      installId: '11111111-2222-4333-8444-555555555555',
      fetch: f.fetch,
    });
    await expect(client.myCode()).rejects.toMatchObject({ reason: 'signed_out' });
    expect(f.calls).toHaveLength(0);
  });
});

describe('withReferralKit', () => {
  it('adds noindex on the invite route and JSON for the app-link files, keeping the app headers', async () => {
    const cfgOut = withReferralKit({
      reactStrictMode: true,
      headers: async () => [{ source: '/x', headers: [{ key: 'A', value: 'b' }] }],
    });
    expect(cfgOut['reactStrictMode']).toBe(true);
    const rules = await cfgOut.headers!();
    expect(rules.map((r) => r.source)).toEqual([
      '/x',
      '/i/:code*',
      '/.well-known/apple-app-site-association',
      '/.well-known/assetlinks.json',
    ]);
    expect(rules[1]!.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
    const custom = await withReferralKit({}, { invitePath: '/join/', wellKnown: false }).headers!();
    expect(custom.map((r) => r.source)).toEqual(['/join/:code*']);
  });
});

describe('OG image model', () => {
  it('shares the SVG layout: colours, initial, wrapped headline, no name', () => {
    const m = inviteOgModel({ appName: 'acme', accent: '#123', background: '#000000' });
    expect(m.initial).toBe('A');
    expect(m.ink).toBe('#ffffff');
    expect(m.onAccent).toBe('#ffffff');
    expect(m.headlineLines.join(' ')).toBe("You're invited to acme");
    expect(m.headlineBaselines).toHaveLength(m.headlineLines.length);
    const long = inviteOgModel({ appName: 'X', headline: 'word '.repeat(40) });
    expect(long.headlineSize).toBe(64);
    expect(long.headlineLines.length).toBeLessThanOrEqual(3);
    expect(renderOgSvg({ appName: 'acme' })).toContain(`y="${inviteOgModel({ appName: 'acme' }).headlineBaselines[0]}"`);
  });
});
