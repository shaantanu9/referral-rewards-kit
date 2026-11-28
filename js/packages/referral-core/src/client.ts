import {
  availabilityFromReason,
  isNotDeployedError,
  ReferralAvailability,
  ReferralServerError,
  ReferralUnavailableException,
  ReferralUnavailableReason,
} from './availability';
import { isWellFormedCode, normaliseCode } from './code-format';
import { ReferralEventMemory } from './event-memory';
import {
  referralCodeHash,
  ReferralEvent,
  ReferralEventName,
  reportReferralEvent,
  rewardGrantedProps,
  type ReferralCodeHasher,
  type ReferralEventSink,
} from './events';
import type { ReferralRpc } from './http-rpc';
import type { InstallIdStore } from './install-id';
import { asList, asMap } from './json';
import {
  ActivationResult,
  ClaimResult,
  MyClaim,
  MyCodeResult,
  ReferralFormatException,
  ReferralPreferences,
  ReferralStats,
  ReferralTerms,
  RewardItem,
} from './models';
import type { KeyValueStore } from './storage';

export interface ReferralClientOptions {
  /** `referralHttpRpc(...)`, `supabaseRpc(supabase)`, or your own `(fn, params) => json`. */
  readonly rpc: ReferralRpc;
  readonly installIds: InstallIdStore;
  /** Receives every analytics event of this client, its queues and the widgets built on it. */
  readonly onEvent?: ReferralEventSink | null;
  /** Salt for `code_hash` in events. Set an app-specific value. Ignored with a [codeHasher]. */
  readonly codeHashSalt?: string;
  readonly codeHasher?: ReferralCodeHasher | null;
  /** Remembers once-only events across restarts (`reward_granted`, `referral_feature_hidden`). */
  readonly eventStore?: KeyValueStore | null;
  readonly clock?: () => Date;
  /** Recognises a "function not found" error of your rpc; default [isNotDeployedError]. */
  readonly isNotDeployed?: (error: unknown) => boolean;
}

/**
 * Typed client for the user RPCs in ADR 7. Every call sends the install id. It is also the one source of analytics:
 * give it `onEvent` and every widget and queue built on it reports the whole funnel.
 *
 * Throw [ReferralUnavailableException] from the rpc when referrals cannot work (not deployed, signed out, no
 * project); anything else is treated as offline. A PostgREST `PGRST202` error is recognised as not deployed.
 */
export class ReferralClient {
  private readonly rpc: ReferralRpc;
  private readonly installIds: InstallIdStore;
  private readonly notDeployed: (error: unknown) => boolean;
  private readonly codeHasher: ReferralCodeHasher | null;
  private readonly memory: ReferralEventMemory;
  readonly onEvent: ReferralEventSink | null;
  readonly codeHashSalt: string;

  constructor(opts: ReferralClientOptions) {
    this.rpc = opts.rpc;
    this.installIds = opts.installIds;
    this.onEvent = opts.onEvent ?? null;
    this.codeHashSalt = opts.codeHashSalt ?? 'referral_kit';
    this.codeHasher = opts.codeHasher ?? null;
    this.memory = new ReferralEventMemory({ store: opts.eventStore ?? null, ...(opts.clock ? { clock: opts.clock } : {}) });
    this.notDeployed = opts.isNotDeployed ?? isNotDeployedError;
  }

  /** Sends [event] to `onEvent`; exceptions from the sink are swallowed. */
  report(event: ReferralEvent): void {
    reportReferralEvent(this.onEvent, event);
  }

  /** The `code_hash` for [code] (normalised first). */
  codeHash(code: string): string {
    const h = this.codeHasher;
    return h == null ? referralCodeHash(code, this.codeHashSalt) : h(normaliseCode(code));
  }

  /** Reports `referral_feature_hidden` for [reason], at most once a day per reason. */
  async reportHidden(reason: string, opts: { surface?: string } = {}): Promise<void> {
    if (!this.onEvent || !(await this.memory.firstToday(reason))) return;
    this.report(new ReferralEvent(ReferralEventName.referralFeatureHidden, { reason, surface: opts.surface ?? 'app' }));
  }

  /** Reports `invite_link_opened` for a code that arrived from an invite link or the install referrer. */
  reportLinkOpened(code: string): void {
    const norm = normaliseCode(code);
    if (!isWellFormedCode(norm)) return;
    this.report(new ReferralEvent(ReferralEventName.inviteLinkOpened, { code_hash: this.codeHash(norm) }));
  }

  /** [quiet]: an RPC newer than the core set (migration 23); a server without it is not reported as hidden. */
  private async call(fn: string, extra: Record<string, unknown> = {}, quiet = false): Promise<unknown> {
    const id = await this.installIds.installId();
    let result: unknown;
    try {
      result = await this.rpc(fn, { ...extra, install_id: id });
    } catch (e) {
      if (e instanceof ReferralUnavailableException) {
        if (!quiet) void this.reportHidden(e.reason, { surface: 'client' });
        throw e;
      }
      if (this.notDeployed(e)) {
        if (!quiet) void this.reportHidden(ReferralUnavailableReason.notDeployed, { surface: 'client' });
        throw new ReferralUnavailableException(ReferralUnavailableReason.notDeployed);
      }
      throw e;
    }
    // A JSON string result (raw HTTP adapters) is decoded; a malformed one throws like Dart's jsonDecode.
    return typeof result === 'string' ? (JSON.parse(result) as unknown) : result;
  }

  /**
   * Whether referrals work for this user right now, by asking for the terms. Never throws. Anything but `available`
   * is reported as `referral_feature_hidden` (once a day per reason).
   */
  async availability(): Promise<ReferralAvailability> {
    let a: ReferralAvailability;
    try {
      await this.terms();
      return ReferralAvailability.available;
    } catch (e) {
      if (e instanceof ReferralUnavailableException) return availabilityFromReason(e.reason);
      a =
        e instanceof ReferralServerError || e instanceof ReferralFormatException
          ? ReferralAvailability.serverError
          : ReferralAvailability.offline;
    }
    await this.reportHidden(a === ReferralAvailability.offline ? 'offline' : 'server_error', { surface: 'client' });
    return a;
  }

  /** `referral_my_code`: the caller's active code, created once; `left` after they left the program. */
  async myCode(): Promise<MyCodeResult> {
    return MyCodeResult.fromJson(await this.call('referral_my_code'));
  }

  /** `referral_rotate_code`: retires the code and issues a new one, at most once per 30 days (`too_soon`). */
  async rotateCode(): Promise<MyCodeResult> {
    return MyCodeResult.fromJson(await this.call('referral_rotate_code'), 'referral_rotate_code');
  }

  /** `referral_claim`. Use `PendingClaimQueue.claim` in apps: it keeps the code offline and reports events. */
  async claim(code: string): Promise<ClaimResult> {
    return ClaimResult.fromJson(await this.call('referral_claim', { code: normaliseCode(code) }));
  }

  /** `referral_terms`: active rules, caps and windows. */
  async terms(): Promise<ReferralTerms> {
    return ReferralTerms.fromJson(await this.call('referral_terms'));
  }

  /** `referral_check_activation`: asks the server to evaluate the app's activation hook now. */
  async checkActivation(): Promise<ActivationResult> {
    return ActivationResult.fromJson(await this.call('referral_check_activation'));
  }

  /** `referral_stats`. */
  async stats(): Promise<ReferralStats> {
    return ReferralStats.fromJson(await this.call('referral_stats'));
  }

  /**
   * `referral_pending`: granted or banked rewards this device has not shown yet. Reports `reward_granted` once per
   * granted reward (remembered in `eventStore`).
   */
  async pending(): Promise<RewardItem[]> {
    const items = asList(await this.call('referral_pending'), 'referral_pending').map((r) => RewardItem.fromJson(r));
    if (this.onEvent) {
      const granted = items.filter((r) => r.state !== 'banked' && r.id !== '');
      const fresh = new Set(await this.memory.newRewards(granted.map((r) => r.id)));
      for (const r of granted) {
        if (fresh.has(r.id)) this.report(new ReferralEvent(ReferralEventName.rewardGranted, rewardGrantedProps(r)));
      }
    }
    return items;
  }

  /** `referral_ack`: marks rewards as shown on this device. Returns how many were newly recorded. */
  async ack(rewardIds: readonly string[]): Promise<number> {
    if (rewardIds.length === 0) return 0;
    const m = asMap(await this.call('referral_ack', { reward_ids: [...rewardIds] }), 'referral_ack');
    const n = m['acknowledged'];
    return typeof n === 'number' ? Math.trunc(n) : 0;
  }

  /** `referral_preferences` (migration 23). Throws `not_deployed` on an older server, without reporting it. */
  async preferences(): Promise<ReferralPreferences> {
    return ReferralPreferences.fromJson(await this.call('referral_preferences', {}, true));
  }

  /**
   * `referral_preferences_set` (migration 23). Sends only what is given: [showName] and [displayName] (an empty name
   * clears it), [participating] false to leave the invite program and true to join again. A refusal comes back as
   * `reason` (`under_age`, `anonymous_user`, `invalid_name`); check names first with `displayNameProblem`.
   */
  async setPreferences(opts: { showName?: boolean; displayName?: string; participating?: boolean }): Promise<ReferralPreferences> {
    const prefs: Record<string, unknown> = {};
    if (opts.showName !== undefined) prefs['show_name'] = opts.showName;
    if (opts.displayName !== undefined) {
      const name = opts.displayName.trim();
      prefs['display_name'] = name === '' ? null : name;
    }
    if (opts.participating !== undefined) prefs['participating'] = opts.participating;
    return ReferralPreferences.fromJson(
      await this.call('referral_preferences_set', { prefs }, true),
      'referral_preferences_set',
    );
  }

  /** `referral_my_claim` (migration 23): the caller's own claim as a friend. */
  async myClaim(): Promise<MyClaim> {
    return MyClaim.fromJson(await this.call('referral_my_claim', {}, true));
  }
}
