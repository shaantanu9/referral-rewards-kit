import type { KeyValueStore } from './storage';

/** Supplies the install id every RPC takes (ADR 7, 8): a random UUID, never an advertising id. */
export interface InstallIdStore {
  installId(): Promise<string>;
}

/** Random UUID version 4 from `crypto.getRandomValues` (or [random] bytes, for tests). */
export function newInstallId(random?: () => number): string {
  const b = new Uint8Array(16);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!random && c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor((random ?? Math.random)() * 256) & 0xff;
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}`;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Whether [v] looks like an id this package wrote (anything else is replaced). */
export const isInstallId = (v: string | null | undefined): v is string => v != null && uuid.test(v);

/**
 * The default [InstallIdStore], over pluggable storage: [secure] holds the id (Keychain / Keystore through
 * expo-secure-store on React Native, [localStorageStore] on the web). [backup], when given, is read first and kept in
 * step: the Flutter package's Android Block Store role (an id that survives a reinstall). The value is read once per
 * instance and cached; storage errors never throw (a fresh id still works for this run).
 */
export class StoredInstallIdStore implements InstallIdStore {
  /** Storage key, in [secure] and [backup]. */
  static readonly key = 'referral_kit.install_id';

  private readonly secure: KeyValueStore;
  private readonly backup: KeyValueStore | null;
  private readonly random: (() => number) | undefined;
  private pending: Promise<string> | null = null;

  constructor(opts: { secure: KeyValueStore; backup?: KeyValueStore | null; random?: () => number }) {
    this.secure = opts.secure;
    this.backup = opts.backup ?? null;
    this.random = opts.random;
  }

  installId(): Promise<string> {
    if (!this.pending) {
      this.pending = this.load().catch((e: unknown) => {
        this.pending = null;
        throw e;
      });
    }
    return this.pending;
  }

  private static async read(s: KeyValueStore | null): Promise<string | null> {
    if (!s) return null;
    try {
      return await s.getString(StoredInstallIdStore.key);
    } catch {
      return null;
    }
  }

  private static async write(s: KeyValueStore | null, v: string): Promise<void> {
    if (!s) return;
    try {
      await s.setString(StoredInstallIdStore.key, v);
    } catch {
      // Not fatal: the id still works for this run.
    }
  }

  private async load(): Promise<string> {
    const fromBackup = await StoredInstallIdStore.read(this.backup);
    if (isInstallId(fromBackup)) {
      await StoredInstallIdStore.write(this.secure, fromBackup);
      return fromBackup;
    }
    const fromSecure = await StoredInstallIdStore.read(this.secure);
    if (isInstallId(fromSecure)) {
      await StoredInstallIdStore.write(this.backup, fromSecure);
      return fromSecure;
    }
    const fresh = newInstallId(this.random);
    await StoredInstallIdStore.write(this.secure, fresh);
    await StoredInstallIdStore.write(this.backup, fresh);
    return fresh;
  }
}

/** [InstallIdStore] with a fixed value, for tests. */
export class FixedInstallIdStore implements InstallIdStore {
  constructor(readonly id: string) {}
  async installId(): Promise<string> {
    return this.id;
  }
}
