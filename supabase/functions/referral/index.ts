// referral Edge Function (ADR 6.4, 6.5, 6.7, 13). Deployed with --no-verify-jwt; each route authenticates itself.
//   POST …/webhook  RevenueCat webhook: Authorization token + X-RevenueCat-Webhook-Signature, ingest, 200, process.
//   POST …/worker   pg_cron every 15 min: X-Referral-Worker-Secret, sweep, events, starts, banked check, grants.
// Anything else: 404 (unknown path) or 405 (known path, other method). Missing configuration: 503.

import { type Db, postgrestDb } from "./db.ts";
import { InvalidEventError, normaliseEnvironment, normaliseStore, trimEvent, verifySignature } from "./logic.ts";
import { processEvent, type ProcessResult } from "./process.ts";
import { activeStoreSubscription, EntitlementsUnknown, runGrants, type RunGrantsSummary } from "./grant.ts";
import { fetchRevenueCat, type RcSubscription, type RevenueCat, RevenueCatError } from "./revenuecat.ts";

export interface Deps {
  env: (name: string) => string | undefined;
  /** Built from SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY by default. */
  db?: (env: Deps["env"]) => Db;
  /** Built from REVENUECAT_SECRET_KEY + REVENUECAT_PROJECT_ID by default. */
  revenuecat?: (env: Deps["env"]) => RevenueCat;
  now?: () => number;
  /** `EdgeRuntime.waitUntil` when present; tests pass their own. */
  waitUntil?: ((p: Promise<unknown>) => void) | null;
  /** Grant options for tests (sleep, verify delay). */
  grant?: { sleep?: (ms: number) => Promise<void>; verifyDelayMs?: number };
  log?: (line: string) => void;
}

const MAX_BODY_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Constant-time string equality: compares SHA-256 digests byte by byte, so length and content leak nothing. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * RevenueCat sends the configured Authorization value as entered (its docs name no prefix). Accept it raw, or as
 * `Bearer <token>` for owners who type the prefix into the dashboard.
 */
async function webhookTokenOk(header: string | null, token: string): Promise<boolean> {
  if (header === null) return false;
  const raw = await safeEqual(header, token);
  const bearer = await safeEqual(header, `Bearer ${token}`);
  return raw || bearer;
}

function missing(env: Deps["env"], names: string[]): boolean {
  return names.some((n) => !env(n));
}

function defaultDb(env: Deps["env"]): Db {
  return postgrestDb({ url: env("SUPABASE_URL")!, serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY")! });
}

function defaultRc(env: Deps["env"]): RevenueCat {
  return fetchRevenueCat({ secretKey: env("REVENUECAT_SECRET_KEY")!, projectId: env("REVENUECAT_PROJECT_ID")! });
}

function defaultWaitUntil(): ((p: Promise<unknown>) => void) | null {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  return rt?.waitUntil ? (p) => rt.waitUntil!(p) : null;
}

const DB_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const WEBHOOK_ENV = ["REFERRAL_WEBHOOK_TOKEN", "REVENUECAT_WEBHOOK_SIGNING_SECRET", ...DB_ENV];
const WORKER_ENV = ["REFERRAL_WORKER_SECRET", "REVENUECAT_SECRET_KEY", "REVENUECAT_PROJECT_ID", ...DB_ENV];

async function webhook(req: Request, d: Required<Omit<Deps, "grant">> & Pick<Deps, "grant">): Promise<Response> {
  if (missing(d.env, WEBHOOK_ENV)) return json(503, { error: "not configured" });
  if (!(await webhookTokenOk(req.headers.get("Authorization"), d.env("REFERRAL_WEBHOOK_TOKEN")!))) {
    return json(401, { error: "unauthorized" });
  }
  const sig = req.headers.get("X-RevenueCat-Webhook-Signature");
  if (sig === null) return json(401, { error: "unauthorized" });
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: "too large" });
  const v = await verifySignature(raw, sig, d.env("REVENUECAT_WEBHOOK_SIGNING_SECRET")!, d.now());
  if (!v.ok) return json(401, { error: "unauthorized" });

  let ev;
  try {
    ev = trimEvent(raw);
  } catch (e) {
    if (e instanceof InvalidEventError) return json(400, { error: "invalid event" });
    throw e;
  }
  const db = d.db(d.env);
  let status: string;
  try {
    status = await db.rpc<string>("referral_svc_ingest_event", { event: ev });
  } catch (_e) {
    // Not stored: a non-200 makes RevenueCat retry.
    d.log(JSON.stringify({ level: "error", source: "referral-webhook", msg: "ingest failed" }));
    return json(500, { error: "not stored" });
  }
  if (status === "stored") {
    const work = processEvent(db, ev.event_id).then((r) => {
      if (r.status === "failed") {
        d.log(JSON.stringify({ level: "warn", source: "referral-webhook", msg: "event failed", mark: r.mark }));
      }
    });
    if (d.waitUntil) d.waitUntil(work);
    else await work;
  }
  return json(200, { status });
}

interface NeedStart {
  original_transaction_id: string;
  app_user_ids: string[];
  event_ids: string[];
  transaction_ids: string[];
  store: string | null;
  environment: string | null;
}

/** Find the subscription whose `starts_at` fills a lost INITIAL_PURCHASE (ADR 6.3). */
export function findStart(subs: RcSubscription[], need: NeedStart): number | null {
  const ids = new Set([need.original_transaction_id, ...need.transaction_ids]);
  const store = normaliseStore(need.store);
  const env = normaliseEnvironment(need.environment);
  for (const s of subs) {
    const id = s.store_subscription_identifier;
    if (id === null || id === undefined || !ids.has(String(id))) continue;
    if (store !== null && normaliseStore(s.store) !== store) continue;
    if (env !== null && normaliseEnvironment(s.environment) !== env) continue;
    if (typeof s.starts_at === "number") return s.starts_at;
  }
  return null;
}

async function listSubsOrEmpty(rc: RevenueCat, userId: string): Promise<RcSubscription[]> {
  try {
    return await rc.listSubscriptions(userId);
  } catch (e) {
    if (e instanceof RevenueCatError && e.kind === "not_found") return [];
    throw e;
  }
}

/** What the worker reads from `referral_svc_sweep` (migrations 5, 6, 17). */
interface SweepResult {
  alerts?: Record<string, unknown>;
  /** Migration 17: events given up this run (no start within paid_window_days of being received); also in alerts. */
  starts_given_up?: number;
  /** Migration 17: each banked user with the lookup keys of their banked rewards. */
  banked?: { user_id: string; entitlement_ids: string[] }[];
  /** Before migration 17: banked users only (released for settings.entitlement_id). */
  banked_users?: string[];
  [k: string]: unknown;
}

/** Banked users and their entitlements; an older database gives only users, read with settings.entitlement_id. */
export function bankedPairs(sweep: SweepResult, settingsEntitlement: string | null) {
  if (Array.isArray(sweep.banked)) return sweep.banked;
  return settingsEntitlement
    ? (sweep.banked_users ?? []).map((user_id) => ({ user_id, entitlement_ids: [settingsEntitlement] }))
    : [];
}

async function worker(req: Request, d: Required<Omit<Deps, "grant">> & Pick<Deps, "grant">): Promise<Response> {
  if (missing(d.env, WORKER_ENV)) return json(503, { error: "not configured" });
  const given = req.headers.get("X-Referral-Worker-Secret");
  if (given === null || !(await safeEqual(given, d.env("REFERRAL_WORKER_SECRET")!))) {
    return json(401, { error: "unauthorized" });
  }
  await req.body?.cancel();
  const started = d.now();
  const db = d.db(d.env);
  const rc = d.revenuecat(d.env);
  const alerts: Record<string, unknown> = {};
  const errors: string[] = [];
  const note = (where: string, e: unknown) =>
    errors.push(`${where}: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);

  const sweep = await db.rpc<SweepResult>("referral_svc_sweep", {});
  const plan = await db.rpc<
    {
      worker_batch: number;
      worker_time_budget_seconds: number;
      entitlement_id: string | null;
      banked_check_due: boolean;
    }
  >("referral_svc_worker_plan", {});
  const deadline = started + plan.worker_time_budget_seconds * 1000;
  for (const [k, v] of Object.entries(sweep.alerts ?? {})) if (v !== 0 && v !== false && v !== null) alerts[k] = v;

  // Events: retry received/failed ones, fill missing starts.
  const pending = await db.rpc<{ run: string[]; need_start: NeedStart[]; failed_for_owner: number }>(
    "referral_svc_pending_events",
    { max_rows: 50 },
  );
  const events: Record<string, number> = {};
  const count = (r: ProcessResult) => (events[r.status] = (events[r.status] ?? 0) + 1);
  const eventsAlert: string[] = [];
  for (const id of pending.run) {
    if (d.now() >= deadline) break;
    const r = await processEvent(db, id);
    count(r);
    if (r.status === "failed" && r.mark === "alert_owner") eventsAlert.push(id);
  }
  let startsFilled = 0;
  let startsMissing = 0;
  for (const need of pending.need_start) {
    if (d.now() >= deadline) break;
    let start: number | null = null;
    try {
      for (const uid of need.app_user_ids) {
        start = findStart(await listSubsOrEmpty(rc, uid), need);
        if (start !== null) break;
      }
    } catch (e) {
      note("need_start", e);
      continue;
    }
    if (start === null) {
      startsMissing++;
      continue;
    }
    await db.rpc<number>("referral_svc_fill_start", {
      original_transaction_id: need.original_transaction_id,
      starts_at_ms: start,
    });
    startsFilled++;
    for (const id of need.event_ids) {
      if (d.now() >= deadline) break;
      count(await processEvent(db, id));
    }
  }

  // Daily: release banked days of anyone with no active store subscription for that entitlement (a missed
  // EXPIRATION webhook). Per entitlement: a rule's params.entitlement_id may name another one than settings.
  let bankedReleased = 0;
  if (plan.banked_check_due) {
    const ids = new Map<string, string | null>();
    for (const b of bankedPairs(sweep, plan.entitlement_id)) {
      if (d.now() >= deadline || !UUID.test(b.user_id)) continue;
      try {
        const subs = await listSubsOrEmpty(rc, b.user_id);
        const release: string[] = [];
        for (const key of b.entitlement_ids ?? []) {
          if (!ids.has(key)) ids.set(key, await rc.entitlementIdFor(key));
          const entId = ids.get(key)!;
          if (entId === null) {
            note("banked_check", new Error("unknown entitlement lookup key"));
            continue;
          }
          try {
            if (!(await activeStoreSubscription(rc, subs, key, entId))) release.push(key);
          } catch (e) {
            if (!(e instanceof EntitlementsUnknown)) throw e;
            note("banked_check", e); // unsure: keep the days banked, look again tomorrow
          }
        }
        if (release.length > 0) {
          bankedReleased += await db.rpc<number>("referral_svc_release_banked_keys", {
            user_id: b.user_id,
            entitlement_ids: release,
          }) ?? 0;
        }
      } catch (e) {
        note("banked_check", e);
      }
    }
  }

  const grants: RunGrantsSummary = await runGrants(db, rc, {
    batch: plan.worker_batch,
    deadlineMs: deadline,
    now: d.now,
    ...d.grant,
  });

  if (pending.failed_for_owner > 0) alerts.failed_events_total = pending.failed_for_owner;
  if (eventsAlert.length > 0) alerts.events_failed_now = eventsAlert.length;
  if (grants.cap_reached) alerts.daily_cap_reached = true;
  if (grants.results.some((r) => r.state === "failed")) {
    alerts.rewards_failed_now = grants.results.filter((r) => r.state === "failed").length;
  }
  // Still-waiting starts are reported in the summary only; the sweep alerts once when it gives one up
  // (`starts_given_up`, copied from sweep.alerts above).
  if (errors.length > 0) alerts.errors = errors.length;
  if (Object.keys(alerts).length > 0) {
    d.log(JSON.stringify({ level: "alert", source: "referral-worker", alerts }));
  }

  return json(200, {
    sweep: {
      leases_released: sweep.leases_released ?? 0,
      activated_or_expired: sweep.activated_or_expired ?? 0,
      events_purged: sweep.events_purged ?? 0,
    },
    events,
    starts: { filled: startsFilled, not_found: startsMissing, given_up: sweep.starts_given_up ?? 0 },
    banked: { checked: plan.banked_check_due, released: bankedReleased },
    grants: { claimed: grants.claimed, outcomes: grants.outcomes, cap_reached: grants.cap_reached },
    alerts,
    errors,
    ms: d.now() - started,
  });
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const d = {
    env: deps.env,
    db: deps.db ?? defaultDb,
    revenuecat: deps.revenuecat ?? defaultRc,
    now: deps.now ?? Date.now,
    waitUntil: deps.waitUntil === undefined ? defaultWaitUntil() : deps.waitUntil,
    grant: deps.grant,
    log: deps.log ?? ((l: string) => console.log(l)),
  };
  return async (req: Request) => {
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    const route = path.endsWith("/webhook") ? "webhook" : path.endsWith("/worker") ? "worker" : null;
    if (route === null) return json(404, { error: "not found" });
    if (req.method !== "POST") return json(405, { error: "method not allowed" });
    try {
      return route === "webhook" ? await webhook(req, d) : await worker(req, d);
    } catch (e) {
      d.log(JSON.stringify({
        level: "error",
        source: `referral-${route}`,
        msg: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      }));
      return json(500, { error: "internal error" });
    }
  };
}

if (import.meta.main) {
  Deno.serve(createHandler({ env: (n) => Deno.env.get(n) }));
}
