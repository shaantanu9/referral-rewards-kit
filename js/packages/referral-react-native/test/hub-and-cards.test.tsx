import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createRef } from 'react';
import { MemoryKeyValueStore, ReferralEventName, ReferralPromptPolicy, type Subscribe } from '@myind/referral-core';
import {
  InviteHub,
  InviteHubSection,
  ReferralInvitePageSettings,
  ReferralRewardCard,
  ReferralWelcomeCard,
  type InviteHubHandle,
} from '../src';
import { en, setup } from './helpers';

describe('InviteHub', () => {
  test('both parts: code with Share above, entry with the server days left below; attribution once', async () => {
    const s = setup();
    await render(s.wrap(<InviteHub client={s.client} queue={s.queue} appName="Reader" from="settings" />));
    expect(await screen.findByText(en.yourCode)).toBeOnTheScreen();
    expect(await screen.findByTestId('referral-gift-title')).toBeOnTheScreen();
    expect(screen.getAllByTestId('myind-attribution')).toHaveLength(1);
    const viewed = s.events.filter((e) => e.name === ReferralEventName.inviteScreenViewed);
    expect(viewed).toHaveLength(1);
    expect(viewed[0]!.props).toEqual({ from: 'settings', focus: 'share' });
  });

  test('each part can be hidden; showAttribution false hides the link', async () => {
    const s = setup();
    await render(s.wrap(<InviteHub client={s.client} queue={s.queue} appName="Reader" showInvite={false} showAttribution={false} />));
    expect(await screen.findByTestId('referral-gift-title')).toBeOnTheScreen();
    expect(screen.queryByText(en.yourCode)).toBeNull();
    expect(screen.queryByTestId('myind-attribution')).toBeNull();
    await screen.unmount();
    await render(s.wrap(<InviteHub client={s.client} queue={s.queue} appName="Reader" showEntry={false} />));
    expect(await screen.findByText(en.yourCode)).toBeOnTheScreen();
    expect(screen.queryByTestId('referral-code-field')).toBeNull();
  });

  test('not deployed: one "not available yet" message, no field, no Retry', async () => {
    const s = setup();
    s.server.deployed = false;
    await render(s.wrap(<InviteHub client={s.client} queue={s.queue} appName="Reader" />));
    expect(await screen.findAllByText(en.notAvailable)).toHaveLength(1);
    expect(screen.queryByTestId('referral-code-field')).toBeNull();
    expect(screen.queryByText(en.retry)).toBeNull();
  });

  test('initialSection enterCode reports focus code; scrollTo is safe to call', async () => {
    const s = setup();
    const ref = createRef<InviteHubHandle>();
    await render(
      s.wrap(<InviteHub ref={ref} client={s.client} queue={s.queue} appName="Reader" initialSection={InviteHubSection.enterCode} />),
    );
    await screen.findByText(en.yourCode);
    expect(s.events[0]!.props).toEqual({ from: 'unknown', focus: 'code' });
    await act(() => ref.current!.scrollTo(InviteHubSection.invite));
  });

  test('scrollable false: no scroll view of its own', async () => {
    const s = setup();
    await render(s.wrap(<InviteHub client={s.client} queue={s.queue} appName="Reader" scrollable={false} />));
    await screen.findByText(en.yourCode);
    expect(screen.queryByTestId('referral-hub-scroll')).toBeNull();
  });
});

describe('ReferralRewardCard', () => {
  test('shows each pending reward and acks on dismiss; onShown, onDismissed, events', async () => {
    const s = setup();
    s.server.aFriendSignsUp();
    s.server.aFriendStarts();
    const shownIds: string[] = [];
    const dismissed: boolean[] = [];
    await render(
      s.wrap(
        <ReferralRewardCard client={s.client} onShown={(r) => shownIds.push(r.id)} onDismissed={(_, ack) => dismissed.push(ack)} resumes={() => () => {}} />,
      ),
    );
    await fireEvent.press(await screen.findByRole('button', { name: en.dismiss }));
    expect(screen.queryByRole('button', { name: en.dismiss })).toBeNull();
    expect(shownIds).toHaveLength(1);
    expect(dismissed).toEqual([true]);
    expect(s.server.called('referral_ack')).toHaveLength(1);
    expect(s.names()).toEqual(expect.arrayContaining([ReferralEventName.rewardShown, ReferralEventName.rewardAcknowledged]));
  });

  test('nothing pending, or an error: nothing shown; a reward granted in the background shows on resume, once', async () => {
    const s = setup();
    let resume: () => void = () => {};
    const resumes: Subscribe = (l) => {
      resume = l;
      return () => {};
    };
    s.server.offline = true;
    await render(s.wrap(<ReferralRewardCard client={s.client} resumes={resumes} />));
    expect(screen.queryByRole('button', { name: en.dismiss })).toBeNull();
    s.server.offline = false;
    s.server.aFriendStarts();
    await act(() => resume());
    expect(await screen.findByRole('button', { name: en.dismiss })).toBeOnTheScreen();
    await act(() => resume());
    expect(s.events.filter((e) => e.name === ReferralEventName.rewardShown)).toHaveLength(1);
  });

  test('a failed ack is reported as not acknowledged', async () => {
    const s = setup();
    s.server.aFriendStarts();
    const dismissed: boolean[] = [];
    await render(s.wrap(<ReferralRewardCard client={s.client} onDismissed={(_, a) => dismissed.push(a)} resumes={() => () => {}} />));
    const button = await screen.findByRole('button', { name: en.dismiss });
    s.server.offline = true;
    await fireEvent.press(button);
    expect(dismissed).toEqual([false]);
  });
});

describe('ReferralWelcomeCard', () => {
  test('claimed: the gift and the days left; dismiss hides it for the day', async () => {
    const s = setup();
    s.server.claimed = true;
    const store = new MemoryKeyValueStore();
    ReferralWelcomeCard.session = 'one';
    await render(s.wrap(<ReferralWelcomeCard client={s.client} store={store} appName="Reader" clock={() => s.now} />));
    expect(await screen.findByTestId('referral-welcome-claimed')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('referral-welcome-dismiss'));
    expect(screen.queryByTestId('referral-welcome-claimed')).toBeNull();
    await screen.unmount();
    ReferralWelcomeCard.session = 'two';
    await render(s.wrap(<ReferralWelcomeCard client={s.client} store={store} appName="Reader" clock={() => s.now} />));
    await act(async () => {});
    expect(screen.queryByTestId('referral-welcome-claimed')).toBeNull();
    expect(s.names()).toEqual(expect.arrayContaining([ReferralEventName.welcomeCardShown, ReferralEventName.welcomeCardDismissed]));
  });

  test('joined: pass it on once, opening the invite hub; with a policy never in the first session', async () => {
    const s = setup();
    s.server.claimed = true;
    s.server.youStartUsing();
    const open = jest.fn();
    ReferralWelcomeCard.session = 'a';
    await render(s.wrap(<ReferralWelcomeCard client={s.client} store={new MemoryKeyValueStore()} appName="Reader" onPassItOn={open} />));
    await fireEvent.press(await screen.findByTestId('referral-welcome-invite'));
    expect(open).toHaveBeenCalled();
    await screen.unmount();

    const policyStore = new MemoryKeyValueStore();
    const policy = new ReferralPromptPolicy({ store: policyStore, clock: () => s.now });
    await policy.startSession();
    await render(s.wrap(<ReferralWelcomeCard client={s.client} store={new MemoryKeyValueStore()} appName="Reader" policy={policy} />));
    await act(async () => {});
    expect(screen.queryByTestId('referral-welcome-joined')).toBeNull();
  });

  test('none and an older server show nothing', async () => {
    const s = setup();
    await render(s.wrap(<ReferralWelcomeCard client={s.client} store={new MemoryKeyValueStore()} appName="Reader" />));
    await act(async () => {});
    expect(screen.queryByTestId(/referral-welcome/)).toBeNull();
  });
});

describe('ReferralInvitePageSettings', () => {
  test('first name: validated like the server, saved, and withdrawn at once', async () => {
    const s = setup();
    await render(s.wrap(<ReferralInvitePageSettings client={s.client} />));
    await fireEvent(await screen.findByTestId('referral-show-name'), 'valueChange', true);
    await fireEvent.changeText(screen.getByTestId('referral-name-field'), 'me@x.com');
    await fireEvent.press(screen.getByRole('button', { name: en.save }));
    expect(await screen.findByTestId('referral-name-error')).toBeOnTheScreen();
    expect(s.server.called('referral_preferences_set')).toHaveLength(0);
    await fireEvent.changeText(screen.getByTestId('referral-name-field'), 'Asha');
    await fireEvent.press(screen.getByRole('button', { name: en.save }));
    expect(await screen.findByText(en.saved)).toBeOnTheScreen();
    expect(s.server.displayName).toBe('Asha');
    expect(s.server.showName).toBe(true);
    await fireEvent(screen.getByTestId('referral-show-name'), 'valueChange', false);
    expect(s.server.showName).toBe(false);
  });

  test('leave with a confirm; Cancel keeps it', async () => {
    const s = setup();
    const left = jest.fn();
    let answer = false;
    await render(s.wrap(<ReferralInvitePageSettings client={s.client} onLeft={left} confirmLeave={async () => answer} />));
    await fireEvent.press(await screen.findByRole('button', { name: en.leaveProgram }));
    expect(s.server.left).toBe(false);
    answer = true;
    await fireEvent.press(screen.getByRole('button', { name: en.leaveProgram }));
    expect(s.server.left).toBe(true);
    expect(left).toHaveBeenCalled();
  });

  test('an older server (no preferences RPC): nothing shown', async () => {
    const s = setup();
    s.server.offline = true;
    await render(s.wrap(<ReferralInvitePageSettings client={s.client} />));
    await act(async () => {});
    expect(screen.queryByTestId('referral-invite-page')).toBeNull();
  });
});
