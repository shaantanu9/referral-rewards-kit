import { formatCode } from './code-format';
import type { ReferralCopy } from './copy';
import type { EventProps } from './events';

/** A share sheet's answer, in share_plus's shape: what an adapter returns so `invite_shared` can name the channel. */
export interface ShareResult {
  readonly status: 'success' | 'dismissed' | 'unavailable';
  /** The activity / package that received it (iOS: `net.whatsapp.WhatsApp.ShareExtension`), or empty. */
  readonly raw: string;
}

/** The Share button's rectangle (needed for the iPad popover). */
export interface ShareOrigin {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Opens a share sheet with [text]. Return a [ShareResult] so `invite_shared` can say whether, and through which
 * app, the user shared; returning nothing reports `status: unavailable`, `channel: unknown`. React Native:
 * `Share.share`; web: [webShare].
 */
export type ShareHandler = (text: string, origin?: ShareOrigin | null) => Promise<ShareResult | void | unknown>;

export function isShareResult(v: unknown): v is ShareResult {
  return (
    v != null &&
    typeof v === 'object' &&
    typeof (v as ShareResult).raw === 'string' &&
    ['success', 'dismissed', 'unavailable'].includes((v as ShareResult).status)
  );
}

/**
 * The Web Share API as a [ShareHandler]: `success` when shared, `dismissed` when the user closed the sheet,
 * `unavailable` (with the text copied to the clipboard when possible) where there is no `navigator.share`.
 */
export const webShare: ShareHandler = async (text) => {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ text });
      return { status: 'success', raw: '' } satisfies ShareResult;
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      if (name === 'AbortError') return { status: 'dismissed', raw: '' } satisfies ShareResult;
      return { status: 'unavailable', raw: '' } satisfies ShareResult;
    }
  }
  try {
    await nav?.clipboard?.writeText(text);
  } catch {
    // No clipboard either.
  }
  return { status: 'unavailable', raw: '' } satisfies ShareResult;
};

const buckets: ReadonlyArray<readonly [string, string]> = [
  ['whatsapp', 'whatsapp'],
  ['telegram', 'telegram'],
  ['instagram', 'instagram'],
  ['discord', 'discord'],
  ['messenger', 'messenger'],
  ['facebook', 'facebook'],
  ['twitter', 'x'],
  ['snapchat', 'snapchat'],
  ['activity.message', 'messages'],
  ['mms', 'messages'],
  ['messaging', 'messages'],
  ['activity.mail', 'mail'],
  ['android.gm', 'mail'],
  ['gmail', 'mail'],
  ['copytopasteboard', 'copy'],
  ['airdrop', 'airdrop'],
];

/** The share sheet's answer as a small channel name for analytics. Never the raw string: a bucket, `other` or `unknown`. */
export function shareChannel(result: unknown): string {
  if (!isShareResult(result)) return 'unknown';
  if (result.status === 'dismissed') return 'dismissed';
  if (result.status === 'unavailable') return 'unknown';
  const s = result.raw.toLowerCase();
  if (s === '' || s.startsWith('dev.fluttercommunity.plus/')) return 'unknown';
  for (const [key, value] of buckets) if (s.includes(key)) return value;
  return 'other';
}

/** Props of `invite_shared` for what the share handler returned. */
export function shareEventProps(result: unknown, opts: { hasLink: boolean }): EventProps {
  return {
    channel: shareChannel(result),
    status: isShareResult(result) ? result.status : 'unavailable',
    has_link: opts.hasLink,
  };
}

/** The app's invite link builder: the link for a code, or null when the app has none yet. */
export type InviteLinkBuilder = (code: string) => string | URL | null | undefined;

/** The invite link for [code], or null when the app has none, it does not parse, or it is not https. */
export function resolveInviteLink(inviteLink: InviteLinkBuilder | null | undefined, code: string): string | null {
  const raw = inviteLink?.(code);
  if (raw == null) return null;
  try {
    const u = raw instanceof URL ? raw : new URL(raw);
    if (u.protocol !== 'https:' || u.hostname === '') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * The sentence to share for [code]: with an invite link, the app's [shareText] (code, link) or the kit's sentence
 * from the terms; without one, the code to type in plus [storeLink], or the code alone.
 */
export function inviteShareText(opts: {
  copy: ReferralCopy;
  appName: string;
  code: string;
  link?: string | null;
  storeLink?: string | null;
  shareText?: (code: string, link: string) => string;
  shareTextNoLink?: (code: string, storeLink: string | null) => string;
}): string {
  const shown = formatCode(opts.code);
  if (opts.link != null) {
    return opts.shareText?.(shown, opts.link) ?? opts.copy.shareText({ appName: opts.appName, code: opts.code, link: opts.link });
  }
  const store = opts.storeLink ?? null;
  return (
    opts.shareTextNoLink?.(shown, store) ??
    opts.copy.shareTextNoLink({ appName: opts.appName, code: opts.code, storeLink: store })
  );
}
