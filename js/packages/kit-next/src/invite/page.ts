import { INVITE_STRINGS } from './strings';
import {
  displayCode,
  escapeHtml,
  fetchInvitePreview,
  normaliseCode,
  parsePreview,
  pickLang,
  playUrl,
  previewLines,
  segmentsText,
  validCode,
  type InviteConfig,
  type InvitePreview,
  type Lang,
  type PreviewSegment,
  type Strings,
} from './render';

// ---------------------------------------------------------------------------------------------------------------
// Codes from the URL
// ---------------------------------------------------------------------------------------------------------------

/**
 * The invite code in a path such as `/i/ABCD-EFGH` (any prefix, a trailing slash, lower case, a dash, percent
 * encoding), normalised; null when the last segment after [prefix] is not a well-formed code.
 */
export function inviteCodeFromPath(pathname: string, prefix = '/i/'): string | null {
  const at = pathname.indexOf(prefix);
  if (at < 0) return null;
  const rest = pathname.slice(at + prefix.length).replace(/\/+$/, '');
  if (rest === '' || rest.includes('/')) return null;
  return codeOrNull(rest);
}

/** The code of a dynamic segment (`params.code` of `app/i/[code]`), normalised; null when malformed. */
export function inviteCodeFromParams(params: { code?: string | string[] | undefined } | null | undefined): string | null {
  const raw = params?.code;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v == null ? null : codeOrNull(v);
}

/** The code in a URL: its `/i/<code>` path, or `?code=` (`?referrer=code%3D…` too). */
export function inviteCodeFromUrl(url: string | URL, prefix = '/i/'): string | null {
  let u: URL;
  try {
    u = typeof url === 'string' ? new URL(url, 'https://invalid.invalid') : url;
  } catch {
    return null;
  }
  const fromPath = inviteCodeFromPath(u.pathname, prefix);
  if (fromPath) return fromPath;
  const q = u.searchParams.get('code') ?? u.searchParams.get('referrer')?.replace(/^code=/i, '') ?? null;
  return q == null ? null : codeOrNull(q);
}

function codeOrNull(raw: string): string | null {
  let v = raw;
  try {
    v = decodeURIComponent(raw);
  } catch {
    // Keep it as is.
  }
  const c = normaliseCode(v);
  return validCode(c) ? c : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The invite page as data, for apps that render their own page (app/i/[code]/page.tsx)
// ---------------------------------------------------------------------------------------------------------------

/** Wording for each language: the kit's (en, hi, id) with the app's own on top. */
export function inviteStrings(overrides?: Partial<Record<Lang, Strings>>): Record<Lang, Strings> {
  return { ...INVITE_STRINGS, ...(overrides ?? {}) };
}

/** Everything the invite page shows, as plain text (no HTML), for a React page. */
export interface InvitePageModel {
  readonly lang: Lang;
  /** "{app}: you're invited": the `<title>`; never the sharer's name. */
  readonly title: string;
  /** The page's h1: "Priya invited you to Example" with a preview name, else [title]. */
  readonly headline: readonly PreviewSegment[];
  readonly disclosure: readonly PreviewSegment[] | null;
  readonly reward: readonly PreviewSegment[] | null;
  readonly boost: readonly PreviewSegment[] | null;
  readonly lead: readonly PreviewSegment[];
  /** The normalised code, or null for a missing / malformed one (the page then says the link is not complete). */
  readonly code: string | null;
  /** `ABCD-EFGH`. */
  readonly codeDisplay: string | null;
  /** `A B C D E F G H` for screen readers. */
  readonly codeSpoken: string | null;
  readonly copy: string;
  readonly copied: string;
  readonly appStore: string;
  readonly appStoreNote: string;
  readonly appStoreUrl: string;
  readonly googlePlay: string;
  readonly playNote: string;
  /** The Play link with the code in the install referrer. */
  readonly playUrl: string;
  readonly terms: string;
  readonly termsUrl: string;
  readonly canonicalUrl: string;
  readonly ogImageUrl: string;
  /** For `<meta name="description">` / og:description: never the sharer's name. */
  readonly description: string;
}

export interface InvitePageModelOptions {
  config: InviteConfig;
  /** The raw code from the URL (normalised here). */
  code: string | null | undefined;
  lang?: Lang;
  /** The Accept-Language header, used when [lang] is not given. */
  acceptLanguage?: string | null;
  strings?: Partial<Record<Lang, Strings>>;
  preview?: InvitePreview | null;
  now?: Date;
}

/** The invite page's content for [code], the same lines as `renderInvite` without the HTML. */
export function invitePageModel(o: InvitePageModelOptions): InvitePageModel {
  const lang = o.lang ?? pickLang(o.acceptLanguage ?? null);
  const s = inviteStrings(o.strings)[lang];
  const cfg = o.config;
  const raw = o.code == null ? null : normaliseCode(o.code);
  const code = raw != null && validCode(raw) ? raw : null;
  const preview = code ? parsePreview(o.preview) : null;
  const pl = previewLines(preview, cfg, s, lang, o.now ?? new Date());
  const app = cfg.appName;
  const title = s.title.replaceAll('{app}', app);
  const lead = (code ? s.lead : s.invalid).replaceAll('{app}', app);
  return {
    lang,
    title,
    headline: pl.headline ?? [{ text: title }],
    disclosure: pl.disclosure,
    reward: pl.reward,
    boost: pl.boost,
    lead: pl.lead ?? [{ text: lead }],
    code,
    codeDisplay: code ? displayCode(code) : null,
    codeSpoken: code ? code.split('').join(' ') : null,
    copy: s.copy,
    copied: s.copied,
    appStore: s.appStore,
    appStoreNote: s.appStoreNote,
    appStoreUrl: cfg.appStoreUrl,
    googlePlay: s.googlePlay,
    playNote: s.playNote,
    playUrl: playUrl(cfg, code),
    terms: s.terms,
    termsUrl: cfg.siteUrl + (cfg.termsPath ?? '/terms'),
    canonicalUrl: cfg.siteUrl + '/i/' + (code ?? ''),
    ogImageUrl: cfg.ogImageUrl,
    description: lead,
  };
}

/** [invitePageModel] with the preview fetched on the server (when the config has `supabaseUrl` + `anonKey`). */
export async function loadInvitePageModel(
  o: Omit<InvitePageModelOptions, 'preview'> & { fetch?: typeof fetch; timeoutMs?: number },
): Promise<InvitePageModel> {
  const raw = o.code == null ? null : normaliseCode(o.code);
  const preview =
    raw && validCode(raw)
      ? await fetchInvitePreview(o.config.supabaseUrl, o.config.anonKey, raw, o.fetch ?? fetch, o.timeoutMs ?? 2000)
      : null;
  return invitePageModel({ ...o, preview });
}

export { segmentsText };

/** Plain text of a model line (for places that cannot hold a `<bdi>`). */
export const lineText = (segs: readonly PreviewSegment[] | null): string => (segs ? segmentsText(segs) : '');

// ---------------------------------------------------------------------------------------------------------------
// Next.js metadata
// ---------------------------------------------------------------------------------------------------------------

/** The subset of Next's `Metadata` this package fills (structurally compatible with `import type { Metadata }`). */
export interface InviteMetadata {
  title: string;
  description: string;
  robots: { index: false; follow: false };
  alternates: { canonical: string };
  openGraph: {
    type: 'website';
    title: string;
    description: string;
    url: string;
    images: Array<{ url: string; width: number; height: number }>;
  };
  twitter: { card: 'summary_large_image'; title: string; description: string; images: string[] };
  other: Record<string, string>;
}

/**
 * `generateMetadata` for an invite page: title and description in the page's language, `noindex, nofollow` (invite
 * links must not be indexed or end up on coupon sites, ADR 8, 12), the canonical `/i/<CODE>` URL, and the Open Graph
 * / Twitter card with the app's OG image. Never the sharer's name: chat apps cache link previews.
 *
 * ```ts
 * export async function generateMetadata({ params }) {
 *   const { code } = await params;
 *   return inviteMetadata({ config, code, acceptLanguage: (await headers()).get('accept-language') });
 * }
 * ```
 */
export function inviteMetadata(o: Omit<InvitePageModelOptions, 'preview' | 'now'>): InviteMetadata {
  const m = invitePageModel(o);
  return {
    title: m.title,
    description: m.description,
    robots: { index: false, follow: false },
    alternates: { canonical: m.canonicalUrl },
    openGraph: {
      type: 'website',
      title: m.title,
      description: m.description,
      url: m.canonicalUrl,
      images: [{ url: m.ogImageUrl, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image', title: m.title, description: m.description, images: [m.ogImageUrl] },
    other: { 'content-language': m.lang },
  };
}

/** Escapes for HTML attributes and text (exported for apps that write their own markup). */
export { escapeHtml };
