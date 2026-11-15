// RevenueCat in-app currency (API v2 "virtual currencies") for `rc_currency` rewards (ADR 0002 18.5).
// POST /projects/{project_id}/customers/{customer_id}/virtual_currencies/transactions
//   body {"adjustments": {"<code>": amount}, "reference": "<grant_key>"}, header Idempotency-Key: <grant id>
// Key permission: customer_information:purchases:read_write. Checked on revenuecat.com/docs/api-v2/virtual-currency,
// 2026-11-14. The Idempotency-Key makes a retry after a timeout safe: RevenueCat applies the request once.

import { classifyStatus, RevenueCatError } from "../referral/revenuecat.ts";

export interface RcCurrency {
  /** Adds `amount` of `code` to the customer's balance, once per `idempotencyKey`. Returns the new balance or null. */
  add(
    customerId: string,
    code: string,
    amount: number,
    reference: string,
    idempotencyKey: string,
  ): Promise<number | null>;
  /** Creates the customer (404 on add means RevenueCat has never seen this user). */
  createCustomer(customerId: string): Promise<void>;
}

export interface FetchCurrencyOptions {
  secretKey: string;
  projectId: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function fetchCurrency(opts: FetchCurrencyOptions): RcCurrency {
  const base = (opts.baseUrl ?? "https://api.revenuecat.com/v2").replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;
  const project = `/projects/${encodeURIComponent(opts.projectId)}`;
  async function post(op: string, path: string, body: unknown, extra: Record<string, string> = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(base + path, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${opts.secretKey}`,
          "Accept": "application/json",
          "Content-Type": "application/json",
          ...extra,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
    } catch {
      throw new RevenueCatError("timeout", op, null);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw classifyStatus(op, res);
    }
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  return {
    async add(customerId, code, amount, reference, idempotencyKey) {
      const j = await post(
        "add_currency",
        `${project}/customers/${encodeURIComponent(customerId)}/virtual_currencies/transactions`,
        { adjustments: { [code]: amount }, reference },
        { "Idempotency-Key": idempotencyKey },
      ) as { items?: { currency_code?: string; balance?: number }[] } | null;
      const item = j?.items?.find((i) => i.currency_code === code);
      return typeof item?.balance === "number" ? item.balance : null;
    },
    async createCustomer(customerId) {
      try {
        await post("create_customer", `${project}/customers`, { id: customerId });
      } catch (e) {
        if (e instanceof RevenueCatError && e.kind === "client" && e.status === 409) return; // already exists
        throw e;
      }
    },
  };
}
