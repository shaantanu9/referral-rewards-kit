/**
 * `@myind/referral-react-native/install-referrer`: the Google Play install referrer through `expo-application`
 * (`npx expo install expo-application`), so a friend who installs from an invite page lands with the code prefilled.
 * Android only; iOS and web have no referrer (null). Bare React Native: `react-native-device-info`'s
 * `getInstallReferrer()` or `react-native-play-install-referrer` fit the same `InstallReferrerSource` interface.
 */
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import type { InstallReferrerSource } from '@myind/referral-core';

/**
 * Reads `Application.getInstallReferrerAsync()` on Android (e.g. `code=ABCDEFGH&utm_source=…`); null elsewhere or when
 * the Play Store is missing or the call fails. Use with `InstallReferrerCodeReader`, which reads it once per install.
 */
export function playInstallReferrer(
  read: () => Promise<string> = () => Application.getInstallReferrerAsync(),
  os: string = Platform.OS,
): InstallReferrerSource {
  return {
    async readReferrer() {
      if (os !== 'android') return null;
      try {
        const r = await read();
        return r === '' ? null : r;
      } catch {
        return null;
      }
    },
  };
}
