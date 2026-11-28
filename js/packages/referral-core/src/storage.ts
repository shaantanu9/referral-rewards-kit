/**
 * Small async string store used by the pending-claim queue, the prompt policy, the install-referrer reader, the event
 * memory and the install id. Back it with anything: [MemoryKeyValueStore], [localStorageStore] (web), or an adapter
 * over AsyncStorage / SecureStore (React Native).
 */
export interface KeyValueStore {
  getString(key: string): Promise<string | null>;
  setString(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** In-memory [KeyValueStore], for tests, SSR and apps that do not want anything persisted. */
export class MemoryKeyValueStore implements KeyValueStore {
  readonly values: Map<string, string>;
  constructor(initial?: Record<string, string>) {
    this.values = new Map(Object.entries(initial ?? {}));
  }
  async getString(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async setString(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}

/** The part of the Web Storage API the store uses. */
export interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * A [KeyValueStore] over `window.localStorage`, keys prefixed with [prefix] (`referral_kit.` like the Flutter
 * package's SharedPreferences store). Safe on the server and in private windows: when there is no `localStorage`, or
 * it throws (quota, blocked storage), values live in memory for this page instead. Pass [storage] to use
 * `sessionStorage` or a test double.
 */
export function localStorageStore(prefix = 'referral_kit.', storage?: WebStorageLike | null): KeyValueStore {
  const memory = new Map<string, string>();
  const resolve = (): WebStorageLike | null => {
    if (storage !== undefined) return storage;
    try {
      const ls = (globalThis as { localStorage?: WebStorageLike }).localStorage;
      return ls ?? null;
    } catch {
      return null;
    }
  };
  return {
    async getString(key) {
      const k = prefix + key;
      try {
        const s = resolve();
        if (s) {
          const v = s.getItem(k);
          if (v !== null) return v;
        }
      } catch {
        // Blocked storage: memory below.
      }
      return memory.get(k) ?? null;
    },
    async setString(key, value) {
      const k = prefix + key;
      memory.set(k, value);
      try {
        resolve()?.setItem(k, value);
      } catch {
        // Kept in memory for this page.
      }
    },
    async remove(key) {
      const k = prefix + key;
      memory.delete(k);
      try {
        resolve()?.removeItem(k);
      } catch {
        // Nothing to remove.
      }
    },
  };
}
