import {
  MemoryKeyValueStore,
  ReferralEventName,
  ReferralPromptPolicy,
} from '@myind/referral-core';
import { FakeReferralServer, fakeReferralClient } from '@myind/referral-core/testing';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReferralRewardCard, ReferralWelcomeCard } from '../src';
import { clock, harness, renderKit, settle } from './support';

describe('ReferralRewardCard', () => {
  it('shows each pending reward and acks on dismiss; onShown per reward, onDismissed after the ack, events', async () => {
    const h = harness();
    h.server.aFriendSignsUp();
    h.server.aFriendStarts();
    h.server.aFriendPays();
    const onShown = vi.fn();
    const onDismissed = vi.fn();
    renderKit(h, <ReferralRewardCard onShown={onShown} onDismissed={onDismissed} />);
    await screen.findByText('A friend you invited started using the app. You got 8 chapters.');
    expect(screen.getByText('A friend you invited subscribed. You got 5 days of plus.')).toBeTruthy();
    expect(onShown).toHaveBeenCalledTimes(2);
    expect(h.named(ReferralEventName.rewardShown)).toHaveLength(2);
    const first = screen.getAllByRole('article')[0]!;
    fireEvent.click(first.querySelector('button')!);
    await waitFor(() => expect(onDismissed).toHaveBeenCalledOnce());
    expect(onDismissed.mock.calls[0]![1]).toBe(true);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(h.named(ReferralEventName.rewardAcknowledged)[0]!.props['acknowledged']).toBe(true);
    expect(h.server.called('referral_ack')).toHaveLength(1);
  });

  it('a failed ack is reported as not acknowledged', async () => {
    const h = harness();
    h.server.aFriendSignsUp();
    h.server.aFriendStarts();
    const onDismissed = vi.fn();
    renderKit(h, <ReferralRewardCard onDismissed={onDismissed} />);
    const card = await screen.findByRole('article');
    h.server.offline = true;
    fireEvent.click(card.querySelector('button')!);
    await waitFor(() => expect(onDismissed).toHaveBeenCalledWith(expect.anything(), false));
    expect(h.named(ReferralEventName.rewardAcknowledged)[0]!.props['acknowledged']).toBe(false);
  });

  it('leading and action; the action dismisses and acks', async () => {
    const h = harness();
    h.server.aFriendSignsUp();
    h.server.aFriendStarts();
    const onAction = vi.fn();
    renderKit(h, <ReferralRewardCard leading={<span>🎁</span>} actionLabel="Read now" onAction={onAction} />);
    fireEvent.click(await screen.findByText('Read now'));
    expect(onAction).toHaveBeenCalledOnce();
    await waitFor(() => expect(h.server.called('referral_ack')).toHaveLength(1));
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('nothing pending, or an error: nothing shown', async () => {
    const h = harness();
    const view = renderKit(h, <ReferralRewardCard />);
    await settle();
    expect(view.container.innerHTML).toBe('');
    view.unmount();
    const h2 = harness();
    h2.server.offline = true;
    const view2 = renderKit(h2, <ReferralRewardCard />);
    await settle();
    expect(view2.container.innerHTML).toBe('');
  });

  it('a reward granted while the page was hidden shows when it becomes visible; not reported twice', async () => {
    const h = harness();
    renderKit(h, <ReferralRewardCard />);
    await settle();
    h.server.aFriendSignsUp();
    h.server.aFriendStarts();
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await screen.findByRole('article');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle();
    expect(h.named(ReferralEventName.rewardShown)).toHaveLength(1);
  });

  it('a new client (another user signed in) loads that user', async () => {
    const h = harness();
    const view = renderKit(h, <ReferralRewardCard />);
    await settle();
    expect(screen.queryByRole('article')).toBeNull();
    const other = new FakeReferralServer({ clock });
    other.aFriendSignsUp();
    other.aFriendStarts();
    const client2 = fakeReferralClient(other);
    view.rerender(<ReferralRewardCard client={client2} />);
    expect(await screen.findByRole('article')).toBeTruthy();
  });
});

describe('ReferralWelcomeCard', () => {
  async function claimed(): Promise<ReturnType<typeof harness>> {
    const h = harness();
    h.server.claimed = true;
    return h;
  }

  it('claimed: the gift, the step and the days left; dismiss hides it for the day', async () => {
    const h = await claimed();
    const store = new MemoryKeyValueStore();
    const view = renderKit(h, <ReferralWelcomeCard activationStep="Read your first page" session="s1" />, { store });
    expect(
      await screen.findByText('Your welcome gift of 4 chapters is waiting: Read your first page. 30 days left.'),
    ).toBeTruthy();
    expect(h.named(ReferralEventName.welcomeCardShown)[0]!.props).toEqual({ state: 'claimed' });
    fireEvent.click(screen.getByTestId('referral-welcome-dismiss'));
    await settle();
    expect(screen.queryByTestId('referral-welcome-claimed')).toBeNull();
    expect(h.named(ReferralEventName.welcomeCardDismissed)[0]!.props).toEqual({ state: 'claimed', action: 'dismiss' });
    view.unmount();
    renderKit(h, <ReferralWelcomeCard session="s2" />, { store });
    await settle();
    expect(screen.queryByTestId('referral-welcome-claimed')).toBeNull();
  });

  it('claimed: once per day across visits, kept within a visit', async () => {
    const h = await claimed();
    const store = new MemoryKeyValueStore();
    const v1 = renderKit(h, <ReferralWelcomeCard session="a" />, { store });
    await screen.findByTestId('referral-welcome-claimed');
    v1.unmount();
    const v2 = renderKit(h, <ReferralWelcomeCard session="a" />, { store });
    await screen.findByTestId('referral-welcome-claimed');
    v2.unmount();
    renderKit(h, <ReferralWelcomeCard session="b" />, { store });
    await settle();
    expect(screen.queryByTestId('referral-welcome-claimed')).toBeNull();
  });

  it('joined: pass it on once, opening the invite hub', async () => {
    const h = await claimed();
    h.server.youStartUsing();
    const store = new MemoryKeyValueStore();
    const onPassItOn = vi.fn();
    const view = renderKit(h, <ReferralWelcomeCard onPassItOn={onPassItOn} session="j" />, { store });
    expect(
      await screen.findByText(
        'Pass it on: give a friend 4 chapters when they join with your code and start using the app.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId('referral-welcome-invite'));
    expect(onPassItOn).toHaveBeenCalledOnce();
    await settle();
    view.unmount();
    renderKit(h, <ReferralWelcomeCard session="j2" />, { store });
    await settle();
    expect(screen.queryByTestId('referral-welcome-joined')).toBeNull();
  });

  it('joined with a policy: never in the first session', async () => {
    const h = await claimed();
    h.server.youStartUsing();
    const policyStore = new MemoryKeyValueStore();
    const policy = new ReferralPromptPolicy({ store: policyStore, clock });
    await policy.startSession();
    renderKit(h, <ReferralWelcomeCard session="p" />, { store: new MemoryKeyValueStore(), policy });
    await settle();
    expect(screen.queryByTestId('referral-welcome-joined')).toBeNull();
  });

  it('none, expired and an older server show nothing', async () => {
    const h = harness();
    const v = renderKit(h, <ReferralWelcomeCard session="n" />);
    await settle();
    expect(v.container.innerHTML).toBe('');
    v.unmount();
    const h2 = await claimed();
    h2.server.claimExpired = true;
    const v2 = renderKit(h2, <ReferralWelcomeCard session="e" />);
    await settle();
    expect(v2.container.innerHTML).toBe('');
    v2.unmount();
    const h3 = harness();
    h3.server.deployed = false;
    const v3 = renderKit(h3, <ReferralWelcomeCard session="o" />);
    await settle();
    expect(v3.container.innerHTML).toBe('');
  });
});
