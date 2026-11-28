/**
 * `@myind/referral-react-native/async-storage`: the kit's `KeyValueStore` on `@react-native-async-storage/async-storage`
 * (install it: `npx expo install @react-native-async-storage/async-storage`). Use it for the pending-claim queue, the
 * prompt policy, the install-referrer reader, the event memory, the code cache and the welcome card.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValueStore } from '@myind/referral-core';

/** The subset of AsyncStorage the store uses (inject a double in tests). */
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * A `KeyValueStore` over AsyncStorage with keys prefixed by [prefix] (`referral_kit.` like the Flutter package's
 * SharedPreferences store). Read errors read as "nothing stored"; write errors are swallowed (the kit treats storage
 * as best effort, like Dart).
 */
export function asyncStorageStore(prefix = 'referral_kit.', storage: AsyncStorageLike = AsyncStorage): KeyValueStore {
  return {
    async getString(key) {
      try {
        return await storage.getItem(prefix + key);
      } catch {
        return null;
      }
    },
    async setString(key, value) {
      try {
        await storage.setItem(prefix + key, value);
      } catch {
        // Best effort.
      }
    },
    async remove(key) {
      try {
        await storage.removeItem(prefix + key);
      } catch {
        // Best effort.
      }
    },
  };
}
