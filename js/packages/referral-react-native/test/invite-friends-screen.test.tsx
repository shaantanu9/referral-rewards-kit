import { fireEvent, render, screen } from '@testing-library/react-native';
import { isolatedCode, MemoryKeyValueStore, ReferralEventName, spellCode, t } from '@myind/referral-core';
import { Text } from 'react-native';
import { InviteFriendsScreen } from '../src';
import { en, FakeReferralServer, setup } from './helpers';

const link = (c: string): string => `https://example.com/i/${c}`;

test('code, rules, caps, Share with the isolated code, invite_shared with the channel', async () => {
  const s = setup();
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" inviteLink={link} from="you" />));
  expect(await screen.findByLabelText(spellCode(FakeReferralServer.myCode))).toBeOnTheScreen();
  expect(screen.getByText(en.yourCode)).toBeOnTheScreen();
  expect(screen.getByText(en.inviteTitle)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: en.share }));
  expect(s.shared[0]).toContain(isolatedCode(FakeReferralServer.myCode));
  expect(s.shared[0]).toContain(link(FakeReferralServer.myCode));
  const shared = s.events.find((e) => e.name === ReferralEventName.inviteShared)!;
  expect(shared.props).toEqual({ channel: 'whatsapp', status: 'success', has_link: true });
  expect(s.events[0]!.name).toBe(ReferralEventName.inviteScreenViewed);
  expect(s.events[0]!.props).toEqual({ from: 'you', focus: 'share' });
});

test('Copy writes the formatted code, calls back and announces', async () => {
  const s = setup();
  const copiedBack: string[] = [];
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" onCopied={(c) => copiedBack.push(c)} />));
  await fireEvent.press(await screen.findByRole('button', { name: en.copyCode }));
  expect(s.copied).toEqual(['K7QM-2XRA']);
  expect(copiedBack).toEqual(['K7QM-2XRA']);
  expect(screen.getByTestId('referral-toast')).toHaveTextContent(en.codeCopied);
  expect(s.events.find((e) => e.name === ReferralEventName.inviteCodeCopied)!.props).toEqual({ has_link: false });
});

test('no clipboard adapter: Copy is hidden', async () => {
  const s = setup();
  await render(<InviteFriendsScreen client={s.client} appName="Reader" share={async () => undefined} launcher={s.launcher} />);
  await screen.findByText(en.yourCode);
  expect(screen.queryByText(en.copyCode)).toBeNull();
});

test('no invite page: Share sends the code and the store link, a line says how', async () => {
  const s = setup();
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" storeLink="https://example.com/app" />));
  expect(await screen.findByTestId('referral-no-link')).toHaveTextContent(en.noLinkHint('Reader'));
  await fireEvent.press(screen.getByRole('button', { name: en.share }));
  expect(s.shared[0]).toContain('https://example.com/app');
  expect(s.names()).toContain(ReferralEventName.referralFeatureHidden);
});

test('a non-https link counts as no link', async () => {
  const s = setup();
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" inviteLink={(c) => `http://x.test/${c}`} />));
  expect(await screen.findByTestId('referral-no-link')).toBeOnTheScreen();
});

test('empty state, then a waiting friend, then a joined friend', async () => {
  const s = setup();
  const { unmount } = await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" />));
  expect(await screen.findByTestId('referral-empty')).toBeOnTheScreen();
  await unmount();
  s.server.aFriendSignsUp();
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" />));
  expect(await screen.findByTestId('referral-claimed')).toBeOnTheScreen();
  expect(screen.queryByTestId('referral-empty')).toBeNull();
  await screen.unmount();
  s.server.aFriendStarts();
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" />));
  expect(await screen.findByTestId('referral-joined')).toHaveTextContent(en.joinedCount(1));
  expect(screen.getByText(en.rewardsEarned)).toBeOnTheScreen();
});

test('pending and banked rewards and the cap are listed', async () => {
  const s = setup();
  s.server.addPendingReward(new Date('2026-11-23T10:00:00Z'));
  s.server.addBankedReward();
  s.server.skippedCap = 2;
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" onOpenTerms={() => {}} />));
  expect(await screen.findByText(en.pendingRewards)).toBeOnTheScreen();
  expect(screen.getByText(en.skippedCap(2))).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: en.termsLink })).toBeOnTheScreen();
});

test('paused program and code disabled', async () => {
  const s = setup();
  s.server.enabled = false;
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" />));
  expect(await screen.findByTestId('referral-paused')).toHaveTextContent(en.paused);
  await screen.unmount();
  s.server.enabled = true;
  s.server.codeReason = 'code_disabled';
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" />));
  expect(await screen.findByTestId('referral-unavailable')).toHaveTextContent(en.codeDisabled);
});

test('load error with Retry; offline falls back to the cached code', async () => {
  const s = setup();
  s.server.offline = true;
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" />));
  expect(await screen.findByText(en.loadFailed)).toBeOnTheScreen();
  s.server.offline = false;
  await fireEvent.press(screen.getByRole('button', { name: en.retry }));
  expect(await screen.findByText(en.yourCode)).toBeOnTheScreen();
  await screen.unmount();

  const cache = new MemoryKeyValueStore({ my_code: 'ABCDEFGH' });
  s.server.offline = true;
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" codeCache={cache} />));
  expect(await screen.findByLabelText(spellCode('ABCDEFGH'))).toBeOnTheScreen();
  expect(screen.queryByTestId('referral-empty')).toBeNull();
});

test('not deployed: "not available yet", no Retry; a render prop can hide it', async () => {
  const s = setup();
  s.server.deployed = false;
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" />));
  expect(await screen.findByText(en.notAvailable)).toBeOnTheScreen();
  expect(screen.queryByText(en.retry)).toBeNull();
  await screen.unmount();
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" renderUnavailable={() => <Text>hidden</Text>} />));
  expect(await screen.findByText('hidden')).toBeOnTheScreen();
});

test('signed out: one sentence and Sign in', async () => {
  const s = setup();
  s.server.signedIn = false;
  const signIn = jest.fn();
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" onSignIn={signIn} />));
  await fireEvent.press(await screen.findByRole('button', { name: en.signIn }));
  expect(signIn).toHaveBeenCalled();
  expect(screen.getByText(en.signInToInvite)).toBeOnTheScreen();
});

test('give-first headline and the boost banner; an ended boost is not shown', async () => {
  const s = setup();
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" clock={() => s.now} />));
  expect(await screen.findByTestId('referral-boost')).toBeOnTheScreen();
  expect(screen.getByTestId('referral-invite-headline')).toBeOnTheScreen();
  await screen.unmount();
  s.server.boost = false;
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" />));
  await screen.findByText(en.yourCode);
  expect(screen.queryByTestId('referral-boost')).toBeNull();
});

test('WhatsApp opens wa.me with the share text and reports whatsapp_button; hidden when it cannot launch', async () => {
  const s = setup();
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" inviteLink={link} />));
  await fireEvent.press(await screen.findByRole('button', { name: en.whatsApp }));
  expect(s.opened[0]).toMatch(/^https:\/\/wa\.me\/\?text=/);
  expect(s.events.find((e) => e.props['channel'] === 'whatsapp_button')!.props['status']).toBe('opened');
  await screen.unmount();
  s.setCanLaunch(false);
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" inviteLink={link} />));
  await screen.findByText(en.yourCode);
  expect(screen.queryByText(en.whatsApp)).toBeNull();
});

test('Show QR code: needs an https link and a renderer, reports invite_qr_shown, the sheet draws the link', async () => {
  const s = setup();
  const drawn: string[] = [];
  const renderQr = ({ value }: { value: string }) => {
    drawn.push(value);
    return <Text>QR</Text>;
  };
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" inviteLink={link} />, { renderQr }));
  await fireEvent.press(await screen.findByRole('button', { name: en.showQr }));
  expect(s.names()).toContain(ReferralEventName.inviteQrShown);
  expect(drawn).toContain(link(FakeReferralServer.myCode));
  expect(screen.getByLabelText(en.qrSemantics)).toBeOnTheScreen();
  await screen.unmount();
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" />, { renderQr }));
  await screen.findByText(en.yourCode);
  expect(screen.queryByText(en.showQr)).toBeNull();
});

test('attribution: shown by default through the launcher, hidden with showAttribution false', async () => {
  const s = setup();
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" />));
  await fireEvent.press(await screen.findByRole('link', { name: 'Opens myind.ai: Built with Myind referral kit' }));
  expect(s.opened[0]).toContain('utm_medium=attribution');
  await screen.unmount();
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" showAttribution={false} />));
  await screen.findByText(en.yourCode);
  expect(screen.queryByTestId('myind-attribution')).toBeNull();
});

test('hi strings are used', async () => {
  const s = setup();
  await render(s.wrap(<InviteFriendsScreen client={s.client} appName="Reader" />, { locale: 'hi' }));
  expect(await screen.findByText(t('hi').yourCode)).toBeOnTheScreen();
});
