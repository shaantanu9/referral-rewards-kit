'use client';
import { useSyncExternalStore } from 'react';

/**
 * A tiny snapshot store (the same contract as the cores' `SnapshotStore`): `subscribe(listener) => unsubscribe` and
 * `getSnapshot()`, which returns the same object until something changes. The controllers of this package keep their
 * state in one, and the hooks read it with `useSyncExternalStore`.
 */
export class ReferralStore<S extends object> {
  private state: S;
  private readonly listeners = new Set<() => void>();

  constructor(initial: S) {
    this.state = initial;
  }

  readonly getSnapshot = (): S => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Merges [patch] into the state and notifies, unless nothing changed. */
  set(patch: Partial<S>): void {
    let changed = false;
    for (const k of Object.keys(patch) as Array<keyof S>) {
      if (!Object.is(this.state[k], patch[k])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }
}

/** Reads a [ReferralStore] (or any subscribe / getSnapshot pair) with `useSyncExternalStore`; SSR-safe. */
export function useReferralStore<S extends object>(store: {
  subscribe: (l: () => void) => () => void;
  getSnapshot: () => S;
}): S {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
