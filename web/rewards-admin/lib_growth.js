// Pure helpers for the Referrals section's Funnel and Boosts views (referral migrations 23 and 24). No DOM, no network:
// tested in referral_test.js. Kept apart from lib.js, which holds the rest of the page's helpers.

// Funnel (referral_admin_funnel) ------------------------------------------------------------------------------------

const share = (a, b) => (b > 0 ? a / b : null);

/** Claimed → joined → paid for the period's cohort, each with the share of the step before (null when it is 0). */
export function funnelSteps(f) {
  const t = f?.totals ?? {};
  const claimed = Number(t.claimed ?? 0);
  const joined = Number(t.joined ?? 0);
  const paid = Number(t.paid ?? 0);
  return [
    { step: "Used a code", n: claimed, rate: null },
    { step: "Started using the app", n: joined, rate: share(joined, claimed) },
    { step: "Subscribed", n: paid, rate: share(paid, joined) },
  ];
}

/** Claimed → paid over the whole period, and the share that expired without starting. */
export function funnelOverall(f) {
  const t = f?.totals ?? {};
  const claimed = Number(t.claimed ?? 0);
  return { paid: share(Number(t.paid ?? 0), claimed), expired: share(Number(t.expired ?? 0), claimed) };
}

/**
 * The per-day rows for the bar list: newest day first, days without a claim left out, each with `width` (0–100, the
 * claimed bar scaled to the busiest day) and the day's claimed → joined share.
 */
export function funnelDayRows(f) {
  const days = (f?.days ?? []).filter((d) => Number(d.claimed) > 0);
  const max = Math.max(1, ...days.map((d) => Number(d.claimed)));
  return days
    .map((d) => ({
      ...d,
      width: Math.round((Number(d.claimed) / max) * 100),
      joinedRate: share(Number(d.joined), Number(d.claimed)),
    }))
    .sort((a, b) => String(b.day).localeCompare(String(a.day)));
}

/** "26.5 h", "2.1 days" for the median time from claim to join; "–" when nobody joined. */
export function hoursText(h) {
  if (h === null || h === undefined || Number.isNaN(Number(h))) return "–";
  const n = Number(h);
  return n >= 48 ? `${(n / 24).toFixed(1)} days` : `${n.toFixed(1)} h`;
}

// Boosts (referral_admin_boosts, _boost_create, _boost_end) -----------------------------------------------------

export const BOOST_STATUS = {
  scheduled: ["Scheduled", "warn"],
  running: ["Running", "ok"],
  ended: ["Ended", "off"],
};

export function boostStatus(status) {
  const [label, kind] = BOOST_STATUS[status] ?? [String(status ?? "–"), "off"];
  return { label, kind };
}

const EVENT_TEXT = { joined: "starts", paid: "subscribes" };
const list = (xs, word = "and") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${word} ${xs.at(-1)}`);

/** "×2 for the sharer and friend when the friend starts or subscribes" */
export function boostLine(b) {
  const m = Number(b?.multiplier);
  const who = (b?.who ?? []).map((w) => (w === "sharer" ? "sharer" : "friend"));
  const events = (b?.events ?? []).map((e) => EVENT_TEXT[e] ?? e);
  return `×${Number.isFinite(m) ? m : "?"} for the ${list(who)} when the friend ${list(events, "or") || "?"}`;
}

/** "3 of 50 used", "3 (no limit)" */
export function boostBudgetText(b) {
  const used = Number(b?.boosted_rewards ?? 0);
  return b?.budget === null || b?.budget === undefined ? `${used} (no limit)` : `${used} of ${b.budget} used`;
}

/** What each answer of the boost functions means, for the admin. */
export const BOOST_REASONS = {
  missing: "Fill in the start, the end and the multiplier.",
  starts_in_past: "The start is in the past. A boost can start now at the earliest.",
  ends_before_start: "The end must be after the start.",
  too_long: "A boost lasts 31 days at most.",
  bad_multiplier: "The multiplier is more than 1 and at most 5 (for example 2 for double).",
  bad_events: "Pick when it applies: when the friend starts, subscribes, or both.",
  bad_who: "Pick who gets it: the sharer, the friend, or both.",
  bad_budget: "The budget is a whole number of rewards, 0 or more (empty = no limit).",
  overlap: "Another boost covers part of that time. Boosts cannot overlap.",
  not_found: "That boost no longer exists. Reload the list.",
  already_ended: "That boost has already ended.",
  just_started: "That boost started a moment ago. Try again in a few seconds.",
  invalid: "The database refused that boost.",
};

export function boostReasonText(reason) {
  return BOOST_REASONS[reason] ?? `Not saved: ${reason ?? "unknown reason"}`;
}

const DAY_MS = 86_400_000;

/**
 * The create form → arguments for referral_admin_boost_create, checked like the database (migration 23) so most
 * mistakes are shown before sending. `start` / `end` are datetime-local values (the browser's time zone).
 * Returns { ok: true, args } or { ok: false, reason }.
 */
export function boostCreateArgs({ start, end, multiplier, events, who, budget }, now = Date.now()) {
  const s = start ? new Date(start) : null;
  const e = end ? new Date(end) : null;
  const m = String(multiplier ?? "").trim() === "" ? NaN : Number(multiplier);
  if (!s || !e || Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || Number.isNaN(m)) {
    return { ok: false, reason: "missing" };
  }
  // The server reads a start up to 5 minutes ago as now (the time the form took).
  if (s.getTime() < now - 5 * 60_000) return { ok: false, reason: "starts_in_past" };
  if (e.getTime() <= Math.max(s.getTime(), now)) return { ok: false, reason: "ends_before_start" };
  if (e.getTime() - s.getTime() > 31 * DAY_MS) return { ok: false, reason: "too_long" };
  if (!(m > 1 && m <= 5)) return { ok: false, reason: "bad_multiplier" };
  const ev = (events ?? []).filter((x) => x === "joined" || x === "paid");
  if (!ev.length || ev.length !== (events ?? []).length) return { ok: false, reason: "bad_events" };
  const w = (who ?? []).filter((x) => x === "sharer" || x === "friend");
  if (!w.length || w.length !== (who ?? []).length) return { ok: false, reason: "bad_who" };
  const b = String(budget ?? "").trim();
  if (b !== "" && !/^\d{1,9}$/.test(b)) return { ok: false, reason: "bad_budget" };
  return {
    ok: true,
    args: {
      starts_at: s.toISOString(),
      ends_at: e.toISOString(),
      multiplier: m,
      events: ev,
      who: w,
      budget: b === "" ? null : Number(b),
    },
  };
}

/** The confirm text for End: a boost not started is deleted, a running one stops now. */
export function boostEndQuestion(b) {
  return b?.status === "scheduled"
    ? "This boost has not started. Ending it deletes it; nobody has seen it yet. Delete it?"
    : "End this boost now? Friends who use a code from now on get the normal rewards; rewards already boosted stay. This cannot be undone.";
}
