/**
 * Every analytics event the package reports: the whole referral funnel, so an app forwards `onEvent` to its
 * analytics and logs nothing of its own. Wire names never change once shipped; a new event gets a new name. The
 * props table is in the Flutter package README ("Analytics events").
 */
import {
  ReferralServerError,
  ReferralUnavailableException,
} from './availability';
import { normaliseCode } from './code-format';
import { ClaimReason, ReferralFormatException, type ClaimResult, type RewardItem } from './models';
import { sha256Hex } from './sha256';
import type { ClaimOutcome } from './pending-claim';

/** Event names, as sent (`wireName`). */
export const ReferralEventName = {
  /** Props: `from`, `focus` (`share` | `code`). */
  inviteScreenViewed: 'invite_screen_viewed',
  /** Props: `has_link`. */
  inviteCodeCopied: 'invite_code_copied',
  /** Props: `status`, `channel`, `has_link`. WhatsApp button: `channel: whatsapp_button`, `status` `opened` | `unavailable`. */
  inviteShared: 'invite_shared',
  /** Props: `code_hash`. */
  inviteLinkOpened: 'invite_link_opened',
  /** Props: `source` (`typed` | `focus` | `pasted` | `prefilled`). Once per entry widget. */
  codeEntryStarted: 'code_entry_started',
  /** Props: `code_hash`, `source`. */
  codeSubmitted: 'code_submitted',
  /** Props: `result` ([claimEventResult]), `via` (`entry` | `retry`), `code_hash`, and for retries `trigger`. */
  codeClaimResult: 'code_claim_result',
  /** Props: `kind`, `amount`, `who`, `event`. Once per reward on this device. */
  rewardGranted: 'reward_granted',
  /** Props: `kind`, `event`, `who`, `state`. */
  rewardShown: 'reward_shown',
  /** Props: as `reward_shown`, plus `acknowledged`. */
  rewardAcknowledged: 'reward_acknowledged',
  /** The "Show QR code" sheet opened with the invite link (0.5). No props. */
  inviteQrShown: 'invite_qr_shown',
  /** Props: `state` (`claimed` | `joined`). */
  welcomeCardShown: 'welcome_card_shown',
  /** Props: `state`, `action` (`dismiss` | `invite`). */
  welcomeCardDismissed: 'welcome_card_dismissed',
  /** Props: `show_name` and/or `participating`; `result`. Never the name. */
  invitePreferencesChanged: 'invite_preferences_changed',
  /** Props: `reason`, `surface` (`client` | `invite` | `entry` | `app`). At most once a day per reason. */
  referralFeatureHidden: 'referral_feature_hidden',
} as const;
export type ReferralEventName = (typeof ReferralEventName)[keyof typeof ReferralEventName];

/** The 0.2.0 names, for an app that wants to keep its old event names; missing for events new in 0.3.0. */
export const referralLegacyEventNames: Readonly<Partial<Record<ReferralEventName, string>>> = {
  invite_screen_viewed: 'referral_invite_viewed',
  invite_code_copied: 'referral_code_copied',
  invite_shared: 'referral_invite_shared',
  code_entry_started: 'referral_code_entry_started',
  code_submitted: 'referral_code_submitted',
  code_claim_result: 'referral_claim_result',
  reward_shown: 'referral_reward_shown',
  reward_acknowledged: 'referral_reward_acknowledged',
  referral_feature_hidden: 'referral_feature_unavailable',
};

export type EventProps = Readonly<Record<string, string | number | boolean>>;

/**
 * One analytics event: a name and a few small properties. Never carries an invite code, a user id or an install id;
 * codes appear only as a hash (`ReferralClient.codeHash`).
 */
export class ReferralEvent {
  constructor(
    readonly name: ReferralEventName,
    readonly props: EventProps = {},
  ) {}

  /** The event name to send, e.g. `invite_code_copied`. */
  get wireName(): string {
    return this.name;
  }

  /** The 0.2.0 name (or [wireName] for events new in 0.3.0). */
  get legacyWireName(): string {
    return referralLegacyEventNames[this.name] ?? this.name;
  }

  toString(): string {
    return `ReferralEvent(${this.name}, ${JSON.stringify(this.props)})`;
  }
}

/** Receives every [ReferralEvent]: `onEvent: (e) => analytics.track(e.wireName, e.props)`. */
export type ReferralEventSink = (event: ReferralEvent) => void;

/** Turns a normalised code into the `code_hash` sent in events. */
export type ReferralCodeHasher = (normalisedCode: string) => string;

/**
 * A short, stable, one-way id for an invite code: the first 12 hex characters of SHA-256(`salt:CODE`), on the
 * normalised code. Use an app-specific [salt].
 */
export const referralCodeHash = (code: string, salt = 'referral_kit'): string =>
  sha256Hex(`${salt}:${normaliseCode(code)}`).substring(0, 12);

/** Calls [sink] and swallows anything it throws: analytics must never break the referral flow. */
export function reportReferralEvent(sink: ReferralEventSink | null | undefined, event: ReferralEvent): void {
  if (!sink) return;
  try {
    sink(event);
  } catch {
    // An analytics failure is not the user's problem.
  }
}

/** Every value [claimEventResult] can return. Stable: names are never renamed or removed. */
export const claimResultNames: ReadonlySet<string> = new Set([
  'ok',
  'invalid',
  'expired',
  'own_code',
  'same_install',
  'already_used',
  'not_verified',
  'rate_limited',
  'paused',
  'under_age',
  'anonymous',
  'offline_queued',
  'not_deployed',
  'signed_out',
  'no_project',
  'server_error',
  'other',
]);

/**
 * The `result` of a claim, one name per outcome (see [claimResultNames]). Switch on the string with a default
 * branch: a newer server's outcome arrives as `other`.
 */
export function claimEventResult(outcome: ClaimOutcome): string {
  const error = outcome.error;
  if (outcome.status === 'queued_offline') {
    if (error instanceof ReferralUnavailableException) return error.reason;
    if (error instanceof ReferralServerError || error instanceof ReferralFormatException) return 'server_error';
    return 'offline_queued';
  }
  const r = outcome.result;
  if (r == null) return 'server_error';
  return claimReasonName(r.reason);
}

/** The event name of a server claim reason ([claimEventResult] without the kept-code cases). */
export function claimReasonName(reason: ClaimReason): string {
  switch (reason) {
    case ClaimReason.ok:
      return 'ok';
    case ClaimReason.unknownCode:
      return 'invalid';
    case ClaimReason.windowClosed:
      return 'expired';
    case ClaimReason.ownCode:
      return 'own_code';
    case ClaimReason.sameInstall:
      return 'same_install';
    case ClaimReason.alreadyReferred:
      return 'already_used';
    case ClaimReason.notVerified:
      return 'not_verified';
    case ClaimReason.rateLimited:
      return 'rate_limited';
    case ClaimReason.programPaused:
      return 'paused';
    case ClaimReason.underAge:
      return 'under_age';
    case ClaimReason.anonymousUser:
      return 'anonymous';
    case ClaimReason.unknown:
      return 'other';
  }
}

/** [claimReasonName] of a result (Dart: `result.resultName`). */
export const claimResultName = (r: ClaimResult): string => claimReasonName(r.reason);

/** Props of a reward card event, without ids. */
export function rewardEventProps(r: RewardItem): EventProps {
  const p: Record<string, string | number | boolean> = { kind: r.kind };
  if (r.event != null) p['event'] = r.event;
  if (r.who != null) p['who'] = r.who;
  if (r.state != null) p['state'] = r.state;
  return p;
}

/** Props of `reward_granted`: `kind`, `amount`, `who`, `event`. */
export function rewardGrantedProps(r: RewardItem): EventProps {
  const p: Record<string, string | number | boolean> = { kind: r.kind, amount: r.amount };
  if (r.who != null) p['who'] = r.who;
  if (r.event != null) p['event'] = r.event;
  return p;
}
