import type { KeyValueStore } from './storage';

/**
 * Remembers which once-only events were already reported, so `reward_granted` fires once per reward and
 * `referral_feature_hidden` once a day per reason. Backed by a [KeyValueStore] (survives restarts) or, without one,
 * by memory. Never throws.
 */
export class ReferralEventMemory {
  /** Reward ids already reported (the last [maxRewards]). */
  static readonly rewardsKey = 'events.rewards_reported';
  /** `<yyyy-mm-dd>|<reason>` marks for today's hidden reasons. */
  static readonly hiddenKey = 'events.hidden_reported';
  static readonly maxRewards = 200;

  private readonly store: KeyValueStore | null;
  private readonly clock: () => Date;
  private rewards: string[] | null = null;
  private hidden: string[] | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(opts: { store?: KeyValueStore | null; clock?: () => Date } = {}) {
    this.store = opts.store ?? null;
    this.clock = opts.clock ?? (() => new Date());
  }

  /** Runs [op] after the previous one, so two quick calls never both report. */
  private serial<T>(op: () => Promise<T>): Promise<T> {
    const next = this.tail.then(op, op);
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async read(key: string): Promise<string[]> {
    try {
      const raw = await this.store?.getString(key);
      if (raw == null || raw === '') return [];
      return raw.split('\n');
    } catch {
      return [];
    }
  }

  private async write(key: string, values: string[]): Promise<void> {
    try {
      await this.store?.setString(key, values.join('\n'));
    } catch {
      // Memory still has it for this run.
    }
  }

  /** The ids in [ids] not reported before; remembers them. */
  newRewards(ids: Iterable<string>): Promise<string[]> {
    const list = [...ids];
    return this.serial(async () => {
      const seen = (this.rewards ??= await this.read(ReferralEventMemory.rewardsKey));
      const fresh: string[] = [];
      for (const id of list) {
        if (id === '' || seen.includes(id) || fresh.includes(id)) continue;
        fresh.push(id);
      }
      if (fresh.length === 0) return fresh;
      seen.push(...fresh);
      if (seen.length > ReferralEventMemory.maxRewards) seen.splice(0, seen.length - ReferralEventMemory.maxRewards);
      await this.write(ReferralEventMemory.rewardsKey, seen);
      return fresh;
    });
  }

  /** True the first time [reason] is seen today (UTC); remembers it. */
  firstToday(reason: string): Promise<boolean> {
    return this.serial(async () => {
      const day = this.clock().toISOString().substring(0, 10);
      const mark = `${day}|${reason}`;
      const had = (this.hidden ??= await this.read(ReferralEventMemory.hiddenKey));
      if (had.includes(mark)) return false;
      const kept = had.filter((m) => m.startsWith(`${day}|`));
      had.length = 0;
      had.push(...kept, mark);
      await this.write(ReferralEventMemory.hiddenKey, had);
      return true;
    });
  }
}
