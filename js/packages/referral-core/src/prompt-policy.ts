import { parseDateTime } from './json';
import type { KeyValueStore } from './storage';

/** Moments the kit itself may prompt at, each allowed a fixed number of times (0.5). */
export const ReferralPromptMoment = {
  /** A referred user just got their welcome reward: the pass-it-on card (G3). Once ever, never in the first session. */
  welcomeRewardReceived: 'welcome_reward_received',
} as const;
export type ReferralPromptMoment = (typeof ReferralPromptMoment)[keyof typeof ReferralPromptMoment];

const DAY = 24 * 60 * 60 * 1000;

/**
 * When the app may show its one "invite friends" prompt (ADR 11.4): never in the first session; at most one per
 * [minIntervalMs] (14 days); only after a moment of value this session; never during a purchase, within
 * [purchaseCooldownMs] after one, nor later in the session in which a purchase happened.
 *
 * Usage: [startSession] once per launch, [reportMomentOfValue] when the user got value, the purchase hooks around
 * store purchases, then `if (await policy.shouldPrompt()) { show(); await policy.markPrompted(); }`.
 */
export class ReferralPromptPolicy {
  private static readonly sessionsKey = 'prompt.sessions';
  private static readonly lastPromptKey = 'prompt.last_prompt_at';
  private static readonly lastPurchaseKey = 'prompt.last_purchase_at';

  private readonly store: KeyValueStore;
  private readonly clock: () => Date;
  readonly minIntervalMs: number;
  readonly purchaseCooldownMs: number;

  private session = 0;
  private valueThisSession = false;
  private purchasing = false;
  private purchasedThisSession = false;

  constructor(opts: { store: KeyValueStore; clock?: () => Date; minIntervalMs?: number; purchaseCooldownMs?: number }) {
    this.store = opts.store;
    this.clock = opts.clock ?? (() => new Date());
    this.minIntervalMs = opts.minIntervalMs ?? 14 * DAY;
    this.purchaseCooldownMs = opts.purchaseCooldownMs ?? DAY;
  }

  /** Counts a new app session. Call once per launch, before [shouldPrompt]. */
  async startSession(): Promise<void> {
    const raw = await this.store.getString(ReferralPromptPolicy.sessionsKey);
    const n = raw != null && /^\d+$/.test(raw) ? parseInt(raw, 10) : 0;
    this.session = n + 1;
    this.valueThisSession = false;
    this.purchasing = false;
    this.purchasedThisSession = false;
    await this.store.setString(ReferralPromptPolicy.sessionsKey, String(this.session));
  }

  /** The app's own moment of value (a chapter finished, a goal met). */
  reportMomentOfValue(): void {
    this.valueThisSession = true;
  }

  reportPurchaseStarted(): void {
    this.purchasing = true;
    this.purchasedThisSession = true;
  }

  /** Call when the purchase flow ends, whether it succeeded, failed or was cancelled. */
  async reportPurchaseFinished(): Promise<void> {
    this.purchasing = false;
    this.purchasedThisSession = true;
    await this.store.setString(ReferralPromptPolicy.lastPurchaseKey, this.clock().toISOString());
  }

  private async time(key: string): Promise<Date | null> {
    return parseDateTime(await this.store.getString(key), true);
  }

  private async outsideCooldowns(): Promise<boolean> {
    const now = this.clock().getTime();
    const purchase = await this.time(ReferralPromptPolicy.lastPurchaseKey);
    if (purchase != null && now - purchase.getTime() < this.purchaseCooldownMs) return false;
    const last = await this.time(ReferralPromptPolicy.lastPromptKey);
    if (last != null && now - last.getTime() < this.minIntervalMs) return false;
    return true;
  }

  async shouldPrompt(): Promise<boolean> {
    if (this.session <= 1) return false;
    if (!this.valueThisSession || this.purchasing || this.purchasedThisSession) return false;
    return this.outsideCooldowns();
  }

  /**
   * Whether the kit's own prompt for [moment] may show now: as [shouldPrompt] but the moment itself is the value, and
   * only once ever per moment. Call [markPromptedFor] when it shows.
   */
  async shouldPromptFor(moment: ReferralPromptMoment): Promise<boolean> {
    if (this.session <= 1 || this.purchasing || this.purchasedThisSession) return false;
    if ((await this.store.getString(ReferralPromptPolicy.momentKey(moment))) != null) return false;
    return this.outsideCooldowns();
  }

  /** Records that the prompt for [moment] was shown: it never shows again, and it counts as the last prompt. */
  async markPromptedFor(moment: ReferralPromptMoment): Promise<void> {
    const at = this.clock().toISOString();
    await this.store.setString(ReferralPromptPolicy.momentKey(moment), at);
    await this.store.setString(ReferralPromptPolicy.lastPromptKey, at);
  }

  private static momentKey(m: ReferralPromptMoment): string {
    return `prompt.moment.${m}`;
  }

  /** Records that the prompt was shown; the moment of value is used up. */
  async markPrompted(): Promise<void> {
    this.valueThisSession = false;
    await this.store.setString(ReferralPromptPolicy.lastPromptKey, this.clock().toISOString());
  }
}
