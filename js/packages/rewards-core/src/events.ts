/**
 * Analytics events for the rewards funnel. Forward `onEvent` to your analytics; the package logs nothing itself.
 * Props never carry a user id, an Instagram handle, a social code, a post link, an invite code, or a friend's id or
 * name.
 */
export const RewardsEventName = {
  /** Props: `programs` (count), `inbox` (count). */
  stateLoaded: 'rewards_state_loaded',
  /** Props: `type`, `duplicate`, `grants` (count). */
  tracked: 'rewards_tracked',
  /** Each grant id once per controller. Props: `program`, `kind`, `amount`, `state`. */
  grantReceived: 'rewards_grant_received',
  /** Props: `program`, `result` (`ok` or the refusal reason). */
  offerClaimed: 'rewards_offer_claimed',
  /** An offer was shown after its deadline. Props: `program`. */
  offerExpiredSeen: 'rewards_offer_expired_seen',
  /** Props: `program`, `result`. */
  socialStarted: 'rewards_social_started',
  /** Props: `program`. */
  socialCodeCopied: 'rewards_social_code_copied',
  /** Props: `program`. */
  instagramOpened: 'rewards_instagram_opened',
  /** Props: `count`. */
  inboxSeen: 'rewards_inbox_seen',
  /** Props: `program`, `result`. */
  quizStarted: 'rewards_quiz_started',
  /** Props: `program`, `index`, `correct`, `timed_out`. */
  quizAnswered: 'rewards_quiz_answered',
  /** Props: `program`, `score`, `total`, `grants` (count). */
  quizFinished: 'rewards_quiz_finished',
  /** Props: `program`, `units`, `result`. */
  rechargeUsed: 'rewards_recharge_used',
  /** Props: `program`, `result`. */
  friendInvited: 'rewards_friend_invited',
  /** Props: `result`. Never the code. */
  friendAccepted: 'rewards_friend_accepted',
  /** Props: `result`. */
  friendRemoved: 'rewards_friend_removed',
  /** Props: `program`, `result`. Never the link. */
  socialLinkSubmitted: 'rewards_social_link_submitted',
  /** Props: `result` (`verified` | `not_verified` | `error`). */
  adRewardShown: 'rewards_ad_reward_shown',
  /** Once per reveal. Props: `program`, `kind`. */
  revealOpened: 'rewards_reveal_opened',
  /** Props: `program`. */
  followupOpened: 'rewards_followup_opened',
  /** Props: `count`. */
  followupsPlanned: 'rewards_followups_planned',
  /** Once per saved key. Props: `field`, and `group` for `setFollowupGroupMuted`. Never the value. */
  followupPrefsChanged: 'rewards_followup_prefs_changed',
  /** Props: `reason` (`offline` | `server_error` | `unavailable` | a refusal | `notifier_error` | `store_error`). */
  followupsFailed: 'rewards_followups_failed',
  /** Props: `program`, `result`. */
  leagueJoined: 'rewards_league_joined',
  /** Props: `program`, `result`. */
  leagueLeft: 'rewards_league_left',
  /** Props: `reason` (`not_deployed` | `signed_out` | `no_project` | `offline` | `server_error` | `disabled`). */
  unavailable: 'rewards_unavailable',
} as const;
export type RewardsEventName = (typeof RewardsEventName)[keyof typeof RewardsEventName];

export type RewardsEventProps = Readonly<Record<string, string | number | boolean>>;

export class RewardsEvent {
  constructor(
    readonly name: RewardsEventName,
    readonly props: RewardsEventProps = {},
  ) {}
  /** The event name to send. */
  get wireName(): string {
    return this.name;
  }
  toString(): string {
    return `RewardsEvent(${this.name}, ${JSON.stringify(this.props)})`;
  }
}

export type RewardsEventSink = (event: RewardsEvent) => void;

/** Sends [event] to [sink]; an exception from the app's analytics never reaches the UI. */
export function reportRewardsEvent(sink: RewardsEventSink | null | undefined, event: RewardsEvent): void {
  if (!sink) return;
  try {
    sink(event);
  } catch {
    // Analytics never breaks the UI.
  }
}
