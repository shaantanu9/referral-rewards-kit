import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import { useReferralKit } from '../context';
import type { ReferralClipboard } from '../platform';
import { Button } from '../ui/primitives';

export interface InviteCodePasteButtonProps {
  onPasted: (text: string) => void;
  /** Overrides the platform, for tests. */
  platform?: 'ios' | 'android' | 'web' | string;
  /** Default: the provider's clipboard. */
  clipboard?: ReferralClipboard;
}

/**
 * The Paste control next to the code field (ADR 4.2).
 *
 * - iOS 16+: the system paste control (`clipboard.PasteButton`, expo-clipboard's `ClipboardPasteButton`, Apple's
 *   `UIPasteControl`): it reads the clipboard without the "Allow Paste" prompt because the user tapped a system-drawn
 *   button. iOS below 16 or no control: nothing; the field's own paste menu is used. The clipboard is never read
 *   on iOS.
 * - Android and web: a button that reads the clipboard.
 * - No clipboard adapter: nothing.
 */
export function InviteCodePasteButton(props: InviteCodePasteButtonProps): ReactNode {
  const kit = useReferralKit();
  const clipboard = props.clipboard ?? kit.clipboard;
  if (!clipboard) return null;
  const os = props.platform ?? Platform.OS;
  if (os === 'ios') {
    const Paste = clipboard.PasteButton;
    return Paste ? <Paste label={kit.l10n.paste} onPaste={(t) => t !== '' && props.onPasted(t)} /> : null;
  }
  const read = clipboard.getString;
  if (!read) return null;
  return (
    <Button
      theme={kit.theme}
      variant="outlined"
      icon="⎘"
      label={kit.l10n.paste}
      testID="referral-paste"
      onPress={() => {
        read
          .call(clipboard)
          .then((text) => {
            if (text != null && text !== '') props.onPasted(text);
          })
          .catch(() => {});
      }}
    />
  );
}
