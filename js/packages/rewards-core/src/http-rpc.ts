import {
  RewardsException,
  RewardsNetworkError,
  RewardsServerError,
  RewardsUnavailableException,
  RewardsUnavailableReason,
  rewardsReasonOf,
} from './errors';

/** One HTTP answer: status and body text. */
export interface RewardsHttpResponse {
  readonly status: number;
  readonly body: string;
}

/** Sends one POST and returns its status and body. Replace it in tests or to reuse an app's HTTP client. */
export type RewardsHttpTransport = (
  url: string,
  headers: Readonly<Record<string, string>>,
  body: string,
  timeoutMs: number,
) => Promise<RewardsHttpResponse>;

/** The default [RewardsHttpTransport]: `fetch` with an `AbortController` timeout. */
export const rewardsFetchTransport: RewardsHttpTransport = async (url, headers, body, timeoutMs) => {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { method: 'POST', headers: { ...headers }, body, signal: controller?.signal ?? null });
    return { status: res.status, body: await res.text() };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** Calls one Postgres function through PostgREST and returns its JSON result (a JSON string is accepted too). */
export type RewardsRpc = (fn: string, params: Record<string, unknown>) => Promise<unknown>;

export interface RewardsHttpRpcOptions {
  /** `https://<ref>.supabase.co` (a trailing slash is fine). Null or empty: `no_project`. */
  readonly supabaseUrl: string | null | undefined;
  /** The project's public key; sent as `apikey`. Never a service-role key. */
  readonly anonKey: string | null | undefined;
  /** The signed-in user's JWT, or null when signed out. */
  readonly accessToken: () => Promise<string | null | undefined> | string | null | undefined;
  /** Default 8000 ms. */
  readonly timeoutMs?: number;
  readonly transport?: RewardsHttpTransport;
}

/**
 * A [RewardsRpc] over `fetch`: `POST {supabaseUrl}/rest/v1/rpc/{fn}` with the public key and the user's token.
 *
 * Errors: 404 → [RewardsUnavailableException] `not_deployed`; a 4xx body carrying `rewards: <reason>` →
 * [RewardsException]; any other non-2xx or a body that is not JSON → [RewardsServerError]; no answer →
 * [RewardsNetworkError]. Response bodies are never put in an exception.
 */
export function rewardsHttpRpc(opts: RewardsHttpRpcOptions): RewardsRpc {
  const transport = opts.transport ?? rewardsFetchTransport;
  const timeoutMs = opts.timeoutMs ?? 8000;
  return async (fn, params) => {
    const base = (opts.supabaseUrl ?? '').trim();
    const key = (opts.anonKey ?? '').trim();
    if (base === '' || key === '') throw new RewardsUnavailableException(RewardsUnavailableReason.noProject);
    const token = await opts.accessToken();
    if (token == null || token === '') throw new RewardsUnavailableException(RewardsUnavailableReason.signedOut);
    const root = base.endsWith('/') ? base.substring(0, base.length - 1) : base;
    const headers = {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    let r: RewardsHttpResponse;
    try {
      r = await transport(`${root}/rest/v1/rpc/${fn}`, headers, JSON.stringify(params), timeoutMs);
    } catch {
      throw new RewardsNetworkError(fn);
    }
    if (r.status === 404) throw new RewardsUnavailableException(RewardsUnavailableReason.notDeployed);
    if (r.status < 200 || r.status >= 300) {
      // PostgREST puts the raised message in the body: keep only the reason, never the body.
      const reason = rewardsReasonOf(r.body);
      if (reason != null) throw new RewardsException(reason);
      throw new RewardsServerError(fn, r.status);
    }
    if (r.body.trim() === '') return null;
    try {
      return JSON.parse(r.body) as unknown;
    } catch {
      throw new RewardsServerError(fn, r.status);
    }
  };
}

/**
 * Adapts a supabase-js client (anything with `rpc(fn, params)` resolving to `{data, error}`) to a [RewardsRpc]. The
 * error is thrown as is, so `rewards: <reason>` and `PGRST202` are recognised by the client.
 */
export function supabaseRewardsRpc(client: {
  rpc(fn: string, params?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}): RewardsRpc {
  return async (fn, params) => {
    const { data, error } = await client.rpc(fn, params);
    if (error) throw error;
    return data;
  };
}
