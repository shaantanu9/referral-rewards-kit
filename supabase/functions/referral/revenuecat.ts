// RevenueCat API v2 client for the worker (ADR 6.1, 6.4, 6.5). Base https://api.revenuecat.com/v2, Bearer secret key.
//
// Endpoints (checked on revenuecat.com/docs/api-v2, 2026-11-12):
//   GET  /projects/{p}/customers/{c}                              customer_information:customers:read
//   POST /projects/{p}/customers  {id}                            customer_information:customers:read_write
//   GET  /projects/{p}/customers/{c}/subscriptions                customer_information:subscriptions:read
//   POST /projects/{p}/customers/{c}/actions/grant_entitlement    customer_information:customers:read_write
//   GET  /projects/{p}/entitlements                               project_configuration:entitlements:read
//   GET  /projects/{p}/subscriptions/{s}                          customer_information:subscriptions:read
//   GET  /projects/{p}/subscriptions/{s}/entitlements             customer_information:subscriptions:read
//        (both paths and the list's starting_after / limit (1..100) / next_page checked on
//        revenuecat.com/docs/api-v2/subscription, 2026-11-14; the permission names are [unconfirmed])
// Never logs the key, and errors carry only the status and the operation name (bodies may hold personal data).

import type { ApiV2Subscription } from "./logic.ts";

export interface RcEntitlementRef {
  id?: string;
  lookup_key?: string;
  state?: string;
  [k: string]: unknown;
}

/** API v2 subscription plus the fields the worker reads beyond the 6.5 match. */
export interface RcSubscription extends ApiV2Subscription {
  /**
   * `{object:"list", items:[Entitlement…], next_page: url | null, url}` per the API v2 Subscription schema: a page,
   * not always the whole list. Read it through grant.ts `subscriptionEntitlements`.
   */
  entitlements?: { items?: RcEntitlementRef[] | null; next_page?: string | null; [k: string]: unknown } | null;
  ends_at?: number | null;
  current_period_ends_at?: number | null;
}

export interface RcActiveEntitlement {
  /** RevenueCat's internal entitlement id (`entl…`), not the lookup key. */
  entitlement_id: string;
  /** ms; null = does not expire (lifetime). */
  expires_at: number | null;
}

export interface RcCustomer {
  id?: string;
  /** Returned by GET customer; other endpoints that return a Customer may leave it out or null. */
  active_entitlements?: { items?: RcActiveEntitlement[] | null; [k: string]: unknown } | null;
  [k: string]: unknown;
}

export type RcErrorKind = "not_found" | "rate_limited" | "server" | "timeout" | "client";

export class RevenueCatError extends Error {
  constructor(
    readonly kind: RcErrorKind,
    readonly op: string,
    readonly status: number | null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`revenuecat ${op}: ${kind}${status === null ? "" : ` (${status})`}`);
    this.name = "RevenueCatError";
  }
}

export interface RevenueCat {
  getCustomer(customerId: string): Promise<RcCustomer>;
  createCustomer(customerId: string): Promise<RcCustomer>;
  /** Every page (`starting_after`), both environments. */
  listSubscriptions(customerId: string): Promise<RcSubscription[]>;
  /** One subscription by RevenueCat's id (`sub…`). */
  getSubscription(subscriptionId: string): Promise<RcSubscription>;
  /** Every page of a subscription's entitlements (capped like listSubscriptions). */
  listSubscriptionEntitlements(subscriptionId: string): Promise<RcEntitlementRef[]>;
  /** `entitlementId` is RevenueCat's internal id (see entitlementIdFor). Returns the customer from the 201. */
  grantEntitlement(customerId: string, entitlementId: string, expiresAtMs: number): Promise<RcCustomer>;
  /** Lookup key (`premium`) → internal id (`entl…`); null when the project has no such entitlement. Cached. */
  entitlementIdFor(lookupKey: string): Promise<string | null>;
}

export interface FetchRevenueCatOptions {
  secretKey: string;
  projectId: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Safety cap on pagination. */
  maxPages?: number;
}

/** `Retry-After` as seconds or an HTTP date; null when absent or unreadable. */
export function parseRetryAfter(v: string | null, nowMs = Date.now()): number | null {
  if (v === null || v.trim() === "") return null;
  if (/^\d+$/.test(v.trim())) return Math.min(Number(v.trim()), 6 * 3600);
  const d = Date.parse(v);
  if (Number.isNaN(d)) return null;
  return Math.max(0, Math.min(Math.ceil((d - nowMs) / 1000), 6 * 3600));
}

export function classifyStatus(op: string, res: Response): RevenueCatError {
  const s = res.status;
  if (s === 404) return new RevenueCatError("not_found", op, s);
  if (s === 429) return new RevenueCatError("rate_limited", op, s, parseRetryAfter(res.headers.get("Retry-After")));
  if (s >= 500) return new RevenueCatError("server", op, s);
  return new RevenueCatError("client", op, s);
}

export function fetchRevenueCat(opts: FetchRevenueCatOptions): RevenueCat {
  const base = (opts.baseUrl ?? "https://api.revenuecat.com/v2").replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxPages = opts.maxPages ?? 20;
  const project = `/projects/${encodeURIComponent(opts.projectId)}`;
  let entitlements: Map<string, string> | null = null;

  async function call<T>(op: string, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(base + path, {
        method,
        headers: {
          "Authorization": `Bearer ${opts.secretKey}`,
          "Accept": "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (_e) {
      // AbortSignal.timeout → TimeoutError; a dropped connection is treated the same (the call may have landed).
      throw new RevenueCatError("timeout", op, null);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw classifyStatus(op, res);
    }
    try {
      return await res.json() as T;
    } catch {
      throw new RevenueCatError("server", op, res.status);
    }
  }

  async function listAll<T>(op: string, path: string): Promise<T[]> {
    const out: T[] = [];
    let after: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const q: string = `?limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ""}`;
      const res: { items?: T[]; next_page?: string | null } = await call(op, "GET", path + q);
      out.push(...(res.items ?? []));
      if (!res.next_page) return out;
      const next: string | null = new URL(res.next_page, "https://api.revenuecat.com").searchParams.get(
        "starting_after",
      );
      if (!next || next === after) return out;
      after = next;
    }
    throw new RevenueCatError("server", `${op} (too many pages)`, null);
  }

  const customer = (id: string) => `${project}/customers/${encodeURIComponent(id)}`;

  return {
    getCustomer: (id) => call("get_customer", "GET", customer(id)),
    createCustomer: (id) => call("create_customer", "POST", `${project}/customers`, { id }),
    listSubscriptions: (id) => listAll<RcSubscription>("list_subscriptions", `${customer(id)}/subscriptions`),
    getSubscription: (id) => call("get_subscription", "GET", `${project}/subscriptions/${encodeURIComponent(id)}`),
    listSubscriptionEntitlements: (id) =>
      listAll<RcEntitlementRef>(
        "list_subscription_entitlements",
        `${project}/subscriptions/${encodeURIComponent(id)}/entitlements`,
      ),
    grantEntitlement: (id, entitlementId, expiresAtMs) =>
      call("grant_entitlement", "POST", `${customer(id)}/actions/grant_entitlement`, {
        entitlement_id: entitlementId,
        expires_at: expiresAtMs,
      }),
    async entitlementIdFor(lookupKey) {
      if (entitlements === null) {
        const items = await listAll<{ id?: string; lookup_key?: string }>(
          "list_entitlements",
          `${project}/entitlements`,
        );
        const m = new Map<string, string>();
        for (const e of items) if (e.id && e.lookup_key) m.set(e.lookup_key, e.id);
        entitlements = m;
      }
      return entitlements.get(lookupKey) ?? null;
    },
  };
}
