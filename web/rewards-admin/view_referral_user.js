// Referrals, part two: one person (by email, user id or invite code), rewards that need a look, and the admin log.
import { act, h, loading, mount, table } from "./dom.js";
import { fmtNum, fmtTime } from "./lib.js";
import { personLink, referralCard, rewardsTable } from "./view_referrals.js";

/** Look up one person: their codes, who they invited, who invited them, their rewards and what their app shows. */
export function renderReferralUser(el, api, query) {
  const input = h("input", {
    type: "search",
    placeholder: "Email, user id or invite code",
    size: 32,
    value: query ?? "",
  });
  const out = h("div");
  const look = async (q) => {
    const v = String(q ?? input.value).trim();
    if (!v) return mount(out, h("p", { class: "muted" }, "Type an email, a user id or an invite code."));
    input.value = v;
    mount(out, loading());
    const u = await act(() => api.rpc("referral_admin_user", { query: v }));
    if (!u) return mount(out);
    if (!u.found) return mount(out, h("p", { class: "warn-text" }, `No user found for "${v}".`));
    const reload = () => look(v);
    const st = u.stats ?? {};
    mount(
      out,
      table([u.user], [
        ["Email", (x) => x.email ?? "–"],
        ["User id", (x) => h("code", {}, x.id)],
        ["Signed up", (x) => fmtTime(x.created_at)],
        ["Verified", (x) => fmtTime(x.verified_at)],
        ["Phones", (x) => fmtNum(x.installs)],
        ["Account", (x) => (x.deleted ? h("span", { class: "chip off" }, "deleted") : "active")],
        [
          "Review",
          (x) => (x.review_since ? h("span", { class: "chip warn" }, `since ${fmtTime(x.review_since)}`) : "–"),
        ],
      ]),
      h("h3", {}, "What their app shows"),
      h(
        "p",
        {},
        `${fmtNum(st.claimed_count ?? 0)} friend(s) used the code and have not started · ${
          fmtNum(st.joined_count ?? 0)
        } joined · ${
          st.paid_count === null || st.paid_count === undefined
            ? "subscriptions hidden (below the floor)"
            : `${fmtNum(st.paid_count)} subscribed`
        } · ${fmtNum(st.rewards_granted?.length ?? 0)} reward(s) granted, ${
          fmtNum(st.pending?.length ?? 0)
        } on the way`,
      ),
      h("h3", {}, "Invite codes"),
      table(u.codes, [
        ["Code", (c) => h("code", {}, c.code)],
        ["Created", (c) => fmtTime(c.created_at)],
        ["Retired", (c) => (c.disabled_at ? fmtTime(c.disabled_at) : h("span", { class: "chip ok" }, "active"))],
      ], "No code yet: one is made the first time they open the invite screen."),
      h("h3", {}, `Invited (${u.invited?.length ?? 0})`),
      u.invited?.length
        ? u.invited.map((r) => referralCard(r, api, look, reload))
        : h("p", { class: "muted" }, "Nobody has used their code yet."),
      h("h3", {}, "Invited by"),
      u.invited_by ? referralCard(u.invited_by, api, look, reload) : h("p", { class: "muted" }, "Not referred."),
      h("h3", {}, "Their rewards"),
      rewardsTable(u.rewards, api, reload, "No referral rewards."),
      u.abuse_marks?.length
        ? [
          h("h3", {}, "Abuse marks"),
          table(u.abuse_marks, [["Cause", (a) => a.cause], ["Points", (a) => a.points], ["When", (a) =>
            fmtTime(a.created_at)]]),
        ]
        : null,
    );
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && look());
  mount(
    el,
    h(
      "section",
      { class: "card" },
      h("h2", {}, "Look up a person"),
      h("div", { class: "row" }, input, h("button", { class: "primary", onclick: () => look() }, "Look up")),
      out,
    ),
  );
  if (query) look(query);
}

/** Rewards that failed or are overdue, with Retry. */
/** `onChange` runs after a retry here (the Referrals section refreshes everything); this box alone otherwise. */
export async function renderReferralProblems(el, api, onChange) {
  const draw = async () => {
    mount(el, h("h2", {}, "Rewards that need a look"), loading());
    const rows = await act(() => api.rpc("referral_admin_rewards", {}));
    mount(
      el,
      h("h2", {}, "Rewards that need a look"),
      h(
        "p",
        { class: "muted" },
        "Failed, still retrying, or due for over an hour. App rewards (credits, minutes) are granted by your grant hook; " +
          "Retry now calls it again. Entitlement days go back to the worker.",
      ),
      rows ? withPeople(rows, api, onChange ?? draw) : h("p", { class: "muted" }, "Could not load."),
    );
  };
  await draw();
}

function withPeople(rows, api, reload) {
  return h(
    "div",
    {},
    rowsSummary(rows),
    rewardsTable(rows, api, reload, "Nothing failing. Every due reward was granted."),
  );
}

function rowsSummary(rows) {
  if (!rows.length) return null;
  const codes = [...new Set(rows.map((w) => w.code).filter(Boolean))];
  return h("p", {}, `${rows.length} reward(s) on ${codes.length} code(s): ${codes.join(", ")}`);
}

/** What admins did here: retries and activation checks. */
export async function renderReferralLog(el, api) {
  mount(el, h("h2", {}, "Referral admin log"), loading());
  const rows = await act(() => api.rpc("referral_admin_log", { max_rows: 100 }));
  mount(
    el,
    h("h2", {}, "Referral admin log"),
    table(rows ?? [], [
      ["When", (r) => fmtTime(r.at)],
      ["Admin", (r) => personLink(r.admin, () => {})],
      ["Action", (r) => r.action.replace(/_/g, " ")],
      ["Details", (r) => h("code", {}, JSON.stringify(r.details))],
    ], "Nothing yet."),
  );
}
