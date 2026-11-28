import {
  MyClaimState,
  ReferralEvent,
  ReferralEventName,
  ReferralPromptMoment,
  ReferralTerms,
  type KeyValueStore,
  type MyClaim,
  type ReferralClient,
  type ReferralPromptPolicy,
} from '@myind/referral-core';
import { ReferralStore } from '../store';

export interface WelcomeCardState {
  /** The claim to show a card for; null: no card. */
  readonly claim: MyClaim | null;
  /** The terms (for the pass-it-on reward); `none` for the claimed card or when they could not load. */
  readonly terms: ReferralTerms;
}

export interface WelcomeCardOptions {
  client: ReferralClient;
  store: KeyValueStore;
  policy?: ReferralPromptPolicy | null;
  clock: () => Date;
  /** Identifies this page load; see [welcomeCardSession]. */
  session: string;
  emit: (e: ReferralEvent) => void;
}

/**
 * Identifies this page load, so a card stays visible across re-renders within one visit but not on the next visit
 * the same day (Flutter's app launch). Pass `session` to the card to control it (tests, multi-tab apps).
 */
export const welcomeCardSession = `${Date.now()}-${Math.floor(Math.random() * 2 ** 30)}`;

export const welcomeCardKeys = {
  claimedShown: 'welcome_card.claimed.shown',
  claimedDismissed: 'welcome_card.claimed.dismissed',
  joined: 'welcome_card.joined',
} as const;

/**
 * The welcome card's logic (Flutter `_ReferralWelcomeCardState`): `referral_my_claim` decides; the claimed card shows
 * in at most one visit per day until dismissed for the day, the pass-it-on card once ever (and, with a policy, only
 * when `shouldPromptFor(welcomeRewardReceived)` allows it). Remembered in [WelcomeCardOptions.store].
 */
export class WelcomeCardController {
  readonly store = new ReferralStore<WelcomeCardState>({ claim: null, terms: ReferralTerms.none });
  opts: WelcomeCardOptions;
  private started = false;

  constructor(opts: WelcomeCardOptions) {
    this.opts = opts;
  }

  get state(): WelcomeCardState {
    return this.store.getSnapshot();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.load();
  }

  private day(): string {
    const d = this.opts.clock();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private async load(): Promise<void> {
    try {
      const claim = await this.opts.client.myClaim();
      let show = false;
      if (claim.state === MyClaimState.claimed) show = await this.mayShowClaimed();
      else if (claim.state === MyClaimState.joined) show = await this.mayShowJoined();
      if (!show) return;
      let terms = ReferralTerms.none;
      if (claim.state === MyClaimState.joined) {
        try {
          terms = await this.opts.client.terms();
        } catch {
          // The plain "invite a friend to {app}" line then.
        }
      }
      this.store.set({ claim, terms });
      this.opts.emit(new ReferralEvent(ReferralEventName.welcomeCardShown, { state: claim.state }));
    } catch {
      // Older server or offline: no card.
    }
  }

  private async mayShowClaimed(): Promise<boolean> {
    const s = this.opts.store,
      today = this.day(),
      session = this.opts.session;
    if ((await s.getString(welcomeCardKeys.claimedDismissed)) === today) return false;
    const shown = await s.getString(welcomeCardKeys.claimedShown);
    if (shown != null && shown.startsWith(`${today}|`) && shown !== `${today}|${session}`) return false;
    await s.setString(welcomeCardKeys.claimedShown, `${today}|${session}`);
    return true;
  }

  private async mayShowJoined(): Promise<boolean> {
    const s = this.opts.store,
      session = this.opts.session;
    const v = await s.getString(welcomeCardKeys.joined);
    if (v != null) return v === session;
    const policy = this.opts.policy;
    if (policy) {
      if (!(await policy.shouldPromptFor(ReferralPromptMoment.welcomeRewardReceived))) return false;
      await policy.markPromptedFor(ReferralPromptMoment.welcomeRewardReceived);
    }
    await s.setString(welcomeCardKeys.joined, session);
    return true;
  }

  /** Hides the card (`dismiss` or `invite`) and remembers it: for the day (claimed) or for good (joined). */
  async close(action: 'dismiss' | 'invite'): Promise<void> {
    const claim = this.state.claim;
    if (claim == null) return;
    this.store.set({ claim: null });
    this.opts.emit(new ReferralEvent(ReferralEventName.welcomeCardDismissed, { state: claim.state, action }));
    if (claim.state === MyClaimState.claimed) {
      await this.opts.store.setString(welcomeCardKeys.claimedDismissed, this.day());
    } else {
      await this.opts.store.setString(welcomeCardKeys.joined, 'done');
    }
  }
}
