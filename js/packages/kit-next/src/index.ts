/**
 * @myind/kit-next: Next.js App Router helpers for referral-kit. Server-safe (no React, no window): the referral RPC for
 * server components and route handlers, the invite landing route `/i/[code]` with its metadata, the terms page, the
 * OG image layout, and `withReferralKit` for next.config. The image itself is in `@myind/kit-next/og` (`next/og`), the
 * attribution link in `@myind/kit-next/attribution`.
 */
export {
  createReferralRpc,
  createServerReferralClient,
  isSecretSupabaseKey,
  noStoreTransport,
  type ServerReferralClientOptions,
  type ServerReferralRpcOptions,
} from './rpc';
export {
  createInviteRoute,
  createTermsRoute,
  type InviteRouteOptions,
  type RouteContext,
  type TermsRouteOptions,
} from './route';
export {
  inviteCodeFromParams,
  inviteCodeFromPath,
  inviteCodeFromUrl,
  inviteMetadata,
  invitePageModel,
  inviteStrings,
  lineText,
  loadInvitePageModel,
  type InviteMetadata,
  type InvitePageModel,
  type InvitePageModelOptions,
} from './invite/page';
export {
  boostDate,
  cleanName,
  displayCode,
  escapeHtml,
  fetchInvitePreview,
  fillSegments,
  langLocale,
  normaliseCode,
  parsePreview,
  pickLang,
  playUrl,
  previewLines,
  renderInvite,
  renderTerms,
  rewardText,
  scriptJson,
  segmentsHtml,
  segmentsText,
  termsLines,
  validCode,
  type InviteConfig,
  type InvitePreview,
  type Lang,
  type PluralLabel,
  type PreviewLines,
  type PreviewReward,
  type PreviewSegment,
  type PreviewStrings,
  type RenderOptions,
  type Strings,
  type Terms,
  type TermsRewardLabels,
} from './invite/render';
export { INVITE_STRINGS } from './invite/strings';
export { INVITE_TEMPLATE } from './invite/template';
export {
  inviteOgModel,
  OG_HEIGHT,
  OG_WIDTH,
  renderOgSvg,
  safeColour,
  textOn,
  wrap,
  type OgModel,
  type OgOptions,
} from './invite/og';
export { withReferralKit, type HeaderRule, type NextConfigLike, type WithReferralKitOptions } from './config';
