// deno test web/rewards-admin/ — the Referrals section's helpers and the demo's referral functions (migration 21 shapes).
import { reasonText, referralFunnel, referralListArgs, referralState, rewardChip, rewardLine } from "./lib.js";
import { createDemoBackend } from "./demo.js";

const eq = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg ?? "not equal"}\n  actual:   ${JSON.stringify(a)}\n  expected: ${JSON.stringify(b)}`);
  }
};
const ok = (v, msg) => {
  if (!v) throw new Error(msg ?? "expected true");
};

Deno.test("referral errors read as sentences", () => {
  ok(reasonText(new Error("referral: not_admin")).includes("not an admin"));
  eq(reasonText(new Error("referral: brand_new")), "referral: brand_new");
  ok(
    reasonText(new Error("PGRST202 Could not find the function public.referral_admin_overview")).includes(
      "migration 21",
    ),
  );
  ok(
    reasonText(new Error("PGRST202 Could not find the function public.rewards_admin_log")).includes(
      "rewards functions",
    ),
  );
});

Deno.test("states and reward chips", () => {
  eq(referralState("claimed").label, "Used the code");
  eq(referralState("claimed").kind, "warn");
  eq(referralState("something_new").label, "something_new", "an unknown state still shows");
  eq(rewardChip("granted"), "ok");
  eq(rewardChip("failed_retryable"), "bad");
  eq(rewardChip("queued"), "warn");
  eq(rewardChip("skipped_cap"), "off");
  eq(
    rewardLine({ who: "sharer", event: "joined", kind: "ai_credits", amount: 20 }),
    "20 ai credits to the sharer (joined)",
  );
});

Deno.test("funnel rates, never dividing by zero", () => {
  const f = referralFunnel({ totals: { claimed_in_window: 10, joined_in_window: 4, paid_in_window: 1 } });
  eq(f.map((s) => s.n), [10, 4, 1]);
  eq(f.map((s) => s.rate), [null, 0.4, 0.25]);
  eq(referralFunnel({}).map((s) => s.rate), [null, null, null]);
});

Deno.test("list arguments: blank filters are left out, the cursor is passed whole", () => {
  eq(referralListArgs({ state: "", search: "  " }), { max_rows: 50 });
  eq(referralListArgs({ state: "claimed", search: " ben@ ", cursor: { before: "t", before_id: "i" } }), {
    max_rows: 50,
    state: "claimed",
    search: "ben@",
    before: "t",
    before_id: "i",
  });
});

Deno.test("demo: overview, list, search, paging, person, problems, retry, log", async () => {
  const { rpc } = createDemoBackend();
  const o = await rpc("referral_admin_overview", { days: 7 });
  eq(o.daily.length, 7);
  ok(o.totals.referrals === 6 && o.referrals_by_state.claimed === 2, "six referrals, two waiting");
  ok(o.top_sharers[0].sharer.email === "asha@example.com" && o.top_sharers[0].waiting === 1, "top sharer");
  ok(o.totals.problem_rewards === 1, "one failing reward");

  const all = await rpc("referral_admin_referrals", { max_rows: 50 });
  eq(all.rows.length, 6);
  ok(all.rows.every((r) => r.sharer?.email && "rewards" in r), "both people and rewards on every row");
  eq((await rpc("referral_admin_referrals", { search: "farah" })).rows.map((r) => r.friend.email), [
    "farah@example.com",
  ]);
  eq((await rpc("referral_admin_referrals", { state: "claimed" })).rows.length, 2);
  const p1 = await rpc("referral_admin_referrals", { max_rows: 4 });
  const p2 = await rpc("referral_admin_referrals", {
    max_rows: 4,
    before: p1.next_before,
    before_id: p1.next_before_id,
  });
  eq(p1.rows.length + p2.rows.length, 6, "two pages cover every row once");
  ok(!p2.next_before, "no third page");

  const u = await rpc("referral_admin_user", { query: "K7QM-4TRP" });
  ok(u.found && u.user.email === "asha@example.com" && u.invited.length === 4, "person by code");
  eq(u.stats.claimed_count, 1);
  eq((await rpc("referral_admin_user", { query: "ben@example.com" })).invited_by.sharer.email, "asha@example.com");
  eq((await rpc("referral_admin_user", { query: "nobody@example.com" })).found, false);

  const problems = await rpc("referral_admin_rewards", {});
  eq(problems.length, 1);
  const r = await rpc("referral_admin_retry_reward", { reward_id: problems[0].id });
  ok(r.ok && r.result === "granted", "retry grants");
  eq((await rpc("referral_admin_retry_reward", { reward_id: problems[0].id })).reason, "not_failed");
  eq((await rpc("referral_admin_rewards", {})).length, 0);
  eq((await rpc("referral_admin_log", {}))[0].action, "retry_reward");
});
