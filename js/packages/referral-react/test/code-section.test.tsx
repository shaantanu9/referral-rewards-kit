import { ReferralEventName, ReferralRule, ReferralTerms } from '@myind/referral-core';
import { FakeReferralServer } from '@myind/referral-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InviteCodeSection } from '../src';
import { harness, renderKit, settle } from './support';

const friend = FakeReferralServer.friendCode;

describe('InviteCodeSection', () => {
  it('the friend part: gift, real days left, steps; after a code "almost yours" with the next step', async () => {
    const h = harness();
    const onAlmost = vi.fn();
    renderKit(h, <InviteCodeSection onAlmostAction={onAlmost} texts={{ activationStep: 'Read your first page' }} />);
    expect((await screen.findByTestId('referral-gift-title')).textContent).toBe('A gift is waiting for you: 4 chapters');
    const chip = screen.getByTestId('referral-deadline');
    expect(chip.textContent).toBe('Only 3 days left to add a code');
    expect(chip.className).not.toContain('rfk-chip--last');
    // The chip shows the days, so the entry's own countdown is hidden.
    expect(screen.queryByTestId('referral-window')).toBeNull();
    const steps = screen.getByTestId('referral-steps');
    expect(Array.from(steps.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      "1Add your friend's code",
      '2Read your first page',
      '34 chapters lands for you, and for your friend',
    ]);
    fireEvent.change(screen.getByLabelText('Invite code'), { target: { value: friend } });
    fireEvent.click(screen.getByTestId('referral-add-code'));
    expect((await screen.findByTestId('referral-almost')).textContent).toBe('Almost yours');
    expect(screen.getByText('Start using the app and your 4 chapters unlocks. Your friend gets theirs too.')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: '1 of 2 done: code added' });
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    fireEvent.click(screen.getByTestId('referral-almost-action'));
    expect(onAlmost).toHaveBeenCalledOnce();
    expect(screen.getByTestId('referral-almost-action').textContent).toBe('Start using Acme');
  });

  it('last day: the chip uses the error colours', async () => {
    const h = harness();
    h.server.claimDaysLeft = 1;
    renderKit(h, <InviteCodeSection />);
    const chip = await screen.findByTestId('referral-deadline');
    expect(chip.textContent).toBe('Last day to add a code');
    expect(chip.className).toContain('rfk-chip--last');
  });

  it('window over: no field, one line why, reported once', async () => {
    const h = harness();
    h.server.claimDaysLeft = 0;
    renderKit(h, <InviteCodeSection />);
    expect((await screen.findByTestId('referral-cannot-add')).textContent).toBe(
      'Codes are for your first 7 days, and yours have passed.',
    );
    expect(screen.queryByLabelText('Invite code')).toBeNull();
    await settle();
    expect(h.named(ReferralEventName.referralFeatureHidden).filter((e) => e.props['reason'] === 'window_closed')).toHaveLength(1);
  });

  it('not eligible (server sends no days left): no field, one line why', async () => {
    const h = harness();
    h.server.claimDaysLeft = null;
    renderKit(h, <InviteCodeSection />);
    expect((await screen.findByTestId('referral-cannot-add')).textContent).toBe(
      "A friend's code can be added once, in your first 7 days. This account can't add one now.",
    );
  });

  it('an older server without claim_days_left still shows the field', async () => {
    const h = harness();
    const terms = new ReferralTerms({
      ...ReferralTerms.none,
      rules: [new ReferralRule({ event: 'joined', who: 'friend', kind: 'minutes', amount: 30 })],
    });
    renderKit(h, <InviteCodeSection terms={terms} />);
    expect(await screen.findByLabelText('Invite code')).toBeTruthy();
    expect(screen.getByTestId('referral-gift-title').textContent).toBe('A gift is waiting for you: 30 min');
    expect(screen.queryByTestId('referral-deadline')).toBeNull();
  });

  it('a sharer-only program names no gift for the friend and shows no steps', async () => {
    const h = harness();
    const terms = new ReferralTerms({
      ...ReferralTerms.none,
      rules: [new ReferralRule({ event: 'joined', who: 'sharer', kind: 'minutes', amount: 30 })],
      claimDaysLeft: 4,
      hasClaimDaysLeft: true,
    });
    renderKit(h, <InviteCodeSection terms={terms} />);
    expect((await screen.findByTestId('referral-gift-title')).textContent).toBe('Have an invite code?');
    expect(screen.queryByTestId('referral-steps')).toBeNull();
    expect(screen.getByTestId('referral-disclosure').textContent).toContain(
      'Your inviter gets a reward when you start using the app, so',
    );
  });

  it('signed out: one sentence and a Sign in button', async () => {
    const h = harness();
    h.server.signedIn = false;
    const onSignIn = vi.fn();
    renderKit(h, <InviteCodeSection onSignIn={onSignIn} />);
    expect((await screen.findByTestId('referral-not-available')).textContent).toContain('Sign in');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('header and leading slots; texts override the headline and steps', async () => {
    const h = harness();
    renderKit(
      h,
      <InviteCodeSection
        header={<img alt="gift art" src="data:," />}
        leading={<span>+4</span>}
        texts={{ giftTitle: (r) => `Free: ${r}`, steps: () => ['one', 'two'] }}
      />,
    );
    expect((await screen.findByTestId('referral-gift-title')).textContent).toBe('Free: 4 chapters');
    expect(screen.getByAltText('gift art')).toBeTruthy();
    expect(screen.getByText('+4')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('referral-steps').querySelectorAll('li')).toHaveLength(2));
  });
});
