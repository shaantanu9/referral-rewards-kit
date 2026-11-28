import {
  ReferralNetworkError,
  ReferralServerError,
  ReferralUnavailableException,
  ReferralUnavailableReason,
} from './availability';

/** One HTTP answer: status and body text. */
export interface HttpResponseLike {
  readonly status: number;
  readonly body: string;
}

/**
 * Sends one POST and returns its status and body. The default uses `fetch` with an `AbortController` timeout; replace
 * it in tests or to reuse an app's HTTP client.
 */
export type HttpTransport = (
  url: string,
  headers: Readonly<Record<string, string>>,
  body: string,
  timeoutMs: number,
) => Promise<HttpResponseLike>;

/** The default [HttpTransport]: `fetch` (browsers, Node 18+, React Native, edge runtimes). */
export const fetchTransport: HttpTransport = async (url, headers, body, timeoutMs) => {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { method: 'POST', headers: { ...headers }, body, signal: controller?.signal ?? null });
    return { status: res.status, body: await res.text() };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** Options shared by the referral and rewards HTTP rpc. */
export interface HttpRpcOptions {
  /** `https://<ref>.supabase.co` (a trailing slash is fine). Null or empty: `no_project`. */
  readonly supabaseUrl: string | null | undefined;
  /** The project's public (anon / publishable) key; sent as `apikey`. Never a service-role key. */
  readonly anonKey: string | null | undefined;
  /** The signed-in user's JWT, or null when signed out (`signed_out`). */
  readonly accessToken: () => Promise<string | null | undefined> | string | null | undefined;
  /** Default 8000 ms. */
  readonly timeoutMs?: number;
  readonly transport?: HttpTransport;
}

/** Calls one Postgres function through PostgREST and returns its JSON result. */
export type ReferralRpc = (fn: string, params: Record<string, unknown>) => Promise<unknown>;

/**
 * A [ReferralRpc] over `fetch`, for apps without supabase-js: `POST {supabaseUrl}/rest/v1/rpc/{fn}` with the
 * project's public key and the signed-in user's access token, and the decoded body back.
 *
 * Errors: 404 (PostgREST's "function not found") → [ReferralUnavailableException] `not_deployed`; any other non-2xx
 * status or a body that is not JSON → [ReferralServerError]; no answer or a timeout → [ReferralNetworkError].
 * Response bodies are never put in an exception (they may echo user data).
 *
 * ```ts
 * const rpc = referralHttpRpc({ supabaseUrl, anonKey, accessToken: async () => session?.access_token });
 * const referrals = new ReferralClient({ rpc, installIds });
 * ```
 */
export function referralHttpRpc(opts: HttpRpcOptions): ReferralRpc {
  const transport = opts.transport ?? fetchTransport;
  const timeoutMs = opts.timeoutMs ?? 8000;
  return async (fn, params) => {
    const base = (opts.supabaseUrl ?? '').trim();
    const key = (opts.anonKey ?? '').trim();
    if (base === '' || key === '') throw new ReferralUnavailableException(ReferralUnavailableReason.noProject);
    const token = await opts.accessToken();
    if (token == null || token === '') throw new ReferralUnavailableException(ReferralUnavailableReason.signedOut);
    const root = base.endsWith('/') ? base.substring(0, base.length - 1) : base;
    const headers = {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    let r: HttpResponseLike;
    try {
      r = await transport(`${root}/rest/v1/rpc/${fn}`, headers, JSON.stringify(params), timeoutMs);
    } catch {
      throw new ReferralNetworkError(fn);
    }
    if (r.status === 404) throw new ReferralUnavailableException(ReferralUnavailableReason.notDeployed);
    if (r.status < 200 || r.status >= 300) throw new ReferralServerError(fn, r.status);
    if (r.body.trim() === '') return null;
    try {
      return JSON.parse(r.body) as unknown;
    } catch {
      throw new ReferralServerError(fn, r.status);
    }
  };
}

/**
 * Adapts a supabase-js client (or anything with `rpc(fn, params)` resolving to `{data, error}`) to a [ReferralRpc]:
 * `supabaseRpc(supabase)`. A returned `error` is thrown as is, so `PGRST202` is recognised as not deployed.
 */
export function supabaseRpc(client: {
  rpc(fn: string, params?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}): ReferralRpc {
  return async (fn, params) => {
    const { data, error } = await client.rpc(fn, params);
    if (error) throw error;
    return data;
  };
}
