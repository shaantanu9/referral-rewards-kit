import { ReferralUnavailableException, type ReferralUnavailableReason } from './availability';
import type { ReferralClient } from './client';
import { isWellFormedCode, normaliseCode } from './code-format';
import { claimEventResult, ReferralEvent, ReferralEventName } from './events';
import { ClaimReason, type ClaimResult } from './models';
import type { KeyValueStore } from './storage';

/** What happened to a claim made through [PendingClaimQueue]. */
export const ClaimStatus = {
  /** The server answered; see [ClaimOutcome.result]. */
  answered: 'answered',
  /** The call failed (offline, timeout, server error, or not deployed yet); the code is kept and retried. */
  queuedOffline: 'queued_offline',
  /** The server said `not_verified`; the code is kept and retried after the account is verified. */
  queuedNotVerified: 'queued_not_verified',
  /** Nothing was pending. */
  nothingPending: 'nothing_pending',
} as const;
export type ClaimStatus = (typeof ClaimStatus)[keyof typeof ClaimStatus];

export class ClaimOutcome {
  /** The normalised code. */
  readonly code: string | null;
  readonly result: ClaimResult | null;
  readonly error: unknown;

  constructor(
    readonly status: ClaimStatus,
    init: { code?: string | null; result?: ClaimResult | null; error?: unknown } = {},
  ) {
    this.code = init.code ?? null;
    this.result = init.result ?? null;
    this.error = init.error ?? null;
  }

  get isQueued(): boolean {
    return this.status === ClaimStatus.queuedOffline || this.status === ClaimStatus.queuedNotVerified;
  }

  /** Why referrals could not be used for this claim (not deployed, signed out, no project); null otherwise. */
  get unavailable(): ReferralUnavailableReason | null {
    return this.error instanceof ReferralUnavailableException ? this.error.reason : null;
  }

  /** [claimEventResult] of this outcome (Dart: `outcome.resultName`). */
  get resultName(): string {
    return claimEventResult(this);
  }
}

/** Why a retry ran (ADR 11.6); the value is the `trigger` prop of `code_claim_result`. */
export const RetryTrigger = {
  reconnect: 'reconnect',
  appResume: 'appresume',
  tokenRefresh: 'tokenrefresh',
  signInChange: 'signinchange',
  manual: 'manual',
} as const;
export type RetryTrigger = (typeof RetryTrigger)[keyof typeof RetryTrigger];

/**
 * Keeps a code that was claimed offline or refused only as `not_verified`, and retries it (ADR 11.6). A retry keeps
 * the code on `rate_limited` and `anonymous_user` too. Also holds a code from a link ([keep]) until the friend taps
 * it. Call [retryPendingClaim] on reconnect, app resume, token refresh and sign-in changes, or use
 * [PendingClaimRetrier].
 */
export class PendingClaimQueue {
  static readonly storageKey = 'pending_claim_code';
  static readonly statusKey = 'pending_claim_status';
  /** Where [keep] stores a link code. Separate from [storageKey]: the retrier never sees it. */
  static readonly linkCodeKey = 'pending_claim_link_code';

  private readonly client: ReferralClient;
  private readonly store: KeyValueStore;
  /** Called when a kept code gets a final server answer (anything but `not_verified`). */
  readonly onResolved: ((outcome: ClaimOutcome, trigger: RetryTrigger) => void) | null;
  private inFlight: Promise<ClaimOutcome> | null = null;

  constructor(opts: {
    client: ReferralClient;
    store: KeyValueStore;
    onResolved?: (outcome: ClaimOutcome, trigger: RetryTrigger) => void;
  }) {
    this.client = opts.client;
    this.store = opts.store;
    this.onResolved = opts.onResolved ?? null;
  }

  /** The kept code, if any. */
  pendingCode(): Promise<string | null> {
    return this.store.getString(PendingClaimQueue.storageKey);
  }

  /** Why the code is kept: `queued_offline` or `queued_not_verified`; null when none is kept. */
  async pendingStatus(): Promise<ClaimStatus | null> {
    if ((await this.pendingCode()) == null) return null;
    return (await this.store.getString(PendingClaimQueue.statusKey)) === 'not_verified'
      ? ClaimStatus.queuedNotVerified
      : ClaimStatus.queuedOffline;
  }

  async clear(): Promise<void> {
    await this.store.remove(PendingClaimQueue.storageKey);
    await this.store.remove(PendingClaimQueue.statusKey);
  }

  /**
   * Keeps [code] without calling the server, for a code from an invite link or the install referrer. It is never
   * claimed by itself: a prefilled code needs one tap (ADR 0001 §4.2 step 3). Returns false, changing nothing, for a
   * malformed code or when a link code is already kept. Reports `invite_link_opened`. Cleared by [claim].
   */
  async keep(code: string, _opts: { source?: string } = {}): Promise<boolean> {
    const norm = normaliseCode(code);
    if (!isWellFormedCode(norm) || (await this.linkCode()) != null) return false;
    await this.store.setString(PendingClaimQueue.linkCodeKey, norm);
    this.client.reportLinkOpened(norm);
    return true;
  }

  /** The code kept by [keep] and not yet claimed, if any. */
  linkCode(): Promise<string | null> {
    return this.store.getString(PendingClaimQueue.linkCodeKey);
  }

  /** Forgets the code kept by [keep] (e.g. the friend dismissed "Use code …"). */
  clearLinkCode(): Promise<void> {
    return this.store.remove(PendingClaimQueue.linkCodeKey);
  }

  /**
   * Claims [code] now; keeps it when the call fails or the answer is `not_verified`. Reports `code_submitted`
   * (`source`: `typed` | `pasted` | `prefilled` | the app's own) and then `code_claim_result` (`via`).
   */
  async claim(code: string, opts: { source?: string; via?: string } = {}): Promise<ClaimOutcome> {
    const source = opts.source ?? 'typed';
    const via = opts.via ?? 'entry';
    const norm = normaliseCode(code);
    if (norm !== '') {
      this.client.report(
        new ReferralEvent(ReferralEventName.codeSubmitted, { code_hash: this.client.codeHash(norm), source }),
      );
    }
    const outcome = await this.attempt(norm);
    if (!outcome.isQueued) await this.clear();
    await this.clearLinkCode();
    this.reportOutcome(outcome, via);
    return outcome;
  }

  private reportOutcome(outcome: ClaimOutcome, via: string, trigger?: RetryTrigger): void {
    const props: Record<string, string> = { result: claimEventResult(outcome), via };
    if (trigger) props['trigger'] = trigger;
    if (outcome.code) props['code_hash'] = this.client.codeHash(outcome.code);
    this.client.report(new ReferralEvent(ReferralEventName.codeClaimResult, props));
  }

  /** Retries the kept code, if any. Safe to call often: concurrent calls share one request. */
  retryPendingClaim(opts: { trigger?: RetryTrigger } = {}): Promise<ClaimOutcome> {
    if (!this.inFlight) {
      this.inFlight = this.retry(opts.trigger ?? RetryTrigger.manual).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async retry(trigger: RetryTrigger): Promise<ClaimOutcome> {
    const code = await this.pendingCode();
    if (code == null) return new ClaimOutcome(ClaimStatus.nothingPending);
    let outcome = await this.attempt(code);
    const reason = outcome.result?.reason;
    if (reason === ClaimReason.rateLimited || reason === ClaimReason.anonymousUser) {
      // Not final for a kept code: the limit passes and a guest may still create an account.
      outcome = new ClaimOutcome(ClaimStatus.queuedOffline, { code, result: outcome.result });
    }
    if (!outcome.isQueued) {
      await this.clear();
      try {
        this.onResolved?.(outcome, trigger);
      } catch {
        // The app's callback never breaks the queue.
      }
      // A retry that is still queued is not reported: it would repeat on every resume while offline.
      this.reportOutcome(outcome, 'retry', trigger);
    }
    return outcome;
  }

  private async attempt(code: string): Promise<ClaimOutcome> {
    try {
      const result = await this.client.claim(code);
      if (result.reason === ClaimReason.notVerified) {
        await this.store.setString(PendingClaimQueue.storageKey, code);
        await this.store.setString(PendingClaimQueue.statusKey, 'not_verified');
        return new ClaimOutcome(ClaimStatus.queuedNotVerified, { code, result });
      }
      return new ClaimOutcome(ClaimStatus.answered, { code, result });
    } catch (e) {
      await this.store.setString(PendingClaimQueue.storageKey, code);
      await this.store.setString(PendingClaimQueue.statusKey, 'offline');
      return new ClaimOutcome(ClaimStatus.queuedOffline, { code, error: e });
    }
  }
}

/** Subscribes [listener] to some signal and returns the unsubscribe function. */
export type Subscribe = (listener: () => void) => () => void;

/**
 * Wires [PendingClaimQueue.retryPendingClaim] to the app's signals: reconnects, token refreshes, sign-in changes and
 * app resumes. Each is a [Subscribe] function, e.g. supabase-js
 * `(l) => supabase.auth.onAuthStateChange(l).data.subscription.unsubscribe`, [browserOnline] and [browserResume] on
 * the web, `AppState` on React Native. Call [dispose] to stop.
 */
export class PendingClaimRetrier {
  private readonly subs: Array<() => void> = [];

  constructor(opts: {
    queue: PendingClaimQueue;
    reconnects?: Subscribe;
    tokenRefreshes?: Subscribe;
    signInChanges?: Subscribe;
    appResumes?: Subscribe;
  }) {
    const on = (s: Subscribe | undefined, trigger: RetryTrigger): void => {
      if (!s) return;
      this.subs.push(s(() => void opts.queue.retryPendingClaim({ trigger })));
    };
    on(opts.reconnects, RetryTrigger.reconnect);
    on(opts.tokenRefreshes, RetryTrigger.tokenRefresh);
    on(opts.signInChanges, RetryTrigger.signInChange);
    on(opts.appResumes, RetryTrigger.appResume);
  }

  dispose(): void {
    for (const u of this.subs.splice(0)) {
      try {
        u();
      } catch {
        // Already gone.
      }
    }
  }
}

/** The browser's `online` event as a [Subscribe]; does nothing on the server. */
export const browserOnline: Subscribe = (listener) => {
  const w = (globalThis as { window?: Window }).window;
  if (!w?.addEventListener) return () => {};
  w.addEventListener('online', listener);
  return () => w.removeEventListener('online', listener);
};

/** The page becoming visible again (`visibilitychange`) as a [Subscribe]; does nothing on the server. */
export const browserResume: Subscribe = (listener) => {
  const d = (globalThis as { document?: Document }).document;
  if (!d?.addEventListener) return () => {};
  const h = (): void => {
    if (d.visibilityState === 'visible') listener();
  };
  d.addEventListener('visibilitychange', h);
  return () => d.removeEventListener('visibilitychange', h);
};
