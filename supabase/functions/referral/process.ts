// Process one stored webhook event (ADR 6.7 transaction 2): read the facts, decide, apply under the fingerprint.

import type { Db } from "./db.ts";
import { decide, type EventContext } from "./decide.ts";
import { normaliseStore, usersInEvent } from "./logic.ts";

export const MAX_APPLY_TRIES = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProcessResult =
  | { status: "applied"; event_state: string; banked_released: number }
  | { status: "already_done" | "unknown_event" }
  /** The event was marked failed; `mark` is the SQL's answer (`will_retry` / `alert_owner`). */
  | { status: "failed"; error: string; mark: string | null };

function errorText(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 300);
}

async function markFailed(db: Db, eventId: string, error: string): Promise<ProcessResult> {
  let mark: string | null = null;
  try {
    mark = await db.rpc<string>("referral_svc_mark_event_failed", { event_id: eventId, error });
  } catch { /* the worker retries `received` events too */ }
  return { status: "failed", error, mark };
}

/**
 * An EXPIRATION of a store (non-promotional) subscription releases the user's banked days for the entitlements it
 * names (ADR 6.4), whichever entitlement a rule granted (`params.entitlement_id` or settings). A promotional grant
 * expiring never does.
 */
async function releaseBanked(db: Db, ctx: EventContext): Promise<number> {
  const ev = ctx.event;
  if (ev.type !== "EXPIRATION") return 0;
  const store = normaliseStore(ev.fields.store);
  const ents = (ev.fields.entitlement_ids ?? []).filter((e) => typeof e === "string" && e !== "");
  if (store === null || store === "promotional" || ents.length === 0) return 0;
  const u = usersInEvent(ev.type, ev.fields);
  let n = 0;
  if (u.kind !== "users") return 0;
  for (const id of u.users) {
    if (!UUID.test(id)) continue;
    n += await db.rpc<number>("referral_svc_release_banked_keys", { user_id: id, entitlement_ids: ents }) ?? 0;
  }
  return n;
}

export async function processEvent(db: Db, eventId: string): Promise<ProcessResult> {
  try {
    for (let i = 0; i < MAX_APPLY_TRIES; i++) {
      const ctx = await db.rpc<EventContext | null>("referral_svc_event_context", { event_id: eventId });
      if (ctx === null) return { status: "unknown_event" };
      if (!["received", "failed", "waiting"].includes(ctx.event.state)) return { status: "already_done" };
      const decision = decide(ctx);
      const res = await db.rpc<string>("referral_svc_apply_event", {
        event_id: eventId,
        fingerprint: ctx.fingerprint,
        decision,
      });
      if (res === "retry") continue;
      if (res === "already_done" || res === "unknown_event") return { status: res };
      if (res !== "applied") throw new Error(`unexpected apply result ${String(res)}`);
      let released = 0;
      try {
        released = await releaseBanked(db, ctx);
      } catch (e) {
        // The event is already processed; the daily banked sweep releases these days instead.
        console.log(JSON.stringify({ level: "warn", msg: "release_banked failed", error: errorText(e) }));
      }
      return { status: "applied", event_state: decision.event_state, banked_released: released };
    }
    return await markFailed(db, eventId, `facts changed ${MAX_APPLY_TRIES} times in a row`);
  } catch (e) {
    return await markFailed(db, eventId, errorText(e));
  }
}
