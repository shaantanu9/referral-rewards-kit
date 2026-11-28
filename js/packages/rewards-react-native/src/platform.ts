/** Helpers built on React Native itself (no extra install). */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { RewardsController } from '@myind/rewards-core';

/**
 * Reloads the rewards state when the app comes back to the foreground (`AppState` → active), so grants that landed
 * while the app was in the background show without a restart.
 */
export function useRefreshOnResume(controller: RewardsController): void {
  useEffect(() => {
    const first = AppState.currentState;
    let last: string = typeof first !== 'string' || first === 'unknown' ? 'active' : first;
    const sub = AppState.addEventListener('change', (next) => {
      const wasAway = last !== 'active';
      last = next;
      if (next === 'active' && wasAway) void controller.refresh();
    });
    return () => sub.remove();
  }, [controller]);
}
