import { render, screen, fireEvent } from '@testing-library/react-native';
import { AppState, Linking, Share } from 'react-native';
import { InstallReferrerCodeReader, MemoryKeyValueStore, StoredInstallIdStore, shareChannel } from '@myind/referral-core';
import { appStateResumes, linkingLauncher, rnShare } from '../src';
import { asyncStorageStore } from '../src/adapters/async-storage';
import { secureInstallIdStore, secureStore } from '../src/adapters/secure-store';
import { netInfoReconnects } from '../src/adapters/netinfo';
import { playInstallReferrer } from '../src/adapters/install-referrer';
import { expoClipboard } from '../src/adapters/clipboard';
import { qrCodeSvg } from '../src/adapters/qrcode';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: jest.fn() } }));
jest.mock('expo-secure-store', () => ({ AFTER_FIRST_UNLOCK: 0, getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('expo-application', () => ({ getInstallReferrerAsync: jest.fn() }));
jest.mock('expo-clipboard', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    isPasteButtonAvailable: true,
    setStringAsync: jest.fn(async () => true),
    getStringAsync: jest.fn(async () => 'H4PZ8WNE'),
    ClipboardPasteButton: (p: { onPress: (d: { type: string; text: string }) => void }) => (
      <Text onPress={() => p.onPress({ type: 'text', text: 'pasted' })}>paste control</Text>
    ),
  };
});
jest.mock('react-native-qrcode-svg', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { value: string; size: number }) => <Text>{`qr:${p.value}:${p.size}`}</Text> };
});

test('rnShare maps Share.share to the kit result (iOS activity names the channel)', async () => {
  const spy = jest.spyOn(Share, 'share');
  spy.mockResolvedValueOnce({ action: Share.sharedAction, activityType: 'net.whatsapp.WhatsApp.ShareExtension' });
  const r = await rnShare('hello');
  expect(spy).toHaveBeenCalledWith({ message: 'hello' });
  expect(shareChannel(r)).toBe('whatsapp');
  spy.mockResolvedValueOnce({ action: Share.dismissedAction, activityType: undefined });
  expect(await rnShare('x')).toEqual({ status: 'dismissed', raw: '' });
  spy.mockRejectedValueOnce(new Error('no'));
  expect(await rnShare('x')).toEqual({ status: 'unavailable', raw: '' });
});

test('linkingLauncher never throws', async () => {
  jest.spyOn(Linking, 'canOpenURL').mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('x'));
  expect(await linkingLauncher.canLaunch('https://wa.me/')).toBe(true);
  expect(await linkingLauncher.canLaunch('https://wa.me/')).toBe(false);
  jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x'));
  expect(await linkingLauncher.launch('https://a.test')).toBe(true);
  expect(await linkingLauncher.launch('https://a.test')).toBe(false);
});

test('appStateResumes fires on background → active only, and unsubscribes', () => {
  let handler: (s: string) => void = () => {};
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
    handler = h;
    return { remove };
  }) as never);
  const fired = jest.fn();
  const off = appStateResumes(fired);
  handler('background');
  handler('active');
  handler('active');
  handler('inactive');
  expect(fired).toHaveBeenCalledTimes(1);
  off();
  expect(remove).toHaveBeenCalled();
});

test('asyncStorageStore prefixes keys and swallows errors', async () => {
  const m = new Map<string, string>();
  const store = asyncStorageStore('referral_kit.', {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => void m.set(k, v),
    removeItem: async (k) => void m.delete(k),
  });
  await store.setString('a', '1');
  expect(m.get('referral_kit.a')).toBe('1');
  expect(await store.getString('a')).toBe('1');
  await store.remove('a');
  expect(await store.getString('a')).toBeNull();
  const broken = asyncStorageStore('p.', {
    getItem: async () => {
      throw new Error('x');
    },
    setItem: async () => {
      throw new Error('x');
    },
    removeItem: async () => {},
  });
  expect(await broken.getString('a')).toBeNull();
  await expect(broken.setString('a', '1')).resolves.toBeUndefined();
});

test('secure install id: a UUID stored once in secure storage, mirrored to the backup', async () => {
  const m = new Map<string, string>();
  const secure = secureStore(
    {},
    {
      getItemAsync: async (k) => m.get(k) ?? null,
      setItemAsync: async (k, v) => void m.set(k, v),
      deleteItemAsync: async (k) => void m.delete(k),
    },
  );
  const backup = new MemoryKeyValueStore();
  const ids = secureInstallIdStore({ store: secure, backup });
  const id = await ids.installId();
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(m.get(StoredInstallIdStore.key)).toBe(id);
  expect(await backup.getString(StoredInstallIdStore.key)).toBe(id);
  expect(await secureInstallIdStore({ store: secure }).installId()).toBe(id);
});

test('netInfoReconnects fires on offline → online only', () => {
  let push: (s: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void = () => {};
  const sub = netInfoReconnects(((l: typeof push) => {
    push = l;
    return () => {};
  }) as never);
  const fired = jest.fn();
  sub(fired);
  push({ isConnected: true, isInternetReachable: true });
  push({ isConnected: false, isInternetReachable: false });
  push({ isConnected: true, isInternetReachable: null });
  push({ isConnected: true, isInternetReachable: true });
  expect(fired).toHaveBeenCalledTimes(1);
});

test('playInstallReferrer: Android only, read once per install by the core reader', async () => {
  const source = playInstallReferrer(async () => 'utm_source=x&code%3DH4PZ8WNE', 'android');
  const reader = new InstallReferrerCodeReader({ store: new MemoryKeyValueStore(), source });
  expect(await reader.readOnce()).toBe('H4PZ8WNE');
  expect(await reader.readOnce()).toBeNull();
  expect(await playInstallReferrer(async () => 'code=H4PZ8WNE', 'ios').readReferrer()).toBeNull();
  expect(
    await playInstallReferrer(async () => {
      throw new Error('ERR_APPLICATION_INSTALL_REFERRER_UNAVAILABLE');
    }, 'android').readReferrer(),
  ).toBeNull();
});

test('expoClipboard copies, reads, and renders the iOS paste control', async () => {
  const Clipboard = jest.requireMock('expo-clipboard');
  await expoClipboard.setString('ABCD-EFGH');
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('ABCD-EFGH');
  expect(await expoClipboard.getString!()).toBe('H4PZ8WNE');
  const Paste = expoClipboard.PasteButton!;
  const got: string[] = [];
  await render(<>{Paste({ label: 'Paste', onPaste: (t) => got.push(t) })}</>);
  await fireEvent.press(screen.getByText('paste control'));
  expect(got).toEqual(['pasted']);
});

test('qrCodeSvg draws the link', async () => {
  await render(<>{qrCodeSvg({ value: 'https://x.test/i/A', size: 200, label: 'QR' })}</>);
  expect(screen.getByText('qr:https://x.test/i/A:200')).toBeOnTheScreen();
});
