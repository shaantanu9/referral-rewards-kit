import { defaultRewardsTexts, type RewardsEvent } from '@myind/rewards-core';
import { FakeRewardsServer, fakeRewards } from '@myind/rewards-core/testing';
import type { ReactElement, ReactNode } from 'react';
import { RewardsKitProvider, type RewardsKitConfig } from '../src';

export const x = defaultRewardsTexts;

/** A fake engine at 21:00 UTC (3 h before the day ends, so the streak is at risk), a controller and its events. */
export function setup(opts: { now?: Date; surpriseChance?: number } = {}) {
  const now = opts.now ?? new Date('2026-11-20T21:00:00Z');
  const server = new FakeRewardsServer({ clock: () => now, surpriseChance: opts.surpriseChance ?? 0 });
  const events: RewardsEvent[] = [];
  const { client, controller } = fakeRewards(server, { onEvent: (e) => events.push(e) });
  const opened: string[] = [];
  const copied: string[] = [];
  const wrap = (node: ReactNode, extra: Partial<RewardsKitConfig> = {}): ReactElement => (
    <RewardsKitProvider openUrl={(u) => opened.push(u)} copyText={async (t) => void copied.push(t)} {...extra}>
      {node}
    </RewardsKitProvider>
  );
  return { now, server, client, controller, events, names: () => events.map((e) => e.name as string), opened, copied, wrap };
}
