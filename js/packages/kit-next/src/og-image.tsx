/**
 * `@myind/kit-next/og`: the invite link's preview image with `next/og` (`ImageResponse`, 1200×630 PNG), the same
 * layout as `renderOgSvg`. One image per app and language, never per code and never with a name.
 */
import { ImageResponse } from 'next/og';
import { inviteOgModel, OG_HEIGHT, OG_WIDTH, type OgOptions } from './invite/og';
import { pickLang, type Lang } from './invite/render';

export { inviteOgModel, renderOgSvg, OG_WIDTH, OG_HEIGHT, type OgOptions, type OgModel } from './invite/og';

type ImageOptions = ConstructorParameters<typeof ImageResponse>[1];

/** The invite preview image as an `ImageResponse` (for `opengraph-image.tsx` or a route handler). */
export function inviteOgImage(o: OgOptions, init: ImageOptions = {}): ImageResponse {
  const m = inviteOgModel(o);
  // Satori lays out boxes, not SVG baselines: a line's top is its baseline minus ~0.8 of the font size.
  const top = (baseline: number, size: number): number => Math.round(baseline - size * 0.8);
  return new ImageResponse(
    (
      <div
        lang={m.lang}
        style={{
          width: OG_WIDTH,
          height: OG_HEIGHT,
          display: 'flex',
          position: 'relative',
          background: m.background,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ position: 'absolute', left: 0, top: 0, width: OG_WIDTH, height: 14, background: m.accent }} />
        <div
          style={{
            position: 'absolute',
            left: 80,
            top: 80,
            width: 96,
            height: 96,
            borderRadius: 24,
            background: m.accent,
            color: m.onAccent,
            fontSize: 56,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {m.initial}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 200,
            top: top(142, 40),
            fontSize: 40,
            fontWeight: 600,
            color: m.ink,
            display: 'flex',
          }}
        >
          {m.appLabel}
        </div>
        {m.headlineLines.map((line, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 80,
              top: top(m.headlineBaselines[i]!, m.headlineSize),
              fontSize: m.headlineSize,
              fontWeight: 800,
              color: m.ink,
              display: 'flex',
              whiteSpace: 'nowrap',
            }}
          >
            {line}
          </div>
        ))}
        <div
          style={{ position: 'absolute', left: 80, top: top(540, 34), fontSize: 34, color: m.muted, display: 'flex' }}
        >
          {m.subline}
        </div>
      </div>
    ),
    { width: OG_WIDTH, height: OG_HEIGHT, ...init },
  );
}

export interface InviteOgRouteOptions extends Omit<OgOptions, 'lang' | 'headline' | 'subline'> {
  /** Headline and subline per language (`?lang=hi`, else the Accept-Language header); English defaults. */
  texts?: Partial<Record<Lang, { headline?: string; subline?: string }>>;
  /** Seconds browsers and caches keep the image. Default one day. */
  cacheSeconds?: number;
}

/**
 * A route handler for the image: `app/og/invite/route.tsx` → `export const { GET } = createInviteOgRoute({...})`, then
 * point the invite config's `ogImageUrl` at it.
 */
export function createInviteOgRoute(opts: InviteOgRouteOptions): { GET: (request: Request) => Response } {
  return {
    GET(request) {
      const url = new URL(request.url);
      const q = url.searchParams.get('lang');
      const lang: Lang = q === 'en' || q === 'hi' || q === 'id' ? q : pickLang(request.headers.get('accept-language'));
      const t = opts.texts?.[lang] ?? {};
      return inviteOgImage(
        {
          appName: opts.appName,
          ...(opts.accent ? { accent: opts.accent } : {}),
          ...(opts.background ? { background: opts.background } : {}),
          ...(t.headline ? { headline: t.headline } : {}),
          ...(t.subline ? { subline: t.subline } : {}),
          lang,
        },
        { headers: { 'cache-control': `public, max-age=${opts.cacheSeconds ?? 86_400}, immutable` } },
      );
    },
  };
}
