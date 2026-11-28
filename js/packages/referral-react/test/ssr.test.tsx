// @vitest-environment node
// Server rendering: importing the package and rendering every component with react-dom/server must not touch
// window or document (Next.js App Router renders client components on the server first).
import { MemoryKeyValueStore, PendingClaimQueue } from '@myind/referral-core';
import { FakeReferralServer, fakeReferralClient } from '@myind/referral-core/testing';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as kit from '../src';

describe('SSR', () => {
  it('runs in a runtime without window or document', () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
  });

  it('renders every component to a string without throwing', () => {
    const server = new FakeReferralServer();
    const client = fakeReferralClient(server);
    const queue = new PendingClaimQueue({ client, store: new MemoryKeyValueStore() });
    const html = renderToString(
      <kit.ReferralProvider client={client} queue={queue} appName="Acme" inviteLink={(c) => `https://acme.app/i/${c}`}>
        <kit.InviteHub />
        <kit.InviteFriendsScreen />
        <kit.InviteCodeSection />
        <kit.InviteCodeEntry />
        <kit.ReferralInvitePageSettings />
        <kit.ReferralRewardCard />
        <kit.ReferralWelcomeCard session="ssr" />
        <kit.InviteCodeText code="K7QM2XRA" />
        <kit.ReferralDeadlineChip text="Only 3 days left to add a code" />
        <kit.ReferralQrCode value="https://acme.app/i/K7QM2XRA" />
        <kit.ReferralMessage text="Hello" />
        <kit.MyindAttribution />
      </kit.ReferralProvider>,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('K7QM-');
    expect(html).toContain('utm_source=referral-react');
    expect(html).toContain('Only 3 days left to add a code');
    expect(html).toContain('<svg');
  });

  it('the QR path is deterministic', () => {
    const a = kit.qrPath('https://acme.app/i/K7QM2XRA');
    expect(a.modules).toBeGreaterThanOrEqual(21);
    expect(kit.qrPath('https://acme.app/i/K7QM2XRA').path).toBe(a.path);
  });
});
