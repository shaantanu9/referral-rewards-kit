// In-memory stand-in for the referral admin functions (migration 21), merged into the demo backend. Same names,
// arguments and answer shapes as the SQL; refusals use the same `referral: <reason>` messages. Fake people only.

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
        reward(r1, "sharer", "joined", "ai_credits", 20, "granted"),
        reward(r1, "friend", "joined", "ai_credits", 20, "granted"),
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
  };
}
