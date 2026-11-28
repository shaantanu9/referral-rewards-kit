/**
 * `@myind/referral-react-native/clipboard`: Copy and Paste through `expo-clipboard` (`npx expo install expo-clipboard`).
 * On iOS 16+ Paste is the system paste control (`ClipboardPasteButton`, Apple's `UIPasteControl`): no "Allow Paste"
 * prompt, and the kit never reads the clipboard on iOS by itself. Bare React Native: wrap
 * `@react-native-clipboard/clipboard` in a `ReferralClipboard` (without `PasteButton`).
 */
import * as Clipboard from 'expo-clipboard';
import type { ReactNode } from 'react';
import type { ReferralClipboard } from '../platform';

function PasteButton(props: { onPaste: (text: string) => void; label: string }): ReactNode {
  if (!Clipboard.isPasteButtonAvailable) return null;
  return (
    <Clipboard.ClipboardPasteButton
      acceptedContentTypes={['plain-text']}
      displayMode="iconAndLabel"
      accessibilityLabel={props.label}
      style={{ width: 120, height: 48 }}
      onPress={(data) => {
        if (data.type === 'text' && typeof data.text === 'string') props.onPaste(data.text);
      }}
    />
  );
}

/** expo-clipboard as the kit's clipboard: pass it to `ReferralKitProvider clipboard={expoClipboard}`. */
export const expoClipboard: ReferralClipboard = {
  async setString(text) {
    await Clipboard.setStringAsync(text);
  },
  async getString() {
    try {
      return await Clipboard.getStringAsync();
    } catch {
      return null;
    }
  },
  PasteButton,
};
