// rewards Edge Function (ADR 0002 section 10). Deployed with --no-verify-jwt; each route authenticates itself.
//   POST …/worker     pg_cron every 15 min: Authorization: Bearer <REWARDS_WORKER_SECRET>. Retries local grants,
//                     expires stale social posts (and purges old events), grants entitlement_days through RevenueCat.
//   GET  …/instagram  Meta webhook verification (hub.challenge).
//   POST …/instagram  Meta webhook: X-Hub-Signature-256, then each mention → rewards_svc_verify_social.
//   POST …/revenuecat RevenueCat webhook (a second integration): Authorization = REWARDS_RC_WEBHOOK_TOKEN (raw or
//                     Bearer), X-RevenueCat-Webhook-Signature when REWARDS_RC_SIGNING_SECRET is set. Ad rewards →
//                     rewards_svc_ad_reward; other events → rewards_svc_rc_event (ADR 0002 18.5).
//   POST …/followups  daily cron, worker bearer: follow-up emails through Resend (dry run unless REWARDS_EMAIL_DRY_RUN=false).
//   GET|POST …/unsubscribe?t=…  one-click unsubscribe (GET shows a button; POST unsubscribes) (ADR 0002 18.7).
// Anything else: 404 (unknown path) or 405 (known path, other method). Missing configuration: 503.

import { safeEqual } from "../referral/index.ts";
import { fetchRevenueCat, type RevenueCat } from "../referral/revenuecat.ts";
import { verifySignature } from "../referral/logic.ts";
import { fetchCurrency, type RcCurrency } from "./currency.ts";
import { rcAction } from "./rc_webhook.ts";
import { type Mailer, resendMailer, runFollowups, unsubscribe } from "./followups.ts";
import { type Db, rewardsDb, RPC, type VerifySocialResult } from "./db.ts";
import { runGrants, type RunGrantsSummary } from "./grant.ts";
import { fetchGraphApi, type GraphApi, parseMentions, resolveItem, verifyHubSignature } from "./instagram.ts";

export interface Deps {
  env: (name: string) => string | undefined;
  db?: (env: Deps["env"]) => Db;
  revenuecat?: (env: Deps["env"]) => RevenueCat;
  graph?: (env: Deps["env"]) => GraphApi;
  currency?: (env: Deps["env"]) => RcCurrency;
  /** Null when no Resend key: the follow-up run is then a dry run. */
  mailer?: (env: Deps["env"]) => Mailer | null;
  now?: () => number;
  grant?: { sleep?: (ms: number) => Promise<void>; verifyDelayMs?: number };
  log?: (line: string) => void;
}

type D = Required<Omit<Deps, "grant">> & Pick<Deps, "grant">;

const MAX_BODY_BYTES = 256 * 1024;
/** The worker stops starting grants after this long, well inside the Edge Function wall-clock limit. */
export const WORKER_BUDGET_MS = 100_000;
export const WORKER_BATCH = 20;
export const WORKER_MAX = 200;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const DB_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const WORKER_ENV = ["REWARDS_WORKER_SECRET", "REVENUECAT_SECRET_KEY", "REVENUECAT_PROJECT_ID", ...DB_ENV];
const INSTAGRAM_ENV = ["INSTAGRAM_VERIFY_TOKEN", "INSTAGRAM_APP_SECRET", "INSTAGRAM_ACCESS_TOKEN", ...DB_ENV];
const RC_ENV = ["REWARDS_RC_WEBHOOK_TOKEN", ...DB_ENV];
const FOLLOWUP_ENV = ["REWARDS_WORKER_SECRET", ...DB_ENV];

const missing = (env: Deps["env"], names: string[]) => names.some((n) => !env(n));

async function worker(req: Request, d: D): Promise<Response> {
  if (missing(d.env, WORKER_ENV)) return json(503, { error: "not configured" });
  const auth = req.headers.get("Authorization");
  if (auth === null || !(await safeEqual(auth, `Bearer ${d.env("REWARDS_WORKER_SECRET")!}`))) {
    return json(401, { error: "unauthorized" });
  }
  const started = d.now();
  const db = d.db(d.env);
  const local = await db.rpc<number>(RPC.retryLocal, {});
  const expired = await db.rpc<number>(RPC.expireSocial, {});
  const grants: RunGrantsSummary = await runGrants(db, d.revenuecat(d.env), {
    batch: WORKER_BATCH,
    max: WORKER_MAX,
    deadlineMs: started + WORKER_BUDGET_MS,
    now: d.now,
    sleep: d.grant?.sleep,
    verifyDelayMs: d.grant?.verifyDelayMs,
    currency: d.currency(d.env),
  });
  const summary = { local_granted: local, social_expired: expired, claimed: grants.claimed, outcomes: grants.outcomes };
  d.log(JSON.stringify({ level: "info", source: "rewards-worker", ...summary }));
  return json(200, summary);
}

function challenge(req: Request, d: D): Response {
  if (!d.env("INSTAGRAM_VERIFY_TOKEN")) return json(503, { error: "not configured" });
  const q = new URL(req.url).searchParams;
  // A plain comparison is fine here: the verify token only proves the subscription request is ours, and Meta sends
  // it once at setup. Still compared by value, never logged.
  if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === d.env("INSTAGRAM_VERIFY_TOKEN")) {
    return new Response(q.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return json(403, { error: "forbidden" });
}

export interface InstagramSummary {
  items: number;
  dropped: number;
  matched: number;
  unmatched: number;
  failed: number;
}

async function instagram(req: Request, d: D): Promise<Response> {
  if (missing(d.env, INSTAGRAM_ENV)) return json(503, { error: "not configured" });
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: "too large" });
  if (!(await verifyHubSignature(raw, req.headers.get("X-Hub-Signature-256"), d.env("INSTAGRAM_APP_SECRET")!))) {
    return json(401, { error: "unauthorized" });
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return json(400, { error: "invalid json" });
  }
  const { items, dropped } = parseMentions(body);
  const out: InstagramSummary = { items: items.length, dropped, matched: 0, unmatched: 0, failed: 0 };
  const db = d.db(d.env);
  const graph = d.graph(d.env);
  for (const item of items) {
    try {
      const args = await resolveItem(graph, item);
      if (args === null) {
        out.unmatched++;
        continue;
      }
      const r = await db.rpc<VerifySocialResult | null>(RPC.verifySocial, { ...args });
      if (r?.matched) out.matched++;
      else out.unmatched++;
    } catch (e) {
      out.failed++;
      // Never the token, username or caption: only which step failed.
      d.log(JSON.stringify({
        level: "warn",
        source: "rewards-instagram",
        kind: item.kind,
        msg: (e instanceof Error ? e.name + ": " + e.message : String(e)).slice(0, 120),
      }));
    }
  }
  d.log(JSON.stringify({ level: "info", source: "rewards-instagram", ...out }));
  // Always 200 after a valid signature: Meta retries non-2xx, and a retry cannot fix a failed lookup.
  return json(200, out);
}

async function revenuecat(req: Request, d: D): Promise<Response> {
  if (missing(d.env, RC_ENV)) return json(503, { error: "not configured" });
  const token = d.env("REWARDS_RC_WEBHOOK_TOKEN")!;
  const auth = req.headers.get("Authorization") ?? "";
  const tokenOk = (await safeEqual(auth, token)) || (await safeEqual(auth, `Bearer ${token}`));
  if (!tokenOk) return json(401, { error: "unauthorized" });
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: "too large" });
  const secret = d.env("REWARDS_RC_SIGNING_SECRET");
  if (secret) {
    const sig = req.headers.get("X-RevenueCat-Webhook-Signature");
    if (sig === null || !(await verifySignature(raw, sig, secret, d.now())).ok) {
      return json(401, { error: "unauthorized" });
    }
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return json(400, { error: "invalid json" });
  }
  const a = rcAction(body);
  if (a.kind === "skip") return json(200, { status: "ignored", reason: a.reason });
  const db = d.db(d.env);
  // A database error is a 500 so RevenueCat retries; effects are idempotent (the event id is the dedupe key).
  const r = a.kind === "ad"
    ? await db.rpc<Record<string, unknown>>(RPC.adReward, {
      user_id: a.userId,
      ad_transaction_id: a.adTransactionId,
      currency: a.currency,
      amount: a.amount,
      event_id: a.eventId,
    })
    : await db.rpc<Record<string, unknown>>(RPC.rcEvent, {
      user_id: a.userId,
      event_type: a.type,
      event_id: a.eventId,
      props: a.props,
    });
  const tracked = r?.tracked === true;
  d.log(
    JSON.stringify({ level: "info", source: "rewards-revenuecat", kind: a.kind, tracked, reason: r?.reason ?? null }),
  );
  return json(200, { status: tracked ? "tracked" : "ignored", reason: r?.reason ?? null });
}

async function followups(req: Request, d: D): Promise<Response> {
  if (missing(d.env, FOLLOWUP_ENV)) return json(503, { error: "not configured" });
  const auth = req.headers.get("Authorization");
  if (auth === null || !(await safeEqual(auth, `Bearer ${d.env("REWARDS_WORKER_SECRET")!}`))) {
    return json(401, { error: "unauthorized" });
  }
  const mailer = d.mailer(d.env);
  // Dry run unless explicitly switched off AND a mailer exists.
  const dryRun = d.env("REWARDS_EMAIL_DRY_RUN") !== "false" || mailer === null;
  const r = await runFollowups(d.db(d.env), mailer, {
    dryRun,
    appName: d.env("REWARDS_APP_NAME") ?? "the app",
    publicUrl: d.env("REWARDS_PUBLIC_URL") ?? `${d.env("SUPABASE_URL")}/functions/v1/rewards`,
  });
  d.log(
    JSON.stringify({
      level: "info",
      source: "rewards-followups",
      dry_run: r.dryRun,
      claimed: r.claimed,
      sent: r.sent,
      failed: r.failed,
    }),
  );
  return json(200, r);
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const d: D = {
    env: deps.env,
    db: deps.db ??
      ((env) => rewardsDb({ url: env("SUPABASE_URL")!, serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY")! })),
    revenuecat: deps.revenuecat ??
      ((env) =>
        fetchRevenueCat({ secretKey: env("REVENUECAT_SECRET_KEY")!, projectId: env("REVENUECAT_PROJECT_ID")! })),
    graph: deps.graph ?? ((env) => fetchGraphApi({ accessToken: env("INSTAGRAM_ACCESS_TOKEN")! })),
    mailer: deps.mailer ??
      ((env) =>
        env("RESEND_API_KEY") && env("REWARDS_EMAIL_FROM")
          ? resendMailer({
            apiKey: env("RESEND_API_KEY")!,
            from: env("REWARDS_EMAIL_FROM")!,
            replyTo: env("REWARDS_EMAIL_REPLY_TO"),
          })
          : null),
    currency: deps.currency ??
      ((env) => fetchCurrency({ secretKey: env("REVENUECAT_SECRET_KEY")!, projectId: env("REVENUECAT_PROJECT_ID")! })),
    now: deps.now ?? Date.now,
    grant: deps.grant,
    log: deps.log ?? ((l: string) => console.log(l)),
  };
  return async (req: Request) => {
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    const route = path.endsWith("/worker")
      ? "worker"
      : path.endsWith("/instagram")
      ? "instagram"
      : path.endsWith("/revenuecat")
      ? "revenuecat"
      : path.endsWith("/followups")
      ? "followups"
      : path.endsWith("/unsubscribe")
      ? "unsubscribe"
      : null;
    if (route === null) return json(404, { error: "not found" });
    try {
      if (route === "worker") {
        return req.method === "POST" ? await worker(req, d) : json(405, { error: "method not allowed" });
      }
      if (route === "followups") {
        return req.method === "POST" ? await followups(req, d) : json(405, { error: "method not allowed" });
      }
      if (route === "unsubscribe") {
        if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "method not allowed" });
        if (missing(d.env, DB_ENV)) return json(503, { error: "not configured" });
        return await unsubscribe(req, d.db(d.env), d.env("REWARDS_APP_NAME") ?? "the app");
      }
      if (route === "revenuecat") {
        return req.method === "POST" ? await revenuecat(req, d) : json(405, { error: "method not allowed" });
      }
      if (req.method === "GET") return challenge(req, d);
      if (req.method === "POST") return await instagram(req, d);
      return json(405, { error: "method not allowed" });
    } catch (e) {
      d.log(JSON.stringify({
        level: "error",
        source: `rewards-${route}`,
        msg: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      }));
      return json(500, { error: "internal error" });
    }
  };
}

if (import.meta.main) {
  Deno.serve(createHandler({ env: (n) => Deno.env.get(n) }));
}
