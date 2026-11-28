/**
 * @myind/referral-react: every referral_kit widget for React DOM, on top of `@myind/referral-core`. Client components
 * ("use client"), safe to import on the server (no window access at import). Styles: `@myind/referral-react/styles.css`
 * (CSS variables `--rfk-*`, light and dark).
 */
export {
  ReferralProvider,
  useReferral,
  useResolvedKit,
  defaultAttributionSource,
  type ReferralKitOptions,
  type ReferralContextValue,
  type ReferralProviderProps,
  type ResolvedKit,
} from './context';
export { ReferralStore, useReferralStore } from './store';
export {
  useInviteScreen,
  useCodeEntry,
  usePendingRewards,
  useWelcomeCard,
  useInvitePageSettings,
  useReferralTerms,
  useInviteCode,
  useClaim,
  usePendingClaimRetrier,
  useReferralPrompt,
  useReferralClient,
  type AsyncState,
  type UseInviteScreenOptions,
  type UseCodeEntryOptions,
  type UseRewardCardOptions,
  type UseWelcomeCardOptions,
  type UseInvitePageSettingsOptions,
} from './hooks';

export {
  InviteScreenController,
  inviteCodeCacheKey,
  type InviteScreenData,
  type InviteScreenOptions,
  type InviteScreenState,
  type InviteScreenStatus,
} from './controllers/invite-screen';
export {
  CodeEntryController,
  claimDaysLeft,
  type CodeEntryMessage,
  type CodeEntryOptions,
  type CodeEntryState,
} from './controllers/code-entry';
export { RewardCardController, type RewardCardOptions, type RewardCardState } from './controllers/reward-card';
export {
  WelcomeCardController,
  welcomeCardKeys,
  welcomeCardSession,
  type WelcomeCardOptions,
  type WelcomeCardState,
} from './controllers/welcome-card';
export {
  InvitePageSettingsController,
  type InvitePageSettingsOptions,
  type InvitePageSettingsState,
  type NameError,
  type PrefsStatus,
} from './controllers/invite-page-settings';

export { InviteCodeText, type InviteCodeTextProps, type InviteCodeTextRenderContext } from './components/code-text';
export {
  MyindAttribution,
  type MyindAttributionProps,
  type MyindAttributionRenderContext,
} from './components/myind-attribution';
export {
  ReferralMessage,
  ReferralUnavailableMessage,
  ReferralEntryUnavailable,
  unavailableMessage,
  type ReferralMessageProps,
  type ReferralUnavailableMessageProps,
  type ReferralEntryUnavailableProps,
  type ReferralUnavailableRender,
} from './components/message';
export {
  ReferralBoostBanner,
  ReferralDeadlineChip,
  ReferralQrCode,
  ReferralQrSheet,
  qrPath,
  type ReferralBoostBannerProps,
  type ReferralDeadlineChipProps,
  type ReferralQrCodeProps,
  type ReferralQrSheetProps,
} from './components/invite-extras';
export {
  InviteCodeEntry,
  InviteCodePasteButton,
  codeEntryMessageText,
  type InviteCodeEntryProps,
  type InviteCodeEntryRenderContext,
  type InviteCodePasteButtonProps,
} from './components/invite-code-entry';
export {
  InviteCodeSection,
  type InviteCodeSectionPhase,
  type InviteCodeSectionProps,
  type InviteCodeSectionRenderContext,
} from './components/invite-code-section';
export {
  ReferralInvitePageSettings,
  type ReferralInvitePageSettingsProps,
  type ReferralInvitePageSettingsRenderContext,
} from './components/invite-page-settings';
export {
  InviteFriendsScreen,
  type InviteFriendsScreenActions,
  type InviteFriendsScreenProps,
  type InviteFriendsScreenRenderContext,
} from './components/invite-friends-screen';
export {
  InviteHub,
  InviteHubSection,
  type InviteHubHandle,
  type InviteHubProps,
  type InviteHubRenderContext,
} from './components/invite-hub';
export {
  ReferralRewardCard,
  type ReferralRewardCardProps,
  type ReferralRewardCardRenderContext,
} from './components/reward-card';
export {
  ReferralWelcomeCard,
  type ReferralWelcomeCardProps,
  type ReferralWelcomeCardRenderContext,
} from './components/welcome-card';
export { RfkButton, RfkDialog, Spinner, cx, type StyleProps, type RfkButtonProps, type RfkDialogProps } from './ui';
