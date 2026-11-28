/**
 * `@myind/rewards-react-native/view-shot`: turns a `RewardsRecapCard` into a PNG for the share sheet with
 * `react-native-view-shot` (`npx expo install react-native-view-shot`). Nothing is captured or shared until the user
 * taps the app's Share button.
 */
import type { RefObject } from 'react';
import { Share } from 'react-native';
import { captureRef } from 'react-native-view-shot';

/** The capture function (inject a double in tests). */
export type Capture = (ref: RefObject<unknown>, options: { format: 'png'; quality: number; result: 'tmpfile'; width?: number }) => Promise<string>;

/** The card on screen as a PNG file; resolves to its `file://` uri, or null while the card is not mounted. */
export async function captureRecapCard(
  ref: RefObject<unknown>,
  opts: { width?: number; capture?: Capture } = {},
): Promise<string | null> {
  if (ref.current == null) return null;
  const capture = opts.capture ?? (captureRef as unknown as Capture);
  return capture(ref, { format: 'png', quality: 1, result: 'tmpfile', ...(opts.width ? { width: opts.width } : {}) });
}

/**
 * Captures the card and opens the share sheet with the image (and [message]). React Native's `Share` shares a file on
 * iOS; on Android it shares text only, so pass [shareFile] there, e.g. expo-sharing
 * `(uri) => Sharing.shareAsync(uri, { mimeType: 'image/png' })`. Resolves false when nothing was shared.
 */
export async function shareRecapCard(
  ref: RefObject<unknown>,
  opts: { message?: string; shareFile?: (uri: string) => Promise<unknown>; capture?: Capture; width?: number } = {},
): Promise<boolean> {
  try {
    const uri = await captureRecapCard(ref, { ...(opts.capture ? { capture: opts.capture } : {}), ...(opts.width ? { width: opts.width } : {}) });
    if (uri == null) return false;
    if (opts.shareFile) {
      await opts.shareFile(uri);
      return true;
    }
    const r = await Share.share({ url: uri, ...(opts.message ? { message: opts.message } : {}) });
    return r.action !== Share.dismissedAction;
  } catch {
    return false;
  }
}
