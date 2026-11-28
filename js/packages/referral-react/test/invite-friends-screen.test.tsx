import { isolatedCode, MemoryKeyValueStore, ReferralEventName } from '@myind/referral-core';
import { FakeReferralServer } from '@myind/referral-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InviteFriendsScreen } from '../src';
import { FakeLauncher, harness, link, renderKit, settle } from './support';

const code = FakeReferralServer.myCode;

describe('InviteFriendsScreen', () => {
  it('code, rules, caps, rewards earned, pending with date, banked, cap, terms link', async () => {
    const h = harness();
    h.server.aFriendSignsUp();
    h.server.aFriendStarts();
    h.server.addPendingReward(new Date('2026-11-25T12:00:00Z'));
    h.server.addBankedReward();
    h.server.skippedCap = 2;
    const onOpenTerms = vi.fn();
    renderKit(h, <InviteFriendsScreen inviteLink={link} onOpenTerms={onOpenTerms} />);
    await screen.findByTestId('referral-code');
    expect(screen.getByTestId('referral-code').getAttribute('aria-label')).toBe('K 7 Q M, 2 X R A');
    expect(screen.getByText('K7QM-')).toBeTruthy();
    expect(screen.getByText('2XRA')).toBeTruthy();
    const rules = screen.getByTestId('referral-rules');
    expect(rules.textContent).toContain('You and your friend each get 4 chapters');
    expect(rules.textContent).toContain('You get 5 days of plus when a friend you invited subscribes');
    expect(rules.textContent).toContain('Up to 10 friends a month count.');
    expect(rules.textContent).toContain('Up to 6 subscribing friends a year count.');
    expect(screen.getByTestId('referral-joined').textContent).toBe('1 friend joined');
    expect(screen.getByTestId('referral-earned').textContent).toContain('8 chapters');
    const pending = screen.getByTestId('referral-pending').textContent!;
    expect(pending).toContain('4 chapters, around Nov 25, 2026');
    expect(pending).toContain('5 days of plus, added when your current plan ends.');
    expect(screen.getByTestId('referral-skipped').textContent).toBe('2 rewards were over the limit');
    expect(screen.queryByTestId('referral-empty')).toBeNull();
    fireEvent.click(screen.getByText('Program terms'));
    expect(onOpenTerms).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'Invite friends' })).toBeTruthy();
  });

  it('Share sends the rules-built text with the isolated code and reports the channel', async () => {
    const h = harness();
    renderKit(h, <InviteFriendsScreen inviteLink={link} />);
    fireEvent.click(await screen.findByTestId('referral-share'));
    await settle();
    expect(h.shared).toEqual([
      `Here's 4 chapters in Acme, on me: join with my code ${isolatedCode(code)} and we both get it once you start using the app. ${link(code)}`,
    ]);
    const e = h.named(ReferralEventName.inviteShared)[0]!;
    expect(e.props).toEqual({ channel: 'whatsapp', status: 'success', has_link: true });
  });

  it('Copy writes the formatted code, calls back, reports has_link and announces "Code copied"', async () => {
    const h = harness();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onCopied = vi.fn();
    renderKit(h, <InviteFriendsScreen onCopied={onCopied} />);
    fireEvent.click(await screen.findByTestId('referral-copy-code'));
    await settle();
    expect(writeText).toHaveBeenCalledWith('K7QM-2XRA');
    expect(onCopied).toHaveBeenCalledWith('K7QM-2XRA');
    expect(h.named(ReferralEventName.inviteCodeCopied)[0]!.props).toEqual({ has_link: false });
    expect(screen.getByTestId('referral-toast').textContent).toBe('Code copied');
    expect(screen.getByTestId('referral-toast').getAttribute('aria-live')).toBe('polite');
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('empty state names the reward each side gets', async () => {
    const h = harness();
    renderKit(h, <InviteFriendsScreen inviteLink={link} />);
    expect((await screen.findByTestId('referral-empty')).textContent).toBe(
      'No invites yet. Share your code: you each get 4 chapters when a friend starts using the app.',
    );
  });

  it('the sharer sees a friend who used the code before they start (waiting line, no empty state)', async () => {
    const h = harness();
    h.server.aFriendSignsUp();
    renderKit(h, <InviteFriendsScreen inviteLink={link} texts={{ activationStepForFriends: 'Read their first page' }} />);
    const line = await screen.findByTestId('referral-claimed');
    expect(line.textContent).toBe(
      '1 friend used your code. Their next step: Read their first page. When they do it, you both get 4 chapters.',
    );
    expect(screen.queryByTestId('referral-empty')).toBeNull();
  });

  it('give-first headline and the boost banner with its real last day', async () => {
    const h = harness();
    renderKit(h, <InviteFriendsScreen inviteLink={link} />);
    expect((await screen.findByTestId('referral-invite-headline')).textContent).toBe(
      'Give a friend 4 chapters, and get the same, when they join with your code and start using the app',
    );
    expect(screen.getByTestId('referral-boost').textContent).toBe(
      'Double rewards until Fri, 20 Nov for every friend who adds your code by then.',
    );
  });

  it('an ended boost is not shown', async () => {
    const h = harness();
    renderKit(h, <InviteFriendsScreen inviteLink={link} />, { clock: () => new Date('2026-12-30T00:00:00Z') });
    await screen.findByTestId('referral-code');
    expect(screen.queryByTestId('referral-boost')).toBeNull();
  });

  it('paused program keeps earned rewards visible and reports the feature hidden', async () => {
    const h = harness();
    h.server.enabled = false;
    h.server.aFriendSignsUp();
    h.server.aFriendStarts();
    renderKit(h, <InviteFriendsScreen inviteLink={link} />);
    expect((await screen.findByTestId('referral-paused')).textContent).toBe(
      "Invites are paused right now. Rewards you've earned are safe.",
    );
    expect(screen.getByTestId('referral-earned')).toBeTruthy();
    expect(screen.queryByTestId('referral-share')).toBeNull();
    await settle();
    expect(h.named(ReferralEventName.referralFeatureHidden)[0]!.props).toEqual({
      reason: 'program_paused',
      surface: 'invite',
    });
  });

  it('code disabled for review', async () => {
    const h = harness();
    h.server.codeReason = 'code_disabled';
    renderKit(h, <InviteFriendsScreen />);
    expect((await screen.findByTestId('referral-unavailable')).textContent).toBe(
      "Your code is paused while we review it. Rewards you've earned are safe.",
    );
  });

  it('load error offers Retry; offline falls back to the cached code', async () => {
    const h = harness();
    h.server.offline = true;
    const cache = new MemoryKeyValueStore();
    renderKit(h, <InviteFriendsScreen codeCache={cache} />);
    const failed = await screen.findByTestId('referral-load-failed');
    expect(failed.textContent).toContain("Couldn't load your invites.");
    h.server.offline = false;
    fireEvent.click(within(failed).getByText('Try again'));
    await screen.findByTestId('referral-code');
    expect(await cache.getString('my_code')).toBe(code);
  });

  it('offline with a cached code: the code and Share, no numbers', async () => {
    const h = harness();
    h.server.offline = true;
    const cache = new MemoryKeyValueStore({ my_code: code });
    renderKit(h, <InviteFriendsScreen codeCache={cache} inviteLink={link} />);
    await screen.findByTestId('referral-code');
    expect(screen.queryByTestId('referral-invite-headline')).toBeNull();
    expect(screen.queryByTestId('referral-empty')).toBeNull();
    expect(screen.queryByTestId('referral-invite-page')).toBeNull();
    expect(screen.getByTestId('referral-share')).toBeTruthy();
  });

  it('not deployed: "not available yet", no Retry; renderUnavailable can hide it', async () => {
    const h = harness();
    h.server.deployed = false;
    const view = renderKit(h, <InviteFriendsScreen />);
    expect((await screen.findByTestId('referral-not-available')).textContent).toBe(
      "Invites aren't available yet. Check back soon.",
    );
    expect(screen.queryByText('Try again')).toBeNull();
    view.unmount();
    renderKit(harness({ server: h.server }), <InviteFriendsScreen renderUnavailable={() => null} />);
    await settle();
    expect(screen.queryByTestId('referral-not-available')).toBeNull();
  });

  it('signed out: one sentence and a Sign in button', async () => {
    const h = harness();
    h.server.signedIn = false;
    const onSignIn = vi.fn();
    renderKit(h, <InviteFriendsScreen onSignIn={onSignIn} />);
    expect((await screen.findByTestId('referral-not-available')).textContent).toContain(
      'Sign in to get your invite code',
    );
    fireEvent.click(screen.getByText('Sign in'));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('reports invite_screen_viewed once with from, not when embedded', async () => {
    const h = harness();
    renderKit(h, <InviteFriendsScreen from="settings" />);
    await screen.findByTestId('referral-code');
    fireEvent.click(screen.getByTestId('referral-share'));
    await settle();
    expect(h.named(ReferralEventName.inviteScreenViewed).map((e) => e.props)).toEqual([
      { from: 'settings', focus: 'share' },
    ]);
    const h2 = harness();
    renderKit(h2, <InviteFriendsScreen embedded />);
    await screen.findAllByTestId('referral-code');
    expect(h2.named(ReferralEventName.inviteScreenViewed)).toHaveLength(0);
  });

  it('WhatsApp opens wa.me with the share text and reports channel whatsapp_button', async () => {
    const h = harness();
    renderKit(h, <InviteFriendsScreen inviteLink={link} />);
    fireEvent.click(await screen.findByTestId('referral-whatsapp'));
    await settle();
    expect(h.launcher.launched[0]).toMatch(/^https:\/\/wa\.me\/\?text=Here's/);
    expect(decodeURIComponent(h.launcher.launched[0]!)).toContain(link(code));
    expect(h.named(ReferralEventName.inviteShared)[0]!.props).toEqual({
      channel: 'whatsapp_button',
      status: 'opened',
      has_link: true,
    });
  });

  it('WhatsApp hidden when it cannot launch; unavailable when the launch fails', async () => {
    const h = harness({ launcher: new FakeLauncher(false) });
    const view = renderKit(h, <InviteFriendsScreen inviteLink={link} />);
    await screen.findByTestId('referral-share');
    await settle();
    expect(screen.queryByTestId('referral-whatsapp')).toBeNull();
    view.unmount();
    const h2 = harness({ launcher: new FakeLauncher(true, false) });
    renderKit(h2, <InviteFriendsScreen inviteLink={link} />);
    fireEvent.click(await screen.findByTestId('referral-whatsapp'));
    await settle();
    expect(h2.named(ReferralEventName.inviteShared)[0]!.props['status']).toBe('unavailable');
  });

  it('Show QR code: the https invite link in a labelled dialog, an event, Escape closes it', async () => {
    const h = harness();
    renderKit(h, <InviteFriendsScreen inviteLink={link} />);
    fireEvent.click(await screen.findByTestId('referral-show-qr'));
    const dialog = screen.getByRole('dialog', { name: 'Your invite link' });
    const qr = within(dialog).getByRole('img', { name: 'QR code of your invite link' });
    expect(qr.getAttribute('data-value')).toBe(link(code));
    expect(qr.querySelector('rect')!.getAttribute('fill')).toBe('#ffffff');
    expect(within(dialog).getByText(link(code))).toBeTruthy();
    expect(h.named(ReferralEventName.inviteQrShown)).toHaveLength(1);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('no invite page: no QR, Share sends the code and the store link, a line says how', async () => {
    const h = harness();
    renderKit(h, <InviteFriendsScreen storeLink="https://acme.app/get" />);
    expect((await screen.findByTestId('referral-no-link')).textContent).toBe(
      'Your friend gets Acme from the app store and types this code in.',
    );
    expect(screen.queryByTestId('referral-show-qr')).toBeNull();
    fireEvent.click(screen.getByTestId('referral-share'));
    await settle();
    expect(h.shared[0]).toContain(isolatedCode(code));
    expect(h.shared[0]).toContain('https://acme.app/get');
    expect(h.named(ReferralEventName.inviteShared)[0]!.props['has_link']).toBe(false);
  });

  it('a non-https link counts as no link', async () => {
    const h = harness();
    renderKit(h, <InviteFriendsScreen inviteLink={(c) => `http://acme.app/i/${c}`} />);
    await screen.findByTestId('referral-no-link');
    expect(screen.queryByTestId('referral-show-qr')).toBeNull();
  });

  it('header above the code and the app share sentence with the formatted code', async () => {
    const h = harness();
    renderKit(
      h,
      <InviteFriendsScreen
        inviteLink={link}
        header={<p data-testid="app-header">Read more together</p>}
        shareText={(c, l) => `Use ${c} at ${l}`}
      />,
    );
    expect(await screen.findByTestId('app-header')).toBeTruthy();
    fireEvent.click(screen.getByTestId('referral-share'));
    await settle();
    expect(h.shared[0]).toBe(`Use K7QM-2XRA at ${link(code)}`);
  });

  it('first name: validated like the server, saved, and withdrawn at once', async () => {
    const h = harness();
    renderKit(h, <InviteFriendsScreen inviteLink={link} />);
    const block = await screen.findByTestId('referral-invite-page');
    expect(block.textContent).toContain('with a note that you get a reward if they join');
    fireEvent.click(within(block).getByRole('switch', { name: 'Show my first name' }));
    const field = await within(block).findByTestId('referral-name-field');
    fireEvent.change(field, { target: { value: 'me@x.com' } });
    fireEvent.click(within(block).getByTestId('referral-name-save'));
    expect((await within(block).findByTestId('referral-name-error')).textContent).toBe("A name can't contain @ or a link.");
    expect(field.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(field, { target: { value: 'Priya' } });
    fireEvent.click(within(block).getByTestId('referral-name-save'));
    await waitFor(() => expect(within(block).getByTestId('referral-prefs-status').textContent).toBe('Saved'));
    expect(h.server.showName).toBe(true);
    expect(h.server.displayName).toBe('Priya');
    fireEvent.click(within(block).getByRole('switch'));
    await waitFor(() => expect(h.server.showName).toBe(false));
    expect(h.named(ReferralEventName.invitePreferencesChanged).map((e) => e.props)).toEqual([
      { show_name: true, result: 'ok' },
      { show_name: false, result: 'ok' },
    ]);
  });

  it('leave with a confirm, then "You left" and Join again', async () => {
    const h = harness();
    renderKit(h, <InviteFriendsScreen inviteLink={link} />);
    fireEvent.click(await screen.findByTestId('referral-leave'));
    const dialog = screen.getByRole('dialog', { name: 'Leave the invite program?' });
    fireEvent.click(within(dialog).getByTestId('referral-leave-cancel'));
    expect(h.server.left).toBe(false);
    fireEvent.click(screen.getByTestId('referral-leave'));
    fireEvent.click(screen.getByTestId('referral-leave-confirm'));
    expect((await screen.findByTestId('referral-left')).textContent).toBe('You left the invite program');
    expect(screen.queryByTestId('referral-code')).toBeNull();
    fireEvent.click(screen.getByTestId('referral-join-again'));
    await screen.findByTestId('referral-code');
    expect(h.server.left).toBe(false);
  });

  it('an older server (no new RPCs) shows no invite page block and no boost', async () => {
    const h = harness();
    h.server.boost = false;
    const original = h.server.call.bind(h.server);
    h.server.call = async (fn, params) => {
      if (fn === 'referral_preferences') throw Object.assign(new Error('not found'), { code: 'PGRST202' });
      return original(fn, params);
    };
    renderKit(h, <InviteFriendsScreen inviteLink={link} />);
    await screen.findByTestId('referral-code');
    await settle();
    expect(screen.queryByTestId('referral-invite-page')).toBeNull();
    expect(screen.queryByTestId('referral-boost')).toBeNull();
  });

  it('render escape hatch gets the data, actions and the default content', async () => {
    const h = harness();
    renderKit(
      h,
      <InviteFriendsScreen
        inviteLink={link}
        render={({ data, actions, defaultContent }) => (
          <div>
            <button onClick={() => void actions.share()}>my share {data?.code.code ?? ''}</button>
            {defaultContent}
          </div>
        )}
      />,
    );
    fireEvent.click(await screen.findByText(`my share ${code}`));
    await settle();
    expect(h.shared).toHaveLength(1);
    expect(screen.getByTestId('referral-invite-screen')).toBeTruthy();
  });

  it('className and style land on the root', async () => {
    const h = harness();
    renderKit(h, <InviteFriendsScreen className="mine" style={{ maxWidth: 480 }} />);
    const root = screen.getByTestId('referral-invite-screen');
    expect(root.className).toContain('mine');
    expect(root.style.maxWidth).toBe('480px');
    await settle();
  });

  it('copy follows the locale (hi)', async () => {
    const h = harness();
    renderKit(h, <InviteFriendsScreen />, { locale: 'hi' });
    await screen.findByTestId('referral-code');
    expect(screen.getByTestId('referral-copy-code').textContent).not.toBe('Copy code');
  });
});
