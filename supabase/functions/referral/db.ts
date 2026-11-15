// Database access for the Edge Function (ADR 7, 13): only the `public.referral_svc_*` wrappers, called through
// PostgREST with the service role key. No supabase-js dependency.

/** One call to a `public.referral_svc_*` function. The result is the function's JSON value (null for SQL null). */
export interface Db {
  rpc<T = unknown>(fn: string, params?: Record<string, unknown>): Promise<T>;
}

export class DbError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "DbError";
  }
}

export interface PostgrestOptions {
  /** `SUPABASE_URL`, e.g. `https://<ref>.supabase.co`. */
  url: string;
  /** `SUPABASE_SERVICE_ROLE_KEY`. Sent as `apikey` and `Authorization: Bearer`. Never logged. */
  serviceRoleKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Function names this client may call. Default `referral_svc_*`; the rewards function passes `rewards_svc_*`. */
  allow?: RegExp;
}

/** `POST {url}/rest/v1/rpc/{fn}` with the params as the JSON body. */
export function postgrestDb(opts: PostgrestOptions): Db {
  const base = opts.url.replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const allow = opts.allow ?? /^referral_svc_[a-z_]+$/;
  return {
    async rpc<T>(fn: string, params: Record<string, unknown> = {}): Promise<T> {
      if (!allow.test(fn)) throw new DbError(`not a service function: ${fn}`, null);
      let res: Response;
      try {
        res = await doFetch(`${base}/rest/v1/rpc/${fn}`, {
          method: "POST",
          headers: {
            "apikey": opts.serviceRoleKey,
            "Authorization": `Bearer ${opts.serviceRoleKey}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        throw new DbError(`${fn}: ${e instanceof Error ? e.name : "network error"}`, null);
      }
      const text = await res.text();
      if (!res.ok) {
        // PostgREST errors carry the SQL message (e.g. "breaks a precondition"); keep it short, no body echo.
        let msg = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(text);
          if (j && typeof j.message === "string") msg = j.message.slice(0, 300);
        } catch { /* not JSON */ }
        throw new DbError(`${fn}: ${msg}`, res.status);
      }
      return (text === "" ? null : JSON.parse(text)) as T;
    },
  };
}
