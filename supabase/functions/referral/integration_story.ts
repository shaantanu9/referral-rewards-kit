// Integration story against a real local Postgres (run by scripts/test-function.sh, which starts the database,
// applies the Supabase stub and every migration, and cleans up). Not picked up by a plain `deno test`.
//
// The Db adapter runs each `referral_svc_*` call through psql as `service_role`, the same role PostgREST uses with
// the service key, so the privileges are exercised too. RevenueCat is the in-memory fake.
//
// Story: claim → activation → INITIAL_PURCHASE webhook → hold passes → worker grants → refund webhook after the
// grant gives `refunded_late` and a `late_refund` abuse mark.

import assert from "./test_assert.ts";
import type { Db } from "./db.ts";
import { createHandler } from "./index.ts";
import { FakeRevenueCat, signedRequest, storeSub } from "./test_fakes.ts";

const PGBIN = Deno.env.get("PGBIN") ?? "/opt/homebrew/opt/postgresql@17/bin";
const PORT = Deno.env.get("PGTEST_PORT") ?? "54330";

async function psql(sql: string, vars: Record<string, string> = {}): Promise<string> {
  const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "localhost", "-p", PORT];
  args.push("-U", "referral_admin", "-d", "referral_test");
  for (const [k, v] of Object.entries(vars)) args.push("-v", `${k}=${v}`);
  const p = new Deno.Command(`${PGBIN}/psql`, { args, stdin: "piped", stdout: "piped", stderr: "piped" }).spawn();
  const w = p.stdin.getWriter();
  await w.write(new TextEncoder().encode(sql));
  await w.close();
  const out = await p.output();
  if (!out.success) throw new Error(`psql: ${new TextDecoder().decode(out.stderr).trim()}`);
  return new TextDecoder().decode(out.stdout).trim();
}

function pgArrayLiteral(xs: unknown[]): string {
  return `{${xs.map((x) => `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

/** A Db that calls the wrappers as service_role through psql, with every parameter bound by name. */
function psqlDb(): Db {
  return {
    async rpc<T>(fn: string, params: Record<string, unknown> = {}): Promise<T> {
      if (!/^referral_svc_[a-z_]+$/.test(fn)) throw new Error(`not a service function: ${fn}`);
      const vars: Record<string, string> = {};
      const named: string[] = [];
      Object.entries(params).forEach(([k, v], i) => {
        if (!/^[a-z_]+$/.test(k)) throw new Error(`bad parameter name ${k}`);
        if (v === null || v === undefined) return named.push(`${k} => null`);
        vars[`p${i}`] = Array.isArray(v) ? pgArrayLiteral(v) : typeof v === "object" ? JSON.stringify(v) : String(v);
        named.push(`${k} => :'p${i}'`);
      });
      const out = await psql(
        `set role service_role;\nselect coalesce(to_jsonb(public.${fn}(${named.join(", ")}))::text, 'null');\n`,
        vars,
      );
      return JSON.parse(out) as T;
    },
  };
}

const ENV: Record<string, string> = {
  REFERRAL_WEBHOOK_TOKEN: "test-webhook-token-not-real",
  REVENUECAT_WEBHOOK_SIGNING_SECRET: "test-signing-secret-not-real",
  REFERRAL_WORKER_SECRET: "test-worker-secret-not-real",
  REVENUECAT_SECRET_KEY: "test-revenuecat-key-not-real",
  REVENUECAT_PROJECT_ID: "proj_test",
  SUPABASE_URL: "http://unused.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "unused",
};
const URL_BASE = "http://localhost/functions/v1/referral";

Deno.test("integration: claim → activation → purchase → hold → grant → late refund", async () => {
  const sharer = crypto.randomUUID();
  const friend = crypto.randomUUID();
  const db = psqlDb();
  const rc = new FakeRevenueCat();
  const pending: Promise<unknown>[] = [];
  const logs: string[] = [];
  const handler = createHandler({
    env: (n) => ENV[n],
    db: () => db,
    revenuecat: () => rc,
    waitUntil: (p) => void pending.push(p),
    grant: { sleep: () => Promise.resolve(), verifyDelayMs: 0 },
    log: (l) => void logs.push(l),
  });
  const q = (sql: string) => psql(sql);

  // the app's setup: verified users, the paid rule, an activity hook that says "active"
  await q(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${sharer}', 'sharer@example.test', now() - interval '1 hour'),
      ('${friend}', 'friend@example.test', now() - interval '1 hour');
    update referral.settings set entitlement_id = 'premium';
    insert into referral.rules (version, event, who, kind, amount, params)
      values (1, 'paid', 'sharer', 'entitlement_days', 5, '{"entitlement_id":"premium"}');
    create or replace function referral_app.app_referral_is_active(user_id uuid) returns boolean
      language sql stable security definer set search_path = '' as $$ select true $$;
    revoke execute on function referral_app.app_referral_is_active(uuid) from public;`);

  // 1. claim
  const code = await q(`select referral.my_code('${sharer}', 'install-sharer-0001') ->> 'code'`);
  assert.ok(code.length > 0, "sharer has a code");
  assert.equal(await q(`select referral.claim('${friend}', '${code}', 'install-friend-0001') ->> 'reason'`), "ok");

  // 2. activation
  assert.equal(await q(`select referral.check_activation('${friend}')`), "joined");

  // 3. INITIAL_PURCHASE webhook
  const purchasedAt = Date.now() + 2000;
  const purchase = {
    api_version: "1.0",
    event: {
      id: `EVT-STORY-${friend}`,
      type: "INITIAL_PURCHASE",
      event_timestamp_ms: purchasedAt,
      app_user_id: friend,
      original_app_user_id: friend,
      aliases: [friend],
      original_transaction_id: "2000000000009001",
      transaction_id: "2000000000009001",
      product_id: "premium_monthly",
      entitlement_ids: ["premium"],
      period_type: "NORMAL",
      price: 4.99,
      store: "APP_STORE",
      environment: "PRODUCTION",
      purchased_at_ms: purchasedAt,
      is_family_share: false,
      subscriber_attributes: { $email: { value: "friend@example.test" } },
    },
  };
  const send = async (body: unknown) => {
    const raw = JSON.stringify(body);
    const res = await handler(
      await signedRequest(`${URL_BASE}/webhook`, raw, {
        token: ENV.REFERRAL_WEBHOOK_TOKEN,
        secret: ENV.REVENUECAT_WEBHOOK_SIGNING_SECRET,
        t: Math.floor(Date.now() / 1000),
      }),
    );
    await Promise.all(pending.splice(0));
    return res;
  };
  let res = await send(purchase);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "stored" });
  assert.equal(await q(`select state from referral.events where event_id = 'EVT-STORY-${friend}'`), "processed");
  assert.equal(await q(`select state from referral.referrals where friend_id = '${friend}'`), "paid");
  assert.equal(
    await q(`select w.state from referral.rewards w join referral.referrals r on r.id = w.referral_id
             where r.friend_id = '${friend}' and w.event = 'paid'`),
    "queued",
  );
  assert.equal(await q(`select count(*) from referral.events where fields::text like '%example.test%'`), "0");
  res = await send(purchase);
  assert.deepEqual(await res.json(), { status: "duplicate" }, "a replay is a duplicate");

  // 4. the hold passes
  await q(`update referral.rewards set available_at = now() - interval '1 second' where event = 'paid'`);

  // 5. the worker grants against the fake RevenueCat (sharer unknown there → created)
  rc.add(friend, {
    subs: [storeSub({ store_subscription_identifier: "2000000000009001", starts_at: purchasedAt })],
  });
  res = await handler(
    new Request(`${URL_BASE}/worker`, {
      method: "POST",
      headers: { "X-Referral-Worker-Secret": ENV.REFERRAL_WORKER_SECRET },
    }),
  );
  assert.equal(res.status, 200);
  const summary = await res.json();
  assert.deepEqual(summary.grants.outcomes, { granted: 1 }, JSON.stringify(summary));
  assert.ok(rc.calls.includes(`create:${sharer}`), "sharer created in RevenueCat on 404");
  const target = Number(
    await q(`select (extract(epoch from target_expires_at) * 1000)::bigint from referral.rewards where event = 'paid'`),
  );
  assert.equal(rc.customers.get(sharer)!.active.get("entl_premium"), target, "RevenueCat holds the stored target");
  assert.ok(Math.abs(target - (Date.now() + 5 * 86_400_000)) < 120_000, "target ≈ now + 5 days");
  assert.equal(await q(`select state from referral.rewards where event = 'paid'`), "granted");

  // 6. refund after the grant → refunded_late + late_refund mark
  const refund = structuredClone(purchase);
  Object.assign(refund.event, {
    id: `EVT-STORY-REFUND-${friend}`,
    type: "CANCELLATION",
    cancel_reason: "CUSTOMER_SUPPORT",
    price: -4.99,
    event_timestamp_ms: Date.now() + 5000,
  });
  res = await send(refund);
  assert.equal(res.status, 200);
  assert.equal(await q(`select state from referral.referrals where friend_id = '${friend}'`), "refunded_late");
  assert.equal(
    await q(`select string_agg(cause, ',') from referral.abuse_marks where user_id = '${sharer}'`),
    "late_refund",
  );
  assert.equal(
    await q(`select refunded_at is not null from referral.transactions t
             join referral.referrals r on r.original_transaction_id_hash = t.original_transaction_id_hash
             where r.friend_id = '${friend}'`),
    "t",
  );
  assert.equal(await q(`select state from referral.rewards where event = 'paid'`), "granted", "no clawback");
  assert.ok(!logs.some((l) => l.includes('"error"')), logs.join("\n"));
});
