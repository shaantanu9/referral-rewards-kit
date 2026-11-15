// Programs, their rules, and event types (rewards_admin_config / save_program / add_rule / set_rule_active /
// save_event_type). Rules are append-only: change one by adding the new version and turning the old one off.
import { act, h, loading, mount, table } from "./dom.js";
import { parseJson, PROGRAM_TEMPLATES, ruleShape, ruleSurprise } from "./lib.js";

/** Program cards stay open across reloads (after saving or adding a rule). */
const openPrograms = new Set();

export async function renderPrograms(el, api) {
  mount(el, loading());
  const cfg = await act(() => api.rpc("rewards_admin_config"));
  if (!cfg) return mount(el, h("p", { class: "muted" }, "Could not load the setup."));
  const reload = () => renderPrograms(el, api);
  mount(
    el,
    h("h2", {}, "Programs"),
    h(
      "p",
      { class: "muted" },
      "Each program is one feature you turn on. A program's kind never changes; rules are added, never edited.",
    ),
    cfg.programs.map((p) => programCard(p, api, reload)),
    newProgramCard(api, reload),
    h("h2", {}, "Event types"),
    eventTypesCard(cfg.event_types, api, reload),
  );
}

function programCard(p, api, reload) {
  const config = h("textarea", { rows: 6, spellcheck: "false" }, JSON.stringify(p.config, null, 2));
  const pub = h("textarea", { rows: 2, spellcheck: "false" }, JSON.stringify(p.public ?? {}, null, 2));
  const enabled = h("input", { type: "checkbox", checked: p.enabled });
  const save = async () => {
    const c = parseJson(config.value);
    const u = parseJson(pub.value);
    if (!c.ok || !u.ok) return alertBox(config, c.error ?? u.error);
    const ok = await act(() =>
      api.rpc("rewards_admin_save_program", {
        key: p.key,
        kind: p.kind,
        enabled: enabled.checked,
        config: c.value,
        public: u.value,
        starts_at: p.starts_at,
        ends_at: p.ends_at,
        sort: p.sort ?? 0,
      }), `Saved ${p.key}`);
    if (ok) reload();
  };
  return h(
    "details",
    {
      class: "card program",
      "data-key": p.key,
      open: openPrograms.has(p.key),
      ontoggle: (e) => (e.target.open ? openPrograms.add(p.key) : openPrograms.delete(p.key)),
    },
    h(
      "summary",
      {},
      h("strong", {}, p.public?.title ?? p.key),
      " ",
      h("span", { class: "chip" }, p.kind),
      " ",
      h("span", { class: `chip ${p.live ? "ok" : "off"}` }, p.live ? "live" : p.enabled ? "outside its dates" : "off"),
      " ",
      h("code", {}, p.key),
    ),
    h("label", { class: "inline" }, enabled, " Switched on"),
    h("label", {}, "Config (JSON)", config),
    h("label", {}, "Public display JSON (sent to the app as is)", pub),
    h("button", { class: "primary", onclick: save }, "Save program"),
    rulesBlock(p, api, reload),
  );
}

function rulesBlock(p, api, reload) {
  const shape = ruleShape(p.kind);
  if (!shape.rules) return h("p", { class: "muted" }, "This kind takes no rules: the app reads its state.");
  const kind = h("input", {
    placeholder: "coins, minutes, badge, entitlement_days, rc_currency, mystery…",
    value: "coins",
  });
  const amount = h("input", { type: "number", step: "any", min: "0", value: "10" });
  const threshold = h("input", { type: "number", min: "1", placeholder: shape.thresholdLabel ?? "Threshold" });
  const repeat = h("select", {}, shape.repeats.map((r) => h("option", { value: r }, r)));
  const params = h("textarea", {
    rows: 2,
    spellcheck: "false",
    placeholder:
      '{"badge":"night_owl"} · {"audience":"free"} · surprise: {"chance":0.1,"amount_range":[5,30]} (amount = max)',
  });
  const add = async () => {
    const pr = parseJson(params.value);
    if (!pr.ok) return alertBox(params, pr.error);
    const ok = await act(() =>
      api.rpc("rewards_admin_add_rule", {
        program: p.key,
        kind: kind.value.trim(),
        amount: Number(amount.value),
        threshold: shape.threshold === "required" ? Number(threshold.value) || null : null,
        repeat: repeat.value,
        params: pr.value,
      }), "Rule added");
    if (ok) reload();
  };
  const toggle = async (r) => {
    if (
      await act(
        () => api.rpc("rewards_admin_set_rule_active", { rule_id: r.id, active: !r.active }),
        r.active ? "Rule off" : "Rule on",
      )
    ) reload();
  };
  return h(
    "div",
    { class: "rules" },
    h("h4", {}, "Rules"),
    table(p.rules, [
      ["v", (r) => r.version],
      [shape.thresholdLabel ?? "At", (r) => r.threshold ?? "–"],
      ["Repeat", (r) => r.repeat],
      ["Reward", (r) => `${r.amount} ${r.kind}`],
      ["Surprise", (r) => ruleSurprise(r.params) || "–"],
      ["Params", (r) => h("code", {}, JSON.stringify(r.params))],
      ["", (r) => h("button", { onclick: () => toggle(r) }, r.active ? "Turn off" : "Turn on")],
    ], "No rules yet."),
    h(
      "div",
      { class: "form-row" },
      h("label", {}, "Kind", kind),
      h("label", {}, "Amount", amount),
      shape.threshold === "required" ? h("label", {}, shape.thresholdLabel ?? "Threshold", threshold) : null,
      h("label", {}, "Repeat", repeat),
    ),
    h("label", {}, "Params (JSON)", params),
    h("button", { onclick: add }, "Add rule"),
  );
}

function newProgramCard(api, reload) {
  const key = h("input", { placeholder: "daily_quiz", pattern: "[a-z][a-z0-9_]{1,39}" });
  const kinds = Object.keys(PROGRAM_TEMPLATES);
  const config = h("textarea", { rows: 6, spellcheck: "false" }, JSON.stringify(PROGRAM_TEMPLATES[kinds[0]], null, 2));
  const kind = h("select", {
    onchange: (e) => (config.value = JSON.stringify(PROGRAM_TEMPLATES[e.target.value], null, 2)),
  }, kinds.map((k) => h("option", { value: k }, k)));
  const title = h("input", { placeholder: "Daily quiz" });
  const create = async () => {
    const c = parseJson(config.value);
    if (!c.ok) return alertBox(config, c.error);
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(key.value)) {
      return alertBox(key, "Key: lower case letters, digits and _ (2-40).");
    }
    const ok = await act(() =>
      api.rpc("rewards_admin_save_program", {
        key: key.value,
        kind: kind.value,
        enabled: false,
        config: c.value,
        public: title.value ? { title: title.value } : {},
        starts_at: null,
        ends_at: null,
        sort: 99,
      }), `Created ${key.value} (switched off until you turn it on)`);
    if (ok) reload();
  };
  return h(
    "details",
    { class: "card" },
    h("summary", {}, h("strong", {}, "+ New program")),
    h(
      "div",
      { class: "form-row" },
      h("label", {}, "Key", key),
      h("label", {}, "Kind", kind),
      h("label", {}, "Title", title),
    ),
    h("label", {}, "Config (JSON, a template per kind)", config),
    h("button", { class: "primary", onclick: create }, "Create (off)"),
  );
}

function eventTypesCard(types, api, reload) {
  const name = h("input", { placeholder: "quiz_finished" });
  const source = h(
    "select",
    {},
    h("option", { value: "server" }, "server (trigger / RevenueCat / admin)"),
    h("option", { value: "client" }, "client (the app may send it)"),
  );
  const limit = h("input", { type: "number", min: "1", value: "50" });
  const save = async () => {
    if (
      await act(() =>
        api.rpc("rewards_admin_save_event_type", {
          name: name.value.trim(),
          source: source.value,
          daily_limit: Number(limit.value),
        }), "Event type saved")
    ) reload();
  };
  return h(
    "section",
    { class: "card" },
    table(types, [["Name", (t) => h("code", {}, t.name)], ["Source", (t) => t.source], [
      "Per user / 24 h",
      (t) => t.daily_limit,
    ]]),
    h(
      "p",
      { class: "muted" },
      "Names with review or rating are refused: the stores forbid rewarding them. RevenueCat events arrive as rc_<type>, e.g. rc_initial_purchase.",
    ),
    h(
      "div",
      { class: "form-row" },
      h("label", {}, "Name", name),
      h("label", {}, "Source", source),
      h("label", {}, "Daily limit", limit),
    ),
    h("button", { onclick: save }, "Save event type"),
  );
}

function alertBox(near, message) {
  near.setCustomValidity(message);
  near.reportValidity();
  setTimeout(() => near.setCustomValidity(""), 3000);
}
