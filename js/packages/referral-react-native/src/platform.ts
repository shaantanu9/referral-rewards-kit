/**
 * Adapters built on React Native itself (no extra install): the share sheet (`Share`), opening links (`Linking`) and
 * app resumes (`AppState`). The ones that need a native library live in their own entry points
 * (`@myind/referral-react-native/async-storage`, `/secure-store`, `/clipboard`, `/netinfo`, `/install-referrer`,
 * `/qrcode`), so an app bundles only what it imports.
 */
import type { ReactNode } from 'react';
import { AppState, Linking, Share } from 'react-native';
import type { ReferralLauncher, ShareHandler, ShareResult, Subscribe } from '@myind/referral-core';

/**
 * React Native's `Share.share` as the kit's [ShareHandler]. iOS reports the receiving activity
 * (`net.whatsapp.WhatsApp.ShareExtension`), so `invite_shared` can name the channel; Android always reports
 * "shared". A failure reads as `unavailable`.
 */
export const rnShare: ShareHandler = async (text) => {
  try {
    const r = await Share.share({ message: text });
    if (r.action === Share.dismissedAction) return { status: 'dismissed', raw: '' } satisfies ShareResult;
    const raw = 'activityType' in r && typeof r.activityType === 'string' ? r.activityType : '';
    return { status: 'success', raw } satisfies ShareResult;
  } catch {
    return { status: 'unavailable', raw: '' } satisfies ShareResult;
  }
};

/**
 * `Linking.canOpenURL` / `openURL` as the kit's [ReferralLauncher] (the WhatsApp button and the attribution link).
 * Never throws. Android 11+: `https` links need a `<queries>` VIEW intent for `canOpenURL` (Expo adds it).
 */
export const linkingLauncher: ReferralLauncher = {
  async canLaunch(url) {
    try {
      return await Linking.canOpenURL(url);
    } catch {
      return false;
    }
  },
  async launch(url) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * The app coming back to the foreground (`AppState` going from background / inactive to active) as a [Subscribe], for
 * `PendingClaimRetrier({appResumes})` and the cards that reload on resume.
 */
export const appStateResumes: Subscribe = (listener) => {
  // Subscribing happens while the app runs: an unknown first state counts as active.
  const first = AppState.currentState;
  let last: string = typeof first !== 'string' || first === 'unknown' ? 'active' : first;
  const sub = AppState.addEventListener('change', (next) => {
    const wasAway = last !== 'active';
    last = next;
    if (next === 'active' && wasAway) listener();
  });
  return () => sub.remove();
};

/**
 * Copying and pasting codes. React Native has no clipboard of its own: use `expoClipboard` from
 * `@myind/referral-react-native/clipboard` (expo-clipboard), or wrap `@react-native-clipboard/clipboard` yourself.
 * Without one, Copy and Paste are hidden.
 */
export interface ReferralClipboard {
  setString(text: string): Promise<void>;
  /** Reads the clipboard (Android and web). iOS never calls it: reading shows the "Allow Paste" prompt. */
  getString?(): Promise<string | null>;
  /**
   * iOS 16+: a system paste control that reads the clipboard without the prompt (expo-clipboard's
   * `ClipboardPasteButton`, Apple's `UIPasteControl`). Render nothing where it is not available.
   */
  PasteButton?: (props: { onPaste: (text: string) => void; label: string }) => ReactNode;
}

/** Draws a QR code for "Show QR code". `qrCodeSvg` from `@myind/referral-react-native/qrcode` is one. */
export type QrRenderer = (props: { value: string; size: number; label: string }) => ReactNode;
