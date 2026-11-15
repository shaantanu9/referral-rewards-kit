// Integration story for the rewards Edge Function against a real local Postgres (run by
// scripts/test-rewards-function.sh, which starts the database, applies the Supabase stub and every migration, and
// cleans up). Not picked up by a plain `deno test` (the name does not end in _test.ts).
//
// The Db adapter runs each `rewards_svc_*` call through psql as `service_role`, the role PostgREST uses with the
// service key, so the privileges are exercised too. RevenueCat is the in-memory fake from ../referral/test_fakes.ts.
// (Same adapter idea as ../referral/integration_story.ts, which keeps its helpers private.)
//
// Story: a lesson with 4 correct answers → a streak pays entitlement_days (queued for the worker) and a score-scaled
// milestone pays coins through the app hook, which is down → /worker retries the coins through the hook and grants
// the days in RevenueCat → an admin's manual entitlement_days goes through the next /worker run → a third run finds
// nothing to do.

import assert from "../referral/test_assert.ts";
import { FakeRevenueCat } from "../referral/test_fakes.ts";
import type { Db } from "./db.ts";
import type { RcCurrency } from "./currency.ts";
import { createHandler } from "./index.ts";

const PGBIN = Deno.env.get("PGBIN") ?? "/opt/homebrew/opt/postgresql@17/bin";
const PORT = Deno.env.get("PGTEST_PORT") ?? "54331";

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

/** A Db that calls the wrappers as service_role through psql, with every parameter bound by name. */
function psqlDb(): Db {
  return {
    async rpc<T>(fn: string, params: Record<string, unknown> = {}): Promise<T> {
      if (!/^rewards_svc_[a-z_]+$/.test(fn)) throw new Error(`not a service function: ${fn}`);
      const vars: Record<string, string> = {};
      const named: string[] = [];
      Object.entries(params).forEach(([k, v], i) => {
        if (!/^[a-z_]+$/.test(k)) throw new Error(`bad parameter name ${k}`);
        if (v === null || v === undefined) return named.push(`${k} => null`);
        vars[`p${i}`] = typeof v === "object" ? JSON.stringify(v) : String(v);
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
  REWARDS_WORKER_SECRET: "test-worker-secret-not-real",
  REVENUECAT_SECRET_KEY: "test-revenuecat-key-not-real",
  REVENUECAT_PROJECT_ID: "proj_test",
  SUPABASE_URL: "http://unused.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "unused",
};
const URL_BASE = "http://localhost/functions/v1/rewards";
const DAY = 86_400_000;

const unused = () => Promise.reject(new Error("no rc_currency in this story"));
const noCurrency: RcCurrency = { add: unused, createCustomer: unused };

Deno.test("integration: lesson → scaled coins via the hook + entitlement_days via /worker → manual grant", async () => {
  const user = crypto.randomUUID();
  const admin = crypto.randomUUID();
  const rc = new FakeRevenueCat();
  const logs: string[] = [];
  const handler = createHandler({
    env: (n) => ENV[n],
    db: () => psqlDb(),
    revenuecat: () => rc,
    currency: () => noCurrency,
    grant: { sleep: () => Promise.resolve(), verifyDelayMs: 0 },
    log: (l) => void logs.push(l),
  });
  const q = (sql: string) => psql(sql);
  const worker = async () => {
    const res = await handler(
      new Request(`${URL_BASE}/worker`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ENV.REWARDS_WORKER_SECRET}` },
      }),
    );
    assert.equal(res.status, 200);
    return await res.json();
  };

  // the app's setup: a coins ledger behind the grant hook (down for now), a streak paying days, a scored milestone
  await q(`
    insert into auth.users (id, email) values ('${user}', 'reader@example.test'), ('${admin}', 'admin@example.test');
    insert into rewards.admins (user_id) values ('${admin}');
    create table public.app_coins (grant_id uuid primary key, user_id uuid not null, amount numeric not null);
    create table public.app_hook_down (down boolean primary key);
    insert into public.app_hook_down values (true);
    -- the hook keeps its owner (postgres, from the migration) through create or replace
    grant select, insert on public.app_coins to postgres;
    grant select on public.app_hook_down to postgres;
    create or replace function rewards_app.app_reward_grant(grant_id uuid, user_id uuid, kind text, amount numeric,
      params jsonb) returns void language plpgsql security definer set search_path = '' as $$
    begin
      if exists (select 1 from public.app_hook_down) then raise exception 'ledger offline'; end if;
      insert into public.app_coins values (grant_id, user_id, amount) on conflict do nothing;
    end $$;
    revoke execute on function rewards_app.app_reward_grant(uuid, uuid, text, numeric, jsonb)
      from public, anon, authenticated, service_role;
    insert into rewards.event_types (name, source, daily_limit) values ('lesson_done', 'client', 100);
    insert into rewards.programs (key, kind, config) values
      ('daily', 'streak', '{"event":"lesson_done"}'), ('lessons', 'milestone', '{"event":"lesson_done"}');
    insert into rewards.rules (program_key, threshold, kind, amount, params) values
      ('daily', 1, 'entitlement_days', 3, '{"entitlement_id":"premium"}'),
      ('lessons', 1, 'coins', 2, '{"amount_from":"correct","amount_max":50}');`);

  // 1. the lesson (as the app's rewards_track would): days queued, coins failed in the hook
  await q(`select rewards.track('${user}', 'lesson_done', 'lesson-1', '{"correct":4}', 'UTC', false)`);
  const states = () =>
    q(`select string_agg(kind || '=' || state || ':' || amount, ',' order by kind) from rewards.grants
       where user_id = '${user}'`);
  assert.equal(await states(), "coins=failed_retryable:8,entitlement_days=queued:3");
  assert.equal(
    await q(`select last_error from rewards.grants where user_id = '${user}' and kind = 'coins'`),
    "ledger offline",
  );

  // 2. the hook is back; the worker retries the coins through it and grants the days in RevenueCat (user created)
  await q(`delete from public.app_hook_down`);
  const first = await worker();
  const errs = await q(`select string_agg(kind || ' ' || state || ' ' || coalesce(last_error, '-'), '; ')
                        from rewards.grants where user_id = '${user}'`);
  assert.equal(first.local_granted, 1, JSON.stringify(first) + " " + errs);
  assert.deepEqual(first.outcomes, { granted: 1 }, JSON.stringify(first));
  assert.equal(await states(), "coins=granted:8,entitlement_days=granted:3");
  assert.equal(await q(`select amount from public.app_coins where user_id = '${user}'`), "8", "4 correct x 2 coins");
  assert.ok(rc.calls.includes(`create:${user}`), "customer created in RevenueCat on 404");
  const after3 = rc.customers.get(user)!.active.get("entl_premium")!;
  assert.ok(Math.abs(after3 - (Date.now() + 3 * DAY)) < 120_000, "premium until ≈ now + 3 days");
  assert.equal(
    Number(
      await q(
        `select target_expires_at_ms from rewards.grants where user_id = '${user}' and kind = 'entitlement_days'`,
      ),
    ),
    after3,
    "RevenueCat holds the stored target",
  );

  // 3. an admin compensates two days by hand: the next worker run grants them on top
  const manual = JSON.parse(
    await q(`begin;
      select tests.act_as('authenticated', '${admin}');
      select public.rewards_admin_grant('${user}', 'entitlement_days', 2, '{"entitlement_id":"premium"}',
                                        'Story: missed days')::text;
      commit;`),
  );
  assert.equal(manual.state, "queued");
  assert.ok(String(manual.grant_key).startsWith("admin/"));
  const second = await worker();
  assert.deepEqual(second.outcomes, { granted: 1 }, JSON.stringify(second));
  assert.equal(await q(`select state from rewards.grants where id = '${manual.id}'`), "granted");
  const after5 = rc.customers.get(user)!.active.get("entl_premium")!;
  assert.ok(Math.abs(after5 - (after3 + 2 * DAY)) < 120_000, "two more days on top of the first three");

  // 4. nothing left: a third run claims nothing and RevenueCat is not called again
  const calls = rc.calls.length;
  const third = await worker();
  assert.deepEqual([third.local_granted, third.claimed], [0, 0], JSON.stringify(third));
  assert.equal(rc.calls.length, calls, "no RevenueCat call when nothing is due");
  assert.equal(await q(`select count(*) from rewards.admin_log where action = 'grant'`), "1");
  assert.ok(!logs.some((l) => l.includes('"error"')), logs.join("\n"));
});
