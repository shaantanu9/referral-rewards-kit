/**
 * The observable base of the controllers: `subscribe(listener) => unsubscribe` and `getSnapshot()` returning the same
 * immutable object until something changes, so React's `useSyncExternalStore` (and any other UI) never tears:
 *
 * ```ts
 * const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
 * ```
 *
 * `subscribe` and `getSnapshot` are bound, so they can be passed around as plain functions. The Dart equivalent is a
 * `ChangeNotifier`; [addListener] / [removeListener] are kept for code ported from it.
 */
export abstract class SnapshotStore<S> {
  private readonly listeners = new Set<() => void>();
  private snapshot: S | null = null;
  private version = 0;
  protected disposed = false;

  /** Builds the immutable snapshot of the current state. Called at most once per change. */
  protected abstract buildSnapshot(version: number): S;

  /** Subscribes [listener] to changes; returns the unsubscribe function. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The current snapshot: the same object between changes. */
  readonly getSnapshot = (): S => {
    if (this.snapshot === null) this.snapshot = this.buildSnapshot(this.version);
    return this.snapshot;
  };

  addListener(listener: () => void): void {
    this.listeners.add(listener);
  }

  removeListener(listener: () => void): void {
    this.listeners.delete(listener);
  }

  /** True while someone listens. */
  get hasListeners(): boolean {
    return this.listeners.size > 0;
  }

  /** Marks the snapshot stale and tells every listener. Does nothing after [dispose]. */
  protected notify(): void {
    if (this.disposed) return;
    this.version++;
    this.snapshot = null;
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch {
        // A listener's error never breaks the controller.
      }
    }
  }

  /** Stops notifying and drops every listener. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}

/** A tiny event emitter for the controllers' streams (grants, moments). */
export class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();
  private closed = false;

  on(listener: (value: T) => void): () => void {
    if (this.closed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(value: T): void {
    if (this.closed) return;
    for (const l of [...this.listeners]) {
      try {
        l(value);
      } catch {
        // A listener's error never breaks the controller.
      }
    }
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
