'use client';
import {
  browserOnline,
  browserResume,
  localStorageStore,
  PendingClaimQueue,
  PendingClaimRetrier,
  referralLocalizations,
  ReferralCopy,
  ReferralTerms,
  reportReferralEvent,
  webShare,
  windowLauncher,
  type InviteLinkBuilder,
  type KeyValueStore,
  type ReferralClient,
  type ReferralEvent,
  type ReferralEventSink,
  type ReferralKitLocalizations,
  type ReferralLauncher,
  type ReferralLocalizationOverrides,
  type ReferralPromptPolicy,
  type ReferralTexts,
  type RewardLabels,
  type ShareHandler,
} from '@myind/referral-core';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

/** Everything the components share. Each component also takes these as props; a prop wins over the provider. */
export interface ReferralKitOptions {
  /** The referral client (`new ReferralClient({rpc, installIds, onEvent})`). Required here or on each component. */
  client?: ReferralClient | null;
  /** Keeps a code claimed offline or before the account was verified, and retries it. Default: one on [store]. */
  queue?: PendingClaimQueue | null;
  /** The app's name in the copy ("Start using {app}"). */
  appName?: string;
  /** `en`, `hi`, `id` (or `hi-IN`); other languages fall back to English unless [l10nOverrides] gives every key. */
  locale?: string;
  /** Per-key strings or functions over the kit's localisations (`referralLocalizations(locale, overrides)`). */
  l10nOverrides?: ReferralLocalizationOverrides;
  /** Names of reward kinds (`{byKind: {chapters: (n) => `${n} free chapters`}}`). */
  labels?: RewardLabels;
  /** The app's own words for the invite screens. */
  texts?: ReferralTexts;
  /** Opens links (WhatsApp). Default: [windowLauncher] (a new tab, noopener). */
  launcher?: ReferralLauncher;
  /** Shares the invite text. Default: [webShare] (the Web Share API; copies the text where there is none). */
  share?: ShareHandler;
  /** Keeps the last code so it can still be shared offline. */
  codeCache?: KeyValueStore | null;
  /** Storage for the default claim queue and the welcome card. Default: `localStorageStore()` (memory on the server). */
  store?: KeyValueStore | null;
  /** The invite page link for a code, e.g. `(c) => `https://example.com/i/${c}``. Null: Share sends the code. */
  inviteLink?: InviteLinkBuilder | null;
  /** The app's store page, shared with the code when there is no invite link. */
  storeLink?: string | null;
  /** Analytics events from the components; `client.onEvent` when unset. */
  onEvent?: ReferralEventSink | null;
  /** Shown as a Sign in button when the user is signed out. */
  onSignIn?: (() => void) | null;
  /** Now (the boost banner, the claim window, the welcome card's day). */
  clock?: () => Date;
  /** The app's prompt policy; the welcome card's pass-it-on prompt follows it. */
  policy?: ReferralPromptPolicy | null;
  /** `utm_source` on the attribution link. Default `referral-react`. */
  attributionSource?: string;
}

export interface ReferralContextValue {
  readonly client: ReferralClient | null;
  readonly queue: PendingClaimQueue | null;
  readonly appName: string;
  readonly locale: string;
  readonly l10n: ReferralKitLocalizations;
  readonly labels: RewardLabels;
  readonly texts: ReferralTexts | undefined;
  readonly launcher: ReferralLauncher;
  readonly share: ShareHandler;
  readonly codeCache: KeyValueStore | null;
  readonly store: KeyValueStore;
  readonly inviteLink: InviteLinkBuilder | null;
  readonly storeLink: string | null;
  readonly onEvent: ReferralEventSink | null;
  readonly onSignIn: (() => void) | null;
  readonly clock: () => Date;
  readonly policy: ReferralPromptPolicy | null;
  readonly attributionSource: string;
}

const english = referralLocalizations('en');
const now = (): Date => new Date();
/** Shared by every component outside a provider (memory on the server, localStorage in the browser). */
const defaultStore = localStorageStore();

export const defaultAttributionSource = 'referral-react';

const defaults: ReferralContextValue = {
  client: null,
  queue: null,
  appName: '',
  locale: 'en',
  l10n: english,
  labels: {},
  texts: undefined,
  launcher: windowLauncher,
  share: webShare,
  codeCache: null,
  store: defaultStore,
  inviteLink: null,
  storeLink: null,
  onEvent: null,
  onSignIn: null,
  clock: now,
  policy: null,
  attributionSource: defaultAttributionSource,
};

const ReferralContext = createContext<ReferralContextValue>(defaults);

export interface ReferralProviderProps extends ReferralKitOptions {
  children?: ReactNode;
  /**
   * Retries a kept claim when the browser comes back online and when the page becomes visible again
   * (`PendingClaimRetrier` with `browserOnline` / `browserResume`). Default true.
   */
  retryPendingClaims?: boolean;
}

/**
 * Gives every referral component below it the client, the claim queue, the copy (locale, overrides, reward labels,
 * texts), how to share and open links, and analytics. Each component also takes the same values as props.
 *
 * ```tsx
 * <ReferralProvider client={client} appName="Acme" locale="hi" inviteLink={(c) => `https://acme.app/i/${c}`}>
 *   <InviteHub />
 * </ReferralProvider>
 * ```
 */
export function ReferralProvider(props: ReferralProviderProps): ReactNode {
  const { children, retryPendingClaims = true, ...opts } = props;
  const outer = useContext(ReferralContext);
  const store = opts.store ?? outer.store;
  const client = opts.client ?? outer.client;
  const ownQueue = useMemo(
    () => (client && !opts.queue ? new PendingClaimQueue({ client, store }) : null),
    [client, store, opts.queue],
  );
  const queue = opts.queue ?? ownQueue ?? outer.queue;
  const locale = opts.locale ?? outer.locale;
  const overrides = opts.l10nOverrides;
  const l10n = useMemo(
    () => (opts.locale === undefined && overrides === undefined ? outer.l10n : referralLocalizations(locale, overrides)),
    [opts.locale, overrides, locale, outer.l10n],
  );

  useEffect(() => {
    if (!retryPendingClaims || !queue) return undefined;
    const retrier = new PendingClaimRetrier({ queue, reconnects: browserOnline, appResumes: browserResume });
    void queue.retryPendingClaim();
    return () => retrier.dispose();
  }, [queue, retryPendingClaims]);

  const value = useMemo<ReferralContextValue>(
    () => ({
      client,
      queue,
      appName: opts.appName ?? outer.appName,
      locale,
      l10n,
      labels: opts.labels ?? outer.labels,
      texts: opts.texts ?? outer.texts,
      launcher: opts.launcher ?? outer.launcher,
      share: opts.share ?? outer.share,
      codeCache: opts.codeCache ?? outer.codeCache,
      store,
      inviteLink: opts.inviteLink ?? outer.inviteLink,
      storeLink: opts.storeLink ?? outer.storeLink,
      onEvent: opts.onEvent ?? outer.onEvent,
      onSignIn: opts.onSignIn ?? outer.onSignIn,
      clock: opts.clock ?? outer.clock,
      policy: opts.policy ?? outer.policy,
      attributionSource: opts.attributionSource ?? outer.attributionSource,
    }),
    [
      client,
      queue,
      locale,
      l10n,
      store,
      outer,
      opts.appName,
      opts.labels,
      opts.texts,
      opts.launcher,
      opts.share,
      opts.codeCache,
      opts.inviteLink,
      opts.storeLink,
      opts.onEvent,
      opts.onSignIn,
      opts.clock,
      opts.policy,
      opts.attributionSource,
    ],
  );
  return <ReferralContext.Provider value={value}>{children}</ReferralContext.Provider>;
}

/** The provider's values (defaults outside a provider: English, `webShare`, `windowLauncher`, no client). */
export function useReferral(): ReferralContextValue {
  return useContext(ReferralContext);
}

/** The resolved options of one component: its props over the provider's. */
export interface ResolvedKit extends Omit<ReferralContextValue, 'client' | 'queue'> {
  readonly client: ReferralClient;
  readonly queue: PendingClaimQueue;
  /** Sends [event] to `onEvent`, else to the client's sink. Never throws. */
  emit(event: ReferralEvent): void;
  /** A `ReferralCopy` over [terms] with the resolved labels. */
  copy(terms?: ReferralTerms | null): ReferralCopy;
}

/** Merges a component's props over the provider. Throws when neither gives a client. */
export function useResolvedKit(props: ReferralKitOptions, component: string): ResolvedKit {
  const ctx = useContext(ReferralContext);
  const client = props.client ?? ctx.client;
  if (!client) {
    throw new Error(`${component}: pass a \`client\` prop or wrap it in <ReferralProvider client={…}>.`);
  }
  const locale = props.locale ?? ctx.locale;
  const overrides = props.l10nOverrides;
  const l10n = useMemo(
    () => (props.locale === undefined && overrides === undefined ? ctx.l10n : referralLocalizations(locale, overrides)),
    [props.locale, overrides, locale, ctx.l10n],
  );
  const store = props.store ?? ctx.store;
  const ownQueue = useMemo(
    () => (props.queue || ctx.queue ? null : new PendingClaimQueue({ client, store })),
    [props.queue, ctx.queue, client, store],
  );
  const onEvent = props.onEvent ?? ctx.onEvent;
  const labels = props.labels ?? ctx.labels;
  return {
    client,
    queue: (props.queue ?? ctx.queue ?? ownQueue)!,
    appName: props.appName ?? ctx.appName,
    locale,
    l10n,
    labels,
    texts: props.texts ?? ctx.texts,
    launcher: props.launcher ?? ctx.launcher,
    share: props.share ?? ctx.share,
    codeCache: props.codeCache ?? ctx.codeCache,
    store,
    inviteLink: props.inviteLink ?? ctx.inviteLink,
    storeLink: props.storeLink ?? ctx.storeLink,
    onEvent,
    onSignIn: props.onSignIn ?? ctx.onSignIn,
    clock: props.clock ?? ctx.clock,
    policy: props.policy ?? ctx.policy,
    attributionSource: props.attributionSource ?? ctx.attributionSource,
    emit: (event) => reportReferralEvent(onEvent ?? client.onEvent, event),
    copy: (terms) => new ReferralCopy({ l10n, terms: terms ?? ReferralTerms.none, labels }),
  };
}
