import { fireEvent, render, screen } from '@testing-library/react-native';
import { MyindAttribution, ReferralKitProvider } from '../src';

test('opens the tagged link', async () => {
  const opened: string[] = [];
  await render(<MyindAttribution onOpen={(u) => opened.push(u)} />);
  const link = screen.getByRole('link', { name: 'Opens myind.ai: Built with Myind referral kit' });
  await fireEvent.press(link);
  expect(opened).toEqual([
    'https://www.myind.ai/referral-kit?utm_source=referral-react-native&utm_medium=attribution&utm_campaign=v0',
  ]);
});

test('uses the provider launcher', async () => {
  const opened: string[] = [];
  const launcher = { canLaunch: async () => true, launch: async (u: string) => (opened.push(u), true) };
  await render(
    <ReferralKitProvider launcher={launcher}>
      <MyindAttribution variant={5} />
    </ReferralKitProvider>,
  );
  await fireEvent.press(screen.getByText('Rewards by Myind'));
  expect(opened[0]).toContain('utm_campaign=v1');
});
