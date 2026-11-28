import {
  MemoryKeyValueStore,
  PendingClaimQueue,
  type ReferralClient,
  type ReferralEvent,
  type ReferralLauncher,
  type ShareHandler,
  type ShareResult,
} from '@myind/referral-core';
import { FakeReferralServer, fakeReferralClient } from '@myind/referral-core/testing';
import { act, cleanup, configure, render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach } from 'vitest';
import { ReferralProvider, type ReferralProviderProps } from '../src';

configure({ asyncUtilTimeout: 20_000 });

afterEach(() => {
  cleanup();
});

/** A fixed "now": Wed 18 Nov 2026, 10:00 UTC. */
export const NOW = new Date('2026-11-18T10:00:00Z');
export const clock = (): Date => NOW;

export class FakeLauncher implements ReferralLauncher {
  readonly launched: string[] = [];
  constructor(
    public can = true,
    public opens = true,
  ) {}
  async canLaunch(): Promise<boolean> {
    return this.can;
  }
  async launch(url: string): Promise<boolean> {
    this.launched.push(url);
    return this.opens;
  }
}

export interface Harness {
  server: FakeReferralServer;
  client: ReferralClient;
  queue: PendingClaimQueue;
  store: MemoryKeyValueStore;
  events: ReferralEvent[];
  shared: string[];
  launcher: FakeLauncher;
  share: ShareHandler;
  /** Events named [name]. */
  named(name: string): ReferralEvent[];
}

export function harness(
  opts: { server?: FakeReferralServer; shareResult?: ShareResult | null; launcher?: FakeLauncher } = {},
): Harness {
  const server = opts.server ?? new FakeReferralServer({ clock });
  const events: ReferralEvent[] = [];
  const client = fakeReferralClient(server, { onEvent: (e) => events.push(e) });
  const store = new MemoryKeyValueStore();
  const queue = new PendingClaimQueue({ client, store });
  const shared: string[] = [];
  const share: ShareHandler = async (text) => {
    shared.push(text);
    return opts.shareResult === undefined ? { status: 'success', raw: 'net.whatsapp.WhatsApp.ShareExtension' } : opts.shareResult;
  };
  return {
    server,
    client,
    queue,
    store,
    events,
    shared,
    launcher: opts.launcher ?? new FakeLauncher(),
    share,
    named: (name) => events.filter((e) => e.name === name),
  };
}

/** Renders [ui] inside a provider wired to [h]. */
export function renderKit(
  h: Harness,
  ui: ReactNode,
  provider: Partial<ReferralProviderProps> = {},
): RenderResult {
  return render(
    <ReferralProvider
      client={h.client}
      queue={h.queue}
      store={h.store}
      appName="Acme"
      launcher={h.launcher}
      share={h.share}
      clock={clock}
      retryPendingClaims={false}
      {...provider}
    >
      {ui}
    </ReferralProvider>,
  );
}

/** Lets pending promises and timers (0 ms) settle inside act. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

export const link = (c: string): string => `https://acme.app/i/${c}`;
