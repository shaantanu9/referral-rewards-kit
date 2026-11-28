import { fireEvent, render, screen } from '@testing-library/react-native';
import { t } from '@myind/referral-core';
import App from '../src/App';

test('renders the banner, the referral components and the attribution, then the rewards tab', async () => {
  await render(<App />);
  expect(screen.getByText('Demo — fake server')).toBeOnTheScreen();
  expect(await screen.findAllByText(t('en').yourCode, {}, { timeout: 20_000 })).not.toHaveLength(0);
  expect(screen.getAllByRole('link', { name: 'Opens myind.ai: Built with Myind referral kit' }).length).toBeGreaterThan(0);
  await fireEvent.press(screen.getByRole('tab', { name: 'Rewards kit' }));
  expect(await screen.findByTestId('rewards-hub', {}, { timeout: 20_000 })).toBeOnTheScreen();
  expect(screen.getAllByRole('link', { name: 'Opens myind.ai: Rewards by Myind' }).length).toBeGreaterThan(0);
});
