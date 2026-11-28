// A fake engine on a clock the test moves, and a render that wraps the UI in a RewardsProvider.
import { RewardsController, type RewardsClient, type RewardsTexts } from '@myind/rewards-core';
import { FakeRewardsServer, fakeRewards } from '@myind/rewards-core/testing';
import { act, render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { RewardsProvider } from '../src';

/** 22:30 UTC: 1 h 30 m before the day ends, so an undone streak is at risk. */
export const start = new Date('2026-11-27T22:30:00Z');

export interface Rig {
  server: FakeRewardsServer;
  client: RewardsClient;
  controller: RewardsController;
  events: Array<{ name: string; props: Readonly<Record<string, unknown>> }>;
  now(): Date;
  advance(ms: number): void;
}

export function rig(opts: { now?: Date; surpriseChance?: number } = {}): Rig {
  let now = opts.now ?? start;
  const events: Rig['events'] = [];
  const server = new FakeRewardsServer({ clock: () => now, surpriseChance: opts.surpriseChance ?? 0 });
  const { client, controller } = fakeRewards(server, { onEvent: (e) => events.push({ name: e.name, props: e.props }) });
  return {
    server,
    client,
    controller,
    events,
    now: () => now,
    advance(ms) {
      now = new Date(now.getTime() + ms);
    },
  };
}

/** Renders [ui] under a provider for [r]'s controller. */
export function renderWith(r: Rig, ui: ReactNode, texts?: RewardsTexts): RenderResult {
  return render(
    <RewardsProvider controller={r.controller} {...(texts ? { texts } : {})}>
      {ui}
    </RewardsProvider>,
  );
}

/** Lets pending promises (the fake's answers) settle inside act. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Loads the state before rendering. */
export async function loaded(r: Rig): Promise<Rig> {
  await r.controller.refresh();
  return r;
}

export { act };
