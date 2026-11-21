// In-memory stand-in for the referral admin functions (migrations 21, 23 funnel, 24 boosts), merged into the demo
// backend. Same names, arguments and answer shapes as the SQL; refusals use the same `referral: <reason>` messages and
// the boost functions the same {"ok": false, "reason"} answers. Fake people only.

const DAY = 86_400_000;
const ago = (days, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000).toISOString();
const person = (id, email) => ({ id, email, deleted: false });
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function referralDemoFns() {
  const people = [
    person(uuid(1), "asha@example.com"),
    person(uuid(2), "ben@example.com"),
    person(uuid(3), "chen@example.com"),
    person(uuid(4), "dana@example.com"),
    person(uuid(5), "eli@example.com"),
    person(uuid(6), "farah@example.com"),
    person(uuid(7), "gopal@example.com"),
  ];
  const codes = { [uuid(1)]: "K7QM4TRP", [uuid(2)]: "WX9HB3NE" };
  const settings = {
    enabled: true,
    paid_enabled: true,
    hold_hours: 72,
    claim_window_days: 7,
    activate_window_days: 30,
    paid_window_days: 90,
    joined_delay_hours: 0,
    sharer_joins_per_30d: 10,
    sharer_paid_per_365d: 6,
    stats_floor: 3,
    entitlement_id: "pro",
  };
  const rules = [
    {
      id: uuid(101),
      version: 1,
      event: "joined",
      who: "sharer",
      kind: "ai_credits",
      amount: 20,
      params: {},
      active: true,
    },
    {
      id: uuid(102),
      version: 1,
      event: "joined",
      who: "friend",
      kind: "ai_credits",
      amount: 20,
      params: {},
      active: true,
    },
    {
      id: uuid(103),
      version: 1,
      event: "paid",
      who: "sharer",
      kind: "entitlement_days",
      amount: 7,
      params: { entitlement_id: "pro" },
      active: true,
    },
  ];
  let n = 200;
  const reward = (ref, who, event, kind, amount, state, extra = {}) => ({
    id: uuid(n++),
    referral_id: ref,
    user: null,
    who,
    event,
    kind,
    amount,
    params: kind === "entitlement_days" ? { entitlement_id: "pro" } : {},
    state,
    attempts: state === "granted" ? 1 : 0,
    last_error: null,
    available_at: ago(1),
    created_at: ago(1),
    updated_at: ago(1),
    ...extra,
  });
  const referral = (i, sharer, friend, state, claimedDaysAgo, extra = {}) => {
    const id = uuid(300 + i);
    const claimed_at = ago(claimedDaysAgo, i);
    const r = {
      id,
      code: codes[sharer.id],
      state,
      rule_set_version: 1,
      claimed_at,
      joined_at: null,
      paid_at: null,
      activate_by: state === "claimed" ? new Date(Date.parse(claimed_at) + 30 * DAY).toISOString() : null,
      cancel_cause: null,
      friend_deleted_at: null,
      sharer,
      friend,
      rewards: [],
      ...extra,
    };
    for (const w of r.rewards) w.user = w.who === "sharer" ? sharer : friend;
    return r;
  };
  const [asha, ben, chen, dana, eli, farah, gopal] = people;
  const r1 = uuid(301), r2 = uuid(302), r4 = uuid(304);
  const referrals = [
    referral(1, asha, ben, "joined", 9, {
      joined_at: ago(8),
      rewards: [
        reward(r1, "sharer", "joined", "ai_credits", 40, "granted", { boost_id: uuid(501) }),
        reward(r1, "friend", "joined", "ai_credits", 40, "granted", { boost_id: uuid(501) }),
      ],
    }),
    referral(2, asha, chen, "paid", 20, {
      joined_at: ago(19),
      paid_at: ago(3),
      rewards: [
        reward(r2, "sharer", "joined", "ai_credits", 20, "granted"),
        reward(r2, "friend", "joined", "ai_credits", 20, "granted"),
        reward(r2, "sharer", "paid", "entitlement_days", 7, "queued", { available_at: ago(-0.5) }),
      ],
    }),
    referral(3, asha, dana, "claimed", 1),
    referral(4, ben, eli, "joined", 4, {
      joined_at: ago(2),
      rewards: [
        reward(r4, "sharer", "joined", "ai_credits", 20, "failed_retryable", {
          attempts: 3,
          last_error: "referral: app_referral_grant: credits ledger timeout",
        }),
        reward(r4, "friend", "joined", "ai_credits", 20, "granted"),
      ],
    }),
    referral(5, ben, farah, "claimed", 0),
    referral(6, asha, gopal, "expired", 40),
  ];
  for (const r of referrals) for (const w of r.rewards) w.user = w.who === "sharer" ? r.sharer : r.friend;
  const log = [];
  const note = (action, details) =>
    log.unshift({ at: new Date().toISOString(), admin: person(uuid(999), "demo@example.com"), action, details });

  // Boosts (migration 24): one that ran last week (r1 claimed inside it), one scheduled for next week.
  let boostN = 510;
  const boosts = [
    {
      id: uuid(501),
      starts_at: ago(12),
      ends_at: ago(5),
      multiplier: 2,
      events: ["joined"],
      who: ["sharer", "friend"],
      budget: null,
      created_at: ago(14),
    },
    {
      id: uuid(502),
      starts_at: ago(-5),
      ends_at: ago(-12),
      multiplier: 1.5,
      events: ["joined", "paid"],
      who: ["friend"],
      budget: 100,
      created_at: ago(1),
    },
  ];
  const boostRow = (b) => {
    const now = Date.now();
    const used =
      allRewards().filter((w) => w.boost_id === b.id && !["cancelled", "void_fraud"].includes(w.state)).length;
    return {
      ...b,
      status: now < Date.parse(b.starts_at) ? "scheduled" : now < Date.parse(b.ends_at) ? "running" : "ended",
      boosted_rewards: used,
      budget_left: b.budget === null ? null : Math.max(b.budget - used, 0),
    };
  };
  const refuse = (reason) => ({ ok: false, reason });
  const allRewards = () => referrals.flatMap((r) => r.rewards.map((w) => ({ ...w, code: r.code })));
  const count = (xs, key) => xs.reduce((m, x) => ((m[x[key]] = (m[x[key]] ?? 0) + 1), m), {});
  const inDays = (iso, d) => iso && Date.parse(iso) >= Date.now() - d * DAY;
  const statsFor = (uid) => {
    const mine = referrals.filter((r) => r.sharer?.id === uid);
    const rewards = allRewards().filter((w) => w.user?.id === uid);
    return {
      rewards_granted: rewards.filter((w) => w.state === "granted"),
      pending: rewards.filter((w) => ["queued", "granting", "failed_retryable"].includes(w.state)),
      banked: [],
      skipped_cap: 0,
      claimed_count: mine.filter((r) => r.state === "claimed").length,
      joined_count: mine.filter((r) => r.joined_at).length,
      paid_count: mine.filter((r) => r.joined_at).length >= 3 ? mine.filter((r) => r.paid_at).length : null,
    };
  };

  return {
    referral_admin_overview: ({ days = 30 }) => {
      const d = Math.min(Math.max(Number(days) || 30, 1), 365);
      const daily = Array.from({ length: d }, (_, i) => {
        const day = new Date(Date.now() - (d - 1 - i) * DAY).toISOString().slice(0, 10);
        return {
          day,
          claimed: referrals.filter((r) => r.claimed_at.slice(0, 10) === day).length,
          joined: referrals.filter((r) => r.joined_at?.slice(0, 10) === day).length,
        };
      });
      const sharers = new Map();
      for (const r of referrals) {
        const s = sharers.get(r.sharer.id) ??
          { sharer: r.sharer, code: codes[r.sharer.id], total: 0, waiting: 0, joined: 0, paid: 0 };
        s.total++;
        if (r.state === "claimed") s.waiting++;
        if (r.joined_at) s.joined++;
        if (r.paid_at) s.paid++;
        sharers.set(r.sharer.id, s);
      }
      return {
        days: d,
        settings,
        rule_set: 1,
        rules,
        referrals_by_state: count(referrals, "state"),
        rewards_by_state: count(allRewards(), "state"),
        totals: {
          codes: Object.keys(codes).length,
          sharers: sharers.size,
          referrals: referrals.length,
          claimed_in_window: referrals.filter((r) => inDays(r.claimed_at, d)).length,
          joined_in_window: referrals.filter((r) => inDays(r.joined_at, d)).length,
          paid_in_window: referrals.filter((r) => inDays(r.paid_at, d)).length,
          problem_rewards: allRewards().filter((w) => w.state.startsWith("failed")).length,
          in_review: 0,
        },
        daily,
        top_sharers: [...sharers.values()].sort((a, b) => b.total - a.total || b.joined - a.joined),
        worker: { last_banked_check_at: ago(0, 5), events_by_state: { processed: 14, waiting: 1 } },
        privacy_problems: 0,
      };
    },
    referral_admin_referrals: ({ state, search, max_rows = 50, before, before_id }) => {
      const q = String(search ?? "").trim().toLowerCase();
      const key = (r) => `${r.claimed_at}|${r.id}`;
      let rows = referrals
        .filter((r) => !state || r.state === state)
        .filter((r) =>
          !q || r.code.toLowerCase() === q.replace(/-/g, "") ||
          [r.sharer?.email, r.friend?.email, r.sharer?.id, r.friend?.id].some((x) => x?.toLowerCase().includes(q))
        )
        .sort((a, b) => key(b).localeCompare(key(a)));
      if (before) rows = rows.filter((r) => key(r) < `${before}|${before_id ?? "ffffffff"}`);
      const page = rows.slice(0, max_rows);
      const last = page.length === max_rows ? page[page.length - 1] : null;
      return { rows: page, next_before: last?.claimed_at ?? null, next_before_id: last?.id ?? null };
    },
    referral_admin_user: ({ query }) => {
      const q = String(query ?? "").trim().toLowerCase();
      const p = people.find((x) => x.id === q || x.email === q) ??
        people.find((x) => codes[x.id]?.toLowerCase() === q.replace(/-/g, ""));
      if (!p) return { found: false };
      return {
        found: true,
        user: {
          ...p,
          created_at: ago(60),
          verified_at: ago(59),
          eligible_from: ago(59),
          review_since: null,
          installs: 1,
        },
        codes: codes[p.id] ? [{ code: codes[p.id], created_at: ago(58), disabled_at: null }] : [],
        invited: referrals.filter((r) => r.sharer.id === p.id),
        invited_by: referrals.find((r) => r.friend?.id === p.id) ?? null,
        rewards: allRewards().filter((w) => w.user?.id === p.id),
        abuse_marks: [],
        stats: statsFor(p.id),
      };
    },
    referral_admin_rewards: ({ state }) =>
      allRewards().filter((w) => (state ? w.state === state : w.state.startsWith("failed"))),
    referral_admin_retry_reward: ({ reward_id }) => {
      const w = referrals.flatMap((r) => r.rewards).find((x) => x.id === reward_id);
      if (!w) return { ok: false, reason: "not_found" };
      if (!w.state.startsWith("failed")) return { ok: false, reason: "not_failed", state: w.state };
      Object.assign(w, { state: "granted", attempts: 1, last_error: null, updated_at: new Date().toISOString() });
      log.unshift({
        at: new Date().toISOString(),
        admin: person(uuid(999), "demo@example.com"),
        action: "retry_reward",
        details: { reward_id },
      });
      return { ok: true, result: "granted", reward: w };
    },
    referral_admin_check_activation: ({ friend_id }) => {
      const r = referrals.find((x) => x.friend?.id === friend_id);
      log.unshift({
        at: new Date().toISOString(),
        admin: person(uuid(999), "demo@example.com"),
        action: "check_activation",
        details: { friend_id, state: r?.state ?? "no_referral" },
      });
      return { state: r?.state ?? "no_referral" };
    },
    referral_admin_log: () => log,
    referral_admin_funnel: ({ days = 30 } = {}) => {
      const d = Math.min(Math.max(Number(days) || 30, 1), 365);
      const today = new Date().toISOString().slice(0, 10);
      const day0 = new Date(Date.parse(today) - (d - 1) * DAY).toISOString().slice(0, 10);
      const cohort = referrals.filter((r) => r.claimed_at.slice(0, 10) >= day0);
      const hours = cohort.filter((r) => r.joined_at)
        .map((r) => (Date.parse(r.joined_at) - Date.parse(r.claimed_at)) / 3_600_000).sort((a, b) => a - b);
      const mid = hours.length / 2;
      const median = !hours.length
        ? null
        : Math.round((hours.length % 2 ? hours[Math.floor(mid)] : (hours[mid - 1] + hours[mid]) / 2) * 10) / 10;
      const counts = (rs) => ({
        claimed: rs.length,
        joined: rs.filter((r) => r.joined_at).length,
        paid: rs.filter((r) => r.paid_at).length,
        expired: rs.filter((r) => r.state === "expired").length,
      });
      return {
        days: Array.from({ length: d }, (_, i) => {
          const day = new Date(Date.parse(day0) + i * DAY).toISOString().slice(0, 10);
          return { day, ...counts(cohort.filter((r) => r.claimed_at.slice(0, 10) === day)) };
        }),
        totals: {
          ...counts(cohort),
          boosted_rewards: cohort.flatMap((r) => r.rewards).filter((w) => w.boost_id).length,
        },
        median_hours_to_join: median,
      };
    },
    referral_admin_boosts: () =>
      boosts.map(boostRow).sort((a, b) =>
        b.starts_at.localeCompare(a.starts_at) || b.created_at.localeCompare(a.created_at)
      ),
    referral_admin_boost_create: (
      { starts_at, ends_at, multiplier, events = ["joined"], who = ["sharer", "friend"], budget = null },
    ) => {
      const now = Date.now();
      let s = Date.parse(starts_at);
      const e = Date.parse(ends_at);
      if (Number.isNaN(s) || Number.isNaN(e) || multiplier === null || multiplier === undefined) {
        return refuse("missing");
      }
      if (s < now && s >= now - 5 * 60_000) s = now;
      // the guard trigger runs before the constraints, as in SQL
      if (s < now) return refuse("starts_in_past");
      if (e <= s) return refuse("ends_before_start");
      if (e > s + 31 * DAY) return refuse("too_long");
      if (!(Number(multiplier) > 1 && Number(multiplier) <= 5)) return refuse("bad_multiplier");
      if (!events?.length || events.some((x) => !["joined", "paid"].includes(x))) return refuse("bad_events");
      if (!who?.length || who.some((x) => !["sharer", "friend"].includes(x))) return refuse("bad_who");
      if (budget !== null && !(Number.isInteger(budget) && budget >= 0)) return refuse("bad_budget");
      if (boosts.some((b) => s < Date.parse(b.ends_at) && Date.parse(b.starts_at) < e)) return refuse("overlap");
      const b = {
        id: uuid(boostN++),
        starts_at: new Date(s).toISOString(),
        ends_at: new Date(e).toISOString(),
        multiplier: Number(multiplier),
        events: [...events],
        who: [...who],
        budget,
        created_at: new Date(now).toISOString(),
      };
      boosts.push(b);
      note("boost_create", { boost_id: b.id, starts_at: b.starts_at, ends_at: b.ends_at, multiplier: b.multiplier });
      return { ok: true, boost: boostRow(b) };
    },
    referral_admin_boost_end: ({ boost_id }) => {
      const i = boosts.findIndex((b) => b.id === boost_id);
      if (i < 0) return refuse("not_found");
      const b = boosts[i];
      const now = Date.now();
      if (Date.parse(b.starts_at) > now) {
        boosts.splice(i, 1);
        note("boost_end", { boost_id, result: "deleted" });
        return { ok: true, result: "deleted", boost: null };
      }
      if (Date.parse(b.ends_at) <= now) return refuse("already_ended");
      b.ends_at = new Date(now).toISOString();
      note("boost_end", { boost_id, result: "ended" });
      return { ok: true, result: "ended", boost: boostRow(b) };
    },
  };
}
