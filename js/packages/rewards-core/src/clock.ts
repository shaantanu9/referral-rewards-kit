/**
 * Server-corrected time for countdowns (ADR 0002 §8): every deadline comes from the server, and the phone's clock may
 * be wrong by minutes or days. [ServerClock] learns the offset from `server_time` and adds it to local time.
 */
export class ServerClock {
  private readonly local: () => Date;
  private offset = 0;

  constructor(opts: { local?: () => Date } = {}) {
    this.local = opts.local ?? (() => new Date());
  }

  /** Server minus phone, in milliseconds. Zero until the first [sync]. */
  get offsetMs(): number {
    return this.offset;
  }

  /** Learns the offset from a server time received at [receivedAt] (phone time; default now). Ignores null. */
  sync(serverTime: Date | null | undefined, receivedAt?: Date): void {
    if (serverTime == null) return;
    this.offset = serverTime.getTime() - (receivedAt ?? this.local()).getTime();
  }

  /** The current time on the server's clock. */
  now(): Date {
    return new Date(this.local().getTime() + this.offset);
  }

  /** Milliseconds left until [deadline] on the server's clock; never negative. Null deadline → null. */
  leftMs(deadline: Date | null | undefined): number | null {
    if (deadline == null) return null;
    const d = deadline.getTime() - this.now().getTime();
    return d < 0 ? 0 : d;
  }
}
