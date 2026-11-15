// Fakes for the function's tests: a scripted Db and an in-memory RevenueCat. No network.
import type { Db } from "./db.ts";
import {
  type RcCustomer,
  type RcEntitlementRef,
  type RcSubscription,
  type RevenueCat,
  RevenueCatError,
} from "./revenuecat.ts";

type Handler = (params: Record<string, unknown>) => unknown;

/** Records every call; each function answers from its handler (or throws when none is set). */
export class FakeDb implements Db {
  calls: { fn: string; params: Record<string, unknown> }[] = [];
  constructor(public handlers: Record<string, Handler> = {}) {}
  rpc<T>(fn: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ fn, params });
    const h = this.handlers[fn];
    if (!h) return Promise.reject(new Error(`no fake for ${fn}`));
    try {
      return Promise.resolve(h(params) as T);
    } catch (e) {
      return Promise.reject(e);
    }
  }
  called(fn: string) {
    return this.calls.filter((c) => c.fn === fn);
  }
}

export interface FakeCustomer {
  subs: RcSubscription[];
  /** internal entitlement id → expiry (null = lifetime). */
  active: Map<string, number | null>;
}

/**
 * In-memory RevenueCat with API v2's documented behaviour: grant ignored within 2 h of an existing promotional
 * expiry, 404 for unknown customers. `fail` injects errors per operation (consumed in order).
 */
export class FakeRevenueCat implements RevenueCat {
  customers = new Map<string, FakeCustomer>();
  entitlements = new Map<string, string>([["premium", "entl_premium"]]);
  promoExpiry = new Map<string, number>();
  fail: Record<string, (RevenueCatError | "timeout_after_landing")[]> = {};
  calls: string[] = [];
  /** subscription id → its full entitlements list (every page); GET subscription/entitlements read it. */
  subEntitlements = new Map<string, RcEntitlementRef[]>();
  /** subscription id → what GET subscription returns (default: the listed subscription itself). */
  subOverride = new Map<string, RcSubscription>();
  /** When false the grant's response omits active_entitlements (as GET customer is the only documented source). */
  grantReturnsEntitlements = true;

  add(id: string, c: Partial<FakeCustomer> = {}) {
    this.customers.set(id, { subs: c.subs ?? [], active: c.active ?? new Map() });
  }

  private wrap<T>(fn: () => T): Promise<T> {
    try {
      return Promise.resolve(fn());
    } catch (e) {
      return Promise.reject(e);
    }
  }

  private maybeFail(op: string): "timeout_after_landing" | null {
    const f = this.fail[op]?.shift();
    if (f === undefined) return null;
    if (f === "timeout_after_landing") return f;
    throw f;
  }

  private view(id: string, withEntitlements = true): RcCustomer {
    const c = this.customers.get(id)!;
    return {
      id,
      active_entitlements: withEntitlements
        ? { items: [...c.active].map(([entitlement_id, expires_at]) => ({ entitlement_id, expires_at })) }
        : null,
    };
  }

  private need(id: string, op: string): FakeCustomer {
    const c = this.customers.get(id);
    if (!c) throw new RevenueCatError("not_found", op, 404);
    return c;
  }

  getCustomer(id: string): Promise<RcCustomer> {
    this.calls.push(`get:${id}`);
    return this.wrap(() => {
      this.maybeFail("get");
      this.need(id, "get_customer");
      return this.view(id);
    });
  }
  createCustomer(id: string): Promise<RcCustomer> {
    this.calls.push(`create:${id}`);
    return this.wrap(() => {
      this.maybeFail("create");
      if (this.customers.has(id)) throw new RevenueCatError("client", "create_customer", 409);
      this.add(id);
      return this.view(id, false);
    });
  }
  listSubscriptions(id: string): Promise<RcSubscription[]> {
    this.calls.push(`subs:${id}`);
    return this.wrap(() => {
      this.maybeFail("subs");
      return this.need(id, "list_subscriptions").subs;
    });
  }
  getSubscription(subId: string): Promise<RcSubscription> {
    this.calls.push(`sub:${subId}`);
    return this.wrap(() => {
      this.maybeFail("sub");
      const o = this.subOverride.get(subId);
      if (o) return o;
      for (const c of this.customers.values()) {
        const s = c.subs.find((x) => x.id === subId);
        if (s) return s;
      }
      throw new RevenueCatError("not_found", "get_subscription", 404);
    });
  }
  listSubscriptionEntitlements(subId: string): Promise<RcEntitlementRef[]> {
    this.calls.push(`sub_ents:${subId}`);
    return this.wrap(() => {
      this.maybeFail("sub_ents");
      const l = this.subEntitlements.get(subId);
      if (!l) throw new RevenueCatError("not_found", "list_subscription_entitlements", 404);
      return l;
    });
  }
  grantEntitlement(id: string, ent: string, expiresAt: number): Promise<RcCustomer> {
    this.calls.push(`grant:${id}:${expiresAt}`);
    return this.wrap(() => {
      const f = this.maybeFail("grant");
      const c = this.need(id, "grant_entitlement");
      const prev = this.promoExpiry.get(`${id}:${ent}`);
      const duplicate = prev !== undefined && Math.abs(prev - expiresAt) < 2 * 3600_000;
      if (!duplicate) {
        this.promoExpiry.set(`${id}:${ent}`, expiresAt);
        const cur = c.active.get(ent);
        if (cur !== null) c.active.set(ent, Math.max(cur ?? 0, expiresAt));
      }
      if (f === "timeout_after_landing") throw new RevenueCatError("timeout", "grant_entitlement", null);
      return this.view(id, this.grantReturnsEntitlements);
    });
  }
  entitlementIdFor(key: string): Promise<string | null> {
    return Promise.resolve(this.entitlements.get(key) ?? null);
  }
}

export function storeSub(over: Partial<RcSubscription> = {}): RcSubscription {
  return {
    id: "sub_1",
    store_subscription_identifier: "tid-1",
    starts_at: 1_000,
    store: "app_store",
    environment: "production",
    ownership: "purchased",
    gives_access: true,
    entitlements: { items: [{ id: "entl_premium", lookup_key: "premium" }] },
    ...over,
  };
}

/** Signed webhook request as RevenueCat sends it. */
export async function signedRequest(
  url: string,
  body: string,
  opts: { token?: string | null; secret: string; t: number; signature?: string | null },
): Promise<Request> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(opts.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${opts.t}.${body}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const headers = new Headers({ "Content-Type": "application/json" });
  if (opts.token !== null) headers.set("Authorization", opts.token ?? "");
  if (opts.signature !== null) headers.set("X-RevenueCat-Webhook-Signature", opts.signature ?? `t=${opts.t},v1=${hex}`);
  return new Request(url, { method: "POST", headers, body });
}
