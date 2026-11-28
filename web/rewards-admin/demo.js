// In-memory stand-in for the rewards admin API (open the page with #demo). Same function names, arguments and answer
// shapes as the SQL (docs/rewards-api.md); refusals use the same `rewards: <reason>` messages. Nothing leaves the tab.

import { referralDemoFns } from "./demo_referral.js";

const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const uid = () => crypto.randomUUID();
/** The Monday n days before this week's (UTC), as a date. */
const monday = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - n);
  return d.toISOString().slice(0, 10);
};

/** `extra(ctx)` (optional) returns more demo functions; it may wrap the base ones (ctx.fns). */
export function createDemoBackend(extra = null) {
  const settings = {
    enabled: true,
    ads_enabled: false,
    rc_allow_sandbox: false,
    daily_grant_cap: 1000,
    default_timezone: "UTC",
    social_window_days: 7,
    surprise_daily_cap: 3,
    email_followups_enabled: false,
    email_cooldown_days: 4,
    email_max_series: 3,
    quiet_from: "21:00:00",
    quiet_to: "08:00:00",
    default_reminder_time: "19:00:00",
    events_retention_days: 90,
    max_attempts: 8,
    lease_minutes: 15,
  };
  const eventTypes = [
    { name: "chapter_finished", source: "server", daily_limit: 200 },
    { name: "quiz_finished", source: "server", daily_limit: 100 },
    { name: "ad_watched", source: "server", daily_limit: 20 },
  ];
  const programs = [
    {
      key: "reading_streak",
      kind: "streak",
      enabled: true,
      sort: 1,
      starts_at: null,
      ends_at: null,
      public: { title: "Reading streak" },
      config: { event: "chapter_finished", weekly_free_freezes: 1 },
    },
    {
      key: "daily_quiz",
      kind: "quiz",
      enabled: true,
      sort: 2,
      starts_at: null,
      ends_at: null,
      public: { title: "Daily quiz" },
      config: { bank: "default", questions: 3 },
    },
    {
      key: "happy_hour",
      kind: "window",
      enabled: true,
      sort: 3,
      starts_at: null,
      ends_at: null,
      public: {},
      config: { from: "21:00", to: "22:00" },
    },
  ];
  programs.push(
    {
      key: "comeback_2d",
      kind: "followup",
      enabled: true,
      sort: 20,
      starts_at: null,
      ends_at: null,
      public: {},
      config: {
        channel: "notification",
        trigger: { type: "inactive_days", days: 2 },
        time: "reminder",
        title: "Rewards demo",
        body: "Your next step is still here.",
        payload: "/home",
        group: "comeback",
      },
    },
    {
      key: "daily_reminder",
      kind: "followup",
      enabled: true,
      sort: 19,
      starts_at: null,
      ends_at: null,
      public: { group_label: "Daily reminder" },
      config: {
        channel: "notification",
        trigger: { type: "daily", min_actions: 1 },
        activity_events: ["chapter_finished"],
        time: "reminder",
        group: "reminder",
        title: "Rewards demo",
        body: "A chapter today?",
        payload: "/read",
      },
    },
    {
      key: "weekly_league",
      kind: "league",
      enabled: true,
      sort: 5,
      starts_at: null,
      ends_at: null,
      public: { title: "Reading league" },
      config: { event: "chapter_finished", group_size: 20, tiers: ["Bronze", "Silver", "Gold"], promote: 3 },
    },
    {
      key: "email_day2",
      kind: "followup",
      enabled: true,
      sort: 21,
      starts_at: null,
      ends_at: null,
      public: {},
      config: {
        channel: "email",
        trigger: { type: "days_since_signup", from: 2, to: 3, no_activity_since_signup: true },
        email: {
          subject: "Your first step is still saved",
          heading: "Hi {{name}}",
          body: "Two minutes today.",
          button: "Open",
          url: "https://example.com/open",
          template: "brand",
        },
      },
    },
  );
  const rules = [
    {
      id: uid(),
      program_key: "weekly_league",
      version: 1,
      threshold: 3,
      repeat: "once",
      kind: "coins",
      amount: 30,
      params: {},
      active: true,
    },
    {
      id: uid(),
      program_key: "reading_streak",
      version: 1,
      threshold: 7,
      repeat: "each_cycle",
      kind: "coins",
      amount: 50,
      params: {},
      active: true,
    },
    {
      id: uid(),
      program_key: "daily_quiz",
      version: 1,
      threshold: 2,
      repeat: "once",
      kind: "coins",
      amount: 10,
      params: {},
      active: true,
    },
    {
      id: uid(),
      program_key: "reading_streak",
      version: 2,
      threshold: 1,
      repeat: "every",
      kind: "minutes",
      amount: 30,
      params: { chance: 0.1, amount_range: [5, 30] },
      active: true,
    },
  ];
  const questions = [
    {
      id: uid(),
      bank: "default",
      kind: "choice",
      prompt: "Which voice reads the narrator?",
      choices: ["Mia", "Leo", "Ava"],
      answer: 0,
      time_limit_s: 15,
      media: {},
      explanation: null,
      tags: [],
      active: true,
    },
    {
      id: uid(),
      bank: "default",
      kind: "true_false",
      prompt: "A streak freeze saves a missed day.",
      choices: ["True", "False"],
      answer: 0,
      time_limit_s: 10,
      media: {},
      explanation: null,
      tags: [],
      active: true,
    },
  ];
  const userId = "11111111-2222-4333-8444-555555555555";
  const grants = [
    {
      id: uid(),
      user_id: userId,
      program_key: "reading_streak",
      kind: "coins",
      amount: 50,
      state: "granted",
      grant_key: "k1",
      last_error: null,
      attempts: 1,
      created_at: new Date().toISOString(),
    },
    {
      id: uid(),
      user_id: userId,
      program_key: "daily_quiz",
      kind: "coins",
      amount: 10,
      state: "failed",
      grant_key: "k2",
      last_error: "app ledger offline",
      attempts: 8,
      created_at: new Date().toISOString(),
    },
  ];
  const posts = [
    {
      id: uid(),
      user_id: userId,
      program_key: "tag_us",
      cycle: 1,
      platform: "instagram",
      handle: "reader.one",
      code: "READ-K7Q2HX",
      state: "pending",
      post_url: "https://www.instagram.com/p/AbCdE123/",
      created_at: new Date().toISOString(),
    },
  ];
  const admins = new Set(["demo-admin"]);
  const log = [];
  const note = (action, detail) =>
    log.unshift({ id: log.length + 1, at: new Date().toISOString(), actor: "demo-admin", action, detail });
  const fail = (reason) => {
    throw new Error(`rewards: ${reason}`);
  };
  const exportCfg = (withQuiz) => ({
    format: "rewards-config",
    version: 1,
    exported_at: new Date().toISOString(),
    settings: { ...settings },
    event_types: structuredClone(eventTypes),
    programs: structuredClone(programs),
    rules: rules.filter((r) => r.active).map(({ program_key, threshold, repeat, kind, amount, params }) => ({
      program: program_key,
      threshold,
      repeat,
      kind,
      amount,
      params,
    })),
    email_templates: [...emailTemplates.values()].map(({ key, html }) => ({ key, html })),
    quiz_questions: withQuiz ? structuredClone(questions) : null,
  });
  const emailTemplates = new Map([[
    "brand",
    {
      key: "brand",
      html:
        '<div style="font-family:Georgia,serif;max-width:520px;margin:auto;padding:24px;border-top:6px solid #b45309">\n<h1>{{heading}}</h1>\n{{body}}\n<p><a href="{{url}}" style="background:#b45309;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">{{button}}</a></p>\n<p style="font-size:12px;color:#777">{{app_name}} · <a href="{{unsubscribe_url}}">Stop these emails</a></p>\n</div>',
      updated_at: new Date().toISOString(),
    },
  ]]);

  const followupSends = [
    {
      id: uid(),
      program_key: "email_day2",
      user_id: userId,
      channel: "email",
      state: "sent",
      provider_id: "re_1",
      error: null,
      created_at: new Date().toISOString(),
    },
  ];
  const fns = {
    ...referralDemoFns(),
    rewards_admin_followup_preview: ({ program }) => {
      const p = programs.find((x) => x.key === program && x.kind === "followup") ?? fail("unknown_program");
      if (p.config.channel !== "email") {
        return {
          channel: "notification",
          note: "Notifications are planned on each phone (rewards_followups_plan); preview a user below.",
        };
      }
      return {
        channel: "email",
        emails_on: settings.email_followups_enabled,
        count: 2,
        sample: [{ user_id: userId, email: "a***@example.com" }, { user_id: uid(), email: "r***@example.com" }],
      };
    },
    rewards_admin_followup_plan: () => ({
      server_time: new Date().toISOString(),
      plan: [
        {
          id: 101,
          program: "comeback_2d",
          at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          title: "Rewards demo",
          body: "Your next step is still here.",
          payload: "/home",
          group: "daily",
        },
      ],
    }),
    rewards_admin_leagues: ({ program }) =>
      programs.filter((p) => p.kind === "league" && (!program || p.key === program)).map((p) => ({
        program: p.key,
        live: p.enabled,
        group_size: p.config.group_size ?? 20,
        tiers: p.config.tiers ?? [],
        members: 57,
        left: 4,
        members_by_tier: [{ tier: 0, members: 41 }, { tier: 1, members: 13 }, { tier: 2, members: 3 }],
        current_week: monday(0),
        ends_at: `${monday(-7)}T00:00:00+00:00`,
        weeks: [
          {
            week: monday(0),
            groups: 3,
            closed_groups: 0,
            entries: 38,
            ranked: 0,
            top_score: null,
            grants: 0,
            promoted: 0,
            demoted: 0,
            group_sizes: [{ tier: 0, size: 20, closed: false }, { tier: 0, size: 9, closed: false }, {
              tier: 1,
              size: 9,
              closed: false,
            }],
          },
          {
            week: monday(7),
            groups: 3,
            closed_groups: 3,
            entries: 44,
            ranked: 39,
            top_score: 61,
            grants: 9,
            promoted: 6,
            demoted: 0,
            group_sizes: [{ tier: 0, size: 20, closed: true }, { tier: 0, size: 16, closed: true }, {
              tier: 1,
              size: 8,
              closed: true,
            }],
          },
        ],
      })),
    rewards_admin_league_close: () => {
      note("league_close", { closed: 0 });
      return { closed: 0 };
    },
    rewards_admin_followup_sends: () => followupSends,
    rewards_admin_email_templates: () => [...emailTemplates.values()].map((t) => ({ ...t })),
    rewards_admin_email_template_save: ({ key, html }) => {
      if (html === null) {
        emailTemplates.delete(key);
        note("email_template_delete", { key });
        return { key, deleted: true };
      }
      if (!String(html).includes("{{unsubscribe_url}}")) fail("template_needs_unsubscribe");
      emailTemplates.set(key, { key, html, updated_at: new Date().toISOString() });
      note("email_template_save", { key, length: html.length });
      return { key, saved: true };
    },
    rewards_admin_retention: () =>
      [0, 1, 2, 3].map((w) => ({
        week: day(7 * (3 - w)),
        signups: 20 + w * 3,
        activated_24h: 12 + w,
        returned_d1: 4 + w,
        active_3_of_7: 3 + w,
        notification_opens: 9 + w * 2,
        opens_then_active_24h: 5 + w,
        emails_sent: 6 + w,
        unsubscribed: w === 2 ? 1 : 0,
      })),
    rewards_admin_config: () => ({
      settings: { ...settings },
      event_types: structuredClone(eventTypes),
      programs: programs.map((p) => ({
        ...structuredClone(p),
        live: p.enabled,
        rules: rules.filter((r) => r.program_key === p.key),
      })),
    }),
    rewards_admin_save_settings: ({ patch }) => {
      for (const k of Object.keys(patch ?? {})) if (!(k in settings)) fail(`unknown_setting ${k}`);
      Object.assign(settings, patch);
      note("save_settings", patch);
      return { ...settings };
    },
    rewards_admin_save_event_type: ({ name, source, daily_limit }) => {
      if (!/^[a-z][a-z0-9_]{1,39}$/.test(name) || /review|rating/.test(name)) {
        throw new Error("new row violates check constraint");
      }
      const t = eventTypes.find((x) => x.name === name);
      if (t) Object.assign(t, { source, daily_limit });
      else eventTypes.push({ name, source, daily_limit });
      note("save_event_type", { name });
      return { name, source, daily_limit };
    },
    rewards_admin_save_program: (a) => {
      const p = programs.find((x) => x.key === a.key);
      if (p && p.kind !== a.kind) fail("a program's kind cannot change");
      const row = {
        key: a.key,
        kind: a.kind,
        enabled: a.enabled,
        config: a.config,
        public: a.public,
        starts_at: a.starts_at,
        ends_at: a.ends_at,
        sort: a.sort,
      };
      if (p) Object.assign(p, row);
      else programs.push(row);
      note("save_program", { key: a.key });
      return row;
    },
    rewards_admin_add_rule: ({ program, kind, amount, threshold, repeat, params }) => {
      if (!programs.some((p) => p.key === program)) fail("unknown_program");
      const version = 1 + Math.max(0, ...rules.filter((r) => r.program_key === program).map((r) => r.version));
      const r = { id: uid(), program_key: program, version, threshold, repeat, kind, amount, params, active: true };
      rules.push(r);
      note("add_rule", { program });
      return r;
    },
    rewards_admin_set_rule_active: ({ rule_id, active }) => {
      const r = rules.find((x) => x.id === rule_id) ?? fail("unknown_rule");
      r.active = active;
      note("set_rule_active", { rule_id, active });
      return r;
    },
    rewards_admin_set_admin: (
      { user_id, admin },
    ) => (admin ? admins.add(user_id) : admins.delete(user_id), note("set_admin", { user_id, admin }), admin),
    rewards_admin_user: ({ user_id }) => ({
      state: {
        enabled: true,
        streaks: [{ program: "reading_streak", current: 4, longest: 9, today_done: true }],
        inbox: [],
        badges: [{ badge: "night_owl" }],
      },
      timezone: "Asia/Kolkata",
      grants: grants.filter((g) => g.user_id === user_id),
      events: user_id === userId ? [{ type: "chapter_finished", count: 42, last_at: new Date().toISOString() }] : [],
      social_posts: posts.filter((p) => p.user_id === user_id),
    }),
    rewards_admin_track: (
      { user_id, type },
    ) => (note("track", { user_id, type }), { enabled: true, duplicate: false, grants: [], streaks: [] }),
    rewards_admin_grant: ({ user_id, kind, amount, params, note: why }) => {
      if (!/^[0-9a-f-]{36}$/i.test(String(user_id))) fail("unknown_user");
      if (!String(why ?? "").trim() || String(why).length > 500) fail("note_required");
      if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) fail("bad_amount");
      if (!/^[a-z][a-z0-9_]{1,39}$/.test(String(kind)) || kind === "mystery") fail("bad_kind");
      const { request_id, ...p } = params ?? {};
      if (p.program && !programs.some((x) => x.key === p.program)) fail("unknown_program");
      if (kind === "entitlement_days" && !p.entitlement_id) {
        fail("bad_params (entitlement_days needs params.entitlement_id)");
      }
      if (kind === "badge" && (!p.badge || !p.program)) {
        fail("bad_params (badge needs params.badge and params.program)");
      }
      const key = `admin/${user_id}/${request_id ?? uid()}`;
      const old = grants.find((g) => g.grant_key === key);
      if (old) return { ...old, duplicate: true };
      const g = {
        id: uid(),
        user_id,
        program_key: p.program ?? null,
        rule_id: null,
        kind,
        amount,
        params: { ...p, manual: true },
        state: ["entitlement_days", "rc_currency"].includes(kind) ? "queued" : "granted",
        grant_key: key,
        last_error: null,
        attempts: 0,
        created_at: new Date().toISOString(),
      };
      grants.unshift(g);
      note("grant", { user_id, grant_id: g.id, kind, amount, params: g.params, note: String(why).trim() });
      return { ...g, duplicate: false };
    },
    rewards_admin_grants: ({ state, program }) =>
      grants.filter((g) => (!state || g.state === state) && (!program || g.program_key === program)),
    rewards_admin_retry_grant: ({ grant_id }) => {
      const g = grants.find((x) => x.id === grant_id && ["failed", "failed_retryable"].includes(x.state)) ??
        fail("not_retryable");
      Object.assign(g, { state: "granted", attempts: 0, last_error: null });
      note("retry_grant", { grant_id });
      return g;
    },
    rewards_admin_social_queue: ({ state }) => posts.filter((p) => p.state === (state ?? "pending")),
    rewards_admin_review_social: ({ post_id, approve }) => {
      const p = posts.find((x) => x.id === post_id) ?? fail("unknown post");
      p.state = approve ? "verified" : "rejected";
      note("review_social", { post_id, approve });
      return { state: p.state, grants: approve ? 1 : 0 };
    },
    rewards_admin_log: () => log,
    rewards_admin_analytics: ({ days }) => ({
      since: day(days - 1),
      daily: Array.from(
        { length: Math.min(days, 30) },
        (_, i) => ({
          day: day(Math.min(days, 30) - 1 - i),
          events: 300 + ((i * 37) % 120),
          active_users: 80 + ((i * 13) % 40),
          grants: 20 + ((i * 7) % 15),
        }),
      ),
      events_by_type: [{ type: "chapter_finished", events: 5400, users: 610 }, {
        type: "quiz_finished",
        events: 820,
        users: 300,
      }, { type: "ad_watched", events: settings.ads_enabled ? 140 : 0, users: 60 }],
      grants_by_program: [{ program: "reading_streak", kind: "coins", state: "granted", count: 210, amount: 10500 }, {
        program: "daily_quiz",
        kind: "coins",
        state: "failed",
        count: 1,
        amount: 10,
      }],
      streaks: [["1", 140], ["2-3", 90], ["4-6", 55], ["7-13", 30], ["14-29", 12], ["30+", 4]].map((
        [bucket, users],
      ) => ({ program: "reading_streak", bucket, users })),
      milestones: [{ program: "explorer", users: 400, avg_count: 3.2 }],
      offers: [{ program: "welcome", started: 300, claimed: 120, expired_unclaimed: 150, claim_rate: 0.4 }],
      social: [{
        program: "tag_us",
        state: "pending",
        verified_by: null,
        count: posts.filter((p) => p.state === "pending").length,
      }],
      open_problems: {
        failed: grants.filter((g) => g.state === "failed").length,
        retrying: 0,
        skipped_cap_today: 0,
        social_pending: posts.filter((p) => p.state === "pending").length,
      },
    }),
    rewards_admin_export: ({ include_quiz }) => exportCfg(include_quiz),
    rewards_admin_import: ({ config, dry_run }) => {
      if (config?.format !== "rewards-config" || config?.version !== 1) {
        fail("bad_config (format rewards-config, version 1)");
      }
      const changes = [];
      for (const p of config.programs ?? []) {
        const cur = programs.find((x) => x.key === p.key);
        const action = !cur
          ? "create"
          : cur.kind !== p.kind
          ? "refused_kind_change"
          : JSON.stringify(cur.config) === JSON.stringify(p.config)
          ? "same"
          : "update";
        if (action !== "same") changes.push({ what: "program", key: p.key, action });
        if (!dry_run && action === "create") programs.push(structuredClone(p));
        if (!dry_run && action === "update") Object.assign(cur, p);
      }
      for (const t of config.email_templates ?? []) {
        const cur = emailTemplates.get(t.key);
        if (cur?.html === t.html) continue;
        changes.push({ what: "email_template", key: t.key, action: cur ? "update" : "create" });
        if (!dry_run) emailTemplates.set(t.key, { key: t.key, html: t.html, updated_at: new Date().toISOString() });
      }
      if (!dry_run) note("import", { changes: changes.length });
      return { applied: !dry_run, changes };
    },
    rewards_admin_quiz_save: ({ bank, questions: qs }) => {
      for (const q of qs) {
        if (!Array.isArray(q.choices) || q.choices.length < 2 || q.answer < 0 || q.answer >= q.choices.length) {
          throw new Error("new row violates check constraint");
        }
        const cur = q.id && questions.find((x) => x.id === q.id);
        if (cur) Object.assign(cur, q);
        else questions.push({ id: uid(), bank, media: {}, tags: [], active: true, ...q });
      }
      note("quiz_save", { bank, count: qs.length });
      return qs.length;
    },
    rewards_admin_quiz_list: ({ bank }) => questions.filter((q) => q.bank === bank),
    rewards_admin_quiz_stats: ({ bank }) =>
      questions.filter((q) => q.bank === bank).map((q, i) => ({
        id: q.id,
        prompt: q.prompt,
        kind: q.kind,
        served: 50 + i,
        answered: 48 + i,
        correct: 12 + i * 20,
        timed_out: 3,
        correct_rate: (12 + i * 20) / (48 + i),
      })),
  };

  if (extra) Object.assign(fns, extra({ programs, rules, settings, eventTypes, grants, note, fns: { ...fns } }));

  return {
    async rpc(fn, params = {}) {
      await new Promise((r) => setTimeout(r, 60));
      const f = fns[fn];
      if (!f) throw new Error(`PGRST202 Could not find the function public.${fn}`);
      return structuredClone(f(params));
    },
  };
}
