/**
 * The "Built with Myind" attribution link (ADR 0003, amended 2026-11-27): on by default on the top-level screens,
 * free to remove (`showAttribution: false`), no licence key, MIT. One config per platform; this file is identical in
 * `@myind/referral-core` and `@myind/rewards-core` (a test in each asserts the same outputs), so the two packages stay
 * independent like the Dart ones. No telemetry: the only signal is the UTM tags on the link the user taps.
 */

export interface AttributionVariant {
  /** The link text. */
  readonly text: string;
  /** Where it goes, before the UTM tags. */
  readonly url: string;
}

export const MYIND_ATTRIBUTION = {
  siteUrl: 'https://www.myind.ai',
  homeUrl: 'https://www.myind.ai/referral-kit',
  showcaseUrl: 'https://www.myind.ai/referral-kit/showcase',
  proUrl: 'https://www.myind.ai/referral-kit/pro',
  badgeUrl: 'https://www.myind.ai/referral-kit/badge.svg',
  githubUrl: 'https://github.com/shaantanu9/referral-rewards-kit',
  utmMedium: 'attribution',
  /** Rotating anchor texts (ADR §STEP 1: not the same anchor everywhere). Index with [attributionLink]. */
  variants: [
    { text: 'Built with Myind referral kit', url: 'https://www.myind.ai/referral-kit' },
    { text: 'Rewards by Myind', url: 'https://www.myind.ai/referral-kit' },
    { text: 'Free referral kit by Myind', url: 'https://www.myind.ai/referral-kit/showcase' },
    { text: 'Made with Myind', url: 'https://www.myind.ai' },
  ] as readonly AttributionVariant[],
} as const;

export const showcaseUrl = MYIND_ATTRIBUTION.showcaseUrl;
export const proUrl = MYIND_ATTRIBUTION.proUrl;
export const badgeUrl = MYIND_ATTRIBUTION.badgeUrl;
export const githubUrl = MYIND_ATTRIBUTION.githubUrl;

/** One resolved attribution link. */
export interface AttributionLink {
  /** The variant index actually used (0..3, after wrapping). */
  readonly variant: number;
  readonly text: string;
  /** The URL with `utm_source`, `utm_medium=attribution` and `utm_campaign=v<variant>`. */
  readonly url: string;
  /** Accessibility label: `Opens myind.ai: <text>`. */
  readonly label: string;
}

/** [variant] wrapped into the variant list (negative and out-of-range values wrap; fractions are truncated). */
export function attributionVariantIndex(variant: number): number {
  const n = MYIND_ATTRIBUTION.variants.length;
  const v = Number.isFinite(variant) ? Math.trunc(variant) : 0;
  return ((v % n) + n) % n;
}

/** `Opens myind.ai: <text>`. */
export const attributionLabel = (text: string): string => `Opens myind.ai: ${text}`;

const utmKeys = new Set(['utm_source', 'utm_medium', 'utm_campaign']);

/**
 * [url] with the attribution UTM tags. Keeps an existing query (any old `utm_source` / `utm_medium` /
 * `utm_campaign` is replaced) and fragment.
 */
export function withAttributionUtm(url: string, source: string, variant: number): string {
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.substring(hashAt) : '';
  const beforeHash = hashAt >= 0 ? url.substring(0, hashAt) : url;
  const qAt = beforeHash.indexOf('?');
  const base = qAt >= 0 ? beforeHash.substring(0, qAt) : beforeHash;
  const kept = (qAt >= 0 ? beforeHash.substring(qAt + 1) : '')
    .split('&')
    .filter((p) => p !== '' && !utmKeys.has(decodeURIComponentSafe(p.split('=')[0] ?? '')));
  const tags = [
    `utm_source=${encodeURIComponent(source)}`,
    `utm_medium=${MYIND_ATTRIBUTION.utmMedium}`,
    `utm_campaign=v${attributionVariantIndex(variant)}`,
  ];
  return `${base}?${[...kept, ...tags].join('&')}${hash}`;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * The attribution link for [variant] (wrapping modulo the 4 variants) tagged for [source]: the app or package that
 * shows it, e.g. `com.acme.reader` or `referral-react`.
 *
 * ```ts
 * attributionLink(0, 'acme') // { text: 'Built with Myind referral kit',
 * //   url: 'https://www.myind.ai/referral-kit?utm_source=acme&utm_medium=attribution&utm_campaign=v0', … }
 * ```
 */
export function attributionLink(variant: number, source: string): AttributionLink {
  const i = attributionVariantIndex(variant);
  const v = MYIND_ATTRIBUTION.variants[i]!;
  return { variant: i, text: v.text, url: withAttributionUtm(v.url, source, i), label: attributionLabel(v.text) };
}
