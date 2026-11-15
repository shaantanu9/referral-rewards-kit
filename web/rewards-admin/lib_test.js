// deno test web/rewards-admin/ — pure helpers and the demo backend's contract with the page.
import {
  bars,
  checkSetupFile,
  fillEmailTemplate,
  hardestQuestions,
  isUuid,
  kpis,
  manualGrantArgs,
  parseCsv,
  parseJson,
  PROGRAM_TEMPLATES,
  questionsFromCsv,
  reasonText,
  ruleShape,
  safeInstagramUrl,
  summarizeChanges,
  templateProblem,
} from "./lib.js";
import { keyProblem } from "./api.js";
import { createDemoBackend } from "./demo.js";

const eq = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg ?? "not equal"}\n  actual:   ${JSON.stringify(a)}\n  expected: ${JSON.stringify(b)}`);
  }
};
const ok = (v, msg) => {
  if (!v) throw new Error(msg ?? "expected true");
};

Deno.test("parseJson: objects, arrays, empty, errors", () => {
  eq(parseJson('{"a":1}'), { ok: true, value: { a: 1 } });
  eq(parseJson("", "object").value, {});
  eq(parseJson("", "array").value, []);
  ok(!parseJson("[1]", "object").ok);
  ok(parseJson("{bad").error.startsWith("Not valid JSON"));
});

Deno.test("checkSetupFile accepts only rewards-config v1", () => {
  ok(checkSetupFile('{"format":"rewards-config","version":1}').ok);
  ok(!checkSetupFile('{"format":"other","version":1}').ok);
  ok(!checkSetupFile("[]").ok);
});

Deno.test("presets in the repo pass the page's file check", async () => {
  for (const name of ["reader", "quiz", "habit"]) {
    const text = await Deno.readTextFile(new URL(`../../supabase/app-config/presets/${name}.json`, import.meta.url));
    ok(checkSetupFile(text).ok, name);
  }
});

Deno.test("every program kind has a template and a rule shape", () => {
  for (
    const k of [
      "streak",
      "milestone",
      "quiz",
      "quest_set",
      "offer",
      "social_tag",
      "comeback",
      "recharge",
      "window",
      "friend_streak",
      "league",
    ]
  ) {
    ok(PROGRAM_TEMPLATES[k], k);
    ok(ruleShape(k), k);
  }
  eq(ruleShape("window").rules, false);
  eq(ruleShape("quiz").thresholdLabel, "Minimum score");
  eq(ruleShape("offer").threshold, "none");
});

Deno.test("reasonText turns server errors into sentences", () => {
  ok(reasonText(new Error("rewards: not_admin")).includes("not an admin"));
  ok(reasonText(new Error("rewards: unknown_setting adss")).includes("adss"));
  ok(reasonText(new Error("PGRST202 Could not find the function")).includes("migrations"));
  eq(reasonText(new Error("rewards: brand_new")), "rewards: brand_new");
});

Deno.test("only real Instagram post links are clickable", () => {
  eq(safeInstagramUrl("https://www.instagram.com/p/AbCdE123/"), "https://www.instagram.com/p/AbCdE123/");
  eq(safeInstagramUrl("javascript:alert(1)"), null);
  eq(safeInstagramUrl("https://evil.example/p/AbCdE123/"), null);
  eq(safeInstagramUrl("https://www.instagram.com/p/AbCdE123/?x=<script>"), null);
});

Deno.test("bars scale to the height, zero stays empty", () => {
  const b = bars([0, 5, 10], { width: 300, height: 100, gap: 0 });
  eq(b.map((x) => x.h), [0, 50, 100]);
  eq(b[2].y, 0);
  eq(bars([]), []);
});

Deno.test("kpis and change summaries", () => {
  eq(
    kpis({
      daily: [{ events: 3, grants: 1, active_users: 2 }, { events: 4, grants: 2, active_users: 5 }],
      open_problems: { failed: 1, retrying: 2, social_pending: 3 },
    }),
    { events: 7, grants: 3, peakActive: 5, problems: 3, socialPending: 3 },
  );
  eq(summarizeChanges([{ action: "create" }, { action: "create" }, { action: "refused_kind_change" }]), {
    create: 2,
    refused_kind_change: 1,
  });
});

Deno.test("CSV questions: header, quotes, errors per row", () => {
  const csv =
    'kind,prompt,choices,answer,seconds,explanation\nchoice,"Who, really?",A|B|C,2,20,because\ntrue_false,Sky is blue,True|False|Maybe,1,10,\nchoice,No answer,A|B,5,,\n';
  const { questions, errors } = questionsFromCsv(csv);
  eq(questions, [{
    kind: "choice",
    prompt: "Who, really?",
    choices: ["A", "B", "C"],
    answer: 1,
    time_limit_s: 20,
    explanation: "because",
  }]);
  eq(errors.length, 2);
  ok(errors[0].includes("exactly two"));
  ok(errors[1].includes("answer"));
  eq(parseCsv('a,"b ""q""",c'), [["a", 'b "q"', "c"]]);
});

Deno.test("hardest questions first, only with enough answers", () => {
  const s = [{ prompt: "easy", answered: 10, correct_rate: 0.9 }, { prompt: "hard", answered: 10, correct_rate: 0.2 }, {
    prompt: "new",
    answered: 1,
    correct_rate: 0,
  }];
  eq(hardestQuestions(s).map((q) => q.prompt), ["hard", "easy"]);
});

Deno.test("the page refuses a service-role key", () => {
  const jwt = (role) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, "")}.y`;
  ok(keyProblem(jwt("service_role")).includes("service-role"));
  eq(keyProblem(jwt("anon")), null);
  ok(keyProblem("sb_secret_abc").includes("secret"));
  eq(keyProblem("sb_publishable_abc"), null);
  ok(isUuid("11111111-2222-4333-8444-555555555555") && !isUuid("x"));
});

Deno.test("demo backend: same refusals and shapes as the SQL", async () => {
  const d = createDemoBackend();
  const cfg = await d.rpc("rewards_admin_config");
  ok(cfg.programs.length >= 3 && "ads_enabled" in cfg.settings);
  await d.rpc("rewards_admin_save_settings", { patch: { ads_enabled: true } });
  eq((await d.rpc("rewards_admin_config")).settings.ads_enabled, true);
  let err;
  try {
    await d.rpc("rewards_admin_save_settings", { patch: { nope: 1 } });
  } catch (e) {
    err = e;
  }
  ok(reasonText(err).includes("nope"));
  const failed = await d.rpc("rewards_admin_grants", { state: "failed" });
  eq((await d.rpc("rewards_admin_retry_grant", { grant_id: failed[0].id })).state, "granted");
  const exp = await d.rpc("rewards_admin_export", { include_quiz: true });
  eq((await d.rpc("rewards_admin_import", { config: exp, dry_run: true })).changes, []);
  const clash = { ...exp, programs: [{ key: "happy_hour", kind: "streak", config: {} }] };
  eq((await d.rpc("rewards_admin_import", { config: clash, dry_run: true })).changes[0].action, "refused_kind_change");
  ok((await d.rpc("rewards_admin_log")).length >= 2, "settings + retry are logged");
  let missing;
  try {
    await d.rpc("rewards_admin_nope");
  } catch (e) {
    missing = e;
  }
  ok(reasonText(missing).includes("migrations"));
});

Deno.test("give a reward: the form is checked like the database, the demo answers like the SQL", async () => {
  const userId = "11111111-2222-4333-8444-555555555555";
  const base = {
    userId,
    kind: "coins",
    amount: "25",
    params: "",
    note: "Outage on 12 Nov",
    requestId: "req-0001-aaaa",
  };
  const a = manualGrantArgs(base);
  ok(a.ok);
  eq(a.value, {
    user_id: userId,
    kind: "coins",
    amount: 25,
    params: { request_id: "req-0001-aaaa" },
    note: "Outage on 12 Nov",
  });
  ok(!manualGrantArgs({ ...base, userId: "nope" }).ok);
  ok(!manualGrantArgs({ ...base, kind: "mystery" }).ok);
  ok(!manualGrantArgs({ ...base, amount: "2.5" }).ok);
  ok(!manualGrantArgs({ ...base, amount: "0" }).ok);
  ok(!manualGrantArgs({ ...base, note: "  " }).ok);
  ok(!manualGrantArgs({ ...base, params: "[1]" }).ok);
  ok(manualGrantArgs({ ...base, kind: "entitlement_days", params: "{}" }).error.includes("entitlement_id"));
  ok(!manualGrantArgs({ ...base, kind: "badge", params: '{"badge":"founder"}' }).ok);
  eq(manualGrantArgs({ ...base, params: '{"request_id":"forged-id-1234"}' }).value.params.request_id, "req-0001-aaaa");

  const d = createDemoBackend();
  const g = await d.rpc("rewards_admin_grant", a.value);
  eq([g.state, g.amount, g.rule_id, g.program_key, g.params.manual, g.duplicate], [
    "granted",
    25,
    null,
    null,
    true,
    false,
  ]);
  ok(g.grant_key.startsWith("admin/"));
  eq((await d.rpc("rewards_admin_grant", a.value)).duplicate, true, "same request id");
  const ent = manualGrantArgs({
    ...base,
    kind: "entitlement_days",
    amount: "3",
    params: '{"entitlement_id":"premium"}',
  });
  eq((await d.rpc("rewards_admin_grant", { ...ent.value, params: { entitlement_id: "premium" } })).state, "queued");
  ok((await d.rpc("rewards_admin_user", { user_id: userId })).grants.some((x) => x.id === g.id));
  ok((await d.rpc("rewards_admin_log")).some((l) => l.action === "grant" && l.detail.note === "Outage on 12 Nov"));
  let err;
  try {
    await d.rpc("rewards_admin_grant", { ...a.value, note: "" });
  } catch (e) {
    err = e;
  }
  ok(reasonText(err).includes("note"));
});

Deno.test("surprise odds read the way people say them", async () => {
  const { chanceText, ruleSurprise } = await import("./lib.js");
  ok(
    chanceText(0.1) === "1 in 10" && chanceText(0.25) === "1 in 4" && chanceText(0.35) === "35 %" &&
      chanceText(1) === "always",
  );
  ok(chanceText(0) === null && chanceText(2) === null && chanceText(undefined) === null);
  ok(ruleSurprise({ chance: 0.1, amount_range: [5, 30] }) === "1 in 10 · 5–30");
  ok(ruleSurprise({ amount_range: [5, 30] }) === "5–30" && ruleSurprise({}) === "");
});

Deno.test("follow-up template, no rules, and the demo answers the follow-up endpoints", async () => {
  const { PROGRAM_TEMPLATES: T, ruleShape: rs, SETTINGS_FIELDS } = await import("./lib.js");
  ok(T.followup.channel === "notification" && rs("followup").rules === false);
  ok(
    SETTINGS_FIELDS.some(([k]) => k === "email_followups_enabled") && SETTINGS_FIELDS.some(([k]) => k === "quiet_from"),
  );
  const { describeTrigger } = await import("./view_followups.js");
  ok(
    describeTrigger({ type: "days_since_signup", from: 2, to: 3, no_activity_since_signup: true }) ===
      "2–3 days after sign-up, no activity since",
  );
  const d = createDemoBackend();
  ok((await d.rpc("rewards_admin_followup_preview", { program: "email_day2" })).count === 2);
  ok((await d.rpc("rewards_admin_followup_preview", { program: "comeback_2d" })).channel === "notification");
  ok((await d.rpc("rewards_admin_retention", { weeks: 8 })).length === 4);
  ok((await d.rpc("rewards_admin_followup_plan", { user_id: "x" })).plan.length === 1);
});

Deno.test("email templates: filled like the email function, refused like the database", async () => {
  const out = fillEmailTemplate(
    "<h1>{{heading}}</h1>{{body}}<a href='{{ url }}'>{{button}}</a>{{nope}}{{unsubscribe_url}}",
    {
      heading: "<b>",
      body: "a\n\nb",
      button: "Go",
      url: "https://x/?a=1&b=2",
      unsubscribe_url: "https://u",
    },
  );
  eq(out, "<h1>&lt;b&gt;</h1><p>a</p>\n<p>b</p><a href='https://x/?a=1&amp;b=2'>Go</a>https://u");
  eq(templateProblem("brand", "<p>{{unsubscribe_url}}</p>"), null);
  ok(templateProblem("Brand", "{{unsubscribe_url}}"));
  ok(templateProblem("brand", "<p>no link</p>").includes("unsubscribe_url"));
  const d = createDemoBackend();
  let err;
  try {
    await d.rpc("rewards_admin_email_template_save", { key: "x2", html: "<p>none</p>" });
  } catch (e) {
    err = e;
  }
  ok(reasonText(err).includes("{{unsubscribe_url}}"));
  await d.rpc("rewards_admin_email_template_save", { key: "x2", html: "{{unsubscribe_url}}" });
  const exp = await d.rpc("rewards_admin_export", { include_quiz: false });
  ok(exp.email_templates.some((t) => t.key === "x2"), "export carries templates");
  await d.rpc("rewards_admin_email_template_save", { key: "x2", html: null });
  eq((await d.rpc("rewards_admin_import", { config: exp, dry_run: true })).changes, [
    { what: "email_template", key: "x2", action: "create" },
  ]);
});

Deno.test("league: template, place rules, week lines, and the demo overview has counts only", async () => {
  const { PROGRAM_TEMPLATES: T, ruleShape: rs, leagueWeekLine } = await import("./lib.js");
  ok(T.league.group_size === 20 && T.league.tiers.length === 3);
  ok(rs("league").threshold === "required" && rs("league").repeats.join() === "once");
  ok(rs("league").thresholdLabel.startsWith("Place"));
  ok(
    leagueWeekLine({ week: "2026-11-09", groups: 2, closed_groups: 0, entries: 25 }) === "25 in 2 groups · 2 open",
  );
  ok(
    leagueWeekLine({
      groups: 1,
      closed_groups: 1,
      entries: 20,
      ranked: 18,
      top_score: 61,
      grants: 3,
      promoted: 3,
      demoted: 1,
    }) === "20 in 1 group · 18 ranked · top score 61 · 3 rewards · 3 up, 1 down",
  );
  const d = createDemoBackend();
  const rows = await d.rpc("rewards_admin_leagues", { program: null, weeks: 4 });
  ok(rows.length === 1 && rows[0].weeks.length === 2);
  ok(!JSON.stringify(rows).includes("user_id"));
  ok((await d.rpc("rewards_admin_league_close")).closed === 0);
});
