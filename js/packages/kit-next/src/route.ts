import { inviteCodeFromParams, inviteStrings } from './invite/page';
import {
  fetchInvitePreview,
  normaliseCode,
  pickLang,
  renderInvite,
  renderTerms,
  validCode,
  type InviteConfig,
  type Lang,
  type Strings,
  type Terms,
  type TermsRewardLabels,
} from './invite/render';
import { INVITE_TEMPLATE } from './invite/template';

/** The second argument of a route handler: Next 15+ passes `params` as a promise (14 as an object). */
export interface RouteContext<P> {
  params: Promise<P> | P;
}

export interface InviteRouteOptions {
  config: InviteConfig;
  /** The app's own wording per language, over the kit's en / hi / id. */
  strings?: Partial<Record<Lang, Strings>>;
  /** The page template (default: the kit's, `INVITE_TEMPLATE`). */
  template?: string;
  /**
   * Fetch the invite preview (sharer's opted-in first name, the friend's reward, a boost) on the server. Default true
   * when the config has `supabaseUrl` and `anonKey`. False: the page's script fetches it in the browser instead.
   */
  serverPreview?: boolean;
  /** Picks the language; default: the `Accept-Language` header. */
  lang?: (request: Request) => Lang;
  /** Seconds a shared cache may keep a page without a preview. Default 300. Pages with a preview are `no-store`. */
  cacheSeconds?: number;
  fetch?: typeof fetch;
  now?: () => Date;
}

const securityHeaders = {
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
} as const;

/**
 * The invite landing for `app/i/[code]/route.ts`: the kit's invite page (ported from `web/invite`) rendered on the
 * server, so the code shows with JavaScript off. Title, description, canonical URL, Open Graph and Twitter tags,
 * `noindex, nofollow`, the store buttons (the Play link carries the code in the install referrer; the App Store button
 * copies the code in the same tap), the terms link, and the preview when configured. A malformed code renders the
 * "link is not complete" page (status 200), never an error page and never the raw input.
 *
 * ```ts
 * // app/i/[code]/route.ts
 * import { createInviteRoute } from '@myind/kit-next';
 * export const { GET } = createInviteRoute({ config });
 * ```
 */
export function createInviteRoute(opts: InviteRouteOptions): {
  GET: (request: Request, context: RouteContext<{ code?: string | string[] }>) => Promise<Response>;
} {
  const strings = inviteStrings(opts.strings);
  const template = opts.template ?? INVITE_TEMPLATE;
  const cfg = opts.config;
  const serverPreview = opts.serverPreview ?? (!!cfg.supabaseUrl && !!cfg.anonKey);
  return {
    async GET(request, context) {
      const params = await context.params;
      const raw = Array.isArray(params?.code) ? params.code[0] : params?.code;
      const code = inviteCodeFromParams(params) ?? (raw ? normaliseCode(safeDecode(raw)) : null);
      const lang = opts.lang?.(request) ?? pickLang(request.headers.get('accept-language'));
      const now = opts.now?.() ?? new Date();
      const ok = code != null && validCode(code);
      const preview =
        serverPreview && ok
          ? await fetchInvitePreview(cfg.supabaseUrl, cfg.anonKey, code, opts.fetch ?? fetch)
          : undefined;
      const html = renderInvite(template, cfg, strings[lang], lang, code, {
        ...(serverPreview ? { preview: preview ?? null } : {}),
        now,
      });
      return new Response(html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-language': lang,
          vary: 'accept-language',
          'cache-control':
            preview != null ? 'private, no-store' : `public, max-age=0, s-maxage=${opts.cacheSeconds ?? 300}`,
          ...securityHeaders,
        },
      });
    },
  };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export interface TermsRouteOptions {
  config: Pick<InviteConfig, 'appName'>;
  /** The live `referral_terms()` export (e.g. from your database, cached), or a function returning it. */
  terms: Terms | (() => Terms | Promise<Terms>);
  /** Wording per reward kind, e.g. `{ minutes: (n) => `${n} min of natural voice` }`. */
  labels?: TermsRewardLabels;
  cacheSeconds?: number;
}

/** The program terms page for `app/terms/route.ts`, generated from the live rules (ADR 11.1). */
export function createTermsRoute(opts: TermsRouteOptions): { GET: (request: Request) => Promise<Response> } {
  return {
    async GET(request) {
      const t = typeof opts.terms === 'function' ? await opts.terms() : opts.terms;
      const lang = pickLang(request.headers.get('accept-language'));
      return new Response(renderTerms(t, opts.labels ?? {}, opts.config, lang), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': `public, max-age=0, s-maxage=${opts.cacheSeconds ?? 300}`,
          ...securityHeaders,
        },
      });
    },
  };
}
