import {
  FixedInstallIdStore,
  ReferralClient,
  referralHttpRpc,
  type HttpTransport,
  type ReferralEventSink,
  type ReferralRpc,
} from '@myind/referral-core';

export interface ServerReferralRpcOptions {
  /** `https://<ref>.supabase.co`, e.g. `process.env.NEXT_PUBLIC_SUPABASE_URL`. */
  supabaseUrl: string | null | undefined;
  /** The project's public (anon / publishable) key. A service-role or secret key is refused. */
  anonKey: string | null | undefined;
  /**
   * The signed-in user's access token (from the request's session cookie), or a function returning it. Null when
   * signed out: calls then fail as `signed_out`.
   */
  accessToken: string | null | undefined | (() => Promise<string | null | undefined> | string | null | undefined);
  /** Default 8000 ms. */
  timeoutMs?: number;
  /** Default: the global `fetch` with `cache: 'no-store'` (every answer is per user). */
  fetch?: typeof fetch;
}

function jwtRole(key: string): string | null {
  const part = key.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { role?: unknown };
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

/** True for a key that must never reach a referral call: a `service_role` JWT or a new `sb_secret_…` key. */
export function isSecretSupabaseKey(key: string | null | undefined): boolean {
  if (!key) return false;
  const k = key.trim();
  return k.startsWith('sb_secret_') || jwtRole(k) === 'service_role';
}

/** An [HttpTransport] over [fetchImpl] that never caches (Next.js caches `fetch` by default in some versions). */
export function noStoreTransport(fetchImpl: typeof fetch = fetch): HttpTransport {
  return async (url, headers, body, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { ...headers },
        body,
        signal: controller.signal,
        cache: 'no-store',
      });
      return { status: res.status, body: await res.text() };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * A `ReferralRpc` for server components, route handlers and server actions: `POST {supabaseUrl}/rest/v1/rpc/{fn}`
 * with the public key and the user's access token, never cached. The referral functions run as that user under row
 * level security, so a service key is neither needed nor accepted (it throws, so it cannot leak into a call by
 * mistake).
 *
 * ```ts
 * const rpc = createReferralRpc({
 *   supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
 *   anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   accessToken: session?.access_token,
 * });
 * ```
 */
export function createReferralRpc(opts: ServerReferralRpcOptions): ReferralRpc {
  if (isSecretSupabaseKey(opts.anonKey)) {
    throw new Error('createReferralRpc: pass the public anon / publishable key, never a service-role or secret key.');
  }
  const token = opts.accessToken;
  return referralHttpRpc({
    supabaseUrl: opts.supabaseUrl,
    anonKey: opts.anonKey,
    accessToken: typeof token === 'function' ? token : () => token,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    transport: noStoreTransport(opts.fetch ?? fetch),
  });
}

export interface ServerReferralClientOptions extends ServerReferralRpcOptions {
  /**
   * This device's install id (the referral functions use it against self-referral). Read it from a cookie the
   * browser sets with `StoredInstallIdStore`; it must be a UUID.
   */
  installId: string;
  onEvent?: ReferralEventSink | null;
  codeHashSalt?: string;
}

/** A `ReferralClient` on [createReferralRpc] for one request (server components, route handlers, server actions). */
export function createServerReferralClient(opts: ServerReferralClientOptions): ReferralClient {
  return new ReferralClient({
    rpc: createReferralRpc(opts),
    installIds: new FixedInstallIdStore(opts.installId),
    onEvent: opts.onEvent ?? null,
    ...(opts.codeHashSalt !== undefined ? { codeHashSalt: opts.codeHashSalt } : {}),
  });
}
