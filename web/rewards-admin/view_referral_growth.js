// Referrals, part three: the Funnel (referral_admin_funnel, migration 23) and Boosts (migration 24) views. Reuses the
// page's table, tile-like cards and chips; every value from the database goes in as text.
import { act, h, loading, mount, table, toast } from "./dom.js";
import { fmtNum, fmtPct, fmtTime } from "./lib.js";
import {
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
import { tile } from "./view_referrals.js";

/** Claimed → joined → paid by claim day, for the last 30 or 90 days. */
export async function renderReferralFunnel(el, api) {
  let days = 30;
  const draw = async () => {
    mount(el, loading());
    const f = await act(() => api.rpc("referral_admin_funnel", { days }));
    if (!f) return mount(el, h("p", { class: "muted" }, "Could not load the funnel."));
    const t = f.totals ?? {};
    const overall = funnelOverall(f);
    const rows = funnelDayRows(f);
    mount(
      el,
      h(
        "div",
        { class: "row between" },
        h("h2", {}, "Funnel"),
        h(
          "label",
          {},
          "Period ",
          h("select", {
            onchange: (e) => {
              days = Number(e.target.value);
              draw();
            },
          }, [30, 90].map((d) => h("option", { value: d, selected: d === days ? "" : null }, `${d} days`))),
        ),
      ),
      h(
        "p",
        { class: "muted" },
        "Everyone who used a code in the period, followed to today: a friend who used a code on the 3rd and started on the 5th counts on the 3rd.",
      ),
      h(
        "div",
        { class: "tiles" },
        tile("Used a code", fmtNum(t.claimed)),
        tile("Started", fmtNum(t.joined)),
        tile("Subscribed", fmtNum(t.paid)),
        tile("Expired", fmtNum(t.expired), t.expired > 0 ? "warn" : null),
        tile("Boosted rewards", fmtNum(t.boosted_rewards)),
        tile("Median time to start", hoursText(f.median_hours_to_join)),
      ),
      h(
        "section",
        { class: "card" },
        h("h3", {}, "Conversion"),
        table(funnelSteps(f), [
          ["Step", (r) => r.step],
          ["People", (r) => fmtNum(r.n)],
          ["Of the step before", (r) => (r.rate === null ? "" : fmtPct(r.rate))],
        ]),
        h(
          "p",
          { class: "muted" },
          `Code to subscription: ${fmtPct(overall.paid)} · expired without starting: ${fmtPct(overall.expired)}`,
        ),
      ),
      h(
        "section",
        { class: "card" },
        h("h3", {}, "By day"),
        table(rows, [
          ["Day", (r) => h("span", { class: "nowrap" }, r.day)],
          ["Used a code", (r) => h("span", { class: "barcell" }, bar(r.width), h("span", {}, fmtNum(r.claimed)))],
          ["Started", (r) => h("span", { class: "nowrap" }, `${fmtNum(r.joined)} (${fmtPct(r.joinedRate)})`)],
          ["Subscribed", (r) => fmtNum(r.paid)],
          ["Expired", (r) => fmtNum(r.expired)],
        ], "Nobody used a code in this period."),
        rows.length ? h("p", { class: "muted" }, "Newest first; days when nobody used a code are left out.") : null,
      ),
    );
  };
  await draw();
}

/** Boost list with status, a create form and End (with a confirm). */
export async function renderReferralBoosts(el, api) {
  const listBox = h("div");
  const draw = async () => {
    mount(listBox, loading());
    const boosts = await act(() => api.rpc("referral_admin_boosts"));
    if (!boosts) return mount(listBox, h("p", { class: "muted" }, "Could not load boosts."));
    mount(
      listBox,
      boosts.length ? boosts.map((b) => boostItem(b, end)) : h("p", { class: "muted" }, "No boosts yet."),
    );
  };
  const end = async (b, button) => {
    if (!globalThis.confirm(boostEndQuestion(b))) return;
    button.disabled = true;
    const r = await act(() => api.rpc("referral_admin_boost_end", { boost_id: b.id }));
    button.disabled = false;
    if (!r) return;
    if (r.ok) toast(r.result === "deleted" ? "Boost deleted" : "Boost ended");
    else toast(boostReasonText(r.reason), "err");
    draw();
  };
  mount(
    el,
    h("h2", {}, "Boosts"),
    h(
      "p",
      { class: "muted" },
      "A boost multiplies the rewards of referrals whose code is used between its start and end. The app and the invite page show the end date while it runs; a scheduled boost is not shown until it starts.",
    ),
    h("section", { class: "card" }, listBox),
    createForm(api, draw),
  );
  await draw();
}

function createForm(api, reload) {
  const start = h("input", { type: "datetime-local", required: true });
  const end = h("input", { type: "datetime-local", required: true });
  const multiplier = h("input", { type: "number", min: "1.1", max: "5", step: "0.1", value: "2", required: true });
  const budget = h("input", { type: "number", min: "0", step: "1", placeholder: "No limit" });
  const check = (value, label, on) =>
    h("label", { class: "inline" }, h("input", { type: "checkbox", value, checked: on }), label);
  const events = h(
    "fieldset",
    { class: "checks" },
    h("legend", {}, "When"),
    check("joined", "The friend starts", true),
    check("paid", "The friend subscribes", false),
  );
  const who = h(
    "fieldset",
    { class: "checks" },
    h("legend", {}, "Who gets more"),
    check("sharer", "The sharer", true),
    check("friend", "The friend", true),
  );
  const picked = (box) => [...box.querySelectorAll("input:checked")].map((i) => i.value);
  const msg = h("p", { class: "warn-text", role: "alert" });
  const save = h("button", { class: "primary" }, "Schedule boost");
  save.addEventListener("click", async () => {
    msg.textContent = "";
    const c = boostCreateArgs({
      start: start.value,
      end: end.value,
      multiplier: multiplier.value,
      events: picked(events),
      who: picked(who),
      budget: budget.value,
    });
    if (!c.ok) return (msg.textContent = boostReasonText(c.reason));
    save.disabled = true;
    const r = await act(() => api.rpc("referral_admin_boost_create", c.args));
    save.disabled = false;
    if (!r) return;
    if (!r.ok) return (msg.textContent = boostReasonText(r.reason));
    toast(r.boost?.status === "running" ? "Boost running now" : "Boost scheduled");
    for (const i of [start, end, budget]) i.value = "";
    reload();
  });
  return h(
    "section",
    { class: "card" },
    h("h3", {}, "New boost"),
    h(
      "div",
      { class: "form-row" },
      h("label", {}, "Start (your time zone)", start),
      h("label", {}, "End (your time zone)", end),
    ),
    h(
      "div",
      { class: "form-row" },
      h("label", {}, "Multiplier (2 = double)", multiplier),
      h("label", {}, "Budget: most boosted rewards (optional)", budget),
    ),
    h("div", { class: "form-row" }, events, who),
    h(
      "p",
      { class: "note" },
      "The end date is shown to users and cannot be extended once the boost starts. It can be ended early. At most 31 days, and boosts cannot overlap.",
    ),
    msg,
    save,
  );
}

/** One boost as a wrapping row (a table needs side-scrolling at phone width and hid the End button). */
function boostItem(b, end) {
  const s = boostStatus(b.status);
  return h(
    "div",
    { class: "boost" },
    h(
      "div",
      { class: "boost-text" },
      h("div", {}, h("span", { class: `chip ${s.kind}` }, s.label), " ", h("strong", {}, boostLine(b))),
      h("div", { class: "muted" }, `${fmtTime(b.starts_at)} → ${fmtTime(b.ends_at)}`),
      h("div", { class: "muted" }, `Boosted rewards: ${boostBudgetText(b)}`),
    ),
    b.status === "ended" ? null : h("button", { onclick: (e) => end(b, e.target) }, "End"),
  );
}

function bar(width) {
  const fill = h("span", { class: "bar-fill" });
  fill.style.width = `${Math.max(0, Math.min(100, Number(width) || 0))}%`;
  return h("span", { class: "bar", "aria-hidden": "true" }, fill);
}
