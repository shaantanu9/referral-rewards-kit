/**
 * `@myind/referral-react-native/qrcode`: the invite QR code drawn by `react-native-qrcode-svg` (needs
 * `react-native-svg`: `npx expo install react-native-svg react-native-qrcode-svg`). Pass it to
 * `ReferralKitProvider renderQr={qrCodeSvg}` to show "Show QR code".
 */
import QRCode from 'react-native-qrcode-svg';
import type { ReactNode } from 'react';
import type { QrRenderer } from '../platform';

/** Black on white, square modules, medium error correction: it scans in dark mode too. */
export const qrCodeSvg: QrRenderer = ({ value, size }): ReactNode => (
  <QRCode value={value} size={size} color="#000000" backgroundColor="#FFFFFF" ecl="M" />
);
