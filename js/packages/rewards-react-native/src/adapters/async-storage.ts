/**
 * `@myind/rewards-react-native/async-storage`: a string store on `@react-native-async-storage/async-storage` for
 * `followupIdStoreOn(...)`, so the follow-up scheduler remembers which notifications it scheduled across restarts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { followupIdStoreOn, type FollowupIdStore, type StringStore } from '@myind/rewards-core';

export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** AsyncStorage as a `StringStore`; read errors read as nothing stored. */
export function asyncStorageStringStore(storage: AsyncStorageLike = AsyncStorage): StringStore {
  return {
    async getString(key) {
      try {
        return await storage.getItem(key);
      } catch {
        return null;
      }
    },
    async setString(key, value) {
      await storage.setItem(key, value);
    },
  };
}

/** The scheduler's id store in AsyncStorage (`rewards_kit.followup_ids`). */
export function asyncStorageFollowupIds(storage?: AsyncStorageLike): FollowupIdStore {
  return followupIdStoreOn(asyncStorageStringStore(storage));
}
