// RevenueCat webhook → rewards events (ADR 0002 18.5). A second webhook integration in RevenueCat points here.
// Event fields from revenuecat.com/docs/integrations/webhooks/event-types-and-fields (2026-11-14):
//   every event: type, id, app_user_id, aliases, environment, event_timestamp_ms
//   VIRTUAL_CURRENCY_TRANSACTION: source (in_app_purchase | admin_api | server_api | client_sdk | expiration | ad_reward),
//     adjustments [{amount, currency: {code, name, description}}], ad_transaction_id (only when source = ad_reward)
// Never logs subscriber attributes, emails or tokens.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RcAction =
  | {
    kind: "ad";
    userId: string;
    adTransactionId: string;
    currency: string | null;
    amount: number | null;
    eventId: string;
  }
  | { kind: "event"; userId: string; type: string; eventId: string; props: Record<string, unknown> }
  | { kind: "skip"; reason: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** The Supabase user: app_user_id when it is a uuid, else the first uuid among the aliases. */
export function supabaseUserId(ev: Record<string, unknown>): string | null {
  const ids = [ev.app_user_id, ...(Array.isArray(ev.aliases) ? ev.aliases : [])];
  for (const id of ids) if (typeof id === "string" && UUID.test(id)) return id.toLowerCase();
  return null;
}

/** What to do with one webhook body. */
export function rcAction(body: unknown): RcAction {
  const ev = isObj(body) && isObj(body.event) ? body.event : null;
  if (ev === null) return { kind: "skip", reason: "no_event" };
  const type = str(ev.type);
  const id = str(ev.id);
  if (type === null || id === null || !/^[A-Z_]{2,60}$/.test(type)) return { kind: "skip", reason: "no_type" };
  const userId = supabaseUserId(ev);
  if (userId === null) return { kind: "skip", reason: "no_supabase_user" };
  if (type === "VIRTUAL_CURRENCY_TRANSACTION" && ev.source === "ad_reward") {
    const adTx = str(ev.ad_transaction_id);
    if (adTx === null) return { kind: "skip", reason: "no_ad_transaction" };
    const first = Array.isArray(ev.adjustments) && isObj(ev.adjustments[0]) ? ev.adjustments[0] : null;
    const currency = first && isObj(first.currency) ? str(first.currency.code) : null;
    const amount = first && typeof first.amount === "number" ? first.amount : null;
    return { kind: "ad", userId, adTransactionId: adTx.slice(0, 200), currency, amount, eventId: id };
  }
  const props: Record<string, unknown> = {};
  for (const k of ["product_id", "store", "environment", "price", "period_type", "source", "currency"]) {
    const v = ev[k];
    if (typeof v === "string" || typeof v === "number") props[k] = typeof v === "string" ? v.slice(0, 100) : v;
  }
  return { kind: "event", userId, type, eventId: id, props };
}
