/**
 * `@myind/referral-core/testing`: an in-memory stand-in for the kit's Supabase functions, so every referral widget
 * state can be shown in demos, stories and tests with no server. A port of the Flutter starter app's
 * `FakeReferralServer` (examples/starter_app/lib/fake_referral_server.dart), with extra switches for the states the
 * starter app could not reach (offline, server error, not verified, rate limited, banked and pending rewards, paid
 * rewards, code rotation).
 */
import {
  ReferralNetworkError,
  ReferralServerError,
  ReferralUnavailableException,
  ReferralUnavailableReason,
} from '../availability';
import { ReferralClient, type ReferralClientOptions } from '../client';
import { normaliseCode } from '../code-format';
import type { ReferralRpc } from '../http-rpc';
import { FixedInstallIdStore } from '../install-id';
import { displayNameProblem } from '../models';
import type { Subscribe } from '../pending-claim';
import { MemoryKeyValueStore, type KeyValueStore } from '../storage';

type Json = Record<string, unknown>;
const DAY = 24 * 60 * 60 * 1000;

export interface FakeReferralServerOptions {
  signedIn?: boolean;
  /** A ×2 boost for both sides, ending in 3 days at local midnight. Default true. */
  boost?: boolean;
  /** Milliseconds each call waits (a real server is not instant). Default 0. */
  latencyMs?: number;
  /** The fake's "now". Default `() => new Date()`. */
  clock?: () => Date;
}

/** One recorded call. */
export interface FakeCall {
  readonly fn: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * Answers the same RPC names with the same JSON shapes as the SQL (migrations 2, 3, 9, 18, 23). It also plays the
 * other people in the story: a friend who signs up with your code ([aFriendSignsUp]), then starts using the app
 * ([aFriendStarts]) or buys ([aFriendPays]). Every field is public: set it to show a state.
 */
export class FakeReferralServer {
  /** The demo user's own code, and a friend's code that works. */
  static readonly myCode = 'K7QM2XRA';
  static readonly friendCode = 'H4PZ8WNE';

  latencyMs: number;
  clock: () => Date;
  /** False: every call throws `not_deployed` (the "not available yet" state). */
  deployed = true;
  /** True: every call throws a network error (the offline state; claims are queued). */
  offline = false;
  /** True: every call throws a 500 [ReferralServerError]. */
  serverError = false;
  /** The terms' `enabled` and `paid_enabled`. */
  enabled = true;
  paidEnabled = true;
  /** The boost (×2) runs; [boostMultiplier] and [boostWho] shape it. */
  boost: boolean;
  boostMultiplier = 2;
  boostWho: string[] = ['sharer', 'friend'];
  /** `referral_my_code` reason other than ok, e.g. `program_paused`, `code_disabled`, `anonymous_user`. */
  codeReason: string | null = null;
  /** The sharer's invite page settings (`referral_preferences`). */
  showName = false;
  displayName: string | null = null;
  left = false;
  /** A refusal for `referral_preferences_set`: `under_age` or `anonymous_user`. */
  preferencesRefusal: string | null = null;
  /** The server's days left to add a code (`claim_days_left`); null: this account cannot add one. */
  claimDaysLeft: number | null = 3;
  /** The friend side: this user added a code. */
  claimed = false;
  /** Forces the next claims' answer, e.g. `not_verified`, `rate_limited`, `same_install`, `program_paused`. */
  claimReason: string | null = null;
  /** With `rate_limited`. */
  retryAfterSeconds = 120;
  /** Friends who used your code and have not started (`claimed_count`) / who started (`joined_count`). */
  claimedFriends = 0;
  joinedFriends = 0;
  paidFriends: number | null = null;
  skippedCap = 0;
  /** Rewards still on hold (`referral_stats.pending`) and banked ones (`banked`, also in `referral_pending`). */
  readonly pendingRewards: Json[] = [];
  readonly bankedRewards: Json[] = [];
  /** When the code was last rotated (`referral_rotate_code` allows one per 30 days). */
  lastRotatedAt: Date | null = null;
  readonly calls: FakeCall[] = [];

  private currentCode = FakeReferralServer.myCode;
  private signedInValue: boolean;
  private readonly signInListeners = new Set<() => void>();
  private claimBoosted = false;
  private readonly friendBoosts: boolean[] = [];
  private readonly granted: Json[] = [];
  private readonly acked = new Set<string>();
  private nextId = 1;

  constructor(opts: FakeReferralServerOptions = {}) {
    this.signedInValue = opts.signedIn ?? true;
    this.boost = opts.boost ?? true;
    this.latencyMs = opts.latencyMs ?? 0;
    this.clock = opts.clock ?? (() => new Date());
  }

  /** The app's sign-in, played here. */
  get signedIn(): boolean {
    return this.signedInValue;
  }
  set signedIn(v: boolean) {
    if (v === this.signedInValue) return;
    this.signedInValue = v;
    for (const l of [...this.signInListeners]) l();
  }

  /** Sign-in changes as a [Subscribe], for `PendingClaimRetrier({signInChanges})`. */
  readonly signInChanges: Subscribe = (listener) => {
    this.signInListeners.add(listener);
    return () => this.signInListeners.delete(listener);
  };

  /** The current code (changes after a rotation). */
  get code(): string {
    return this.currentCode;
  }

  /** End of the boost: in 3 days at local midnight. */
  get boostEndsAt(): Date {
    const d = new Date(this.clock().getTime() + 3 * DAY);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /** The [ReferralRpc] to give a `ReferralClient`. */
  readonly rpc: ReferralRpc = (fn, params) => this.call(fn, params);

  async call(fn: string, params: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ fn, params });
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.offline) throw new ReferralNetworkError(fn);
    if (!this.deployed) throw new ReferralUnavailableException(ReferralUnavailableReason.notDeployed);
    if (!this.signedIn) throw new ReferralUnavailableException(ReferralUnavailableReason.signedOut);
    if (this.serverError) throw new ReferralServerError(fn, 500);
    const now = this.clock();
    switch (fn) {
      case 'referral_my_code':
        if (this.left) return { code: null, reason: 'left', left: true };
        if (this.codeReason) return { code: null, reason: this.codeReason };
        return { code: this.currentCode, reason: 'ok' };
      case 'referral_rotate_code': {
        if (this.left) return { code: null, reason: 'left', left: true };
        const next = this.lastRotatedAt ? new Date(this.lastRotatedAt.getTime() + 30 * DAY) : null;
        if (next && next.getTime() > now.getTime()) {
          return { code: this.currentCode, reason: 'too_soon', next_allowed_at: next.toISOString() };
        }
        this.lastRotatedAt = now;
        this.currentCode = this.currentCode === FakeReferralServer.myCode ? 'P9WQ3ZTX' : FakeReferralServer.myCode;
        return { code: this.currentCode, reason: 'ok' };
      }
      case 'referral_terms':
        return this.terms(now);
      case 'referral_preferences':
        return this.prefs();
      case 'referral_preferences_set':
        return this.setPrefs((params['prefs'] as Json | undefined) ?? {});
      case 'referral_my_claim':
        return this.myClaim(now);
      case 'referral_claim':
        return this.claim(normaliseCode(params['code'] as string | undefined));
      case 'referral_stats':
        return {
          rewards_granted: this.granted
            .filter((r) => r['who'] === 'sharer')
            .map((r) => ({ ...r, at: (r['at'] as string | undefined) ?? now.toISOString() })),
          pending: this.pendingRewards,
          banked: this.bankedRewards,
          skipped_cap: this.skippedCap,
          claimed_count: this.claimedFriends,
          joined_count: this.joinedFriends,
          paid_count: this.paidFriends,
        };
      case 'referral_pending':
        return [
          ...this.granted.filter((r) => !this.acked.has(r['id'] as string)).map((r) => ({ ...r, state: 'granted' })),
          ...this.bankedRewards.map((r) => ({ ...r, state: 'banked' })),
        ];
      case 'referral_ack': {
        const ids = (params['reward_ids'] as string[] | undefined) ?? [];
        const before = this.acked.size;
        for (const id of ids) this.acked.add(id);
        return { acknowledged: this.acked.size - before };
      }
      case 'referral_check_activation': {
        if (!this.claimed) return { state: 'no_referral' };
        return { state: this.granted.some((r) => r['who'] === 'friend') ? 'joined' : 'claimed' };
      }
      default:
        throw new Error(`unknown function ${fn}`);
    }
  }

  private terms(now: Date): Json {
    return {
      enabled: this.enabled,
      paid_enabled: this.paidEnabled,
      rule_set_version: 1,
      rules: [
        { event: 'joined', who: 'friend', kind: 'chapters', amount: 4, params: {} },
        { event: 'joined', who: 'sharer', kind: 'chapters', amount: 4, params: {} },
        { event: 'paid', who: 'sharer', kind: 'entitlement_days', amount: 5, params: { entitlement_id: 'plus' } },
      ],
      claim_window_days: 7,
      activate_window_days: 30,
      paid_window_days: 90,
      hold_hours: 72,
      sharer_joins_per_30d: 10,
      sharer_paid_per_365d: 6,
      claim_days_left: this.claimed ? null : this.claimDaysLeft,
      boost: this.boost
        ? {
            starts_at: new Date(now.getTime() - 4 * DAY).toISOString(),
            ends_at: this.boostEndsAt.toISOString(),
            multiplier: this.boostMultiplier,
            events: ['joined'],
            who: this.boostWho,
          }
        : null,
    };
  }

  private myClaim(now: Date): Json {
    if (!this.claimed) return { state: 'none' };
    if (this.granted.some((r) => r['who'] === 'friend')) return { state: 'joined', joined_at: now.toISOString() };
    if (this.claimExpired) return { state: 'expired' };
    return {
      state: 'claimed',
      claimed_at: now.toISOString(),
      activate_by: new Date(now.getTime() + 30 * DAY).toISOString(),
      days_left: 30,
      rewards: [
        { kind: 'chapters', amount: this.amount(this.claimBoosted), base_amount: 4, params: {}, boosted: this.claimBoosted },
      ],
    };
  }

  /** The friend's activation window ended before they started (`referral_my_claim` state `expired`). */
  claimExpired = false;

  private claim(code: string): Json {
    if (this.claimReason) {
      return this.claimReason === 'rate_limited'
        ? { reason: 'rate_limited', retry_after_seconds: this.retryAfterSeconds }
        : { reason: this.claimReason };
    }
    if (this.claimDaysLeft == null || this.claimDaysLeft <= 0) return { reason: 'window_closed' };
    if (code === this.currentCode) return { reason: 'own_code' };
    if (this.claimed) return { reason: 'already_referred' };
    if (code !== FakeReferralServer.friendCode) return { reason: 'unknown_code' };
    this.claimed = true;
    this.claimBoosted = this.boost;
    return { reason: 'ok', days_left: 30 };
  }

  private amount(boosted: boolean): number {
    return boosted ? 4 * this.boostMultiplier : 4;
  }

  private prefs(): Json {
    return { show_name: this.showName, display_name: this.displayName, participating: !this.left };
  }

  /** The same checks as the SQL: known keys only, names 1–40 characters with a letter and no `@` or `://`. */
  private setPrefs(prefs: Json): Json {
    if (this.preferencesRefusal) return { reason: this.preferencesRefusal };
    if ('display_name' in prefs) {
      const name = prefs['display_name'] as string | null;
      if (name != null && displayNameProblem(name) != null) return { reason: 'invalid_name' };
      this.displayName = name?.trim() ?? null;
    }
    if (typeof prefs['show_name'] === 'boolean') this.showName = prefs['show_name'];
    if (typeof prefs['participating'] === 'boolean') this.left = !prefs['participating'];
    return this.prefs();
  }

  /** The friend (this user, after adding a code) starts using the app: the friend's reward lands. */
  youStartUsing(): boolean {
    if (!this.claimed || this.granted.some((r) => r['who'] === 'friend')) return false;
    this.grant('friend', 'joined', this.claimBoosted);
    return true;
  }

  /** A friend signs up with your code: nothing is earned yet, but you see "1 friend used your code". */
  aFriendSignsUp(): void {
    this.claimedFriends++;
    this.friendBoosts.push(this.boost);
  }

  /** A friend who used your code starts using the app: your reward lands. */
  aFriendStarts(): void {
    if (this.claimedFriends > 0) this.claimedFriends--;
    this.joinedFriends++;
    this.grant('sharer', 'joined', this.friendBoosts.length === 0 ? this.boost : this.friendBoosts.shift()!);
  }

  /** A joined friend buys: your paid reward (5 days of Plus) lands. */
  aFriendPays(): void {
    this.paidFriends = (this.paidFriends ?? 0) + 1;
    this.granted.push({
      id: this.newId(),
      who: 'sharer',
      event: 'paid',
      kind: 'entitlement_days',
      amount: 5,
      params: { entitlement_id: 'plus' },
    });
  }

  /** Adds a reward on hold that lands around [availableAt] (`referral_stats.pending`). */
  addPendingReward(availableAt: Date, kind = 'chapters', amount = 4): void {
    this.pendingRewards.push({ id: this.newId(), who: 'sharer', event: 'joined', kind, amount, available_at: availableAt.toISOString() });
  }

  /** Adds a banked reward (added when the current plan ends). */
  addBankedReward(kind = 'entitlement_days', amount = 5): void {
    this.bankedRewards.push({ id: this.newId(), who: 'sharer', event: 'paid', kind, amount, params: { entitlement_id: 'plus' } });
  }

  private newId(): string {
    return `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`;
  }

  private grant(who: string, event: string, boosted: boolean): void {
    this.granted.push({ id: this.newId(), who, event, kind: 'chapters', amount: this.amount(boosted), params: null });
  }

  /** Calls made to [fn], newest last. */
  called(fn: string): Readonly<Record<string, unknown>>[] {
    return this.calls.filter((c) => c.fn === fn).map((c) => c.params);
  }
}

/** A fixed install id for fakes and tests. */
export const fakeInstallId = '11111111-2222-4333-8444-555555555555';

/** A [ReferralClient] on [server] with a fixed install id and an in-memory event store. */
export function fakeReferralClient(
  server: FakeReferralServer,
  opts: Partial<Omit<ReferralClientOptions, 'rpc'>> & { eventStore?: KeyValueStore | null } = {},
): ReferralClient {
  return new ReferralClient({
    installIds: new FixedInstallIdStore(fakeInstallId),
    eventStore: new MemoryKeyValueStore(),
    ...opts,
    rpc: server.rpc,
  });
}

export { MemoryKeyValueStore } from '../storage';
export { FixedInstallIdStore } from '../install-id';
