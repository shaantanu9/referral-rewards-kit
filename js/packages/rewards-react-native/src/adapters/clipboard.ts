/**
 * `@myind/rewards-react-native/clipboard`: copies a social code with `expo-clipboard`
 * (`npx expo install expo-clipboard`). Pass it to `RewardsKitProvider copyText={expoCopyText}`.
 */
import * as Clipboard from 'expo-clipboard';

export async function expoCopyText(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
}
