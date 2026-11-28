import type { ReferralUnavailableReason } from './availability';

/**
 * The app's own words for the invite screens. Every field is optional: what you leave out comes from the kit's
 * localisations (en, hi, id), built from the live terms. Use it for your app's voice ("Hear your first page read
 * aloud" instead of "Start using YourApp"). Keep overrides as honest as the defaults: name a reward only when the
 * terms give it (the `friendReward` argument is null when they do not), and use the server's days left.
 */
export interface ReferralTexts {
  /** The screen title ("Invite friends"). */
  readonly title?: string;
  /** The friend's part when there is no reward to name ("Have an invite code?"). */
  readonly entryTitle?: string;
  /** The friend's part headline. [friendReward] is null when the terms give none. */
  readonly giftTitle?: (friendReward: string | null) => string;
  /** The deadline chip for the server's [daysLeft] (1 = last day). */
  readonly deadline?: (daysLeft: number) => string;
  /** Above the steps ("How you get it"). */
  readonly stepsTitle?: string;
  /** Step 2 in the app's words, e.g. "Hear your first page read aloud". */
  readonly activationStep?: string;
  /** All the steps; wins over [activationStep]. [both]: the sharer gets the same reward. */
  readonly steps?: (friendReward: string | null, both: boolean) => string[];
  /** After a code is accepted ("Almost yours"). */
  readonly almostTitle?: string;
  readonly almostLine?: (friendReward: string | null, both: boolean) => string;
  /** "1 of 2 done: code added". */
  readonly almostProgress?: string;
  /** The button under "Almost yours" (shown only with `onAlmostAction`), e.g. "Start reading". */
  readonly almostActionLabel?: string;
  /** Why a code can't be added. [windowClosed]: the claim window is over; otherwise not eligible. */
  readonly cannotAdd?: (windowClosed: boolean, windowDays: number) => string;
  /** Under Share when the app has no invite page. */
  readonly noLinkHint?: (appName: string) => string;
  /** The share sentence without an invite page. [storeLink] is null when the app gave none. */
  readonly shareTextNoLink?: (code: string, storeLink: string | null) => string;
  /** The message when referrals cannot be used, per reason. */
  readonly unavailable?: (reason: ReferralUnavailableReason) => string;
  /** The Sign in button shown when signed out (with `onSignIn`). */
  readonly signIn?: string;
  /** The sharer's line for friends who used their code and have not started yet (`claimed_count` > 0). */
  readonly waiting?: (count: number, nextStep: string, sharerReward: string | null, friendReward: string | null) => string;
  /** The invite screen's give-first headline. Both rewards are null-able: name only what the terms give. */
  readonly inviteHeadline?: (friendReward: string | null, sharerReward: string | null) => string | null;
  /** The activation step as the sharer reads it about a friend ("Read their first page"); [activationStep] when unset. */
  readonly activationStepForFriends?: string;
}
