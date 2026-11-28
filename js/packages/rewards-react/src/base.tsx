'use client';
import type { RewardsController, RewardsSnapshot } from '@myind/rewards-core';
import type { ReactNode } from 'react';
import { useRewardsController, useRewardsListener } from './context';

export interface RewardsListenerProps {
  readonly controller?: RewardsController;
  /** What to show while rewards are visible; gets the snapshot and the controller. */
  readonly render: (snapshot: RewardsSnapshot, controller: RewardsController) => ReactNode;
  /** What to show while they are not (not loaded, unavailable, disabled). Default nothing. */
  readonly hidden?: (snapshot: RewardsSnapshot) => ReactNode;
}

/**
 * Re-renders on every controller change and loads the state once on mount when nobody has yet (port of the Flutter
 * `RewardsListener`). Shows [hidden] (default nothing) while rewards are not visible.
 */
export function RewardsListener(props: RewardsListenerProps): ReactNode {
  const c = useRewardsController(props.controller);
  const snap = useRewardsListener(c);
  return <>{snap.visible ? props.render(snap, c) : (props.hidden?.(snap) ?? null)}</>;
}
