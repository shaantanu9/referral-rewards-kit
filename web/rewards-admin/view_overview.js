// Overview: rewards_admin_analytics (counts only, never a user).
import { act, barChart, h, loading, mount, table } from "./dom.js";
import { fmtNum, fmtPct, kpis } from "./lib.js";

export async function renderOverview(el, api) {
  let days = 30;
  const draw = async () => {
    mount(el, loading());
    const a = await act(() => api.rpc("rewards_admin_analytics", { days }));
    if (!a) return mount(el, h("p", { class: "muted" }, "Could not load analytics."));
    const k = kpis(a);
    const daily = a.daily ?? [];
    mount(
      el,
      h(
        "div",
        { class: "row between" },
        h("h2", {}, "Overview"),
        h(
          "label",
          {},
          "Period ",
          h("select", {
            onchange: (e) => {
              days = Number(e.target.value);
              draw();
            },
          }, [7, 30, 90].map((d) => h("option", { value: d, selected: d === days ? "" : null }, `${d} days`))),
        ),
      ),
      h(
        "div",
        { class: "tiles" },
        tile("Events", fmtNum(k.events)),
        tile("Rewards given", fmtNum(k.grants)),
        tile("Most active users in a day", fmtNum(k.peakActive)),
        tile("Problems", fmtNum(k.problems), k.problems > 0 ? "warn" : null, "#problems"),
        tile("Posts to review", fmtNum(k.socialPending), k.socialPending > 0 ? "warn" : null, "#instagram"),
      ),
      h(
        "section",
        { class: "card" },
        h("h3", {}, "Events a day"),
        barChart(daily.map((d) => d.events), daily.map((d) => d.day), { title: "Events a day" }),
      ),
      h(
        "section",
        { class: "card" },
        h("h3", {}, "Rewards given a day"),
        barChart(daily.map((d) => d.grants), daily.map((d) => d.day), { title: "Rewards a day" }),
      ),
      h(
        "div",
        { class: "grid2" },
        h(
          "section",
          { class: "card" },
          h("h3", {}, "Events by type"),
          table(a.events_by_type, [["Type", (r) => r.type], ["Events", (r) => fmtNum(r.events)], [
            "Users",
            (r) => fmtNum(r.users),
          ]]),
        ),
        h(
          "section",
          { class: "card" },
          h("h3", {}, "Rewards by program"),
          table(a.grants_by_program, [
            ["Program", (r) => r.program],
            ["Kind", (r) => r.kind],
            ["State", (r) => r.state],
            ["Count", (r) => fmtNum(r.count)],
            ["Amount", (r) => fmtNum(r.amount)],
          ]),
        ),
        h(
          "section",
          { class: "card" },
          h("h3", {}, "Live streaks"),
          table(a.streaks, [["Program", (r) => r.program], ["Days", (r) => r.bucket], [
            "Users",
            (r) => fmtNum(r.users),
          ]]),
        ),
        h(
          "section",
          { class: "card" },
          h("h3", {}, "Offers"),
          table(a.offers, [
            ["Program", (r) => r.program],
            ["Started", (r) => fmtNum(r.started)],
            ["Claimed", (r) => fmtNum(r.claimed)],
            ["Missed", (r) => fmtNum(r.expired_unclaimed)],
            ["Claim rate", (r) => fmtPct(r.claim_rate)],
          ]),
        ),
        h(
          "section",
          { class: "card" },
          h("h3", {}, "Milestones"),
          table(a.milestones, [["Program", (r) => r.program], ["Users", (r) => fmtNum(r.users)], [
            "Average count",
            (r) => r.avg_count,
          ]]),
        ),
        h(
          "section",
          { class: "card" },
          h("h3", {}, "Instagram posts"),
          table(a.social, [["Program", (r) => r.program], ["State", (r) => r.state], [
            "Checked by",
            (r) => r.verified_by ?? "–",
          ], ["Count", (r) => fmtNum(r.count)]]),
        ),
      ),
    );
  };
  await draw();
}

function tile(label, value, kind, href) {
  const body = [h("div", { class: "tile-value" }, value), h("div", { class: "tile-label" }, label)];
  return href ? h("a", { class: `tile ${kind ?? ""}`, href }, body) : h("div", { class: `tile ${kind ?? ""}` }, body);
}
