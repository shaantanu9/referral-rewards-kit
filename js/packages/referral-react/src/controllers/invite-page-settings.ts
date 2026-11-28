import {
  displayNameProblem,
  ReferralEvent,
  ReferralEventName,
  type EventProps,
  type ReferralClient,
  type ReferralPreferences,
} from '@myind/referral-core';
import { ReferralStore } from '../store';

/** Why the name was refused, as a kind (`displayNameProblem` reasons, or `invalid_name` from the server). */
export type NameError = 'empty' | 'too_long' | 'no_letter' | 'email_or_link';
export type PrefsStatus = 'saved' | 'unavailable' | 'saveFailed';

export interface InvitePageSettingsState {
  /** Null until loaded; the block is hidden then (older server or offline). */
  readonly prefs: ReferralPreferences | null;
  readonly showName: boolean;
  readonly name: string;
  readonly saving: boolean;
  readonly nameError: NameError | null;
  readonly status: PrefsStatus | null;
}

export interface InvitePageSettingsOptions {
  client: ReferralClient;
  initialPreferences?: ReferralPreferences | null;
  emit: (e: ReferralEvent) => void;
  onLeft?: (() => void) | null;
}

/**
 * "Your invite page" logic (Flutter `_ReferralInvitePageSettingsState`): the first-name opt-in (turning it off is
 * saved at once, turning it on waits for a valid name), validation like the server, and leaving the program.
 * Reports `invite_preferences_changed` with the result.
 */
export class InvitePageSettingsController {
  readonly store: ReferralStore<InvitePageSettingsState>;
  opts: InvitePageSettingsOptions;
  private started = false;

  constructor(opts: InvitePageSettingsOptions) {
    this.opts = opts;
    const p = opts.initialPreferences ?? null;
    this.store = new ReferralStore<InvitePageSettingsState>({
      prefs: p,
      showName: p?.showName ?? false,
      name: p?.displayName ?? '',
      saving: false,
      nameError: null,
      status: null,
    });
  }

  get state(): InvitePageSettingsState {
    return this.store.getSnapshot();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.state.prefs == null) void this.load();
  }

  private async load(): Promise<void> {
    try {
      const p = await this.opts.client.preferences();
      this.store.set({ prefs: p, showName: p.showName, name: p.displayName ?? '' });
    } catch {
      // Older server or offline: the block stays hidden.
    }
  }

  /** Unsaved changes: the switch moved, or the name changed while it is on. */
  get dirty(): boolean {
    const { prefs, showName, name } = this.state;
    if (prefs == null) return false;
    return showName !== prefs.showName || (showName && name.trim() !== (prefs.displayName ?? ''));
  }

  setName(name: string): void {
    this.store.set({ name, nameError: null, status: null });
  }

  async toggle(on: boolean): Promise<void> {
    this.store.set({ showName: on, nameError: null, status: null });
    // Turning it off is saved at once (withdrawing is as easy as opting in); turning it on waits for the name.
    if (!on) await this.save({ showName: false });
  }

  async saveName(): Promise<void> {
    const { showName, name } = this.state;
    if (showName) {
      const problem = displayNameProblem(name);
      this.store.set({ nameError: problem });
      if (problem != null) return;
      await this.save({ showName: true, displayName: name });
    } else {
      await this.save({ showName: false });
    }
  }

  /** Leaves the program (after the app's confirm); calls `onLeft` when saved. */
  async leave(): Promise<void> {
    const p = await this.save({ participating: false });
    if (p != null && p.isOk) {
      try {
        this.opts.onLeft?.();
      } catch {
        // The app's callback never breaks the block.
      }
    }
  }

  async save(change: { showName?: boolean; displayName?: string; participating?: boolean }): Promise<ReferralPreferences | null> {
    this.store.set({ saving: true, status: null });
    const props: Record<string, string | number | boolean> = {};
    if (change.showName !== undefined) props['show_name'] = change.showName;
    if (change.participating !== undefined) props['participating'] = change.participating;
    try {
      const p = await this.opts.client.setPreferences(change);
      this.emit({ ...props, result: p.reason ?? 'ok' });
      if (p.isOk) {
        this.store.set({
          prefs: p,
          showName: p.showName,
          name: p.displayName ?? this.state.name,
          status: 'saved',
          saving: false,
        });
      } else if (p.reason === 'invalid_name') {
        this.store.set({ nameError: 'email_or_link', saving: false });
      } else {
        this.store.set({ status: 'unavailable', saving: false });
      }
      return p;
    } catch {
      this.emit({ ...props, result: 'failed' });
      this.store.set({ status: 'saveFailed', saving: false });
      return null;
    }
  }

  private emit(props: EventProps): void {
    this.opts.emit(new ReferralEvent(ReferralEventName.invitePreferencesChanged, props));
  }
}
