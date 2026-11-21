// deno test web/rewards-admin/ — the Referrals section's helpers and the demo's referral functions (migration 21, 23
// and 24 shapes).
import { reasonText, referralFunnel, referralListArgs, referralState, rewardChip, rewardLine } from "./lib.js";
import {
  BOOST_REASONS,
  boostBudgetText,
  boostCreateArgs,
  boostEndQuestion,
  boostLine,
  boostReasonText,
  boostStatus,
  funnelDayRows,
  funnelOverall,
  funnelSteps,
  hoursText,
} from "./lib_growth.js";
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

// Funnel and boosts (migrations 23 and 24) ---------------------------------------------------------------------------

Deno.test("funnel: conversion steps, overall shares, day rows", () => {
  const f = {
    days: [
      { day: "2026-11-18", claimed: 0, joined: 0, paid: 0, expired: 0 },
      { day: "2026-11-19", claimed: 2, joined: 1, paid: 1, expired: 1 },
      { day: "2026-11-20", claimed: 4, joined: 1, paid: 0, expired: 0 },
    ],
    totals: { claimed: 6, joined: 2, paid: 1, expired: 1, boosted_rewards: 1 },
    median_hours_to_join: 15,
  };
  eq(funnelSteps(f).map((s) => [s.n, s.rate]), [[6, null], [2, 2 / 6], [1, 0.5]]);
  eq(funnelSteps({}).map((s) => s.rate), [null, null, null], "no division by zero");
  eq(funnelOverall(f), { paid: 1 / 6, expired: 1 / 6 });
  eq(funnelOverall({}), { paid: null, expired: null });
  const rows = funnelDayRows(f);
  eq(rows.map((r) => [r.day, r.width, r.joinedRate]), [["2026-11-20", 100, 0.25], ["2026-11-19", 50, 0.5]]);
  eq(funnelDayRows({ days: [] }), []);
  eq([hoursText(15), hoursText(26.5), hoursText(72), hoursText(null)], ["15.0 h", "26.5 h", "3.0 days", "–"]);
});

Deno.test("boosts: status, line, budget and reason texts", () => {
  eq(boostStatus("running"), { label: "Running", kind: "ok" });
  eq(boostStatus("scheduled").kind, "warn");
  eq(boostStatus("weird").label, "weird", "an unknown status still shows");
  eq(
    boostLine({ multiplier: 2, events: ["joined"], who: ["sharer", "friend"] }),
    "×2 for the sharer and friend when the friend starts",
  );
  eq(
    boostLine({ multiplier: 1.5, events: ["joined", "paid"], who: ["friend"] }),
    "×1.5 for the friend when the friend starts or subscribes",
  );
  eq(boostBudgetText({ boosted_rewards: 3, budget: 50 }), "3 of 50 used");
  eq(boostBudgetText({ boosted_rewards: 3, budget: null }), "3 (no limit)");
  for (const r of ["overlap", "starts_in_past", "too_long", "bad_multiplier", "not_found", "already_ended"]) {
    ok(BOOST_REASONS[r] && boostReasonText(r) === BOOST_REASONS[r], `a sentence for ${r}`);
  }
  eq(boostReasonText("brand_new"), "Not saved: brand_new");
  ok(boostEndQuestion({ status: "scheduled" }).includes("deletes it"));
  ok(boostEndQuestion({ status: "running" }).includes("cannot be undone"));
});

Deno.test("boosts: the create form is checked like the database", () => {
  const now = Date.parse("2026-11-20T10:00:00Z");
  const iso = (ms) => new Date(ms).toISOString();
  const H = 3_600_000;
  const base = {
    start: iso(now + H),
    end: iso(now + 7 * 24 * H),
    multiplier: "2",
    events: ["joined"],
    who: ["sharer"],
  };
  const good = boostCreateArgs(base, now);
  eq(good, {
    ok: true,
    args: {
      starts_at: iso(now + H),
      ends_at: iso(now + 7 * 24 * H),
      multiplier: 2,
      events: ["joined"],
      who: ["sharer"],
      budget: null,
    },
  });
  eq(boostCreateArgs({ ...base, budget: " 40 " }, now).args.budget, 40);
  eq(boostCreateArgs({ ...base, start: iso(now - 2 * 60_000) }, now).ok, true, "a start 2 minutes ago is now");
  const reason = (patch) => boostCreateArgs({ ...base, ...patch }, now).reason;
  eq(reason({ start: "" }), "missing");
  eq(reason({ multiplier: "" }), "missing");
  eq(reason({ start: iso(now - H) }), "starts_in_past");
  eq(reason({ end: iso(now + H) }), "ends_before_start");
  eq(reason({ end: iso(now + 40 * 24 * H) }), "too_long");
  eq(reason({ multiplier: "1" }), "bad_multiplier");
  eq(reason({ multiplier: "5.5" }), "bad_multiplier");
  eq(reason({ events: [] }), "bad_events");
  eq(reason({ events: ["signup"] }), "bad_events");
  eq(reason({ who: [] }), "bad_who");
  eq(reason({ budget: "-1" }), "bad_budget");
  eq(reason({ budget: "2.5" }), "bad_budget");
});

Deno.test("demo: funnel and boosts answer like the SQL", async () => {
  const { rpc } = createDemoBackend();
  const f = await rpc("referral_admin_funnel", { days: 30 });
  eq(f.days.length, 30);
  eq(f.totals, { claimed: 5, joined: 3, paid: 1, expired: 0, boosted_rewards: 2 }, "the 40-day-old claim is outside");
  ok(typeof f.median_hours_to_join === "number", "median hours");
  eq((await rpc("referral_admin_funnel", { days: 90 })).totals.claimed, 6);

  const list = await rpc("referral_admin_boosts", {});
  eq(list.map((b) => b.status), ["scheduled", "ended"], "newest start first");
  eq(list[1].boosted_rewards, 2);
  eq(list[0].budget_left, 100);

  const H = 3_600_000;
  const at = (h) => new Date(Date.now() + h * H).toISOString();
  const create = (a) => rpc("referral_admin_boost_create", { multiplier: 2, ...a });
  eq(await create({ starts_at: at(-2), ends_at: at(24) }), { ok: false, reason: "starts_in_past" });
  eq(await create({ starts_at: at(24 * 6), ends_at: at(24 * 7) }), { ok: false, reason: "overlap" });
  eq(await create({ starts_at: at(1), ends_at: at(24 * 40) }), { ok: false, reason: "too_long" });
  eq(await create({ starts_at: at(1), ends_at: at(2), multiplier: 6 }), { ok: false, reason: "bad_multiplier" });
  eq(await create({ starts_at: at(1), ends_at: at(0.5) }), { ok: false, reason: "ends_before_start" });

  const made = await create({ starts_at: at(1), ends_at: at(48), budget: 10 });
  ok(made.ok && made.boost.status === "scheduled" && made.boost.budget_left === 10, "created, scheduled");
  const now = await create({ starts_at: at(-0.02), ends_at: at(0.5) });
  ok(now.ok && now.boost.status === "running", "a start a minute ago runs now");
  eq((await rpc("referral_admin_boost_end", { boost_id: made.boost.id })).result, "deleted");
  const ended = await rpc("referral_admin_boost_end", { boost_id: now.boost.id });
  ok(ended.ok && ended.result === "ended" && ended.boost.status === "ended", "a running boost ends now");
  eq(await rpc("referral_admin_boost_end", { boost_id: now.boost.id }), { ok: false, reason: "already_ended" });
  eq(await rpc("referral_admin_boost_end", { boost_id: "nope" }), { ok: false, reason: "not_found" });
  eq((await rpc("referral_admin_log", {})).slice(0, 4).map((l) => l.action), [
    "boost_end",
    "boost_end",
    "boost_create",
    "boost_create",
  ]);
});
