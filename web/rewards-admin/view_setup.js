// Settings (incl. the ads switch) and copying a setup between apps (export / import with a dry run first).
import { act, downloadJson, h, loading, mount, table } from "./dom.js";
import { checkSetupFile, SETTINGS_FIELDS, summarizeChanges } from "./lib.js";

export async function renderSettings(el, api) {
  mount(el, loading());
  const cfg = await act(() => api.rpc("rewards_admin_config"));
  if (!cfg) return mount(el, h("p", { class: "muted" }, "Could not load settings."));
  const inputs = {};
  const rows = SETTINGS_FIELDS.map(([key, type, label]) => {
    const v = cfg.settings[key];
    inputs[key] = type === "bool"
      ? h("input", { type: "checkbox", checked: Boolean(v), "data-key": key })
      : h("input", { type: type === "int" ? "number" : "text", value: v ?? "", "data-key": key });
    return h(
      "label",
      { class: type === "bool" ? "inline" : "" },
      type === "bool" ? [inputs[key], " ", label] : [label, inputs[key]],
    );
  });
  const save = async () => {
    const patch = {};
    for (const [key, type] of SETTINGS_FIELDS) {
      const i = inputs[key];
      const v = type === "bool" ? i.checked : type === "int" ? Number(i.value) : i.value.trim();
      if (v !== cfg.settings[key]) patch[key] = v;
    }
    if (!Object.keys(patch).length) return;
    if (await act(() => api.rpc("rewards_admin_save_settings", { patch }), "Settings saved")) renderSettings(el, api);
  };
  mount(
    el,
    h("h2", {}, "Settings"),
    h(
      "section",
      { class: "card" },
      rows,
      h(
        "p",
        { class: "muted" },
        "Ads: the app shows rewarded ads with RevenueCat's AdMob adapter and RevenueCat verifies them. With the switch on, the engine counts each verified ad as ad_watched (for streaks, quests, milestones). Off: RevenueCat's own ad reward still lands; the engine just stops counting.",
      ),
      h("button", { class: "primary", onclick: save }, "Save settings"),
    ),
  );
}

export function renderCopySetup(el, api) {
  const withQuiz = h("input", { type: "checkbox" });
  const text = h("textarea", {
    rows: 10,
    spellcheck: "false",
    placeholder:
      "Paste a setup file, or choose one below (a preset from supabase/app-config/presets/ or another app's export)",
  });
  const file = h("input", {
    type: "file",
    accept: "application/json,.json",
    onchange: async (e) => {
      const f = e.target.files?.[0];
      if (f) text.value = await f.text();
    },
  });
  const out = h("div");
  const exportNow = async () => {
    const cfg = await act(() => api.rpc("rewards_admin_export", { include_quiz: withQuiz.checked }));
    if (cfg) downloadJson(cfg, `rewards-setup-${new Date().toISOString().slice(0, 10)}.json`);
  };
  const dryRun = async () => {
    const c = checkSetupFile(text.value);
    if (!c.ok) return mount(out, h("p", { class: "warn-text" }, c.error));
    const r = await act(() => api.rpc("rewards_admin_import", { config: c.value, dry_run: true }));
    if (!r) return;
    const counts = summarizeChanges(r.changes);
    const refused = counts.refused_kind_change ?? 0;
    mount(
      out,
      h("h3", {}, r.changes.length ? `${r.changes.length} changes` : "Nothing would change"),
      h("p", { class: "muted" }, Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(" · ")),
      refused
        ? h(
          "p",
          { class: "warn-text" },
          `${refused} program(s) have the same key but another kind here; they are skipped. Rename the key in the file to add them.`,
        )
        : null,
      table(r.changes, [["What", (c) => c.what], ["Key", (c) => h("code", {}, c.key)], [
        "Action",
        (c) => h("span", { class: `chip ${c.action.startsWith("refused") ? "bad" : ""}` }, c.action),
      ]]),
      r.changes.length ? h("button", { class: "primary", onclick: () => apply(c.value) }, "Apply these changes") : null,
    );
  };
  const apply = async (value) => {
    const r = await act(() => api.rpc("rewards_admin_import", { config: value, dry_run: false }), "Setup imported");
    if (r) {
      mount(
        out,
        h(
          "p",
          {},
          `Applied ${r.changes.length} changes. New programs from a file start as they were exported; check Programs.`,
        ),
      );
    }
  };
  mount(
    el,
    h("h2", {}, "Copy setup between apps"),
    h(
      "section",
      { class: "card" },
      h("h3", {}, "Export this app's setup"),
      h("label", { class: "inline" }, withQuiz, " Include quiz questions"),
      h("button", { class: "primary", onclick: exportNow }, "Download setup file"),
    ),
    h(
      "section",
      { class: "card" },
      h("h3", {}, "Import a setup"),
      h(
        "p",
        { class: "muted" },
        "Adds and updates; never deletes, never changes a program's kind. You see every change before anything is saved.",
      ),
      file,
      text,
      h("button", { class: "primary", onclick: dryRun }, "Check (dry run)"),
      out,
    ),
  );
}
