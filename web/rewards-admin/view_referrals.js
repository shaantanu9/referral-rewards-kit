// Referrals: who invited whom, where each referral is, every reward and why one failed (referral migration 21).
// Three views: Overview (tiles, funnel, chart, top sharers, rules, the list with filters, details and actions), Funnel
// and Boosts (view_referral_growth.js). One person's page, problem rewards and the admin log are in
// view_referral_user.js.
import { act, barChart, h, loading, mount, table } from "./dom.js";
import {
  fmtNum,
  fmtPct,
  fmtTime,
  REFERRAL_STATES,
  referralFunnel,
  referralListArgs,
  referralState,
  rewardChip,
  rewardLine,
} from "./lib.js";
import { renderReferralLog, renderReferralProblems, renderReferralUser } from "./view_referral_user.js";
import { renderReferralBoosts, renderReferralFunnel } from "./view_referral_growth.js";

const VIEWS = [
  ["overview", "Overview", renderReferralOverview],
  ["funnel", "Funnel", renderReferralFunnel],
  ["boosts", "Boosts", renderReferralBoosts],
];
let view = "overview"; // kept while the page is open, so coming back to Referrals shows the same view

export async function renderReferrals(el, api) {
  const body = h("div");
  const tabs = h(
    "div",
    { class: "tabs", role: "group", "aria-label": "Referral views" },
    VIEWS.map(([id, label]) =>
      h("button", {
        "aria-pressed": String(id === view),
        onclick: () => {
          view = id;
          for (const b of tabs.children) b.setAttribute("aria-pressed", String(b.dataset.id === view));
          show();
        },
        "data-id": id,
      }, label)
    ),
  );
  // A fresh box per switch: a slow answer for the view left behind lands in a detached box, not over this one.
  const show = () => {
    const box = h("div");
    mount(body, box);
    return (VIEWS.find(([id]) => id === view) ?? VIEWS[0])[2](box, api);
  };
  mount(el, tabs, body);
  await show();
}

async function renderReferralOverview(el, api) {
  let days = 30;
  const overview = h("div");
  const list = h("div");
  const person = h("div");
  const openPerson = (query) => {
    renderReferralUser(person, api, query);
    person.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const drawOverview = async () => {
    mount(overview, loading());
    const o = await act(() => api.rpc("referral_admin_overview", { days }));
    if (!o) return mount(overview, h("p", { class: "muted" }, "Could not load referrals."));
    const t = o.totals ?? {};
    const byState = o.referrals_by_state ?? {};
    const daily = o.daily ?? [];
    mount(
      overview,
      h(
        "div",
        { class: "row between" },
        h("h2", {}, "Referrals"),
        h(
          "label",
          {},
          "Period ",
          h("select", {
            onchange: (e) => {
              days = Number(e.target.value);
              drawOverview();
            },
          }, [7, 30, 90].map((d) => h("option", { value: d, selected: d === days ? "" : null }, `${d} days`))),
        ),
      ),
      o.settings?.enabled === false
        ? h("p", { class: "warn-text" }, "The referral program is paused (settings.enabled = false).")
        : null,
      o.privacy_problems > 0
        ? h("p", { class: "warn-text" }, `privacy_problems() reports ${o.privacy_problems} problem(s). Run it in SQL.`)
        : null,
      h(
        "div",
        { class: "tiles" },
        tile("Referrals", fmtNum(t.referrals)),
        tile("Waiting to start", fmtNum(byState.claimed ?? 0), (byState.claimed ?? 0) > 0 ? "warn" : null),
        tile("Joined", fmtNum((byState.joined ?? 0) + (byState.paid ?? 0))),
        tile("Subscribed", fmtNum(byState.paid ?? 0)),
        tile("Sharers", fmtNum(t.sharers)),
        tile("Rewards failing", fmtNum(t.problem_rewards), t.problem_rewards > 0 ? "warn" : null),
        t.in_review > 0 ? tile("In review", fmtNum(t.in_review), "warn") : null,
      ),
      h(
        "div",
        { class: "grid2" },
        h(
          "section",
          { class: "card" },
          h("h3", {}, `Funnel, last ${o.days} days`),
          table(referralFunnel(o), [["Step", (r) => r.step], ["People", (r) => fmtNum(r.n)], [
            "Of the step before",
            (r) => (r.rate === null ? "" : fmtPct(r.rate)),
          ]]),
        ),
        h(
          "section",
          { class: "card" },
          h("h3", {}, "Rewards by state"),
          table(Object.entries(o.rewards_by_state ?? {}), [
            ["State", ([s]) => h("span", { class: `chip ${rewardChip(s)}` }, s.replace(/_/g, " "))],
            ["Rewards", ([, n]) => fmtNum(n)],
          ], "No rewards yet."),
        ),
      ),
      h(
        "section",
        { class: "card" },
        h("h3", {}, "Codes used a day"),
        barChart(daily.map((d) => d.claimed), daily.map((d) => d.day), { title: "Codes used a day" }),
        h("h3", {}, "Friends who started a day"),
        barChart(daily.map((d) => d.joined), daily.map((d) => d.day), { title: "Friends who started a day" }),
      ),
      h(
        "section",
        { class: "card" },
        h("h3", {}, "Top sharers"),
        table(o.top_sharers, [
          ["Sharer", (s) => personLink(s.sharer, openPerson)],
          ["Code", (s) => s.code ?? "–"],
          ["Invited", (s) => fmtNum(s.total)],
          ["Waiting", (s) => fmtNum(s.waiting)],
          ["Joined", (s) => fmtNum(s.joined)],
          ["Subscribed", (s) => fmtNum(s.paid)],
        ], "Nobody has shared a code yet."),
      ),
      h(
        "details",
        { class: "card" },
        h("summary", {}, `Rules (set ${o.rule_set ?? "none"}) and settings`),
        table(o.rules, [
          ["Set", (r) => r.version],
          ["When", (r) => r.event],
          ["Who", (r) => r.who],
          ["Reward", (r) => `${fmtNum(r.amount)} ${r.kind.replace(/_/g, " ")}`],
          ["Active", (r) => h("span", { class: `chip ${r.active ? "ok" : "off"}` }, r.active ? "yes" : "no")],
        ], "No rules: the program pays nothing."),
        table(Object.entries(o.settings ?? {}), [["Setting", ([k]) => k], ["Value", ([, v]) => String(v ?? "–")]]),
        h(
          "p",
          { class: "muted" },
          `Worker: last daily check ${fmtTime(o.worker?.last_banked_check_at)} · RevenueCat events ${
            Object.entries(o.worker?.events_by_state ?? {}).map(([k, v]) => `${k} ${v}`).join(", ") || "none"
          }`,
        ),
      ),
    );
  };

  // The list: filters, newest first, 50 at a time.
  let filters = { state: "", search: "" };
  let cursor = null;
  const rowsBox = h("div");
  const more = h("button", { hidden: true, onclick: () => loadPage(false) }, "Load more");
  const loadPage = async (fresh) => {
    if (fresh) {
      cursor = null;
      mount(rowsBox, loading());
    }
    const page = await act(() => api.rpc("referral_admin_referrals", referralListArgs({ ...filters, cursor })));
    if (!page) return;
    if (fresh) mount(rowsBox);
    if (fresh && !page.rows.length) mount(rowsBox, h("p", { class: "muted" }, "No referrals match."));
    for (const r of page.rows) rowsBox.append(referralCard(r, api, openPerson, () => refreshAll()));
    cursor = page.next_before ? { before: page.next_before, before_id: page.next_before_id } : null;
    more.hidden = !cursor;
  };
  const search = h("input", { type: "search", placeholder: "Email, user id or code", size: 28 });
  const state = h(
    "select",
    {},
    h("option", { value: "" }, "All states"),
    Object.entries(REFERRAL_STATES).map(([k, [label]]) => h("option", { value: k }, label)),
  );
  const apply = () => {
    filters = { state: state.value, search: search.value };
    loadPage(true);
  };
  search.addEventListener("keydown", (e) => e.key === "Enter" && apply());
  state.addEventListener("change", apply);
  mount(
    list,
    h("h2", {}, "Every referral"),
    h("div", { class: "row" }, search, state, h("button", { onclick: apply }, "Search")),
    h("p", { class: "muted" }, "Newest first. Open one to see both people, the dates and every reward."),
    rowsBox,
    more,
  );

  const problems = h("section", { class: "card" });
  const log = h("details", { class: "card" }, h("summary", {}, "Referral admin log"));
  const logBody = h("div");
  log.append(logBody);
  log.addEventListener("toggle", () => log.open && renderReferralLog(logBody, api));
  mount(el, overview, problems, list, person, log);
  renderReferralUser(person, api, null);
  // After any action (retry, activation check) every part shows the new state: tiles, problems and the list.
  const refreshAll = () =>
    Promise.all([drawOverview(), loadPage(true), renderReferralProblems(problems, api, () => refreshAll())]);
  await refreshAll();
}

/** One referral: a summary line that opens to both people, dates, rewards and actions. */
export function referralCard(r, api, openPerson, reload) {
  const s = referralState(r.state);
  const failing = (r.rewards ?? []).some((w) => w.state.startsWith("failed"));
  return h(
    "details",
    { class: "card" },
    h(
      "summary",
      {},
      h("span", { class: `chip ${s.kind}` }, s.label),
      " ",
      r.sharer?.email ?? "deleted account",
      " → ",
      r.friend?.email ?? "deleted account",
      h("span", { class: "muted" }, ` · ${r.code} · ${fmtTime(r.claimed_at)}`),
      failing ? h("span", { class: "chip bad" }, " reward failing") : null,
    ),
    h("p", { class: "muted" }, s.hint),
    table([r], [
      ["Shared by", (x) => personLink(x.sharer, openPerson)],
      ["Friend", (x) => personLink(x.friend, openPerson)],
      ["Code used", (x) => fmtTime(x.claimed_at)],
      ["Started", (x) => fmtTime(x.joined_at)],
      ["Subscribed", (x) => fmtTime(x.paid_at)],
      ["Must start by", (x) => fmtTime(x.activate_by)],
    ]),
    r.cancel_cause ? h("p", { class: "warn-text" }, `Cancelled: ${r.cancel_cause}`) : null,
    h("h4", {}, "Rewards"),
    rewardsTable(r.rewards, api, reload, "No rewards yet: they are queued when the friend starts or subscribes."),
    r.state === "claimed" && r.friend?.id
      ? h("button", {
        onclick: async () => {
          const res = await act(() => api.rpc("referral_admin_check_activation", { friend_id: r.friend.id }));
          if (res) {
            act(() => Promise.resolve(), `Activation: ${res.state}`);
            if (res.state !== "claimed") reload();
          }
        },
      }, "Check activation now")
      : null,
  );
}

/** Rewards with their state, attempts and last error; failed ones get a Retry button. */
export function rewardsTable(rewards, api, reload, empty = "No rewards.") {
  return table(rewards, [
    ["Reward", (w) => rewardLine(w)],
    ["To", (w) => w.user?.email ?? "–"],
    ["State", (w) => h("span", { class: `chip ${rewardChip(w.state)}` }, w.state.replace(/_/g, " "))],
    ["Attempts", (w) => fmtNum(w.attempts)],
    ["Due", (w) => fmtTime(w.available_at)],
    ["Last error", (w) => w.last_error ?? ""],
    ["", (w) =>
      w.state.startsWith("failed")
        ? h("button", {
          onclick: async (e) => {
            e.target.disabled = true;
            const res = await act(() => api.rpc("referral_admin_retry_reward", { reward_id: w.id }));
            e.target.disabled = false;
            if (res?.ok) {
              act(() => Promise.resolve(), res.result === "granted" ? "Reward granted" : `Retry: ${res.result}`);
              reload();
            } else if (res) act(() => Promise.reject(new Error(`Not retried: ${res.reason}`)));
          },
        }, "Retry now")
        : ""],
  ], empty);
}

export function personLink(p, openPerson) {
  if (!p) return h("span", { class: "muted" }, "deleted account");
  return h("button", { class: "link", title: p.id, onclick: () => openPerson(p.email ?? p.id) }, p.email ?? p.id);
}

export function tile(label, value, kind) {
  return h(
    "div",
    { class: `tile ${kind ?? ""}` },
    h("div", { class: "tile-value" }, value),
    h("div", { class: "tile-label" }, label),
  );
}
