// Support: look up a user (and fire a test event), the Instagram review queue, failed rewards, the audit log.
import { act, h, loading, mount, table } from "./dom.js";
import { fmtNum, fmtTime, isUuid, manualGrantArgs, parseJson, safeInstagramUrl } from "./lib.js";

export function renderUsers(el, api) {
  const id = h("input", { placeholder: "User id (uuid from Supabase Auth)", size: 40 });
  const out = h("div");
  const look = async () => {
    if (!isUuid(id.value)) return mount(out, h("p", { class: "warn-text" }, "Paste a user id (uuid)."));
    mount(out, loading());
    const u = await act(() => api.rpc("rewards_admin_user", { user_id: id.value.trim() }));
    if (!u) return mount(out);
    const type = h("input", { placeholder: "event type, e.g. quiz_finished" });
    const props = h("input", { placeholder: '{"score": 10}' });
    const fire = async () => {
      const p = parseJson(props.value);
      if (!p.ok) return;
      const r = await act(
        () => api.rpc("rewards_admin_track", { user_id: id.value.trim(), type: type.value.trim(), props: p.value }),
        "Event sent",
      );
      if (r) look();
    };
    // Give a reward: one request id per form, so a double click is a duplicate on the server, not a second reward.
    const requestId = crypto.randomUUID();
    const gKind = h("input", { value: "coins", placeholder: "coins", list: "grant-kinds" });
    const gAmount = h("input", { type: "number", min: 1, step: 1, value: "", placeholder: "50" });
    const gParams = h("input", { placeholder: '{} or {"entitlement_id": "premium"}' });
    const gNote = h("input", { placeholder: "Why, e.g. outage on 12 Nov", maxlength: 500 });
    const gProblem = h("p", { class: "warn-text", role: "alert" });
    const give = async (e) => {
      const a = manualGrantArgs({
        userId: id.value,
        kind: gKind.value,
        amount: gAmount.value,
        params: gParams.value,
        note: gNote.value,
        requestId,
      });
      gProblem.textContent = a.ok ? "" : a.error;
      if (!a.ok) return;
      e.target.disabled = true;
      const r = await act(() => api.rpc("rewards_admin_grant", a.value), "Reward given");
      e.target.disabled = false;
      if (r) look();
    };
    mount(
      out,
      h("p", {}, `Timezone: ${u.timezone ?? "default"} · Rewards ${u.state?.enabled === false ? "off" : "on"}`),
      h("h3", {}, "Streaks"),
      table(u.state?.streaks, [["Program", (s) => s.program], ["Now", (s) => s.current], ["Best", (s) => s.longest], [
        "Today",
        (s) => (s.today_done ? "done" : "not yet"),
      ]]),
      h("h3", {}, "Badges"),
      h("p", {}, (u.state?.badges ?? []).map((b) => b.badge).join(", ") || "None"),
      h("h3", {}, "Events"),
      table(u.events, [["Type", (e) => e.type], ["Count", (e) => fmtNum(e.count)], [
        "Last",
        (e) => fmtTime(e.last_at),
      ]]),
      h("h3", {}, "Rewards"),
      table(u.grants, [["When", (g) => fmtTime(g.created_at)], [
        "Program",
        (g) => g.program_key ?? (g.params?.manual ? "manual" : ""),
      ], [
        "Reward",
        (g) => `${g.amount} ${g.kind}`,
      ], [
        "State",
        (g) =>
          h("span", { class: `chip ${g.state === "granted" ? "ok" : g.state === "failed" ? "bad" : ""}` }, g.state),
      ], ["Error", (g) => g.last_error ?? ""]]),
      h("h3", {}, "Instagram posts"),
      table(u.social_posts, [
        ["Program", (s) => s.program_key],
        ["Handle", (s) => `@${s.handle}`],
        ["Code", (s) => s.code],
        ["State", (s) => s.state],
        ["Link", (s) => link(s.post_url)],
      ]),
      h("h3", {}, "Send a test event"),
      h("p", { class: "muted" }, "For test accounts while setting up: the event counts like a real one."),
      h("div", { class: "form-row" }, h("label", {}, "Type", type), h("label", {}, "Props (JSON)", props)),
      h("button", { onclick: fire }, "Send"),
      h("h3", {}, "Give a reward"),
      h(
        "p",
        { class: "muted" },
        "A manual compensation: paid like a program's reward (the app's hook, or RevenueCat for entitlement_days), " +
          "logged with your note.",
      ),
      h(
        "datalist",
        { id: "grant-kinds" },
        ["coins", "entitlement_days", "streak_freeze", "badge", "rc_currency"].map((k) => h("option", { value: k })),
      ),
      h(
        "div",
        { class: "form-row" },
        h("label", {}, "Kind", gKind),
        h("label", {}, "Amount", gAmount),
        h("label", {}, "Params (JSON)", gParams),
        h("label", {}, "Note", gNote),
      ),
      gProblem,
      h("button", { class: "primary", onclick: give }, "Give reward"),
    );
  };
  mount(
    el,
    h("h2", {}, "Users"),
    h("div", { class: "form-row" }, id, h("button", { class: "primary", onclick: look }, "Look up")),
    out,
  );
}

export async function renderInstagram(el, api) {
  let state = "pending";
  const draw = async () => {
    mount(el, loading());
    const posts = await act(() => api.rpc("rewards_admin_social_queue", { state, max_rows: 200 })) ?? [];
    const decide = async (p, approve) => {
      if (
        await act(
          () => api.rpc("rewards_admin_review_social", { post_id: p.id, approve }),
          approve ? "Approved and rewarded" : "Rejected",
        )
      ) draw();
    };
    mount(
      el,
      h(
        "div",
        { class: "row between" },
        h("h2", {}, "Instagram posts"),
        h(
          "select",
          {
            onchange: (e) => {
              state = e.target.value;
              draw();
            },
          },
          ["pending", "expired", "rejected", "verified"].map((s) =>
            h("option", { value: s, selected: s === state ? "" : null }, s)
          ),
        ),
      ),
      h(
        "p",
        { class: "muted" },
        "Posts Meta's webhook did not match. Open the link, check it tags the account and says it was rewarded (#ad), then decide.",
      ),
      table(posts, [
        ["Sent", (p) => fmtTime(p.created_at)],
        ["Handle", (p) => `@${p.handle}`],
        ["Code", (p) => p.code],
        ["Post", (p) => link(p.post_url)],
        ["", (p) =>
          state === "verified" ? "" : [
            h("button", {
              class: "primary",
              onclick: () => decide(p, true),
            }, "Approve"),
            " ",
            state === "pending" ? h("button", { onclick: () => decide(p, false) }, "Reject") : null,
          ]],
      ], "Nothing to review."),
    );
  };
  await draw();
}

export async function renderProblems(el, api) {
  mount(el, loading());
  const [failed, retrying] = await Promise.all([
    act(() => api.rpc("rewards_admin_grants", { state: "failed", max_rows: 200 })),
    act(() => api.rpc("rewards_admin_grants", { state: "failed_retryable", max_rows: 200 })),
  ]);
  const retry = async (g) => {
    if (await act(() => api.rpc("rewards_admin_retry_grant", { grant_id: g.id }), "Retried")) renderProblems(el, api);
  };
  const cols = [
    ["When", (g) => fmtTime(g.created_at)],
    ["Program", (g) => g.program_key],
    ["Reward", (g) => `${g.amount} ${g.kind}`],
    ["Attempts", (g) => g.attempts],
    ["Last error", (g) => g.last_error ?? ""],
  ];
  mount(
    el,
    h("h2", {}, "Problems"),
    h("h3", {}, "Failed (gave up)"),
    h(
      "p",
      { class: "muted" },
      "Fix the cause first (the app's grant hook, RevenueCat key), then retry: the same reward is never paid twice.",
    ),
    table(
      failed,
      [...cols, ["", (g) => h("button", { class: "primary", onclick: () => retry(g) }, "Retry")]],
      "No failed rewards.",
    ),
    h("h3", {}, "Retrying by themselves"),
    table(retrying, cols, "None."),
  );
}

export async function renderLog(el, api) {
  mount(el, loading());
  const log = await act(() => api.rpc("rewards_admin_log", { max_rows: 300 })) ?? [];
  mount(
    el,
    h("h2", {}, "Audit log"),
    h("p", { class: "muted" }, "Every change made through this page or the admin API."),
    table(log, [["When", (l) => fmtTime(l.at)], ["Who", (l) => l.actor ?? "service role"], ["What", (l) => l.action], [
      "Detail",
      (l) => h("code", {}, JSON.stringify(l.detail)),
    ]], "No changes yet."),
  );
}

function link(url) {
  const safe = safeInstagramUrl(url);
  return safe
    ? h("a", { href: safe, target: "_blank", rel: "noopener noreferrer" }, "Open post")
    : url
    ? "link not shown (not an Instagram post link)"
    : "–";
}
