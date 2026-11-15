// Weekly leagues (ADR 0002 18.10): per program, members by tier and each recent week in counts. Never a user or a name.
import { act, h, loading, mount, table } from "./dom.js";
import { fmtNum, fmtTime, leagueWeekLine } from "./lib.js";

export async function renderLeagues(el, api) {
  const draw = async () => {
    mount(el, loading());
    const rows = await act(() => api.rpc("rewards_admin_leagues", { program: null, weeks: 4 }));
    if (!rows) return mount(el, h("p", { class: "muted" }, "Could not load leagues."));
    mount(
      el,
      h(
        "div",
        { class: "row between" },
        h("h2", {}, "Leagues"),
        h("button", {
          onclick: async () => {
            const r = await act(() => api.rpc("rewards_admin_league_close"));
            if (r) {
              await draw();
              if (r.closed > 0) el.prepend(h("p", { class: "muted" }, `${r.closed} ended groups closed.`));
            }
          },
        }, "Close ended weeks now"),
      ),
      h(
        "p",
        { class: "muted" },
        "Opt-in weekly groups. Ended weeks close by themselves (the worker, or when a member opens the board); this page shows counts only.",
      ),
      rows.length === 0
        ? h("p", { class: "muted" }, "No league program yet. Add one under Programs (kind league).")
        : rows.map((p) => card(p)),
    );
  };
  await draw();
}

function card(p) {
  const tierName = (t) => p.tiers?.[t] ?? `Tier ${t + 1}`;
  return h(
    "section",
    { class: "card" },
    h("h3", {}, `${p.program}${p.live ? "" : " (off)"}`),
    h(
      "p",
      {},
      `${fmtNum(p.members)} members · ${fmtNum(p.left)} left · groups of up to ${p.group_size} · this week ends ${
        fmtTime(p.ends_at)
      }`,
    ),
    table(
      p.members_by_tier,
      [["Tier", (r) => tierName(r.tier)], ["Members", (r) => fmtNum(r.members)]],
      "Nobody joined yet.",
    ),
    table(p.weeks, [
      ["Week of", (w) => w.week],
      ["Summary", (w) => leagueWeekLine(w)],
      ["Groups", (w) => w.group_sizes.map((g) => `${tierName(g.tier)} ${g.size}${g.closed ? "" : "*"}`).join(", ")],
    ], "No weeks yet."),
    h("p", { class: "muted" }, "* still open"),
  );
}
