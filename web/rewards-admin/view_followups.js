// Follow-ups (bring people back) and retention by sign-up week (ADR 0002 18.7, 18.8 groups and email templates).
import { act, h, loading, mount, table } from "./dom.js";
import { fillEmailTemplate, fmtNum, fmtPct, fmtTime, isUuid, templateProblem } from "./lib.js";

export async function renderFollowups(el, api) {
  mount(el, loading());
  const [cfg, sends, templates] = await Promise.all([
    act(() => api.rpc("rewards_admin_config")),
    act(() => api.rpc("rewards_admin_followup_sends", { max_rows: 100 })),
    act(() => api.rpc("rewards_admin_email_templates")),
  ]);
  if (!cfg) return mount(el, h("p", { class: "muted" }, "Could not load follow-ups."));
  const programs = cfg.programs.filter((p) => p.kind === "followup");
  const s = cfg.settings;
  const preview = h("div");
  const look = async (p) => {
    mount(preview, loading());
    const r = await act(() => api.rpc("rewards_admin_followup_preview", { program: p.key }));
    if (!r) return mount(preview);
    if (r.channel === "notification") return mount(preview, h("p", { class: "muted" }, r.note));
    mount(
      preview,
      h("h3", {}, `${p.key}: ${fmtNum(r.count)} would get it now${r.emails_on ? "" : " (emails are off in Settings)"}`),
      table(r.sample, [["User", (x) => h("code", {}, x.user_id)], ["Email", (x) => x.email]], "Nobody right now."),
    );
  };
  const userId = h("input", { placeholder: "User id to see their planned notifications", size: 40 });
  const plan = h("div");
  const showPlan = async () => {
    if (!isUuid(userId.value)) return mount(plan, h("p", { class: "warn-text" }, "Paste a user id (uuid)."));
    const r = await act(() => api.rpc("rewards_admin_followup_plan", { user_id: userId.value.trim(), days: 14 }));
    if (r) {
      mount(
        plan,
        table(r.plan, [["When", (x) => fmtTime(x.at)], ["Program", (x) => x.program], [
          "Text",
          (x) => `${x.title}: ${x.body}`,
        ], [
          "Opens",
          (x) => h("code", {}, x.payload),
        ]], "Nothing planned for this user."),
      );
    }
  };
  mount(
    el,
    h("h2", {}, "Follow-ups"),
    h(
      "p",
      { class: "muted" },
      `Emails ${
        s.email_followups_enabled ? "on" : "off"
      } · at most ${s.email_max_series} per person, ${s.email_cooldown_days} days apart · quiet hours ${
        String(s.quiet_from).slice(0, 5)
      }–${
        String(s.quiet_to).slice(0, 5)
      } · one notification a day per group. Change these in Settings; add follow-ups in Programs (kind followup).`,
    ),
    h(
      "section",
      { class: "card" },
      table(programs, [
        ["Program", (p) => h("code", {}, p.key)],
        ["Channel", (p) => p.config.channel],
        ["When", (p) => describeTrigger(p.config.trigger, p.config.activity_events)],
        [
          "Group",
          (p) =>
            p.config.channel === "email"
              ? (p.config.email?.template ? `template ${p.config.email.template}` : "built-in email")
              : `${p.public?.group_label ?? p.config.group ?? "daily"}`,
        ],
        ["Says", (p) => p.config.channel === "email" ? p.config.email?.subject : `${p.config.title}: ${p.config.body}`],
        ["", (p) => h("span", { class: `chip ${p.live ? "ok" : "off"}` }, p.live ? "on" : "off")],
        ["", (p) => h("button", { onclick: () => look(p) }, "Who now?")],
      ], "No follow-ups yet. Import the retention preset in Copy setup, or add a program of kind followup."),
      preview,
    ),
    h(
      "section",
      { class: "card" },
      h("h3", {}, "A user's planned notifications"),
      h("div", { class: "form-row" }, userId, h("button", { onclick: showPlan }, "Show")),
      plan,
    ),
    templatesCard(api, templates ?? [], programs, () => renderFollowups(el, api)),
    h(
      "section",
      { class: "card" },
      h("h3", {}, "Emails sent"),
      table(sends, [["When", (x) => fmtTime(x.created_at)], ["Program", (x) => x.program_key], [
        "State",
        (x) => h("span", { class: `chip ${x.state === "sent" ? "ok" : x.state === "failed" ? "bad" : ""}` }, x.state),
      ], ["Error", (x) => x.error ?? ""]], "No emails sent yet."),
    ),
  );
}

const SAMPLE = {
  subject: "Your first step is still saved",
  heading: "Hi Asha",
  body: "Two minutes today.\n\nNobody sees it but you.",
  button: "Open",
  url: "https://example.com/open",
  name: "Asha",
  app_name: "Your app",
  unsubscribe_url: "https://example.com/unsubscribe?t=sample",
};

/** Branded email layouts: pick one, edit the HTML, see it filled with sample text in a sandboxed frame. */
function templatesCard(api, templates, programs, reload) {
  const key = h("input", { placeholder: "name, e.g. brand", size: 20 });
  const html = h("textarea", { rows: 12, spellcheck: "false", class: "code", style: "width:100%" });
  // sandbox="" : no scripts, no forms, no navigation, its own origin — the template is shown, never run
  const frame = h("iframe", {
    sandbox: "",
    title: "Template preview",
    style: "width:100%;height:360px;border:1px solid #d4d7dd;border-radius:8px;background:#fff",
  });
  const problem = h("p", { class: "warn-text" });
  const used = (k) => programs.filter((p) => p.config.email?.template === k).map((p) => p.key);
  const show = () => {
    frame.srcdoc = fillEmailTemplate(html.value, SAMPLE);
    problem.textContent = html.value || key.value ? templateProblem(key.value, html.value) ?? "" : "";
  };
  const pick = (t) => {
    key.value = t?.key ?? "";
    html.value = t?.html ?? "";
    show();
  };
  html.addEventListener("input", show);
  key.addEventListener("input", show);
  const save = async () => {
    const why = templateProblem(key.value, html.value);
    if (why) return (problem.textContent = why);
    if (
      await act(
        () => api.rpc("rewards_admin_email_template_save", { key: key.value, html: html.value }),
        "Template saved",
      )
    ) reload();
  };
  const remove = async (t) => {
    if (used(t.key).length) {
      return (problem.textContent = `Used by ${used(t.key).join(", ")}: change those programs first.`);
    }
    if (await act(() => api.rpc("rewards_admin_email_template_save", { key: t.key, html: null }), "Template deleted")) {
      reload();
    }
  };
  const card = h(
    "section",
    { class: "card" },
    h("h3", {}, "Email templates"),
    h(
      "p",
      { class: "muted" },
      'Your app\'s layout for follow-up emails. Placeholders: {{heading}} {{body}} {{button}} {{url}} {{name}} {{subject}} {{app_name}} and the required {{unsubscribe_url}}. Values are escaped; an email program uses one with "template": "name" in its email settings, and without one gets the plain built-in layout.',
    ),
    table(templates, [
      ["Name", (t) => h("code", {}, t.key)],
      ["Used by", (t) => used(t.key).join(", ") || "–"],
      ["Updated", (t) => fmtTime(t.updated_at)],
      ["", (t) => h("button", { onclick: () => pick(t) }, "Edit")],
      ["", (t) => h("button", { class: "danger", onclick: () => remove(t) }, "Delete")],
    ], "No templates yet: emails use the built-in layout."),
    h(
      "div",
      { class: "form-row" },
      key,
      h("button", { onclick: () => pick({ key: "", html: STARTER }) }, "New from starter"),
      h("button", { class: "primary", onclick: save }, "Save"),
    ),
    problem,
    html,
    h("h4", {}, "Preview (sample text)"),
    frame,
  );
  // fill after the card is on the page: a frame given srcdoc while detached can stay blank
  setTimeout(() => pick(templates[0]), 0);
  return card;
}

const STARTER = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px">
<h1 style="font-size:20px">{{heading}}</h1>
{{body}}
<p><a href="{{url}}" style="background:#0f766e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">{{button}}</a></p>
<p style="font-size:12px;color:#5d6470">You get this because you use {{app_name}}. <a href="{{unsubscribe_url}}">Stop these emails</a>.</p>
</div>`;

export function describeTrigger(t, events) {
  if (!t) return "–";
  const extra = [
    events?.length ? `counts ${events.join(", ")}` : "",
    t.min_actions ? `after ${t.min_actions}+ actions` : "",
  ].filter(Boolean).join("; ");
  const base = describeType(t);
  return extra ? `${base} (${extra})` : base;
}

function describeType(t) {
  switch (t.type) {
    case "daily":
      return "every day, skipped once active that day";
    case "inactive_days":
      return `${t.days} days without activity`;
    case "streak_at_risk":
      return `streak ${t.program} at risk, ${t.hours_before ?? 4} h before it breaks`;
    case "reward_waiting":
      return "a reward is waiting";
    case "weekly_recap":
      return `weekly, day ${t.weekday}`;
    case "days_since_signup":
      return `${t.from}–${t.to} days after sign-up${t.no_activity_since_signup ? ", no activity since" : ""}`;
    default:
      return t.type;
  }
}

export async function renderRetention(el, api) {
  mount(el, loading());
  const rows = await act(() => api.rpc("rewards_admin_retention", { weeks: 8 }));
  const rate = (n, d) => (d ? fmtPct(n / d) : "–");
  mount(
    el,
    h("h2", {}, "Retention"),
    h(
      "p",
      { class: "muted" },
      "By sign-up week. North star: people active on 3 of their first 7 days. Small numbers: read trends, not percentages.",
    ),
    h(
      "section",
      { class: "card" },
      table(rows, [
        ["Week", (r) => r.week],
        ["Sign-ups", (r) => fmtNum(r.signups)],
        ["Active in 24 h", (r) => `${fmtNum(r.activated_24h)} (${rate(r.activated_24h, r.signups)})`],
        ["Back on day 1", (r) => `${fmtNum(r.returned_d1)} (${rate(r.returned_d1, r.signups)})`],
        ["3 of first 7 days", (r) => `${fmtNum(r.active_3_of_7)} (${rate(r.active_3_of_7, r.signups)})`],
        ["Notification opens → active", (r) => `${fmtNum(r.notification_opens)} → ${fmtNum(r.opens_then_active_24h)}`],
        ["Emails / unsubscribed", (r) => `${fmtNum(r.emails_sent)} / ${fmtNum(r.unsubscribed)}`],
      ], "No sign-ups in the last 8 weeks."),
    ),
  );
}
