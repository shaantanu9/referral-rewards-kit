/**
 * `@myind/referral-react-native/secure-store`: the install id in the Keychain (iOS) / Keystore-encrypted storage
 * (Android) through `expo-secure-store` (`npx expo install expo-secure-store`), the Flutter package's
 * `DefaultInstallIdStore`. Bare React Native without Expo modules: wrap `react-native-keychain` or
 * `react-native-encrypted-storage` in a `KeyValueStore` the same way and pass it to `StoredInstallIdStore`.
 */
import * as SecureStore from 'expo-secure-store';
import { StoredInstallIdStore, type KeyValueStore } from '@myind/referral-core';

/** The subset of expo-secure-store the store uses (inject a double in tests). */
export interface SecureStoreLike {
  getItemAsync(key: string, options?: SecureStore.SecureStoreOptions): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStore.SecureStoreOptions): Promise<void>;
  deleteItemAsync(key: string, options?: SecureStore.SecureStoreOptions): Promise<void>;
}

/**
 * A `KeyValueStore` over expo-secure-store. Keys may hold only letters, digits, `.`, `-` and `_` (the kit's keys do).
 * `AFTER_FIRST_UNLOCK` by default, so the id can be read by background work after the first unlock; the iOS Keychain
 * keeps it across reinstalls on most devices.
 */
export function secureStore(
  options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK },
  store: SecureStoreLike = SecureStore,
): KeyValueStore {
  return {
    async getString(key) {
      try {
        return await store.getItemAsync(key, options);
      } catch {
        return null;
      }
    },
    async setString(key, value) {
      await store.setItemAsync(key, value, options);
    },
    async remove(key) {
      await store.deleteItemAsync(key, options);
    },
  };
}

/**
 * The default install id for React Native: a random UUID in secure storage, optionally mirrored to [backup] (e.g. the
 * AsyncStorage store, so an id survives if the Keychain is unavailable). Never an advertising id.
 */
export function secureInstallIdStore(opts: { backup?: KeyValueStore | null; store?: KeyValueStore } = {}): StoredInstallIdStore {
  return new StoredInstallIdStore({ secure: opts.store ?? secureStore(), backup: opts.backup ?? null });
}
