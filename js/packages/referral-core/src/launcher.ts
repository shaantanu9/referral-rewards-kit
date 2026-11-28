/**
 * Opens links outside the app (the WhatsApp button, G5). React Native: `Linking.canOpenURL` / `openURL`; web:
 * [windowLauncher]. Never throws: a failure reads as "cannot launch".
 */
export interface ReferralLauncher {
  /** Whether [url] can be opened on this device. False hides the button. */
  canLaunch(url: string): Promise<boolean>;
  /** Opens [url]; true when something opened it. */
  launch(url: string): Promise<boolean>;
}

/** Opens links in a new browser tab with `window.open` (noopener); false on the server or when a popup is blocked. */
export const windowLauncher: ReferralLauncher = {
  async canLaunch() {
    return typeof (globalThis as { window?: Window }).window?.open === 'function';
  },
  async launch(url) {
    try {
      const w = (globalThis as { window?: Window }).window;
      if (!w?.open) return false;
      w.open(url, '_blank', 'noopener,noreferrer');
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * `https://wa.me/?text=<text>`: WhatsApp opens with [text] typed in and the user picks the chat. Nothing is sent by
 * the app.
 */
export const whatsAppShareUri = (text: string): string => `https://wa.me/?text=${encodeURIComponent(text)}`;
