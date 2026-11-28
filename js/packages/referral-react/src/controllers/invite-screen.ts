import {
  MyCodeResult,
  ReferralEvent,
  ReferralEventName,
  ReferralPreferences,
  ReferralStats,
  ReferralTerms,
  ReferralUnavailableException,
  resolveInviteLink,
  whatsAppShareUri,
  type InviteLinkBuilder,
  type KeyValueStore,
  type ReferralClient,
  type ReferralLauncher,
  type ReferralUnavailableReason,
} from '@myind/referral-core';
import { ReferralStore } from '../store';

/** What the invite screen loaded. */
export interface InviteScreenData {
  readonly code: MyCodeResult;
  readonly terms: ReferralTerms;
  readonly stats: ReferralStats;
  /** True when the server could not be reached and the cached code is shown. */
  readonly offline: boolean;
  /** Null on a server without `referral_preferences` (before migration 23) or when it could not load. */
  readonly prefs: ReferralPreferences | null;
}

export type InviteScreenStatus = 'loading' | 'ready' | 'error' | 'unavailable';

export interface InviteScreenState {
  readonly status: InviteScreenStatus;
  readonly data: InviteScreenData | null;
  readonly unavailable: ReferralUnavailableReason | null;
  /** The WhatsApp button can open (`launcher.canLaunch`). */
  readonly whatsApp: boolean;
}

export interface InviteScreenOptions {
  client: ReferralClient;
  codeCache?: KeyValueStore | null;
  inviteLink?: InviteLinkBuilder | null;
  showInvitePageSettings?: boolean;
  launcher?: ReferralLauncher | null;
  showWhatsApp?: boolean;
  /** Called after each load finishes, whether it worked or not. */
  onLoaded?: (() => void) | null;
}

/** The cache key of the last code (same as Flutter's `my_code`). */
export const inviteCodeCacheKey = 'my_code';

/**
 * The invite screen's logic (Flutter `_InviteFriendsScreenState`): loads the code, terms, stats and preferences
 * together, keeps the code in [InviteScreenOptions.codeCache] and falls back to it offline, reports
 * `referral_feature_hidden` for a paused program, a disabled code or a missing invite link, and checks whether
 * WhatsApp can open.
 */
export class InviteScreenController {
  readonly store = new ReferralStore<InviteScreenState>({
    status: 'loading',
    data: null,
    unavailable: null,
    whatsApp: false,
  });
  opts: InviteScreenOptions;
  private generation = 0;
  private started = false;
  private viewed = false;

  constructor(opts: InviteScreenOptions) {
    this.opts = opts;
  }

  get state(): InviteScreenState {
    return this.store.getSnapshot();
  }

  /** Loads once (safe to call again, e.g. React StrictMode's second effect run). */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.load();
    if (this.opts.showWhatsApp !== false) void this.checkWhatsApp();
  }

  /** Reports `invite_screen_viewed` once per controller. */
  reportViewed(from: string | null | undefined, emit: (e: ReferralEvent) => void): void {
    if (this.viewed) return;
    this.viewed = true;
    emit(new ReferralEvent(ReferralEventName.inviteScreenViewed, { from: from ?? 'unknown', focus: 'share' }));
  }

  link(code: string): string | null {
    return resolveInviteLink(this.opts.inviteLink, code);
  }

  async checkWhatsApp(): Promise<void> {
    let ok = false;
    try {
      ok = (await this.opts.launcher?.canLaunch(whatsAppShareUri(''))) ?? false;
    } catch {
      ok = false;
    }
    this.store.set({ whatsApp: ok });
  }

  reload(): Promise<void> {
    return this.load();
  }

  private async load(): Promise<void> {
    const gen = ++this.generation;
    this.store.set({ status: 'loading' });
    try {
      const d = await this.fetch();
      if (gen !== this.generation) return;
      const paused = !d.terms.enabled || d.code.reason === 'program_paused';
      if (paused || d.code.reason === 'code_disabled') {
        void this.opts.client.reportHidden(paused ? 'program_paused' : 'code_disabled', { surface: 'invite' });
      } else if (d.code.code != null && this.link(d.code.code) == null) {
        void this.opts.client.reportHidden('no_invite_url', { surface: 'invite' });
      }
      this.store.set({ status: 'ready', data: d, unavailable: null });
    } catch (e) {
      if (gen !== this.generation) return;
      if (e instanceof ReferralUnavailableException) {
        this.store.set({ status: 'unavailable', unavailable: e.reason, data: null });
      } else {
        this.store.set({ status: 'error', data: null, unavailable: null });
      }
    } finally {
      if (gen === this.generation) {
        try {
          this.opts.onLoaded?.();
        } catch {
          // The app's callback never breaks the screen.
        }
      }
    }
  }

  private async fetch(): Promise<InviteScreenData> {
    const { client, codeCache } = this.opts;
    try {
      const prefs =
        this.opts.showInvitePageSettings === false
          ? Promise.resolve(null)
          : client.preferences().then(
              (p) => p,
              () => null,
            );
      const [code, terms, stats] = await Promise.all([client.myCode(), client.terms(), client.stats()]);
      if (code.code != null) await codeCache?.setString(inviteCodeCacheKey, code.code);
      // Left the program: no cached code may be shared offline either.
      if (code.left) await codeCache?.remove(inviteCodeCacheKey);
      return { code, terms, stats, offline: false, prefs: await prefs };
    } catch (e) {
      // Not deployed or signed out: a cached code would promise something the server cannot do.
      if (e instanceof ReferralUnavailableException) throw e;
      const cached = await codeCache?.getString(inviteCodeCacheKey);
      if (cached == null) throw e;
      return {
        code: new MyCodeResult({ code: cached, reason: 'ok' }),
        terms: ReferralTerms.none,
        stats: ReferralStats.empty,
        offline: true,
        prefs: null,
      };
    }
  }
}
