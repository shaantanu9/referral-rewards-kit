'use client';
import {
  browserOnline,
  browserResume,
  MyCodeResult,
  PendingClaimRetrier,
  ReferralUnavailableException,
  type ClaimOutcome,
  type ClaimResult,
  type ReferralPreferences,
  type RewardItem,
  type KeyValueStore,
  type PendingClaimQueue,
  type ReferralClient,
  type ReferralPromptPolicy,
  type ReferralTerms,
  type ReferralUnavailableReason,
  type Subscribe,
} from '@myind/referral-core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useResolvedKit, type ReferralKitOptions } from './context';
import { CodeEntryController, claimDaysLeft, type CodeEntryState } from './controllers/code-entry';
import { InvitePageSettingsController, type InvitePageSettingsState } from './controllers/invite-page-settings';
import { inviteCodeCacheKey, InviteScreenController, type InviteScreenState } from './controllers/invite-screen';
import { RewardCardController, type RewardCardState } from './controllers/reward-card';
import { welcomeCardSession, WelcomeCardController, type WelcomeCardState } from './controllers/welcome-card';
import { useReferralStore } from './store';

export { useReferral, useResolvedKit } from './context';

// ---------------------------------------------------------------------------------------------------------------
// Screen-level hooks: each owns a controller (created once per client) and reads its store.
// ---------------------------------------------------------------------------------------------------------------

export interface UseInviteScreenOptions extends ReferralKitOptions {
  showInvitePageSettings?: boolean;
  showWhatsApp?: boolean;
  onLoaded?: (() => void) | null;
}

/** The invite screen's data and actions (code, terms, stats, preferences; offline fallback to the cached code). */
export function useInviteScreen(
  opts: UseInviteScreenOptions = {},
): InviteScreenState & { controller: InviteScreenController; reload: () => Promise<void> } {
  const kit = useResolvedKit(opts, 'useInviteScreen');
  const controller = useMemo(() => new InviteScreenController({ client: kit.client }), [kit.client]);
  controller.opts = {
    client: kit.client,
    codeCache: kit.codeCache,
    inviteLink: kit.inviteLink,
    launcher: kit.launcher,
    showInvitePageSettings: opts.showInvitePageSettings ?? true,
    showWhatsApp: opts.showWhatsApp ?? true,
    onLoaded: opts.onLoaded ?? null,
  };
  useEffect(() => controller.start(), [controller]);
  const state = useReferralStore(controller.store);
  return { ...state, controller, reload: () => controller.reload() };
}

export interface UseCodeEntryOptions extends ReferralKitOptions {
  terms?: ReferralTerms | null;
  initialCode?: string | null;
  eligibleFrom?: Date | null;
  onClaimed?: ((result: ClaimResult) => void) | null;
}

/** The code entry's state and actions: type, paste, use a link code, submit through the offline queue. */
export function useCodeEntry(
  opts: UseCodeEntryOptions = {},
): CodeEntryState & { controller: CodeEntryController; daysLeft: number | null } {
  const kit = useResolvedKit(opts, 'useCodeEntry');
  const controller = useMemo(
    () =>
      new CodeEntryController({
        client: kit.client,
        queue: kit.queue,
        terms: opts.terms ?? null,
        initialCode: opts.initialCode ?? null,
        emit: kit.emit,
      }),
    // A new client or queue is a new entry; the other options are read live.
    [kit.client, kit.queue],
  );
  controller.opts = { ...controller.opts, emit: kit.emit, onClaimed: opts.onClaimed ?? null };
  const daysFor = (t: ReferralTerms): number | null => claimDaysLeft(t, opts.eligibleFrom, kit.clock());
  useEffect(() => controller.start(daysFor));
  const state = useReferralStore(controller.store);
  const daysLeft = state.terms ? daysFor(state.terms) : null;
  return { ...state, controller, daysLeft };
}

export interface UseRewardCardOptions extends ReferralKitOptions {
  onShown?: ((reward: RewardItem) => void) | null;
  onDismissed?: ((reward: RewardItem, acknowledged: boolean) => void) | null;
}

/** Rewards that landed and were not shown on this device yet (`referral_pending`), with dismiss (acks). */
export function usePendingRewards(
  opts: UseRewardCardOptions = {},
): RewardCardState & { controller: RewardCardController; dismiss: RewardCardController['dismiss'] } {
  const kit = useResolvedKit(opts, 'usePendingRewards');
  const controller = useMemo(() => new RewardCardController({ client: kit.client, emit: kit.emit }), [kit.client]);
  controller.opts = { client: kit.client, emit: kit.emit, onShown: opts.onShown ?? null, onDismissed: opts.onDismissed ?? null };
  useEffect(() => controller.start(), [controller]);
  const state = useReferralStore(controller.store);
  return { ...state, controller, dismiss: (r) => controller.dismiss(r) };
}

export interface UseWelcomeCardOptions extends ReferralKitOptions {
  /** Identifies this page load (see `welcomeCardSession`). */
  session?: string;
}

/** The friend's welcome card state (`referral_my_claim`): claimed (gift waiting) or joined (pass it on). */
export function useWelcomeCard(
  opts: UseWelcomeCardOptions = {},
): WelcomeCardState & { controller: WelcomeCardController; close: WelcomeCardController['close'] } {
  const kit = useResolvedKit(opts, 'useWelcomeCard');
  const controller = useMemo(
    () =>
      new WelcomeCardController({
        client: kit.client,
        store: kit.store,
        policy: kit.policy,
        clock: kit.clock,
        session: opts.session ?? welcomeCardSession,
        emit: kit.emit,
      }),
    [kit.client],
  );
  controller.opts = { ...controller.opts, emit: kit.emit, clock: kit.clock, policy: kit.policy, store: kit.store };
  useEffect(() => controller.start(), [controller]);
  const state = useReferralStore(controller.store);
  return { ...state, controller, close: (a) => controller.close(a) };
}

export interface UseInvitePageSettingsOptions extends ReferralKitOptions {
  initialPreferences?: ReferralPreferences | null;
  onLeft?: (() => void) | null;
}

/** "Your invite page": the first-name opt-in and leaving the program. */
export function useInvitePageSettings(
  opts: UseInvitePageSettingsOptions = {},
): InvitePageSettingsState & { controller: InvitePageSettingsController; dirty: boolean } {
  const kit = useResolvedKit(opts, 'useInvitePageSettings');
  const controller = useMemo(
    () =>
      new InvitePageSettingsController({
        client: kit.client,
        initialPreferences: opts.initialPreferences ?? null,
        emit: kit.emit,
      }),
    [kit.client],
  );
  controller.opts = { ...controller.opts, emit: kit.emit, onLeft: opts.onLeft ?? null };
  useEffect(() => controller.start(), [controller]);
  const state = useReferralStore(controller.store);
  return { ...state, controller, dirty: controller.dirty };
}

// ---------------------------------------------------------------------------------------------------------------
// Small hooks for apps that build their own UI.
// ---------------------------------------------------------------------------------------------------------------

export interface AsyncState<T> {
  readonly loading: boolean;
  readonly value: T | null;
  /** Why referrals cannot be used (not deployed, signed out, no project); null otherwise. */
  readonly unavailable: ReferralUnavailableReason | null;
  /** Any other failure (offline, server error). */
  readonly error: unknown;
  readonly reload: () => void;
}

function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[], skip = false): AsyncState<T> {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Omit<AsyncState<T>, 'reload'>>({
    loading: !skip,
    value: null,
    unavailable: null,
    error: null,
  });
  useEffect(() => {
    if (skip) return undefined;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (value) => live && setState({ loading: false, value, unavailable: null, error: null }),
      (e: unknown) =>
        live &&
        setState({
          loading: false,
          value: null,
          unavailable: e instanceof ReferralUnavailableException ? e.reason : null,
          error: e instanceof ReferralUnavailableException ? null : e,
        }),
    );
    return () => {
      live = false;
    };
  }, [...deps, tick, skip]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** `referral_terms` (skipped when [given] is set): the live rules, caps, windows and boost. */
export function useReferralTerms(
  opts: ReferralKitOptions & { given?: ReferralTerms | null } = {},
): AsyncState<ReferralTerms> {
  const kit = useResolvedKit(opts, 'useReferralTerms');
  const given = opts.given ?? null;
  const s = useAsync(() => kit.client.terms(), [kit.client], given != null);
  return given ? { ...s, loading: false, value: given } : s;
}

/**
 * The caller's invite code (`referral_my_code`), kept in [codeCache] (when given) so it can still be shown offline.
 * `value.left` is true after the user left the program.
 */
export function useInviteCode(opts: ReferralKitOptions = {}): AsyncState<MyCodeResult> & { offline: boolean } {
  const kit = useResolvedKit(opts, 'useInviteCode');
  const cache: KeyValueStore | null = kit.codeCache;
  const [offline, setOffline] = useState(false);
  const s = useAsync(async () => {
    try {
      const r = await kit.client.myCode();
      if (r.code != null) await cache?.setString(inviteCodeCacheKey, r.code);
      if (r.left) await cache?.remove(inviteCodeCacheKey);
      setOffline(false);
      return r;
    } catch (e) {
      if (e instanceof ReferralUnavailableException) throw e;
      const cached = await cache?.getString(inviteCodeCacheKey);
      if (cached == null) throw e;
      setOffline(true);
      return new MyCodeResult({ code: cached, reason: 'ok' });
    }
  }, [kit.client, cache]);
  return { ...s, offline };
}

/**
 * Claims a code through the offline queue (`PendingClaimQueue.claim`): `busy` while it runs, the last `outcome`
 * (answered, or kept offline / until verified). Reports `code_submitted` and `code_claim_result`.
 */
export function useClaim(opts: ReferralKitOptions = {}): {
  claim: (code: string, o?: { source?: string; via?: string }) => Promise<ClaimOutcome>;
  busy: boolean;
  outcome: ClaimOutcome | null;
  queue: PendingClaimQueue;
} {
  const kit = useResolvedKit(opts, 'useClaim');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ClaimOutcome | null>(null);
  const queue = kit.queue;
  const claim = useCallback(
    async (code: string, o: { source?: string; via?: string } = {}) => {
      setBusy(true);
      try {
        const out = await queue.claim(code, o);
        setOutcome(out);
        return out;
      } finally {
        setBusy(false);
      }
    },
    [queue],
  );
  return { claim, busy, outcome, queue };
}

/**
 * Retries a kept claim on the given signals (default: the browser coming back online and the page becoming visible),
 * and once on mount. `ReferralProvider` already does this for its queue.
 */
export function usePendingClaimRetrier(
  queue: PendingClaimQueue | null | undefined,
  signals: { reconnects?: Subscribe; tokenRefreshes?: Subscribe; signInChanges?: Subscribe; appResumes?: Subscribe } = {
    reconnects: browserOnline,
    appResumes: browserResume,
  },
): void {
  useEffect(() => {
    if (!queue) return undefined;
    const r = new PendingClaimRetrier({ queue, ...signals });
    void queue.retryPendingClaim();
    return () => r.dispose();
  }, [queue]);
}

/**
 * The app's one "invite friends" prompt (ADR 11.4) over a `ReferralPromptPolicy`: `check()` resolves whether it may
 * show now (and sets `shouldPrompt`); call `markPrompted()` when you show it.
 */
export function useReferralPrompt(policy: ReferralPromptPolicy | null | undefined): {
  shouldPrompt: boolean;
  check: () => Promise<boolean>;
  markPrompted: () => Promise<void>;
} {
  const [shouldPrompt, setShould] = useState(false);
  const check = useCallback(async () => {
    const ok = policy ? await policy.shouldPrompt() : false;
    setShould(ok);
    return ok;
  }, [policy]);
  const markPrompted = useCallback(async () => {
    setShould(false);
    await policy?.markPrompted();
  }, [policy]);
  return { shouldPrompt, check, markPrompted };
}

/** The referral client from props or the provider (throws when neither has one). */
export function useReferralClient(opts: ReferralKitOptions = {}): ReferralClient {
  return useResolvedKit(opts, 'useReferralClient').client;
}
