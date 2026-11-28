import { act, render } from '@testing-library/react-native';
import { createRef } from 'react';
import { AppState, Share, View } from 'react-native';
import { MemoryFollowupIdStore } from '@myind/rewards-core';
import { useRefreshOnResume } from '../src';
import { expoNotifier } from '../src/adapters/notifications';
import { expoCopyText } from '../src/adapters/clipboard';
import { captureRecapCard, shareRecapCard } from '../src/adapters/view-shot';
import { asyncStorageFollowupIds, asyncStorageStringStore } from '../src/adapters/async-storage';
import { setup } from './helpers';

jest.mock('expo-notifications', () => ({ SchedulableTriggerInputTypes: { DATE: 'date' }, scheduleNotificationAsync: jest.fn(), cancelScheduledNotificationAsync: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(async () => 'file:///tmp/card.png') }));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));

test('expoNotifier schedules a date notification per id (replacing it) and cancels by id', async () => {
  const scheduled: unknown[] = [];
  const cancelled: string[] = [];
  const n = expoNotifier({
    channelId: 'reminders',
    notifications: {
      scheduleNotificationAsync: async (r) => (scheduled.push(r), String(r.identifier)),
      cancelScheduledNotificationAsync: async (id) => void cancelled.push(id),
    },
  });
  const at = new Date('2026-11-21T19:00:00Z');
  await n.schedule({ id: 42, at, title: 'Keep it going', body: 'Your streak', payload: 'daily' });
  expect(scheduled[0]).toEqual({
    identifier: '42',
    content: { title: 'Keep it going', body: 'Your streak', data: { payload: 'daily' } },
    trigger: { type: 'date', date: at, channelId: 'reminders' },
  });
  await n.cancel([1, 2]);
  expect(cancelled).toEqual(['1', '2']);
});

test('expoCopyText uses expo-clipboard', async () => {
  await expoCopyText('DEMO-1');
  expect(jest.requireMock('expo-clipboard').setStringAsync).toHaveBeenCalledWith('DEMO-1');
});

test('captureRecapCard: null while not mounted; a PNG uri; shareRecapCard shares the file', async () => {
  const ref = createRef<unknown>();
  expect(await captureRecapCard(ref)).toBeNull();
  await render(<View ref={ref as never} />);
  expect(await captureRecapCard(ref)).toBe('file:///tmp/card.png');
  const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
  expect(await shareRecapCard(ref, { message: 'My year' })).toBe(true);
  expect(spy).toHaveBeenCalledWith({ url: 'file:///tmp/card.png', message: 'My year' });
  const shareFile = jest.fn(async () => {});
  expect(await shareRecapCard(ref, { shareFile })).toBe(true);
  expect(shareFile).toHaveBeenCalledWith('file:///tmp/card.png');
});

test('asyncStorage string store and the follow-up id store', async () => {
  const m = new Map<string, string>();
  const storage = { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v) };
  const ids = asyncStorageFollowupIds(storage);
  await ids.write([3, 4]);
  expect(await ids.read()).toEqual([3, 4]);
  expect(m.get('rewards_kit.followup_ids')).toBe('[3,4]');
  const broken = asyncStorageStringStore({ getItem: async () => Promise.reject(new Error('x')), setItem: async () => {} });
  expect(await broken.getString('a')).toBeNull();
  expect(new MemoryFollowupIdStore().ids).toEqual([]);
});

test('useRefreshOnResume reloads when the app comes back', async () => {
  let handler: (s: string) => void = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
    handler = h;
    return { remove: () => {} };
  }) as never);
  const s = setup();
  function Probe(): null {
    useRefreshOnResume(s.controller);
    return null;
  }
  await render(<Probe />);
  handler('background');
  await act(async () => handler('active'));
  expect(s.server.called('rewards_state')).toHaveLength(1);
});
