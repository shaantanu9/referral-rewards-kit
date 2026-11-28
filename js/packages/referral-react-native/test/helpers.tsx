import { MemoryKeyValueStore, PendingClaimQueue, t, type ReferralEvent, type ShareResult } from '@myind/referral-core';
import { FakeReferralServer, fakeReferralClient } from '@myind/referral-core/testing';
import type { ReactElement, ReactNode } from "react";
import { ReferralKitProvider, type ReferralClipboard, type ReferralKitConfig } from '../src';

export const en = t('en');

/** A fake server, a client reporting into [events], a queue, and fakes for every adapter. */
export function setup(opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date('2026-11-20T10:00:00Z');
  const server = new FakeReferralServer({ clock: () => now });
  const events: ReferralEvent[] = [];
  const client = fakeReferralClient(server, { onEvent: (e) => events.push(e), clock: () => now });
  const store = new MemoryKeyValueStore();
  const queue = new PendingClaimQueue({ client, store });
  const shared: string[] = [];
  const share = async (text: string): Promise<ShareResult> => {
    shared.push(text);
    return { status: 'success', raw: 'net.whatsapp.WhatsApp.ShareExtension' };
  };
  const opened: string[] = [];
  let canLaunch = true;
  const launcher = {
    canLaunch: async () => canLaunch,
    launch: async (u: string) => {
      opened.push(u);
      return true;
    },
  };
  const copied: string[] = [];
  let clip = '';
  const clipboard: ReferralClipboard = {
    setString: async (s) => {
      copied.push(s);
    },
    getString: async () => clip,
  };
  const names = (): string[] => events.map((e) => e.name);
  const wrap = (node: ReactNode, extra: Partial<ReferralKitConfig> = {}): ReactElement => (
    <ReferralKitProvider share={share} launcher={launcher} clipboard={clipboard} {...extra}>
      {node}
    </ReferralKitProvider>
  );
  return {
    now,
    server,
    client,
    store,
    queue,
    events,
    names,
    shared,
    opened,
    copied,
    clipboard,
    launcher,
    setClip: (s: string) => (clip = s),
    setCanLaunch: (v: boolean) => (canLaunch = v),
    wrap,
  };
}

export { FakeReferralServer };
