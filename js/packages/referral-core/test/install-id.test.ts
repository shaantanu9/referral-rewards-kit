// Port of packages/referral_kit/test/install_id_test.dart over pluggable storage.
import { expect, it } from 'vitest';
import { isInstallId, MemoryKeyValueStore, newInstallId, StoredInstallIdStore, type KeyValueStore } from '../src';

const seeded = (seed: number): (() => number) => {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
};

it('newInstallId is a v4 UUID', () => {
  const ids = Array.from({ length: 200 }, () => newInstallId());
  expect(ids.every((id) => isInstallId(id))).toBe(true);
  expect(new Set(ids).size).toBe(200);
  expect(newInstallId(seeded(1))).toBe(newInstallId(seeded(1)));
  expect(isInstallId('not-a-uuid')).toBe(false);
});

it('created once, then the same id', async () => {
  const secure = new MemoryKeyValueStore();
  const a = await new StoredInstallIdStore({ secure }).installId();
  const b = await new StoredInstallIdStore({ secure }).installId();
  expect(a).toBe(b);
  expect(secure.values.get(StoredInstallIdStore.key)).toBe(a);
});

it('with a backup: written to both, and survives a wiped secure store', async () => {
  const backup = new MemoryKeyValueStore();
  const id = await new StoredInstallIdStore({ secure: new MemoryKeyValueStore(), backup }).installId();
  expect(backup.values.get(StoredInstallIdStore.key)).toBe(id);
  expect(await new StoredInstallIdStore({ secure: new MemoryKeyValueStore(), backup }).installId()).toBe(id);
});

it('a failing backup falls back to the secure store', async () => {
  const broken: KeyValueStore = {
    getString: async () => {
      throw new Error('no play services');
    },
    setString: async () => {
      throw new Error('no play services');
    },
    remove: async () => {},
  };
  const secure = new MemoryKeyValueStore();
  const a = await new StoredInstallIdStore({ secure, backup: broken }).installId();
  expect(await new StoredInstallIdStore({ secure, backup: broken }).installId()).toBe(a);
});

it('a malformed stored value is replaced', async () => {
  const secure = new MemoryKeyValueStore({ [StoredInstallIdStore.key]: 'junk' });
  expect(isInstallId(await new StoredInstallIdStore({ secure }).installId())).toBe(true);
});

it('cached per instance: one storage read', async () => {
  let reads = 0;
  const inner = new MemoryKeyValueStore();
  const counting: KeyValueStore = {
    getString: (k) => (reads++, inner.getString(k)),
    setString: (k, v) => inner.setString(k, v),
    remove: (k) => inner.remove(k),
  };
  const s = new StoredInstallIdStore({ secure: counting });
  const [a, b] = await Promise.all([s.installId(), s.installId()]);
  expect(a).toBe(b);
  expect(reads).toBe(1);
});
