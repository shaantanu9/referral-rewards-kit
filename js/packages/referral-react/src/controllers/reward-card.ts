import {
  ReferralEvent,
  ReferralEventName,
  rewardEventProps,
  type ReferralClient,
  type RewardItem,
} from '@myind/referral-core';
import { ReferralStore } from '../store';

export interface RewardCardState {
  /** Rewards to show, newest from the server, minus the ones dismissed here. */
  readonly items: readonly RewardItem[];
}

export interface RewardCardOptions {
  client: ReferralClient;
  emit: (e: ReferralEvent) => void;
  onShown?: ((reward: RewardItem) => void) | null;
  onDismissed?: ((reward: RewardItem, acknowledged: boolean) => void) | null;
}

/**
 * The reward card's logic (Flutter `_ReferralRewardCardState`): reads `referral_pending`, reports `reward_shown` once
 * per reward, acks on dismiss (`reward_acknowledged` with whether the ack worked), and asks again when the page comes
 * back into view. One load at a time; a dismissed reward stays hidden even if a reload races the ack.
 */
export class RewardCardController {
  readonly store = new ReferralStore<RewardCardState>({ items: [] });
  opts: RewardCardOptions;
  private readonly shown = new Set<string>();
  private readonly dismissed = new Set<string>();
  private loading: Promise<void> | null = null;
  private detach: (() => void) | null = null;

  constructor(opts: RewardCardOptions) {
    this.opts = opts;
  }

  get state(): RewardCardState {
    return this.store.getSnapshot();
  }

  /** Loads, and reloads whenever the page becomes visible again. Returns the stop function. */
  start(): () => void {
    this.reload();
    const d = (globalThis as { document?: Document }).document;
    if (d?.addEventListener && !this.detach) {
      const onVisible = (): void => {
        if (d.visibilityState === 'visible') this.reload();
      };
      d.addEventListener('visibilitychange', onVisible);
      this.detach = () => d.removeEventListener('visibilitychange', onVisible);
    }
    return () => this.stop();
  }

  stop(): void {
    this.detach?.();
    this.detach = null;
  }

  /** Asks the server again (no-op while a load is running). */
  reload(): Promise<void> {
    if (this.loading) return this.loading;
    const f = this.load().finally(() => {
      if (this.loading === f) this.loading = null;
    });
    this.loading = f;
    return f;
  }

  private async load(): Promise<void> {
    try {
      const all = await this.opts.client.pending();
      const items = all.filter((r) => !this.dismissed.has(r.id));
      this.store.set({ items });
      for (const r of items) {
        if (this.shown.has(r.id)) continue;
        this.shown.add(r.id);
        this.opts.emit(new ReferralEvent(ReferralEventName.rewardShown, rewardEventProps(r)));
        safe(() => this.opts.onShown?.(r));
      }
    } catch {
      // Nothing new shown; the rewards stay pending on the server and appear on the next visit.
    }
  }

  async dismiss(r: RewardItem): Promise<void> {
    this.dismissed.add(r.id);
    this.store.set({ items: this.state.items.filter((x) => x.id !== r.id) });
    let acked = true;
    try {
      await this.opts.client.ack([r.id]);
    } catch {
      // Not acknowledged: the card comes back next time, which is better than never showing it.
      acked = false;
    }
    this.opts.emit(
      new ReferralEvent(ReferralEventName.rewardAcknowledged, { ...rewardEventProps(r), acknowledged: acked }),
    );
    safe(() => this.opts.onDismissed?.(r, acked));
  }
}

function safe(f: () => void): void {
  try {
    f();
  } catch {
    // The app's callback failed; the card keeps working.
  }
}
