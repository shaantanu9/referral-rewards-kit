import { isWellFormedCode, normaliseCode } from './code-format';
import type { KeyValueStore } from './storage';

/**
 * Reads the raw install referrer string the store recorded for this install, or null. React Native apps implement
 * it with `react-native-play-install-referrer` (Android); the web has none.
 */
export interface InstallReferrerSource {
  readReferrer(): Promise<string | null>;
}

/** A source that never has a referrer (web, iOS). */
export const noInstallReferrer: InstallReferrerSource = { readReferrer: async () => null };

function decode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/**
 * Pulls the invite code out of a referrer string. The invite page links Play with `&referrer=code%3DABCDEFGH`, which
 * Play hands back as `code=ABCDEFGH`; a still-encoded value and other parameters (`utm_source=…&code=…`) are accepted
 * too. Returns the normalised code, or null when there is no well-formed one.
 */
export function codeFromReferrer(referrer: string | null | undefined): string | null {
  if (referrer == null || referrer === '') return null;
  let text = referrer;
  for (let i = 0; i < 2 && text.includes('%'); i++) {
    const d = decode(text);
    if (d == null) break;
    text = d;
  }
  for (const part of text.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0 || part.substring(0, eq).trim() !== 'code') continue;
    const code = normaliseCode(part.substring(eq + 1));
    if (isWellFormedCode(code)) return code;
  }
  return null;
}

/**
 * Reads the install referrer once per install (ADR 4.2): the first call asks the source and remembers that it did;
 * later calls return null, so a code the user dismissed is never offered again.
 */
export class InstallReferrerCodeReader {
  static readonly readKey = 'install_referrer_read';
  private readonly store: KeyValueStore;
  private readonly source: InstallReferrerSource;

  constructor(opts: { store: KeyValueStore; source?: InstallReferrerSource }) {
    this.store = opts.store;
    this.source = opts.source ?? noInstallReferrer;
  }

  /** The code to prefill, or null. */
  async readOnce(): Promise<string | null> {
    if ((await this.store.getString(InstallReferrerCodeReader.readKey)) != null) return null;
    let raw: string | null = null;
    try {
      raw = await this.source.readReferrer();
    } catch {
      raw = null;
    }
    await this.store.setString(InstallReferrerCodeReader.readKey, '1');
    return codeFromReferrer(raw);
  }
}
