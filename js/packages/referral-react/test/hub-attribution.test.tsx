import { attributionLink, ReferralEventName } from '@myind/referral-core';
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { InviteFriendsScreen, InviteHub, MyindAttribution, type InviteHubHandle } from '../src';
import { harness, link, renderKit, settle } from './support';

/** jsdom has no scrollIntoView: records which part each call scrolled to. */
function recordScrolls(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const proto = HTMLElement.prototype as { scrollIntoView?: unknown };
  const before = proto.scrollIntoView;
  proto.scrollIntoView = function (this: HTMLElement) {
    calls.push(this.getAttribute('data-testid') ?? '');
  };
  return { calls, restore: () => void (proto.scrollIntoView = before) };
}

describe('InviteHub', () => {
  it('both parts: code with Share / Copy above, the entry with the server days left below', async () => {
    const h = harness();
    renderKit(h, <InviteHub inviteLink={link} />);
    expect(await screen.findByTestId('referral-share')).toBeTruthy();
    expect(await screen.findByTestId('referral-deadline')).toBeTruthy();
    expect(screen.getByLabelText('Invite code')).toBeTruthy();
    expect(screen.getAllByRole('heading', { name: 'Invite friends' })).toHaveLength(1);
  });

  it('each part can be hidden', async () => {
    const h = harness();
    const view = renderKit(h, <InviteHub showEntry={false} />);
    await screen.findByTestId('referral-share');
    expect(screen.queryByTestId('referral-hub-entry')).toBeNull();
    view.unmount();
    renderKit(harness(), <InviteHub showInvite={false} />);
    await screen.findByLabelText('Invite code');
    expect(screen.queryByTestId('referral-hub-invite')).toBeNull();
  });

  it('initialSection enterCode scrolls the entry into view after the invite part loads', async () => {
    const { calls, restore } = recordScrolls();
    const h = harness();
    renderKit(h, <InviteHub initialSection="enterCode" from="home" />);
    await screen.findByTestId('referral-share');
    await settle();
    expect(calls).toEqual(['referral-hub-entry']);
    expect(h.named(ReferralEventName.inviteScreenViewed).map((e) => e.props)).toEqual([{ from: 'home', focus: 'code' }]);
    restore();
  });

  it('scrollTo through a ref brings a part back into view', async () => {
    const { calls, restore } = recordScrolls();
    const ref = createRef<InviteHubHandle>();
    renderKit(harness(), <InviteHub ref={ref} />);
    await screen.findByTestId('referral-share');
    ref.current!.scrollTo('invite');
    ref.current!.scrollTo('enterCode');
    expect(calls).toEqual(['referral-hub-invite', 'referral-hub-entry']);
    restore();
  });

  it('not deployed: one "not available yet" message, no field, no Retry', async () => {
    const h = harness();
    h.server.deployed = false;
    renderKit(h, <InviteHub />);
    await screen.findByTestId('referral-not-available');
    await settle();
    expect(screen.getAllByTestId('referral-not-available')).toHaveLength(1);
    expect(screen.queryByLabelText('Invite code')).toBeNull();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('invite_screen_viewed once per open, with the focus', async () => {
    const h = harness();
    renderKit(h, <InviteHub from="you" />);
    await screen.findByTestId('referral-share');
    await settle();
    expect(h.named(ReferralEventName.inviteScreenViewed).map((e) => e.props)).toEqual([{ from: 'you', focus: 'share' }]);
  });

  it('entryTitle replaces the friend part headline when the friend gets nothing named', async () => {
    const h = harness();
    renderKit(h, <InviteHub showInvite={false} entryTitle="Got a code?" texts={{ giftTitle: () => 'Got a code?' }} />);
    expect((await screen.findByTestId('referral-gift-title')).textContent).toBe('Got a code?');
  });
});

describe('MyindAttribution', () => {
  it('a real link with utm tags, rel noopener (not nofollow), an accessible name and a 44 px class', () => {
    render(<MyindAttribution />);
    const a = screen.getByRole('link', { name: 'Opens myind.ai: Built with Myind referral kit' });
    expect(a.getAttribute('href')).toBe(
      'https://www.myind.ai/referral-kit?utm_source=referral-react&utm_medium=attribution&utm_campaign=v0',
    );
    expect(a.getAttribute('rel')).toBe('noopener');
    expect(a.getAttribute('rel')).not.toContain('nofollow');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.className).toContain('rfk-attribution__link');
    expect(a.getAttribute('aria-hidden')).toBeNull();
  });

  it('variant wraps and source is the app', () => {
    render(<MyindAttribution variant={6} source="com.acme.reader" />);
    const expected = attributionLink(2, 'com.acme.reader');
    const a = screen.getByRole('link');
    expect(a.textContent).toBe('Free referral kit by Myind');
    expect(a.getAttribute('href')).toBe(expected.url);
    expect(a.getAttribute('href')).toContain('utm_campaign=v2');
  });

  it('InviteFriendsScreen shows it by default; showAttribution false hides it', async () => {
    const h = harness();
    const view = renderKit(h, <InviteFriendsScreen attributionVariant={1} />);
    await screen.findByTestId('referral-share');
    expect(screen.getByRole('link', { name: 'Opens myind.ai: Rewards by Myind' })).toBeTruthy();
    view.unmount();
    renderKit(harness(), <InviteFriendsScreen showAttribution={false} />);
    await screen.findByTestId('referral-share');
    expect(screen.queryByTestId('myind-attribution')).toBeNull();
  });

  it('InviteHub shows it once (not again for the embedded invite part); false hides it', async () => {
    const h = harness();
    const view = renderKit(h, <InviteHub />);
    await screen.findByTestId('referral-share');
    await settle();
    expect(screen.getAllByTestId('myind-attribution')).toHaveLength(1);
    view.unmount();
    renderKit(harness(), <InviteHub showAttribution={false} />);
    await screen.findByTestId('referral-share');
    expect(screen.queryByTestId('myind-attribution')).toBeNull();
  });

  it('the provider sets the utm_source', async () => {
    renderKit(harness(), <MyindAttribution />, { attributionSource: 'acme-web' });
    expect(screen.getByRole('link').getAttribute('href')).toContain('utm_source=acme-web');
    fireEvent.click(screen.getByRole('link'));
  });
});
