import { ClaimStatus, PendingClaimQueue, ReferralEventName, ReferralTerms } from '@myind/referral-core';
import { FakeReferralServer } from '@myind/referral-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InviteCodeEntry } from '../src';
import { harness, renderKit, settle } from './support';

const friend = FakeReferralServer.friendCode;

describe('InviteCodeEntry', () => {
  it('countdown, disclosure, typed code claimed', async () => {
    const h = harness();
    const onClaimed = vi.fn();
    renderKit(h, <InviteCodeEntry onClaimed={onClaimed} />);
    expect((await screen.findByTestId('referral-window')).textContent).toBe('You can add an invite code for 3 more days');
    expect(screen.getByRole('heading', { name: 'Have an invite code?' })).toBeTruthy();
    expect(screen.getByTestId('referral-disclosure').textContent).toContain(
      'Your inviter gets a reward when you start using the app, and another if you subscribe',
    );
    const field = screen.getByLabelText('Invite code');
    expect(field.getAttribute('dir')).toBe('ltr');
    fireEvent.change(field, { target: { value: 'h4pz-8wne' } });
    fireEvent.click(screen.getByTestId('referral-add-code'));
    await waitFor(() => expect(screen.getByTestId('referral-message').textContent).toBe('Code added.'));
    expect(onClaimed).toHaveBeenCalledOnce();
    expect(onClaimed.mock.calls[0]![0].isOk).toBe(true);
    expect(screen.queryByLabelText('Invite code')).toBeNull();
    expect(h.server.claimed).toBe(true);
  });

  it('one day left uses the singular', async () => {
    const h = harness();
    h.server.claimDaysLeft = 1;
    renderKit(h, <InviteCodeEntry />);
    expect((await screen.findByTestId('referral-window')).textContent).toBe('You can add an invite code for 1 more day');
  });

  it('after the window: no field, the rule is stated, reported once', async () => {
    const h = harness();
    h.server.claimDaysLeft = 0;
    renderKit(h, <InviteCodeEntry showWindow={false} />);
    expect((await screen.findByTestId('referral-window')).textContent).toBe(
      'Invite codes can only be added in your first 7 days',
    );
    expect(screen.queryByLabelText('Invite code')).toBeNull();
    await settle();
    expect(
      h.named(ReferralEventName.referralFeatureHidden).filter((e) => e.props['reason'] === 'window_closed'),
    ).toHaveLength(1);
  });

  it('showWindow false hides the open countdown', async () => {
    const h = harness();
    renderKit(h, <InviteCodeEntry showWindow={false} />);
    await screen.findByLabelText('Invite code');
    await settle();
    expect(screen.queryByTestId('referral-window')).toBeNull();
  });

  it('eligibleFrom gives the countdown on a server without claim_days_left', async () => {
    const h = harness();
    const terms = new ReferralTerms({ ...ReferralTerms.none, rules: [], claimWindowDays: 7 });
    renderKit(h, <InviteCodeEntry terms={terms} eligibleFrom={new Date('2026-11-16T10:00:00Z')} />);
    expect((await screen.findByTestId('referral-window')).textContent).toBe('You can add an invite code for 5 more days');
  });

  it('prefilled code: one tap to confirm, invite_link_opened with the hash', async () => {
    const h = harness();
    renderKit(h, <InviteCodeEntry initialCode="h4pz-8wne" />);
    const use = await screen.findByTestId('referral-use-code');
    expect(use.textContent).toBe('Use code H4PZ-8WNE');
    expect(screen.queryByLabelText('Invite code')).toBeNull();
    const opened = h.named(ReferralEventName.inviteLinkOpened);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.props['code_hash']).toBe(h.client.codeHash(friend));
    fireEvent.click(use);
    await waitFor(() => expect(screen.getByTestId('referral-message').textContent).toBe('Code added.'));
    expect(h.named(ReferralEventName.codeSubmitted)[0]!.props['source']).toBe('prefilled');
  });

  it('"Enter a different code" shows the field', async () => {
    const h = harness();
    renderKit(h, <InviteCodeEntry initialCode={friend} />);
    fireEvent.click(await screen.findByText('Enter a different code'));
    expect(screen.getByLabelText('Invite code')).toBeTruthy();
  });

  it('a code kept from a link shows prefilled: one tap, no "back online" message', async () => {
    const h = harness();
    await h.queue.keep(friend);
    renderKit(h, <InviteCodeEntry />);
    expect((await screen.findByTestId('referral-use-code')).textContent).toBe('Use code H4PZ-8WNE');
    expect(screen.getByTestId('referral-message').textContent).toBe('');
  });

  it('per-reason message: rate_limited with minutes; own code', async () => {
    const h = harness();
    h.server.claimReason = 'rate_limited';
    h.server.retryAfterSeconds = 130;
    renderKit(h, <InviteCodeEntry />);
    fireEvent.change(await screen.findByLabelText('Invite code'), { target: { value: friend } });
    fireEvent.click(screen.getByTestId('referral-add-code'));
    await waitFor(() =>
      expect(screen.getByTestId('referral-message').textContent).toBe('Too many tries. Try again in 3 min.'),
    );
    h.server.claimReason = null;
    fireEvent.change(screen.getByLabelText('Invite code'), { target: { value: FakeReferralServer.myCode } });
    fireEvent.click(screen.getByTestId('referral-add-code'));
    await waitFor(() =>
      expect(screen.getByTestId('referral-message').textContent).toBe("That's your own code. Share it with a friend instead."),
    );
  });

  it('offline: kept and said so; shown again on the next visit', async () => {
    const h = harness();
    renderKit(h, <InviteCodeEntry />);
    const field = await screen.findByLabelText('Invite code');
    h.server.offline = true;
    fireEvent.change(field, { target: { value: friend } });
    fireEvent.click(screen.getByTestId('referral-add-code'));
    await waitFor(() =>
      expect(screen.getByTestId('referral-message').textContent).toBe("We'll apply your code when you're back online."),
    );
    expect(await h.queue.pendingStatus()).toBe(ClaimStatus.queuedOffline);
    const view2 = renderKit(h, <InviteCodeEntry />);
    await waitFor(() =>
      expect(view2.getAllByTestId('referral-message')[1]!.textContent).toBe(
        "We'll apply your code when you're back online.",
      ),
    );
    expect((view2.getAllByLabelText('Invite code')[1] as HTMLInputElement).value).toBe('H4PZ-8WNE');
  });

  it('not verified: kept with the "confirm your email" message', async () => {
    const h = harness();
    h.server.claimReason = 'not_verified';
    renderKit(h, <InviteCodeEntry />);
    fireEvent.change(await screen.findByLabelText('Invite code'), { target: { value: friend } });
    fireEvent.click(screen.getByTestId('referral-add-code'));
    await waitFor(() =>
      expect(screen.getByTestId('referral-message').textContent).toBe("Confirm your email and we'll add your code then."),
    );
    expect(await h.queue.pendingStatus()).toBe(ClaimStatus.queuedNotVerified);
  });

  it('Paste reads the clipboard and fills the formatted code', async () => {
    const h = harness();
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: async () => '  h4pz 8wne ' },
      configurable: true,
    });
    renderKit(h, <InviteCodeEntry />);
    fireEvent.click(await screen.findByTestId('referral-paste'));
    await waitFor(() => expect((screen.getByLabelText('Invite code') as HTMLInputElement).value).toBe('H4PZ-8WNE'));
    expect(h.named(ReferralEventName.codeEntryStarted)[0]!.props).toEqual({ source: 'pasted' });
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('no clipboard read: no Paste button (pasting into the field still works)', async () => {
    const h = harness();
    renderKit(h, <InviteCodeEntry />);
    const field = await screen.findByLabelText('Invite code');
    await settle();
    expect(screen.queryByTestId('referral-paste')).toBeNull();
    fireEvent.paste(field, {
      clipboardData: { getData: () => `Use my code ⁦H4PZ-8WNE⁩ here https://acme.app/i/${friend}` },
    });
    expect((field as HTMLInputElement).value).toBe('H4PZ-8WNE');
  });

  it('pasting a whole invite link finds the code in it', async () => {
    const h = harness();
    renderKit(h, <InviteCodeEntry />);
    const field = await screen.findByLabelText('Invite code');
    fireEvent.paste(field, { clipboardData: { getData: () => `https://acme.app/i/h4pz8wne` } });
    expect((field as HTMLInputElement).value).toBe('H4PZ-8WNE');
  });

  it('terms not deployed: no field, "not available yet"', async () => {
    const h = harness();
    h.server.deployed = false;
    renderKit(h, <InviteCodeEntry />);
    expect((await screen.findByTestId('referral-not-available')).textContent).toBe(
      "Invites aren't available yet. Check back soon.",
    );
    expect(screen.queryByLabelText('Invite code')).toBeNull();
  });

  it('a claim while not deployed is kept and says so (not "offline")', async () => {
    const h = harness();
    renderKit(h, <InviteCodeEntry />);
    const field = await screen.findByLabelText('Invite code');
    h.server.deployed = false;
    fireEvent.change(field, { target: { value: friend } });
    fireEvent.click(screen.getByTestId('referral-add-code'));
    expect((await screen.findByTestId('referral-not-available')).textContent).toBe(
      "Invite codes aren't available yet. We saved your code and will add it when they are.",
    );
  });

  it('events: started once, submitted with hash, claim result from the queue', async () => {
    const h = harness();
    renderKit(h, <InviteCodeEntry />);
    const field = await screen.findByLabelText('Invite code');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'H4PZ' } });
    fireEvent.change(field, { target: { value: friend } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(h.named(ReferralEventName.codeClaimResult)).toHaveLength(1));
    expect(h.named(ReferralEventName.codeEntryStarted).map((e) => e.props)).toEqual([{ source: 'focus' }]);
    expect(h.named(ReferralEventName.codeSubmitted)[0]!.props).toEqual({
      code_hash: h.client.codeHash(friend),
      source: 'typed',
    });
    expect(h.named(ReferralEventName.codeClaimResult)[0]!.props['result']).toBe('ok');
  });

  it('works without a provider when given a client and a queue', async () => {
    const h = harness();
    const { render } = await import('@testing-library/react');
    render(<InviteCodeEntry client={h.client} queue={new PendingClaimQueue({ client: h.client, store: h.store })} />);
    expect(await screen.findByLabelText('Invite code')).toBeTruthy();
  });
});
