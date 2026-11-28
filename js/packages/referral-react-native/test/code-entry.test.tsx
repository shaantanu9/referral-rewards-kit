import { fireEvent, render, screen } from '@testing-library/react-native';
import { ReferralEventName, spellCode } from '@myind/referral-core';
import { Text } from 'react-native';
import { InviteCodeEntry, InviteCodeSection, ReferralKitProvider } from '../src';
import { en, FakeReferralServer, setup } from './helpers';

describe('InviteCodeEntry', () => {
  test('countdown, disclosure, typed code claimed; events started once, submitted, result', async () => {
    const s = setup();
    const claimed: boolean[] = [];
    await render(s.wrap(<InviteCodeEntry client={s.client} queue={s.queue} onClaimed={(r) => claimed.push(r.isOk)} />));
    expect(await screen.findByTestId('referral-window')).toHaveTextContent(en.windowCountdown(3));
    expect(screen.getByTestId('referral-disclosure')).toBeOnTheScreen();
    await fireEvent(screen.getByTestId('referral-code-field'), 'focus');
    await fireEvent.changeText(screen.getByTestId('referral-code-field'), 'h4pz-8wne');
    await fireEvent.press(screen.getByRole('button', { name: en.addCode }));
    expect(await screen.findByTestId('referral-message')).toHaveTextContent(en.claimOk);
    expect(claimed).toEqual([true]);
    expect(s.names().filter((n) => n === ReferralEventName.codeEntryStarted)).toHaveLength(1);
    expect(s.names()).toEqual(expect.arrayContaining([ReferralEventName.codeSubmitted, ReferralEventName.codeClaimResult]));
    // Done: the field is gone.
    expect(screen.queryByTestId('referral-code-field')).toBeNull();
  });

  test('one day left uses the singular; a closed window states the rule, has no field, is reported once', async () => {
    const s = setup();
    s.server.claimDaysLeft = 1;
    await render(s.wrap(<InviteCodeEntry client={s.client} queue={s.queue} />));
    expect(await screen.findByTestId('referral-window')).toHaveTextContent(en.windowCountdown(1));
    await screen.unmount();
    s.server.claimDaysLeft = 0;
    await render(s.wrap(<InviteCodeEntry client={s.client} queue={s.queue} />));
    expect(await screen.findByText(en.windowOver(7))).toBeOnTheScreen();
    expect(screen.queryByTestId('referral-code-field')).toBeNull();
    expect(s.events.filter((e) => e.props['reason'] === 'window_closed')).toHaveLength(1);
  });

  test('prefilled code: invite_link_opened, one tap to confirm', async () => {
    const s = setup();
    await render(s.wrap(<InviteCodeEntry client={s.client} queue={s.queue} initialCode="h4pz8wne" />));
    expect(screen.getByLabelText(spellCode(FakeReferralServer.friendCode))).toBeOnTheScreen();
    expect(s.names()).toContain(ReferralEventName.inviteLinkOpened);
    await fireEvent.press(screen.getByRole('button', { name: en.useCode('H4PZ-8WNE') }));
    expect(await screen.findByText(en.claimOk)).toBeOnTheScreen();
  });

  test('a code kept from a link shows prefilled', async () => {
    const s = setup();
    await s.queue.keep('H4PZ8WNE');
    await render(s.wrap(<InviteCodeEntry client={s.client} queue={s.queue} />));
    expect(await screen.findByRole('button', { name: en.useCode('H4PZ-8WNE') })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en.enterDifferentCode }));
    expect(screen.getByTestId('referral-code-field')).toBeOnTheScreen();
  });

  test('per-reason message: rate_limited with minutes; unknown code', async () => {
    const s = setup();
    s.server.claimReason = 'rate_limited';
    await render(s.wrap(<InviteCodeEntry client={s.client} queue={s.queue} />));
    await fireEvent.changeText(await screen.findByTestId('referral-code-field'), 'ABCDEFGH');
    await fireEvent.press(screen.getByRole('button', { name: en.addCode }));
    expect(await screen.findByTestId('referral-message')).toHaveTextContent(/2/);
  });

  test('offline: kept and said so; shown again on the next visit', async () => {
    const s = setup();
    s.server.offline = true;
    await render(s.wrap(<InviteCodeEntry client={s.client} queue={s.queue} />));
    await fireEvent.changeText(screen.getByTestId('referral-code-field'), 'H4PZ8WNE');
    await fireEvent.press(screen.getByRole('button', { name: en.addCode }));
    expect(await screen.findByText(en.offlineQueued)).toBeOnTheScreen();
    await screen.unmount();
    await render(s.wrap(<InviteCodeEntry client={s.client} queue={s.queue} />));
    expect(await screen.findByText(en.offlineQueued)).toBeOnTheScreen();
    expect(screen.getByTestId('referral-code-field').props.value).toBe('H4PZ-8WNE');
  });

  test('not deployed: no field, "not available yet"; a claim while not deployed is kept and says so', async () => {
    const s = setup();
    s.server.deployed = false;
    await render(s.wrap(<InviteCodeEntry client={s.client} queue={s.queue} />));
    expect(await screen.findByText(en.notAvailable)).toBeOnTheScreen();
    expect(screen.queryByTestId('referral-code-field')).toBeNull();
  });

  test('Android Paste reads the clipboard and fills the field', async () => {
    const s = setup();
    s.setClip('Use my code h4pz8wne');
    await render(s.wrap(<InviteCodeEntry client={s.client} queue={s.queue} pastePlatform="android" />));
    await fireEvent.press(await screen.findByRole('button', { name: en.paste }));
    expect(await screen.findByDisplayValue(/H4PZ/)).toBeOnTheScreen();
    expect(s.events.find((e) => e.name === ReferralEventName.codeEntryStarted)!.props).toEqual({ source: 'pasted' });
  });

  test('iOS: no paste control → nothing; the system control fills the field; the clipboard is never read', async () => {
    const s = setup();
    const read = jest.fn(async () => 'ABCDEFGH');
    const noControl = { setString: async () => {}, getString: read };
    await render(
      <ReferralKitProvider clipboard={noControl}>
        <InviteCodeEntry client={s.client} queue={s.queue} pastePlatform="ios" />
      </ReferralKitProvider>,
    );
    await screen.findByTestId('referral-code-field');
    expect(screen.queryByText(en.paste)).toBeNull();
    await screen.unmount();
    const control = {
      ...noControl,
      PasteButton: ({ onPaste }: { onPaste: (t: string) => void }) => <Text onPress={() => onPaste('h4pz8wne')}>system paste</Text>,
    };
    await render(
      <ReferralKitProvider clipboard={control}>
        <InviteCodeEntry client={s.client} queue={s.queue} pastePlatform="ios" />
      </ReferralKitProvider>,
    );
    await fireEvent.press(await screen.findByText('system paste'));
    expect(screen.getByTestId('referral-code-field').props.value).toBe('H4PZ-8WNE');
    expect(read).not.toHaveBeenCalled();
  });
});

describe('InviteCodeSection', () => {
  test('gift, real days left, steps; after a code "almost yours" with the next step', async () => {
    const s = setup();
    const almost = jest.fn();
    await render(s.wrap(<InviteCodeSection client={s.client} queue={s.queue} appName="Reader" onAlmostAction={almost} />));
    expect(await screen.findByTestId('referral-gift-title')).toBeOnTheScreen();
    expect(screen.getByTestId('referral-deadline')).toBeOnTheScreen();
    expect(screen.getByText(en.stepsTitle)).toBeOnTheScreen();
    // The chip shows the days, so the entry does not repeat them.
    expect(screen.queryByTestId('referral-window')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('referral-code-field'), 'H4PZ8WNE');
    await fireEvent.press(screen.getByRole('button', { name: en.addCode }));
    expect(await screen.findByTestId('referral-almost')).toHaveTextContent(en.almostTitle);
    expect(screen.getByRole('progressbar')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en.stepStartUsing('Reader') }));
    expect(almost).toHaveBeenCalled();
  });

  test('window over: no field, one line why, reported once; not eligible too', async () => {
    const s = setup();
    s.server.claimDaysLeft = 0;
    await render(s.wrap(<InviteCodeSection client={s.client} queue={s.queue} appName="Reader" />));
    expect(await screen.findByTestId('referral-cannot-add')).toBeOnTheScreen();
    expect(screen.queryByTestId('referral-code-field')).toBeNull();
    expect(s.events.filter((e) => e.props['reason'] === 'window_closed')).toHaveLength(1);
    await screen.unmount();
    s.server.claimDaysLeft = null;
    await render(s.wrap(<InviteCodeSection client={s.client} queue={s.queue} appName="Reader" />));
    expect(await screen.findByTestId('referral-cannot-add')).toBeOnTheScreen();
  });

  test("the app's own words win; signed out: one sentence and Sign in", async () => {
    const s = setup();
    await render(
      s.wrap(<InviteCodeSection client={s.client} queue={s.queue} appName="Reader" texts={{ giftTitle: () => 'A present', stepsTitle: 'How' }} />),
    );
    expect(await screen.findByText('A present')).toBeOnTheScreen();
    expect(screen.getByText('How')).toBeOnTheScreen();
    await screen.unmount();
    s.server.signedIn = false;
    await render(s.wrap(<InviteCodeSection client={s.client} queue={s.queue} appName="Reader" onSignIn={() => {}} />));
    expect(await screen.findByText(en.signInToInvite)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en.signIn })).toBeOnTheScreen();
  });
});
