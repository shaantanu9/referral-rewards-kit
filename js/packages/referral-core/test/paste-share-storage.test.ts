// paste, share and storage helpers.
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractInviteCode,
  inviteShareText,
  localStorageStore,
  MemoryKeyValueStore,
  pastedCodeText,
  ReferralCopy,
  referralLocalizations,
  ReferralTerms,
  resolveInviteLink,
  shareChannel,
  shareEventProps,
  whatsAppShareUri,
  type WebStorageLike,
} from '../src';
import { termsJson } from './support';

describe('paste', () => {
  it('pastedCodeText is the Flutter field behaviour', () => {
    expect(pastedCodeText(' ⁦abcd-efgh⁩ ')).toBe('ABCD-EFGH');
    expect(pastedCodeText('abc')).toBe('ABC');
  });
  it('extractInviteCode finds codes in text and links', () => {
    expect(extractInviteCode('abcd efgh')).toBe('ABCDEFGH');
    expect(extractInviteCode('https://reader.app/i/ABCD-EFGH')).toBe('ABCDEFGH');
    expect(extractInviteCode('https://reader.app/join?code=abcdefgh')).toBe('ABCDEFGH');
    expect(extractInviteCode('https://play.google.com/store/apps/details?id=x&referrer=code%3DABCDEFGH')).toBe('ABCDEFGH');
    expect(
      extractInviteCode("Here's 4 free chapters in Reader, on me: join with my code ⁦ABCD-EFGH⁩ and we both get it."),
    ).toBe('ABCDEFGH');
    expect(extractInviteCode('Here are some chapters for you')).toBeNull();
    expect(extractInviteCode('')).toBeNull();
    expect(extractInviteCode(null)).toBeNull();
  });
});

describe('share', () => {
  it('channels are buckets, never the raw string', () => {
    expect(shareChannel({ status: 'success', raw: 'net.whatsapp.WhatsApp.ShareExtension' })).toBe('whatsapp');
    expect(shareChannel({ status: 'success', raw: 'com.apple.UIKit.activity.Message' })).toBe('messages');
    expect(shareChannel({ status: 'success', raw: 'com.google.android.gm' })).toBe('mail');
    expect(shareChannel({ status: 'success', raw: 'com.twitter.android' })).toBe('x');
    expect(shareChannel({ status: 'success', raw: 'com.example.unknown' })).toBe('other');
    expect(shareChannel({ status: 'success', raw: '' })).toBe('unknown');
    expect(shareChannel({ status: 'dismissed', raw: '' })).toBe('dismissed');
    expect(shareChannel(undefined)).toBe('unknown');
    expect(shareEventProps(undefined, { hasLink: true })).toEqual({ channel: 'unknown', status: 'unavailable', has_link: true });
    expect(shareEventProps({ status: 'success', raw: 'whatsapp' }, { hasLink: false })).toEqual({
      channel: 'whatsapp',
      status: 'success',
      has_link: false,
    });
  });

  it('invite links must be https', () => {
    expect(resolveInviteLink((c) => `https://x.test/i/${c}`, 'ABCDEFGH')).toBe('https://x.test/i/ABCDEFGH');
    expect(resolveInviteLink((c) => `http://x.test/i/${c}`, 'ABCDEFGH')).toBeNull();
    expect(resolveInviteLink(() => 'not a url', 'ABCDEFGH')).toBeNull();
    expect(resolveInviteLink(null, 'ABCDEFGH')).toBeNull();
  });

  it('inviteShareText: link, store link, code only, app overrides', () => {
    const copy = new ReferralCopy({ l10n: referralLocalizations('en'), terms: ReferralTerms.fromJson(termsJson()) });
    expect(inviteShareText({ copy, appName: 'A', code: 'ABCDEFGH', link: 'https://x.test/i/ABCDEFGH' })).toContain(
      'https://x.test/i/ABCDEFGH',
    );
    expect(inviteShareText({ copy, appName: 'A', code: 'ABCDEFGH', storeLink: 'https://store' })).toContain('https://store');
    expect(inviteShareText({ copy, appName: 'A', code: 'ABCDEFGH' })).toContain('⁦ABCD-EFGH⁩');
    expect(inviteShareText({ copy, appName: 'A', code: 'ABCDEFGH', link: 'L', shareText: (c, l) => `${c} ${l}` })).toBe('ABCD-EFGH L');
  });

  it('WhatsApp link', () => expect(whatsAppShareUri('Hi & bye')).toBe('https://wa.me/?text=Hi%20%26%20bye'));
});

describe('storage', () => {
  const g = globalThis as { localStorage?: WebStorageLike };
  afterEach(() => {
    delete g.localStorage;
  });

  it('MemoryKeyValueStore', async () => {
    const s = new MemoryKeyValueStore({ a: '1' });
    expect(await s.getString('a')).toBe('1');
    await s.setString('b', '2');
    await s.remove('a');
    expect([...s.values.entries()]).toEqual([['b', '2']]);
  });

  it('localStorageStore prefixes keys and works without localStorage (SSR)', async () => {
    const ssr = localStorageStore();
    await ssr.setString('k', 'v');
    expect(await ssr.getString('k')).toBe('v');
    const map = new Map<string, string>();
    g.localStorage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
    const s = localStorageStore();
    await s.setString('pending_claim_code', 'ABCDEFGH');
    expect(map.get('referral_kit.pending_claim_code')).toBe('ABCDEFGH');
    expect(await localStorageStore().getString('pending_claim_code')).toBe('ABCDEFGH');
    await s.remove('pending_claim_code');
    expect(map.size).toBe(0);
  });

  it('localStorageStore survives a throwing storage', async () => {
    const throwing: WebStorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    const s = localStorageStore('x.', throwing);
    await s.setString('a', '1');
    expect(await s.getString('a')).toBe('1');
    await s.remove('a');
    expect(await s.getString('a')).toBeNull();
  });
});
