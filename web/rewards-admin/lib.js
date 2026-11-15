// Pure helpers for the rewards admin page (no DOM, no network): tested with `deno test web/rewards-admin/`.

/** Program kinds and a starting config for each (ADR 0002 §6, §18.2). */
export const PROGRAM_TEMPLATES = {
  streak: { event: "chapter_finished", weekly_free_freezes: 1, max_freezes: 2, daily_goal: 1 },
  milestone: { event: "chapter_finished" },
  quiz: { bank: "default", questions: 10, mix: { true_false: [2, 3] }, attempts_per_day: 1, avoid_days: 30 },
  quest_set: { reset: "daily", tasks: [{ key: "task_one", event: "chapter_finished", count: 1 }] },
  offer: { window_minutes: 1440, start_on: "first_seen" },
  social_tag: { platform: "instagram", account: "your_account", code_prefix: "APP", repeat_days: null },
  comeback: { event: "chapter_finished", after_days: 7 },
  recharge: { max: 3, every_minutes: 240 },
  window: { from: "21:00", to: "22:00" },
  friend_streak: { event: "chapter_finished", max_friends: 5 },
  league: {
    event: "chapter_finished",
    group_size: 20,
    week_start: 1,
    tiers: ["Bronze", "Silver", "Gold"],
    promote: 3,
    demote: 0,
    min_score: 1,
  },
  followup: {
    channel: "notification",
    trigger: { type: "inactive_days", days: 2 },
    time: "reminder",
    group: "daily",
    priority: 30,
    title: "App name",
    body: "Your next step is still here.",
    payload: "/home",
  },
};

/** Which rule fields a kind takes (threshold required / forbidden, allowed repeats). */
export function ruleShape(kind) {
  if (["recharge", "window", "followup"].includes(kind)) return { rules: false };
  if (["streak", "friend_streak"].includes(kind)) {
    return { rules: true, threshold: "required", repeats: ["once", "each_cycle", "every"] };
  }
  if (kind === "milestone") return { rules: true, threshold: "required", repeats: ["once", "every"] };
  if (kind === "league") {
    return { rules: true, threshold: "required", repeats: ["once"], thresholdLabel: "Place (1 = first, 3 = top 3)" };
  }
  if (kind === "quiz") {
    return { rules: true, threshold: "required", repeats: ["once"], thresholdLabel: "Minimum score" };
  }
  return { rules: true, threshold: "none", repeats: ["once"] };
}

/** Settings the admin API accepts, with their input type. */
export const SETTINGS_FIELDS = [
  ["enabled", "bool", "Rewards on (master switch)"],
  ["ads_enabled", "bool", "Count rewarded ads (RevenueCat)"],
  ["rc_allow_sandbox", "bool", "Count RevenueCat sandbox events (testing only)"],
  ["surprise_daily_cap", "int", "Most surprise rewards per user a day (0 = surprises off)"],
  ["email_followups_enabled", "bool", "Send follow-up emails (the function also needs REWARDS_EMAIL_DRY_RUN=false)"],
  ["email_max_series", "int", "Most follow-up emails per person, ever"],
  ["email_cooldown_days", "int", "Days between two follow-up emails"],
  ["quiet_from", "text", "Quiet hours start (HH:MM, local)"],
  ["quiet_to", "text", "Quiet hours end (HH:MM, local)"],
  ["default_reminder_time", "text", "Reminder time when the user set none (HH:MM)"],
  ["daily_grant_cap", "int", "Most grants a day (all users)"],
  ["default_timezone", "text", "Default timezone (IANA)"],
  ["social_window_days", "int", "Days to find an Instagram post"],
  ["events_retention_days", "int", "Days to keep events"],
  ["max_attempts", "int", "Grant attempts before failed"],
  ["lease_minutes", "int", "Worker lease minutes"],
];

/** Parse a JSON text field; `want` = "object" | "array" | "any". */
export function parseJson(text, want = "object") {
  let v;
  try {
    v = JSON.parse(
      text === undefined || text === null || String(text).trim() === "" ? (want === "array" ? "[]" : "{}") : text,
    );
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${e.message}` };
  }
  const isObj = typeof v === "object" && v !== null && !Array.isArray(v);
  if (want === "object" && !isObj) return { ok: false, error: "Must be a JSON object { … }" };
  if (want === "array" && !Array.isArray(v)) return { ok: false, error: "Must be a JSON array [ … ]" };
  return { ok: true, value: v };
}

/** A setup file for rewards_admin_import: checked before it is sent. */
export function checkSetupFile(text) {
  const p = parseJson(text, "object");
  if (!p.ok) return p;
  if (p.value.format !== "rewards-config" || p.value.version !== 1) {
    return { ok: false, error: "Not a rewards setup file (format rewards-config, version 1)" };
  }
  return p;
}

/** Counts per action of an import's change list, for the summary line. */
export function summarizeChanges(changes) {
  const out = {};
  for (const c of changes ?? []) out[c.action] = (out[c.action] ?? 0) + 1;
  return out;
}

/** The server's `rewards: <reason>` as a sentence for the admin. */
export function reasonText(err) {
  const msg = String(err?.message ?? err ?? "");
  const m = msg.match(/rewards: ([a-z_]+)(.*)/);
  const reason = m ? m[1] : null;
  const known = {
    not_admin: "This account is not an admin of rewards. Ask an admin to add it (rewards_admin_set_admin).",
    not_signed_in: "Signed out. Sign in again.",
    unknown_setting: `Unknown setting${m?.[2] ?? ""}.`,
    unknown_program: "No such program.",
    unknown_rule: "No such rule.",
    not_retryable: "Only failed grants of a user who still exists can be retried.",
    bad_config: "Not a rewards setup file.",
    cannot_remove_self: "You cannot remove yourself as an admin.",
    template_needs_unsubscribe: "An email template must contain {{unsubscribe_url}} (the one-click stop link).",
    bad_groups: "Group names are lower-case letters, digits and _.",
    unknown_user: "No user with that id.",
    note_required: "Write a note: why this reward (at most 500 characters).",
    bad_amount: "The amount is a whole number from 1 to 1,000,000.",
    bad_kind: "The kind is a lower-case name such as coins (a mystery cannot be given by hand).",
  };
  if (reason && known[reason]) return known[reason];
  if (reason) return msg.slice(msg.indexOf("rewards:"));
  if (/PGRST202|Could not find the function/.test(msg)) {
    return "The rewards functions are not on this project yet (apply the migrations).";
  }
  if (/Failed to fetch|NetworkError/.test(msg)) return "Cannot reach the project. Check the URL and your connection.";
  return msg || "Something went wrong.";
}

/** Only real Instagram post links are ever made clickable. */
export function safeInstagramUrl(url) {
  return typeof url === "string" && /^https:\/\/www\.instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]{5,40}\/$/.test(url)
    ? url
    : null;
}

/** Bars for a small chart: values → rectangles scaled to `height`. */
export function bars(values, { width = 600, height = 120, gap = 2 } = {}) {
  const n = values.length;
  if (n === 0) return [];
  const max = Math.max(1, ...values.map((v) => Number(v) || 0));
  const w = Math.max(1, (width - gap * (n - 1)) / n);
  return values.map((v, i) => {
    const h = Math.round(((Number(v) || 0) / max) * height);
    return { x: Math.round(i * (w + gap)), y: height - h, w: Math.max(1, Math.floor(w)), h };
  });
}

/** Headline numbers from rewards_admin_analytics. */
export function kpis(a) {
  const daily = a?.daily ?? [];
  const sum = (k) => daily.reduce((t, d) => t + (Number(d[k]) || 0), 0);
  const p = a?.open_problems ?? {};
  return {
    events: sum("events"),
    grants: sum("grants"),
    peakActive: daily.reduce((m, d) => Math.max(m, Number(d.active_users) || 0), 0),
    problems: (Number(p.failed) || 0) + (Number(p.retrying) || 0),
    socialPending: Number(p.social_pending) || 0,
  };
}

/** Quiz questions sorted hardest first (lowest correct rate among those answered at least `min` times). */
export function hardestQuestions(stats, min = 5) {
  return [...(stats ?? [])]
    .filter((q) => (q.answered ?? 0) >= min)
    .sort((a, b) => (a.correct_rate ?? 1) - (b.correct_rate ?? 1));
}

/**
 * Quiz questions from pasted CSV: `kind,prompt,choices (a|b|c),answer (1-based),seconds[,explanation]`.
 * Returns {questions, errors}; a row with a problem is skipped and named in errors.
 */
export function questionsFromCsv(text) {
  const questions = [];
  const errors = [];
  const rows = parseCsv(text);
  rows.forEach((r, i) => {
    if (i === 0 && /^kind$/i.test((r[0] ?? "").trim())) return; // header
    if (r.every((c) => c.trim() === "")) return;
    const [kind, prompt, choicesText, answerText, seconds, explanation] = r.map((c) => (c ?? "").trim());
    const choices = (choicesText ?? "").split("|").map((c) => c.trim()).filter(Boolean);
    const answer = Number(answerText) - 1;
    const kinds = ["choice", "true_false", "odd_one_out", "listen", "picture"];
    const k = kind || "choice";
    const problem = !kinds.includes(k)
      ? `unknown kind "${k}"`
      : !prompt
      ? "no prompt"
      : choices.length < 2
      ? "needs at least two choices (a|b)"
      : !(Number.isInteger(answer) && answer >= 0 && answer < choices.length)
      ? "answer must be the number of a choice (1 = first)"
      : k === "true_false" && choices.length !== 2
      ? "true_false needs exactly two choices"
      : null;
    if (problem) {
      errors.push(`Row ${i + 1}: ${problem}`);
      return;
    }
    const q = { kind: k, prompt, choices, answer, time_limit_s: Number(seconds) || 15 };
    if (explanation) q.explanation = explanation;
    questions.push(q);
  });
  return { questions, errors };
}

/** Minimal CSV: commas, double-quoted fields, "" for a quote, CRLF or LF. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export const fmtNum = (n) => (n === null || n === undefined ? "–" : Number(n).toLocaleString("en"));
export const fmtPct = (r) => (r === null || r === undefined ? "–" : `${Math.round(Number(r) * 100)} %`);
export function fmtTime(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => UUID.test(String(s ?? "").trim());

/** "1 in 10", "35 %": how a chance reads to people. */
export function chanceText(chance) {
  const c = Number(chance);
  if (!(c > 0 && c <= 1)) return null;
  if (c === 1) return "always";
  const n = 1 / c;
  return Math.abs(n - Math.round(n)) < 0.05 ? `1 in ${Math.round(n)}` : `${Math.round(c * 100)} %`;
}

/** The surprise part of a rule for the rules table: "1 in 10 · 5–30", "5–30", or "". */
export function ruleSurprise(params) {
  const parts = [];
  const c = chanceText(params?.chance);
  if (c) parts.push(c);
  const r = params?.amount_range;
  if (Array.isArray(r) && r.length === 2) parts.push(`${r[0]}–${r[1]}`);
  return parts.join(" · ");
}

const escHtml = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Same rules as the email function's fillTemplate: values escaped, {{body}} as <p> paragraphs, unknown names empty. */
export function fillEmailTemplate(tpl, v) {
  const paras = String(v.body ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const values = {
    subject: escHtml(v.subject),
    heading: escHtml(v.heading),
    body: paras.map((p) => `<p>${escHtml(p)}</p>`).join("\n"),
    button: escHtml(v.button),
    url: escHtml(v.url),
    name: escHtml(v.name),
    app_name: escHtml(v.app_name),
    unsubscribe_url: escHtml(v.unsubscribe_url),
  };
  return String(tpl).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k) => values[k] ?? "");
}

/**
 * The "Give a reward" form → arguments for rewards_admin_grant, checked like the database does (ADR 0002 §18.9).
 * `requestId` makes a second click of the same form a duplicate on the server, never a second reward.
 */
export function manualGrantArgs({ userId, kind, amount, params, note, requestId }) {
  const fail = (error) => ({ ok: false, error });
  if (!isUuid(userId)) return fail("Paste a user id (uuid).");
  const k = String(kind ?? "").trim();
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(k) || k === "mystery") {
    return fail("Kind: a lower-case name such as coins (not mystery).");
  }
  const n = Number(String(amount ?? "").trim());
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) return fail("Amount: a whole number from 1 to 1,000,000.");
  const p = parseJson(params);
  if (!p.ok) return fail(`Params: ${p.error}`);
  const need = {
    entitlement_days: [["entitlement_id"], 'entitlement_days needs {"entitlement_id": "premium"}.'],
    badge: [["badge", "program"], 'A badge needs {"badge": "name", "program": "<program key>"}.'],
    streak_freeze: [["program"], 'A streak freeze needs {"program": "<streak key>"}.'],
    rc_currency: [["currency_code"], 'rc_currency needs {"currency_code": "GEMS"}.'],
  }[k];
  if (need && need[0].some((f) => typeof p.value[f] !== "string" || p.value[f] === "")) return fail(need[1]);
  if (k === "store_offer" && !p.value.offer_code && !p.value.promotional_offer_id) {
    return fail("A store offer needs offer_code or promotional_offer_id.");
  }
  const t = String(note ?? "").trim();
  if (!t || t.length > 500) return fail("Note: why this reward (1–500 characters). It goes to the audit log.");
  const { request_id: _drop, ...rest } = p.value;
  return {
    ok: true,
    value: {
      user_id: String(userId).trim(),
      kind: k,
      amount: n,
      params: requestId ? { ...rest, request_id: requestId } : rest,
      note: t,
    },
  };
}

/** Why a template cannot be saved, or null. Mirrors the database checks. */
export function templateProblem(key, html) {
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(String(key ?? ""))) return "Name: lower-case letters, digits and _, 2–40 long.";
  if (!String(html ?? "").includes("{{unsubscribe_url}}")) return "The template must contain {{unsubscribe_url}}.";
  if (String(html).length > 200000) return "The template is longer than 200,000 characters.";
  return null;
}

/** One line per week of a league overview row: what happened, in plain words (counts only). */
export function leagueWeekLine(w) {
  const parts = [`${w.entries} in ${w.groups} ${w.groups === 1 ? "group" : "groups"}`];
  if (w.closed_groups < w.groups) parts.push(`${w.groups - w.closed_groups} open`);
  if (w.closed_groups > 0) {
    parts.push(`${w.ranked} ranked`, `top score ${w.top_score ?? 0}`, `${w.grants} rewards`);
    if (w.promoted || w.demoted) parts.push(`${w.promoted} up, ${w.demoted} down`);
  }
  return parts.join(" · ");
}
