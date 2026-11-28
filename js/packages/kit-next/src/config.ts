/** The part of `next.config` this helper touches (structurally compatible with Next's `NextConfig`). */
export interface NextConfigLike {
  headers?: () => Promise<HeaderRule[]> | HeaderRule[];
  [key: string]: unknown;
}

export interface HeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
  [key: string]: unknown;
}

export interface WithReferralKitOptions {
  /** Where the invite route lives. Default `/i`. */
  invitePath?: string;
  /**
   * Serve `/.well-known/apple-app-site-association` as JSON (it has no extension, and iOS ignores it with another
   * type) and `/.well-known/assetlinks.json` uncached enough to update. Default true.
   */
  wellKnown?: boolean;
}

/**
 * Adds the invite route's response headers to a Next.js config: `X-Robots-Tag: noindex, nofollow` on every invite
 * link (ADR 8, 12: never indexed, never on coupon sites) and the right content type for the app-link files in
 * `public/.well-known/`. Keeps the app's own `headers()`.
 *
 * ```js
 * // next.config.mjs
 * import { withReferralKit } from '@myind/kit-next';
 * export default withReferralKit({ reactStrictMode: true });
 * ```
 */
export function withReferralKit<C extends NextConfigLike>(
  config: C = {} as C,
  opts: WithReferralKitOptions = {},
): C & { headers: () => Promise<HeaderRule[]> } {
  const base = (opts.invitePath ?? '/i').replace(/\/+$/, '');
  const ours: HeaderRule[] = [
    {
      source: `${base}/:code*`,
      headers: [
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ],
    },
  ];
  if (opts.wellKnown !== false) {
    ours.push(
      {
        source: '/.well-known/apple-app-site-association',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
      },
      {
        source: '/.well-known/assetlinks.json',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
    );
  }
  const theirs = config.headers;
  return {
    ...config,
    async headers() {
      const existing = theirs ? await theirs() : [];
      return [...existing, ...ours];
    },
  };
}
