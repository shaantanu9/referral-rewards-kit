/**
 * `@myind/referral-react-native/netinfo`: reconnects from `@react-native-community/netinfo`
 * (`npx expo install @react-native-community/netinfo`), for `PendingClaimRetrier({reconnects})`.
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import type { Subscribe } from '@myind/referral-core';

type AddListener = (listener: (state: NetInfoState) => void) => () => void;

/**
 * Fires when the device goes from offline to online (`isConnected` false → true; `isInternetReachable` false also
 * counts as offline). The first report after subscribing only records the state.
 */
export function netInfoReconnects(addEventListener: AddListener = (l) => NetInfo.addEventListener(l)): Subscribe {
  return (listener) => {
    let online: boolean | null = null;
    return addEventListener((s) => {
      const now = s.isConnected === true && s.isInternetReachable !== false;
      if (online === false && now) listener();
      online = now;
    });
  };
}
