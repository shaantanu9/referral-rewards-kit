/**
 * Keeps the device's follow-up notifications equal to the engine's plan (ADR 0002 §18.7). The package sends no
 * notification itself: the app implements [FollowupNotifier] with its own library (expo-notifications, notifee, the
 * web Notifications API, …).
 */
import type { RewardsController } from './controller';
import { RewardsException, RewardsServerError, RewardsUnavailableException } from './errors';
import { RewardsEvent, RewardsEventName, type RewardsEventProps } from './events';

/** The app's notification library, as the scheduler needs it. */
export interface FollowupNotifier {
  /** Cancels the notifications with these ids (unknown ids are fine). */
  cancel(ids: number[]): Promise<void>;
  /** Schedules (or replaces) notification [id] at [at] (device time). Must be idempotent per id. */
  schedule(n: { id: number; at: Date; title: string; body: string; payload: string }): Promise<void>;
}

/** Where the scheduler remembers which ids it scheduled, so the next replan (or `stop`) can cancel them. */
export interface FollowupIdStore {
  read(): Promise<number[]>;
  write(ids: number[]): Promise<void>;
}

/** A [FollowupIdStore] in memory (forgets on restart). */
export class MemoryFollowupIdStore implements FollowupIdStore {
  private value: number[];
  constructor(ids: readonly number[] = []) {
    this.value = [...ids];
  }
  get ids(): readonly number[] {
    return [...this.value];
  }
  async read(): Promise<number[]> {
    return [...this.value];
  }
  async write(ids: number[]): Promise<void> {
    this.value = [...ids];
  }
}

/** The string store an app already has (localStorage, AsyncStorage), as `referral-core`'s `KeyValueStore`. */
export interface StringStore {
  getString(key: string): Promise<string | null>;
  setString(key: string, value: string): Promise<void>;
}

/** A persistent [FollowupIdStore] over a string store, under [key]. */
export function followupIdStoreOn(store: StringStore, key = 'rewards_kit.followup_ids'): FollowupIdStore {
  return {
    async read() {
      const raw = await store.getString(key);
      if (!raw) return [];
      try {
        const v = JSON.parse(raw) as unknown;
        return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isInteger(x)) : [];
      } catch {
        return [];
      }
    },
    async write(ids) {
      await store.setString(key, JSON.stringify(ids));
    },
  };
}

/**
 * The `reason` of a `rewards_followups_failed` event: the server's refusal, `unavailable`, `server_error` or
 * `offline` for a server call ([step] `plan`), otherwise `notifier_error` / `store_error`. Never a message.
 */
export function followupFailureReason(e: unknown, step: string): string {
  if (step === 'notifier') return 'notifier_error';
  if (step === 'store') return 'store_error';
  if (e instanceof RewardsUnavailableException) return 'unavailable';
  if (e instanceof RewardsException) return e.reason;
  if (e instanceof RewardsServerError) return 'server_error';
  return 'offline';
}

/**
 * Fetches `rewards_followups_plan` after every controller change (debounced), cancels what it scheduled before and is
 * no longer planned, and schedules every planned item still in the future. Call [stop] on sign-out. Nothing runs in
 * the constructor. Errors never escape: they are reported as `rewards_followups_failed`.
 */
export class FollowupScheduler {
  readonly controller: RewardsController;
  readonly notifier: FollowupNotifier;
  readonly store: FollowupIdStore;
  /** How long the controller must be quiet before a replan. Default 2000 ms. */
  readonly debounceMs: number;
  /** How many days ahead to plan. Default 14. */
  readonly days: number;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private listening = false;
  private generation = 0;
  private running: Promise<void> | null = null;
  private again = false;
  private unsubscribe: (() => void) | null = null;

  constructor(opts: { controller: RewardsController; notifier: FollowupNotifier; store?: FollowupIdStore; debounceMs?: number; days?: number }) {
    this.controller = opts.controller;
    this.notifier = opts.notifier;
    this.store = opts.store ?? new MemoryFollowupIdStore();
    this.debounceMs = opts.debounceMs ?? 2000;
    this.days = opts.days ?? 14;
  }

  /** True between [start] and [stop]. */
  get started(): boolean {
    return this.listening;
  }

  private report(name: RewardsEvent['name'], props: RewardsEventProps): void {
    this.controller.client.report(new RewardsEvent(name, props));
  }

  /** Listens to the controller and plans once after the debounce. Calling it again does nothing. */
  start(): void {
    if (this.listening) return;
    this.listening = true;
    this.unsubscribe = this.controller.subscribe(() => this.changed());
    this.changed();
  }

  private changed(): void {
    if (!this.listening) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.replanNow(), this.debounceMs);
  }

  /** Replans at once (also without [start]). A call while one runs makes it run once more afterwards. */
  replanNow(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.loop().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async loop(): Promise<void> {
    do {
      this.again = false;
      await this.replan(this.generation);
    } while (this.again);
  }

  private async replan(generation: number): Promise<void> {
    let step = 'plan';
    try {
      const plan = await this.controller.client.followupsPlan(this.days);
      if (generation !== this.generation) return;
      const clock = this.controller.clock;
      const serverNow = plan.serverTime ?? clock.now();
      // Server minus device, from this answer when it has a time: notifications fire on the device's clock.
      const offset = plan.serverTime == null ? clock.offsetMs : clock.offsetMs + (plan.serverTime.getTime() - clock.now().getTime());
      const future = plan.items.filter((i) => i.at.getTime() > serverNow.getTime());
      const keep = new Set(future.map((i) => i.id));

      step = 'store';
      const previous = await this.store.read();
      const removed = [...new Set(previous)].filter((id) => !keep.has(id));
      // Remember everything that may be on the device before touching it, so a failure halfway is cancelled later.
      await this.store.write([...new Set([...previous, ...keep])]);

      step = 'notifier';
      if (removed.length > 0) await this.notifier.cancel(removed);
      for (const i of future) {
        if (generation !== this.generation) return;
        await this.notifier.schedule({ id: i.id, at: new Date(i.at.getTime() - offset), title: i.title, body: i.body, payload: i.payload });
      }
      if (generation !== this.generation) return;

      step = 'store';
      await this.store.write([...keep]);
      this.report(RewardsEventName.followupsPlanned, { count: future.length });
    } catch (e) {
      this.report(RewardsEventName.followupsFailed, { reason: followupFailureReason(e, step) });
    }
  }

  /** Stops listening and cancels every notification it scheduled (call on sign-out). Waits for a running replan. */
  async stop(): Promise<void> {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.listening) {
      this.listening = false;
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
    if (this.running) await this.running;
    let step = 'store';
    try {
      const ids = await this.store.read();
      step = 'notifier';
      if (ids.length > 0) await this.notifier.cancel([...new Set(ids)]);
      step = 'store';
      await this.store.write([]);
    } catch (e) {
      this.report(RewardsEventName.followupsFailed, { reason: followupFailureReason(e, step) });
    }
  }
}
